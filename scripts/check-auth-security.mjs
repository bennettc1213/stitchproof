import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { randomBytes, randomUUID, createHmac, createPrivateKey, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  app = process.env.APP_URL || 'http://127.0.0.1:3000';
const local = (value) => ['localhost', '127.0.0.1'].includes(new URL(value).hostname);
if (
  process.env.NODE_ENV === 'production' ||
  process.env.ALLOW_DEV_SEED !== 'true' ||
  !url ||
  !local(url) ||
  !local(app)
)
  throw new Error('Auth security checks require explicitly enabled local fixtures.');
const status = JSON.parse(
  execFileSync(
    process.execPath,
    ['node_modules/supabase/dist/supabase.js', 'status', '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  ),
);
assert.equal(new URL(status.API_URL).host, new URL(url).host);
assert.ok(status.JWT_SECRET, 'Local signing configuration is required; no tokens were printed.');
const containers = execFileSync('docker', ['ps', '--format', '{{json .}}'], {
  encoding: 'utf8',
  windowsHide: true,
})
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((value) => JSON.parse(value));
const authContainer = containers.find(
  (value) =>
    value.Names.startsWith('supabase_auth_') &&
    JSON.parse(
      execFileSync('docker', ['inspect', value.ID], { encoding: 'utf8', windowsHide: true }),
    )[0].Config.Env.includes('GOTRUE_JWT_SECRET=' + status.JWT_SECRET),
);
assert.ok(authContainer, 'The matching local Auth container is required.');
const authEnvironment = JSON.parse(
  execFileSync('docker', ['inspect', authContainer.ID], {
    encoding: 'utf8',
    windowsHide: true,
  }),
)[0].Config.Env;
const signingKeys = JSON.parse(
  authEnvironment
    .find((value) => value.startsWith('GOTRUE_JWT_KEYS='))
    .slice('GOTRUE_JWT_KEYS='.length),
);
assert.ok(process.env.AUTH_RATE_LIMIT_SECRET?.length >= 32);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const client = () => createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const checked = async (request) => {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data;
};
const tag = randomBytes(6).toString('hex'),
  password = randomBytes(24).toString('base64url');
const account = async (label) => {
  const email = `auth-security-${label}-${tag}@example.test`;
  const { user } = await checked(
    service.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  const db = client();
  await checked(db.auth.signInWithPassword({ email, password }));
  return { email, id: user.id, db };
};
const owner = await account('owner'),
  limited = await account('limited');
await checked(
  owner.db.rpc('onboard_shop', {
    p_name: 'Session security check',
    p_timezone: 'America/Los_Angeles',
    p_policy: 'Fictional policy.',
  }),
);
const order = randomUUID();
await checked(
  owner.db.rpc('create_order', {
    p_title: 'Private session refresh fixture',
    p_customer_name: 'Synthetic Customer',
    p_email: 'session-customer@example.test',
    p_company: '',
    p_due: null,
    p_key: order,
  }),
);
const digest = (action, email) =>
  createHmac('sha256', process.env.AUTH_RATE_LIMIT_SECRET)
    .update('threadproof-auth\0' + action + '\0' + email.trim().toLowerCase())
    .digest('hex');
const consume = (action, email) =>
  checked(
    service.rpc('consume_auth_attempt', { p_action: action, p_digest: digest(action, email) }),
  );
// Avoid splitting this concurrency check over a fixed-window boundary.
if (Date.now() % 600000 > 598000) await new Promise((resolve) => setTimeout(resolve, 2200));
const attempts = await Promise.all(
  Array.from({ length: 20 }, () => consume('login', 'parallel-' + tag + '@example.test')),
);
assert.equal(attempts.filter((result) => result.allowed).length, 10);
assert.ok(
  (
    await client().rpc('consume_auth_attempt', {
      p_action: 'login',
      p_digest: digest('login', owner.email),
    })
  ).error,
);
assert.ok((await owner.db.from('auth_attempt_limits').select('digest')).error);
console.log(
  'Independent parallel limit calls allow exactly ten attempts; anonymous/member counter access is denied.',
);

const browser = await chromium.launch();
const abuse = await browser.newContext(),
  context = await browser.newContext();
const limitedPage = await abuse.newPage(),
  page = await context.newPage();
page.setDefaultTimeout(20000);
limitedPage.setDefaultTimeout(20000);
const actionForm = (target, intent) =>
  target.locator('form').filter({ has: target.locator(`input[name="intent"][value="${intent}"]`) });
const login = async (target, email) => {
  await target.goto(app + '/login');
  await target.getByLabel('Email address', { exact: true }).fill(email);
  await target.getByLabel('Password', { exact: true }).fill(password);
  await target.getByRole('button', { name: 'Log in', exact: true }).click();
  await target.waitForURL('**/app/orders');
};
const decode = (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
const claims = (token) => decode(token.split('.')[1]);
async function sessionCookies() {
  const all = (await context.cookies()).filter((cookie) =>
    /^sb-.+-auth-token(?:\.\d+)?$/.test(cookie.name),
  );
  assert.ok(all.length, 'A real SSR session cookie is required.');
  const base = all[0].name.replace(/\.\d+$/, '');
  const joined = [...all]
    .sort((a, b) => Number(a.name.split('.').at(-1) || 0) - Number(b.name.split('.').at(-1) || 0))
    .map((cookie) => cookie.value)
    .join('');
  assert.ok(joined.startsWith('base64-'));
  return { base, template: all[0], session: decode(joined.slice(7)) };
}
async function inject(session, base, template) {
  await context.clearCookies({ name: /^sb-.+-auth-token(?:\.\d+)?$/ });
  const value = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');
  const parts = Array.from({ length: Math.ceil(value.length / 3000) }, (_, index) =>
    value.slice(index * 3000, (index + 1) * 3000),
  );
  await context.addCookies(
    parts.map((value, index) => ({
      name: parts.length === 1 ? base : base + '.' + index,
      value,
      domain: template.domain,
      path: template.path,
      httpOnly: template.httpOnly,
      secure: template.secure,
      sameSite: template.sameSite,
      expires: template.expires,
    })),
  );
}
async function expire(invalidRefresh = false) {
  const snapshot = await sessionCookies();
  const header = decode(snapshot.session.access_token.split('.')[0]);
  assert.equal(header.alg, 'ES256', 'This fixture requires the local ES256 signing setup.');
  const key = (Array.isArray(signingKeys) ? signingKeys : signingKeys.keys).find(
    (value) => value.kid === header.kid && value.d,
  );
  assert.ok(key, 'The matching local signing key is required.');
  const payload = claims(snapshot.session.access_token),
    expired = Math.floor(Date.now() / 1000) - 120;
  payload.exp = expired;
  payload.iat = Math.min(payload.iat, expired - 60);
  const unsigned =
    Buffer.from(JSON.stringify(header)).toString('base64url') +
    '.' +
    Buffer.from(JSON.stringify(payload)).toString('base64url');
  const access =
    unsigned +
    '.' +
    sign('sha256', Buffer.from(unsigned), {
      key: createPrivateKey({ key, format: 'jwk' }),
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url');
  const rejected = await fetch(url + '/auth/v1/user', {
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      Authorization: 'Bearer ' + access,
    },
  });
  assert.equal(rejected.status, 403);
  const rejection = await rejected.json();
  assert.ok(
    /expired/i.test(rejection.msg || rejection.message || ''),
    'Auth must reject the validly signed fixture specifically for expiry.',
  );
  await inject(
    {
      ...snapshot.session,
      access_token: access,
      expires_at: expired,
      ...(invalidRefresh ? { refresh_token: randomBytes(24).toString('hex') } : {}),
    },
    snapshot.base,
    snapshot.template,
  );
  return access;
}
try {
  // Both successes and failures count; normalization cannot bypass the identity bucket.
  await limitedPage.goto(app + '/login');
  for (let index = 0; index < 10; index++) {
    await limitedPage
      .getByLabel('Email address', { exact: true })
      .fill(index % 2 ? limited.email : limited.email.toUpperCase());
    await limitedPage.getByLabel('Password', { exact: true }).fill('incorrect-password-' + tag);
    await limitedPage.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(actionForm(limitedPage, 'login').getByRole('alert')).toContainText(
      'Invalid login credentials',
    );
    await expect(limitedPage.getByRole('button', { name: 'Log in', exact: true })).toBeEnabled();
  }
  await limitedPage.getByLabel('Email address', { exact: true }).fill(limited.email);
  await limitedPage.getByLabel('Password', { exact: true }).fill(password);
  await limitedPage.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(actionForm(limitedPage, 'login').getByRole('alert')).toContainText(
    'Too many authentication attempts',
  );
  await expect(limitedPage.getByLabel('Email address', { exact: true })).toHaveValue(limited.email);
  assert.equal(new URL(limitedPage.url()).pathname, '/login');
  await limitedPage.reload();
  await limitedPage.getByLabel('Email address', { exact: true }).fill(limited.email);
  await limitedPage.getByLabel('Password', { exact: true }).fill(password);
  await limitedPage.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(actionForm(limitedPage, 'login').getByRole('alert')).toContainText(
    'Too many authentication attempts',
  );
  const forgotten = `forgot-limit-${tag}@example.test`;
  await limitedPage.goto(app + '/forgot-password');
  for (let index = 0; index < 3; index++) {
    await limitedPage.getByLabel('Email address', { exact: true }).fill(forgotten);
    await limitedPage.getByRole('button', { name: 'Request reset link', exact: true }).click();
    await expect(
      actionForm(limitedPage, 'forgot')
        .getByRole('status')
        .or(actionForm(limitedPage, 'forgot').getByRole('alert')),
    ).toBeVisible();
    await expect(
      limitedPage.getByRole('button', { name: 'Request reset link', exact: true }),
    ).toBeEnabled();
  }
  await limitedPage.getByRole('button', { name: 'Request reset link', exact: true }).click();
  await expect(actionForm(limitedPage, 'forgot').getByRole('alert')).toContainText(
    'Too many authentication attempts',
  );
  const signup = `signup-limit-${tag}@example.test`;
  for (let index = 0; index < 3; index++) assert.ok((await consume('signup', signup)).allowed);
  await limitedPage.goto(app + '/signup');
  await limitedPage.getByLabel('Email address', { exact: true }).fill(signup);
  await limitedPage.getByLabel('Password', { exact: true }).fill(password);
  await limitedPage.getByRole('button', { name: 'Create your account', exact: true }).click();
  await expect(actionForm(limitedPage, 'signup').getByRole('alert')).toContainText(
    'Too many authentication attempts',
  );
  assert.match(
    (await client().auth.signInWithPassword({ email: signup, password })).error?.message || '',
    /Invalid login credentials/,
  );
  console.log('Browser login/recovery/signup guards persist across reload and retain input.');

  await login(page, owner.email);
  const expired = await expire();
  const response = await page.goto(app + '/app/orders/' + order);
  assert.equal(response.status(), 200);
  await expect(
    page.getByRole('heading', { name: 'Private session refresh fixture', exact: true }),
  ).toBeVisible();
  let refreshed = await sessionCookies();
  assert.notEqual(refreshed.session.access_token, expired);
  assert.ok(claims(refreshed.session.access_token).exp > Date.now() / 1000);
  assert.equal(claims(refreshed.session.access_token).sub, owner.id);
  assert.match(response.headers()['cache-control'] || '', /no-store/);
  // This route is outside the proxy matcher: its Route Handler must persist refresh cookies itself.
  await expire();
  const exported = await context.request.get(app + '/api/export');
  assert.equal(exported.status(), 200);
  assert.ok((await exported.json()).orders.some((value) => value.id === order));
  refreshed = await sessionCookies();
  assert.ok(claims(refreshed.session.access_token).exp > Date.now() / 1000);
  // Parallel requests share the provider's refresh-token reuse grace and must never cross shops.
  await expire();
  const parallel = await Promise.all([
    context.request.get(app + '/api/export'),
    context.request.get(app + '/api/orders/' + order + '/pdf'),
    context.request.get(app + '/app/orders/' + order),
  ]);
  assert.deepEqual(
    parallel.map((result) => result.status()),
    [200, 200, 200],
  );
  await page.goto(app + '/app/orders/' + order);
  await expect(
    page.getByRole('heading', { name: 'Private session refresh fixture', exact: true }),
  ).toBeVisible();
  await expire(true);
  await page.goto(app + '/app/orders/' + order);
  await page.waitForURL('**/login');
  await expect(
    page.getByRole('heading', { name: 'Private session refresh fixture', exact: true }),
  ).toHaveCount(0);
  assert.equal((await context.request.get(app + '/api/export')).status(), 401);
  await login(page, owner.email);
  const snapshot = await sessionCookies(),
    parts = snapshot.session.access_token.split('.');
  parts[2] = (parts[2][0] === 'a' ? 'b' : 'a') + parts[2].slice(1);
  await inject(
    { ...snapshot.session, access_token: parts.join('.') },
    snapshot.base,
    snapshot.template,
  );
  assert.equal((await context.request.get(app + '/api/export')).status(), 401);
  await page.goto(app + '/app/orders/' + order);
  await page.waitForURL('**/login');
  await mkdir('.local', { recursive: true });
  await writeFile(
    '.local/auth-security-check.json',
    JSON.stringify(
      {
        status: 'passed',
        checked_at: new Date().toISOString(),
        scenarios:
          'Shared parallel counters, private counter permissions, normalized login throttling/reload persistence/input retention, recovery/signup guards, cryptographically signed expired local access tokens refreshing through SSR/proxy and private Route Handlers, parallel refresh requests, invalid refresh and tampered-token denial. No session/password/token values are stored in this report.',
      },
      null,
      2,
    ),
  );
  console.log(
    'Forced signed-token expiry, SSR/API refresh, concurrent refresh, and invalid-session denial passed.',
  );
} finally {
  await browser.close();
}

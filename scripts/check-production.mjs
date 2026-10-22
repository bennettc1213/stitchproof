// Explicit local production-safety check. Run after `pnpm build` (with EMAIL_TRANSPORT=unconfigured).
// Scans the build for configured secret values, then starts the production server with each
// development-only or unsafe setting and confirms it refuses to serve app data.
import { spawn } from 'node:child_process';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const port = 3101;
const origin = `http://127.0.0.1:${port}`;
const results = [];
const pass = (name) => {
  results.push(name);
  console.log('PASS', name);
};

// 1. No configured secret appears anywhere in the build output.
const secrets = Object.entries(process.env).filter(
  ([key, value]) =>
    value &&
    value.length >= 16 &&
    /SECRET|SERVICE_ROLE|API_KEY|PASSWORD|WEBHOOK/.test(key) &&
    !key.startsWith('NEXT_PUBLIC_'),
);
try {
  const seeded = JSON.parse(await readFile('.local/seed-credentials.json', 'utf8'));
  for (const account of seeded.accounts || [])
    secrets.push(['seed password ' + account.email, account.password]);
} catch {}
assert.ok(secrets.length >= 4, 'Expected configured secrets to scan for.');
const files = [];
const walk = async (dir) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['cache', 'dev'].includes(entry.name)) await walk(full);
    } else if (entry.isFile()) files.push(full);
  }
};
await walk('.next');
assert.ok(
  files.some((file) => file.includes(path.join('.next', 'static'))),
  'Run pnpm build first.',
);
const leaks = [];
for (const file of files) {
  const text = (await readFile(file)).toString('latin1');
  for (const [key, value] of secrets) if (text.includes(value)) leaks.push(`${key} in ${file}`);
}
assert.deepEqual(leaks, [], 'Secret values must not be compiled into the build.');
pass(
  `${secrets.length} configured secrets absent from ${files.length} build files (client and server)`,
);

// 2. The production server refuses unsafe settings.
const safe = {
  NODE_ENV: 'production',
  APP_URL: 'https://stitchproof.example',
  ALLOW_DEV_SEED: 'false',
  EMAIL_TRANSPORT: 'unconfigured',
  STRIPE_MODE: 'test',
  STRIPE_ALLOW_LIVE: 'false',
};
const start = async (overrides) => {
  const server = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    { env: { ...process.env, ...safe, ...overrides }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  server.stdout.on('data', (chunk) => (log += chunk));
  server.stderr.on('data', (chunk) => (log += chunk));
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(origin + '/api/health');
      return { server, log: () => log };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  server.kill();
  throw new Error('Production server did not start:\n' + log);
};
const stop = (server) =>
  new Promise((resolve) => {
    server.once('exit', resolve);
    server.kill();
  });
const status = async (route) => (await fetch(origin + route, { redirect: 'manual' })).status;

{
  const { server } = await start({});
  const home = await fetch(origin + '/');
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('x-powered-by'), null);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.equal(home.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(await status('/login'), 200);
  assert.equal((await fetch(origin + '/api/ready')).status, 200);
  for (const route of [
    '/api/seed',
    '/api/dev',
    '/api/test',
    '/api/debug',
    '/_next/static/../../.env.local',
  ])
    assert.ok([404, 400].includes(await status(route)), route + ' must not exist');
  assert.equal(
    (await fetch(origin + '/api/internal/outbox', { method: 'POST' })).status,
    401,
    'Workers require their secret.',
  );
  await stop(server);
  pass('safe production settings serve the app with security headers; no test or debug routes');
}

// next.config.ts refuses these at build and start, so the server must never come up.
const refuses = (overrides) =>
  new Promise((resolve) => {
    const server = spawn(
      process.execPath,
      [
        'node_modules/next/dist/bin/next',
        'start',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(port),
      ],
      { env: { ...process.env, ...safe, ...overrides }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let log = '';
    server.stdout.on('data', (chunk) => (log += chunk));
    server.stderr.on('data', (chunk) => (log += chunk));
    const timer = setTimeout(() => {
      server.kill();
      resolve({ exited: false, log });
    }, 30000);
    server.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ exited: true, code, log });
    });
  });
for (const [name, overrides] of [
  ['development seeding enabled', { ALLOW_DEV_SEED: 'true' }],
  ['local development email outbox', { EMAIL_TRANSPORT: 'local' }],
  [
    'live Stripe without the explicit live guard',
    {
      STRIPE_MODE: 'live',
      STRIPE_SECRET_KEY: 'sk_live_' + 'x'.repeat(24),
      STRIPE_ALLOW_LIVE: 'false',
    },
  ],
  ['live Stripe key in test mode', { STRIPE_SECRET_KEY: 'sk_live_' + 'x'.repeat(24) }],
  ['non-HTTPS APP_URL', { APP_URL: 'http://stitchproof.example' }],
]) {
  const result = await refuses(overrides);
  assert.ok(result.exited && result.code !== 0, `${name}: the production server must not start`);
  assert.match(result.log, /Refusing a production build\/start/, name);
  pass(`${name}: production server refuses to start`);
}

await mkdir('.local', { recursive: true });
await writeFile(
  '.local/production-check.json',
  JSON.stringify({ checked_at: new Date().toISOString(), passed: results }, null, 2),
);
console.log('Production safety checks passed. Report: .local/production-check.json');

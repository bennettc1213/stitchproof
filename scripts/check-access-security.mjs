// Local adversarial acceptance: real Auth/PostgREST connections, Storage and browser actions.
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const app = process.env.APP_URL || 'http://127.0.0.1:3000';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const local = (value) => ['localhost', '127.0.0.1'].includes(new URL(value).hostname);
if (
  process.env.NODE_ENV === 'production' ||
  process.env.ALLOW_DEV_SEED !== 'true' ||
  !url ||
  !local(url) ||
  !local(app)
)
  throw new Error('Access checks require explicitly enabled local services.');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const client = () => createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const independentService = () => createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const checked = async (request) => {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data;
};
const denied = async (request) => assert.ok((await request).error, 'Operation must be rejected.');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');
const nonce = randomBytes(6).toString('hex'),
  password = randomBytes(24).toString('base64url');
const passed = [];
const record = (label) => {
  passed.push(label);
  console.log(label);
};
async function session(account) {
  const db = client();
  await checked(db.auth.signInWithPassword({ email: account.email, password }));
  return db;
}
async function account(label) {
  const email = `access-${label}-${nonce}@example.test`;
  const { user } = await checked(
    service.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  const person = { email, id: user.id };
  return { ...person, db: await session(person) };
}
const onboard = (person, label) =>
  checked(
    person.db.rpc('onboard_shop', {
      p_name: 'Fictional access check ' + label,
      p_timezone: 'America/Los_Angeles',
      p_policy: 'Synthetic review policy.',
    }),
  );
async function invitation(owner, person) {
  const secret = token();
  const id = await checked(
    owner.db.rpc('invite_staff', { p_email: person.email, p_digest: hash(secret) }),
  );
  return { id, secret };
}
const accept = (db, invite) => db.rpc('accept_invitation', { p_digest: hash(invite.secret) });
const memberships = (person) =>
  checked(service.from('memberships').select('workspace_id,role').eq('user_id', person.id));

async function invitationChecks() {
  const owner = await account('capacity-owner'),
    shop = await onboard(owner, 'capacity');
  const candidates = await Promise.all(
    ['a', 'b', 'c'].map((label) => account('capacity-' + label)),
  );
  const connections = await Promise.all(candidates.map(() => session(owner)));
  const secrets = candidates.map(() => token());
  const created = await Promise.all(
    connections.map((db, index) =>
      db.rpc('invite_staff', {
        p_email: candidates[index].email,
        p_digest: hash(secrets[index]),
      }),
    ),
  );
  assert.equal(created.filter((result) => !result.error).length, 2);
  const active = await checked(owner.db.rpc('team_details'));
  assert.equal(active.invitations.length, 2);
  assert.ok(!JSON.stringify(active).includes(secrets[0]));
  const index = created.findIndex((result) => !result.error),
    person = candidates[index];
  const invite = { id: created[index].data, secret: secrets[index] };
  const parallel = await Promise.all([
    accept(person.db, invite),
    accept(await session(person), invite),
  ]);
  assert.ok(parallel.every((result) => !result.error && result.data === shop));
  assert.deepEqual(await memberships(person), [{ workspace_id: shop, role: 'staff' }]);
  await denied(
    owner.db.rpc('invite_staff', {
      p_email: 'full-' + nonce + '@example.test',
      p_digest: hash(token()),
    }),
  );
  await denied(person.db.rpc('revoke_invitation', { p_id: invite.id }));
  await denied(person.db.from('invitations').select('token_digest'));
  await denied(client().rpc('accept_invitation', { p_digest: hash(invite.secret) }));
  record(
    'Parallel invitation creation respects two reserved seats; parallel acceptance is idempotent and private.',
  );

  // Release the other pending slot, then exercise replacement, wrong account, expiry and revocation.
  const pending = active.invitations.find((row) => row.id !== invite.id);
  await checked(owner.db.rpc('revoke_invitation', { p_id: pending.id }));
  const target = candidates.find((value) => value.id !== person.id);
  const old = await invitation(owner, target),
    replacement = await invitation(owner, target);
  await denied(accept(target.db, old));
  await denied(accept(person.db, replacement));
  await checked(
    service
      .from('invitations')
      .update({ expires_at: new Date(Date.now() - 60000).toISOString() })
      .eq('id', replacement.id),
  );
  await denied(accept(target.db, replacement));
  const revoked = await invitation(owner, target);
  await checked(owner.db.rpc('revoke_invitation', { p_id: revoked.id }));
  await denied(accept(target.db, revoked));
  const final = await invitation(owner, target);
  await checked(accept(target.db, final));
  await checked(owner.db.rpc('remove_staff', { p_user: target.id }));
  await denied(accept(target.db, final));
  assert.deepEqual(await memberships(target), []);
  record('Replaced, wrong-account, expired, revoked and removed-staff invitation reuse is denied.');

  // Each run uses a fresh shop so the creation-rate cap cannot mask a race.
  for (let round = 0; round < 3; round++) {
    const raceOwner = await account('revoke-owner-' + round),
      raceShop = await onboard(raceOwner, 'revoke');
    const invitee = await account('revoke-target-' + round),
      link = await invitation(raceOwner, invitee);
    const [accepted, revoked] = await Promise.all([
      accept(invitee.db, link),
      raceOwner.db.rpc('revoke_invitation', { p_id: link.id }),
    ]);
    assert.equal([accepted, revoked].filter((result) => !result.error).length, 1);
    const state = await checked(
      service.from('invitations').select('accepted_by,revoked_at').eq('id', link.id).single(),
    );
    if (!accepted.error) {
      assert.equal(state.accepted_by, invitee.id);
      assert.equal(state.revoked_at, null);
      assert.deepEqual(await memberships(invitee), [{ workspace_id: raceShop, role: 'staff' }]);
    } else {
      assert.ok(state.revoked_at);
      assert.equal(state.accepted_by, null);
      assert.deepEqual(await memberships(invitee), []);
      await denied(accept(invitee.db, link));
    }
  }
  record('Three independent acceptance/revocation races leave one consistent outcome.');

  const otherOwner = await account('other-owner'),
    otherShop = await onboard(otherOwner, 'other');
  const dual = await account('dual');
  const first = await invitation(otherOwner, dual),
    second = await invitation(owner, dual);
  const outcomes = await Promise.all([accept(dual.db, first), accept(await session(dual), second)]);
  assert.equal(outcomes.filter((result) => !result.error).length, 1);
  const joined = await memberships(dual);
  assert.equal(joined.length, 1);
  assert.ok([shop, otherShop].includes(joined[0].workspace_id));
  record('Simultaneous invitations from separate shops cannot create two memberships.');

  const onboardingPerson = await account('onboard-race'),
    onboardingLink = await invitation(otherOwner, onboardingPerson);
  const [accepted, onboarded] = await Promise.all([
    accept(onboardingPerson.db, onboardingLink),
    (await session(onboardingPerson)).rpc('onboard_shop', {
      p_name: 'Fictional concurrent signup',
      p_timezone: 'America/Los_Angeles',
      p_policy: '',
    }),
  ]);
  assert.ok(!onboarded.error);
  const finalMembership = await memberships(onboardingPerson);
  assert.equal(finalMembership.length, 1);
  assert.equal(finalMembership[0].workspace_id, onboarded.data);
  if (!accepted.error) assert.equal(accepted.data, onboarded.data);
  else assert.equal(finalMembership[0].role, 'owner');
  record('Concurrent onboarding and invitation acceptance retain exactly one shop per account.');

  const expiredOwner = await account('expired-owner'),
    expiredShop = await onboard(expiredOwner, 'expired');
  const expiredPerson = await account('expired-target'),
    expiredLink = await invitation(expiredOwner, expiredPerson);
  await checked(
    service
      .from('workspaces')
      .update({
        trial_ends_at: new Date(Date.now() - 86400000).toISOString(),
        paid_through: null,
        grace_until: null,
      })
      .eq('id', expiredShop),
  );
  await denied(accept(expiredPerson.db, expiredLink));
  await checked(expiredOwner.db.rpc('revoke_invitation', { p_id: expiredLink.id }));
  assert.deepEqual(await memberships(expiredPerson), []);
  record('Read-only shops reject new acceptance while retaining owner revocation.');
}

const garments = [
  {
    description: 'Fictional polos',
    color: 'Navy',
    sizes: [{ size: 'M', expected: 24, received: 24 }],
  },
];
const spec = {
  placement: 'Left chest',
  design: 'Synthetic wordmark',
  dimensions: '3 inches',
  thread: 'White',
  text: 'FIXTURE',
  instructions: 'Synthetic public instructions.',
};
async function order(owner, label) {
  const id = randomUUID();
  await checked(
    owner.db.rpc('create_order', {
      p_title: 'Security fixture ' + label,
      p_customer_name: 'Synthetic customer',
      p_email: 'fictional-review@example.test',
      p_company: '',
      p_due: null,
      p_key: id,
    }),
  );
  await checked(
    owner.db.rpc('save_intake', {
      p_order: id,
      p_revision: 0,
      p_garments: garments,
      p_spec: spec,
      p_reason: 'Fictional security fixture intake.',
    }),
  );
  await checked(
    owner.db.rpc('save_internal_note', {
      p_order: id,
      p_revision: 1,
      p_note: 'PRIVATE_SENTINEL_' + nonce,
    }),
  );
  return { id, revision: 2, owner };
}
async function upload(fixture, name, purpose = 'proof') {
  const bytes = await readFile('supabase/fixtures/northline-v1.png');
  const file = await checked(
    fixture.owner.db.rpc('reserve_attachment', {
      p_order: fixture.id,
      p_name: name,
      p_mime: 'image/png',
      p_bytes: bytes.length,
      p_purpose: purpose,
      p_caption: '',
    }),
  );
  await checked(
    service.storage.from('order-files').upload(file.path, bytes, { contentType: 'image/png' }),
  );
  await checked(
    service.rpc('finalize_attachment', { p_id: file.id, p_digest: hash(bytes), p_success: true }),
  );
  return { ...file, bytes };
}
async function send(fixture, file) {
  const secret = token();
  await checked(
    fixture.owner.db.rpc('send_proof', {
      p_order: fixture.id,
      p_revision: fixture.revision,
      p_files: [file.id],
      p_digest: hash(secret),
    }),
  );
  fixture.revision++;
  return secret;
}
const reviewForm = (page) =>
  page.locator('form').filter({ has: page.locator('input[name="intent"][value="review"]') });
async function prepareApproval(page, secret) {
  await page.goto(app + '/review/' + secret);
  await expect(page.getByRole('heading', { name: 'Let’s get the details right.' })).toBeVisible();
  const form = reviewForm(page);
  await expect(form.locator('input[name="design"]')).not.toBeChecked();
  await expect(form.locator('input[name="policy"]')).not.toBeChecked();
  await form.getByLabel('Your full name').fill('Synthetic Reviewer');
  await form.locator('input[name="design"]').check();
  await form.locator('input[name="policy"]').check();
}
async function reviewChecks(browser) {
  const owner = await account('review-owner');
  await onboard(owner, 'review');
  const other = await account('review-other');
  await onboard(other, 'other-review');
  const fixture = await order(owner, 'replacement');
  const original = await upload(fixture, 'original-proof.png'),
    current = await upload(fixture, 'current-proof.png');
  const condition = await upload(fixture, 'private-condition.png', 'condition');
  const draft = await upload(fixture, 'unsent-proof.png');
  const sibling = await order(owner, 'sibling'),
    siblingFile = await upload(sibling, 'sibling.png');
  const foreign = await order(other, 'foreign'),
    foreignFile = await upload(foreign, 'foreign.png');
  const context = await browser.newContext(),
    page = await context.newPage();
  page.setDefaultTimeout(15000);
  const fileRequest = (id, secret) =>
    context.request.get(app + '/api/files/' + id + (secret ? '?token=' + secret : ''));
  const active = async (secret, file) => {
    const response = await fileRequest(file.id, secret);
    assert.equal(response.status(), 200);
    assert.equal(hash(await response.body()), hash(file.bytes));
    assert.match(response.headers()['cache-control'], /no-store/);
    assert.equal(response.headers()['referrer-policy'], 'no-referrer');
  };
  const inactive = async (secret, file) => {
    const response = await page.goto(app + '/review/' + secret);
    await expect(
      page.getByRole('heading', { name: 'This review link is inactive.' }),
    ).toBeVisible();
    const html = await response.text();
    assert.ok(!html.includes('PRIVATE_SENTINEL_' + nonce));
    assert.ok(!html.includes('Security fixture replacement'));
    assert.equal((await fileRequest(file.id, secret)).status(), 404);
    assert.match(response.headers()['cache-control'], /no-store/);
    assert.match(response.headers()['x-robots-tag'], /noindex/);
    assert.equal(response.headers()['referrer-policy'], 'no-referrer');
  };
  try {
    const first = await send(fixture, original);
    await prepareApproval(page, first);
    const html = await page.content();
    assert.ok(!html.includes('PRIVATE_SENTINEL_' + nonce));
    await active(first, original);
    for (const file of [condition, draft, current, siblingFile, foreignFile])
      assert.equal((await fileRequest(file.id, first)).status(), 404);
    assert.equal((await fileRequest(original.id)).status(), 401);
    assert.equal((await fileRequest(original.id, token())).status(), 404);
    assert.equal((await fileRequest(original.id, 'invalid')).status(), 404);
    await denied(client().rpc('review_bundle', { p_digest: hash(first) }));
    await denied(owner.db.rpc('review_bundle', { p_digest: hash(first) }));
    record(
      'Public tokens expose only sent bundle files; conditions, drafts, sibling and foreign files remain private.',
    );

    const second = await send(fixture, current);
    // Keep the old page open to submit the stale Server Action, not only a fresh GET.
    await reviewForm(page).getByRole('button', { name: 'Approve this exact proof' }).click();
    await expect(reviewForm(page).getByRole('alert')).toContainText('inactive');
    await expect(reviewForm(page).getByLabel('Your full name')).toHaveValue('Synthetic Reviewer');
    await inactive(first, original);
    await active(second, current);
    assert.equal((await fileRequest(original.id, second)).status(), 404);
    assert.deepEqual(
      await checked(service.from('approval_decisions').select('id').eq('order_id', fixture.id)),
      [],
    );
    record(
      'Replacing a proof revokes old page/file access and rejects an already-open approval form without losing input.',
    );

    await prepareApproval(page, second);
    await checked(
      service
        .from('review_requests')
        .update({ expires_at: new Date(Date.now() - 60000).toISOString() })
        .eq('order_id', fixture.id)
        .eq('token_digest', hash(second)),
    );
    await reviewForm(page).getByRole('button', { name: 'Approve this exact proof' }).click();
    await expect(reviewForm(page).getByRole('alert')).toContainText('inactive');
    await inactive(second, current);
    const third = await send(fixture, current);
    await prepareApproval(page, third);
    await checked(owner.db.rpc('revoke_review', { p_order: fixture.id }));
    await reviewForm(page).getByRole('button', { name: 'Approve this exact proof' }).click();
    await expect(reviewForm(page).getByRole('alert')).toContainText('inactive');
    await inactive(third, current);
    assert.deepEqual(
      await checked(service.from('approval_decisions').select('id').eq('order_id', fixture.id)),
      [],
    );
    record(
      'Expired and owner-revoked reviews deny fresh pages/files and stale browser submissions.',
    );

    const receipt = await send(fixture, current),
      retryPage = await context.newPage();
    await prepareApproval(page, receipt);
    await prepareApproval(retryPage, receipt);
    await Promise.all(
      [page, retryPage].map((target) =>
        reviewForm(target).getByRole('button', { name: 'Approve this exact proof' }).click(),
      ),
    );
    for (const target of [page, retryPage])
      await expect(
        target.getByRole('heading', { name: 'Your approval is recorded.' }),
      ).toBeVisible();
    const decisions = await checked(
      service.from('approval_decisions').select('id,choice').eq('order_id', fixture.id),
    );
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].choice, 'approved');
    assert.equal(
      (
        await checked(
          service
            .from('email_outbox')
            .select('id')
            .eq('order_id', fixture.id)
            .eq('template', 'decision'),
        )
      ).length,
      1,
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your approval is recorded.' })).toBeVisible();
    assert.equal(await reviewForm(page).count(), 0);
    await active(receipt, current);
    await denied(
      independentService().rpc('decide_review', {
        p_digest: hash(receipt),
        p_choice: 'changes_requested',
        p_name: '',
        p_comments: 'Cannot replace a recorded choice',
        p_design: false,
        p_policy: false,
      }),
    );
    // New requests preserve a decided receipt, but expire its files once receipt expiry arrives.
    await send(fixture, current);
    await page.goto(app + '/review/' + receipt);
    await expect(page.getByRole('heading', { name: 'Your approval is recorded.' })).toBeVisible();
    await checked(
      service
        .from('review_requests')
        .update({ expires_at: new Date(Date.now() - 60000).toISOString() })
        .eq('order_id', fixture.id)
        .eq('token_digest', hash(receipt)),
    );
    await inactive(receipt, current);
    assert.equal(
      (await checked(service.from('approval_decisions').select('id').eq('order_id', fixture.id)))
        .length,
      1,
    );
    record(
      'Parallel browser retries create one decision/notification; same-link receipts stay read-only and expiry preserves shop records.',
    );
    const competing = await order(owner, 'competing browser decisions');
    const competingFile = await upload(competing, 'competing-proof.png');
    const competingToken = await send(competing, competingFile);
    await prepareApproval(page, competingToken);
    await prepareApproval(retryPage, competingToken);
    await reviewForm(retryPage)
      .getByRole('button', { name: 'Request changes', exact: true })
      .click();
    await reviewForm(retryPage)
      .getByLabel('What would you like changed?')
      .fill('Please adjust the fictional placement.');
    await Promise.all([
      reviewForm(page).getByRole('button', { name: 'Approve this exact proof' }).click(),
      reviewForm(retryPage).getByRole('button', { name: 'Send change request' }).click(),
    ]);
    let winner;
    await expect
      .poll(
        async () => {
          winner = await checked(
            service.from('approval_decisions').select('choice').eq('order_id', competing.id),
          );
          return winner.length;
        },
        { timeout: 15000 },
      )
      .toBe(1);
    assert.equal(winner.length, 1);
    assert.ok(['approved', 'changes_requested'].includes(winner[0].choice));
    const receiptHeading =
      winner[0].choice === 'approved'
        ? 'Your approval is recorded.'
        : 'Your changes are with the shop.';
    // Concurrent React renders can show the winner's receipt or the losing action's
    // conflict; a fresh read must converge to the single durable decision.
    for (const target of [page, retryPage]) {
      await expect(
        target
          .getByRole('heading', { name: receiptHeading })
          .or(reviewForm(target).getByRole('alert')),
      ).toBeVisible();
      if (await reviewForm(target).getByRole('alert').count())
        await expect(reviewForm(target).getByRole('alert')).toContainText('already been recorded');
      await target.reload();
      await expect(target.getByRole('heading', { name: receiptHeading })).toBeVisible();
      assert.equal(await reviewForm(target).count(), 0);
    }
    assert.equal(
      (
        await checked(
          service
            .from('email_outbox')
            .select('id')
            .eq('order_id', competing.id)
            .eq('template', 'decision'),
        )
      ).length,
      1,
    );
    record(
      'Competing approval/change browser actions converge to one immutable receipt and one notification.',
    );
  } finally {
    await context.close();
  }
}

let browser;
try {
  await mkdir('.local', { recursive: true });
  await invitationChecks();
  browser = await chromium.launch();
  await reviewChecks(browser);
  await writeFile(
    '.local/access-security-check.json',
    JSON.stringify(
      {
        status: 'passed',
        checked_at: new Date().toISOString(),
        checks: passed,
        limits:
          'Isolated fictional local fixtures. Expiry is advanced only on these fixtures. Real Auth/PostgREST connections, Storage and browser actions; no keys/passwords/tokens are stored in this report. HTTPS and provider delivery remain separate launch checks.',
      },
      null,
      2,
    ),
  );
  console.log('Connected invitation and public-review security checks passed.');
} catch (error) {
  await mkdir('.local', { recursive: true });
  await writeFile('.local/access-security-failure.txt', String(error), { mode: 0o600 });
  throw new Error(
    'Access security check failed. Details are in ignored .local/access-security-failure.txt.',
  );
} finally {
  await browser?.close();
}

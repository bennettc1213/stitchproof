import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
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
  throw new Error('Cleanup checks require explicitly enabled local fixtures.');
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const db = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
});
const checked = async (request) => {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data;
};
const bytes = await readFile('supabase/fixtures/northline-v2.png');
const digest = createHash('sha256').update(bytes).digest('hex');
const email = 'cleanup-' + randomBytes(6).toString('hex') + '@example.test',
  password = randomBytes(24).toString('base64url');
await checked(service.auth.admin.createUser({ email, password, email_confirm: true }));
const login = await checked(db.auth.signInWithPassword({ email, password }));
const workspace = await checked(
  db.rpc('onboard_shop', {
    p_name: 'Cleanup test shop',
    p_timezone: 'America/Los_Angeles',
    p_policy: 'Synthetic policy.',
  }),
);
const create = async () =>
  checked(
    db.rpc('create_order', {
      p_title: 'Cleanup fixture',
      p_customer_name: 'Synthetic customer',
      p_email: 'cleanup-customer@example.test',
      p_company: '',
      p_due: null,
      p_key: randomUUID(),
    }),
  );
const order = await create();
await checked(
  db.rpc('save_intake', {
    p_order: order,
    p_revision: 0,
    p_garments: [{ description: 'Polo', sizes: [{ size: 'M', expected: 1, received: 1 }] }],
    p_spec: { placement: 'Left chest' },
    p_reason: 'Synthetic reconciled intake.',
  }),
);
const reserve = async (orderId = order) =>
  checked(
    db.rpc('reserve_attachment', {
      p_order: orderId,
      p_name: 'fixture.png',
      p_mime: 'image/png',
      p_bytes: bytes.length,
      p_purpose: 'proof',
      p_caption: '',
    }),
  );
const upload = async (file) =>
  checked(
    service.storage
      .from('order-files')
      .upload(file.path, bytes, { contentType: 'image/png', upsert: false }),
  );
const ready = await reserve();
await upload(ready);
await checked(
  service.rpc('finalize_attachment', { p_id: ready.id, p_digest: digest, p_success: true }),
);
await checked(
  db.rpc('send_proof', {
    p_order: order,
    p_revision: 1,
    p_files: [ready.id],
    p_digest: createHash('sha256').update(randomBytes(32)).digest('hex'),
  }),
);
const stale = await reserve();
await upload(stale);
const failed = await reserve();
await upload(failed);
await checked(
  service.rpc('finalize_attachment', { p_id: failed.id, p_digest: null, p_success: false }),
);
await checked(
  service
    .from('attachments')
    .update({ created_at: new Date(Date.now() - 7200000).toISOString() })
    .eq('id', stale.id),
);
assert.equal((await fetch(app + '/api/internal/files', { method: 'POST' })).status, 401);
const clean = async () => {
  const r = await fetch(app + '/api/internal/files', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.OUTBOX_WORKER_SECRET },
  });
  assert.equal(r.status, 200);
  const value = await r.json();
  assert.equal(value.failed, 0);
  return value;
};
await Promise.all([clean(), clean()]);
for (const file of [stale, failed]) {
  assert.ok((await service.storage.from('order-files').download(file.path)).error);
  const row = await checked(
    service.from('attachments').select('state,cleaned_at').eq('id', file.id).single(),
  );
  assert.equal(row.state, 'abandoned');
  assert.ok(row.cleaned_at);
}
const history = await checked(service.storage.from('order-files').download(ready.path));
assert.equal(
  createHash('sha256')
    .update(Buffer.from(await history.arrayBuffer()))
    .digest('hex'),
  digest,
);
assert.ok(
  (await service.rpc('finalize_attachment', { p_id: stale.id, p_digest: digest, p_success: true }))
    .error,
  'Expired reservations cannot revive.',
);
let shop = await checked(
  service.from('workspaces').select('storage_used').eq('id', workspace).single(),
);
assert.equal(Number(shop.storage_used), bytes.length);
// A late orphan reappearing at an abandoned path is removed on the daily recheck.
await upload(stale);
await checked(
  service
    .from('attachments')
    .update({ cleaned_at: new Date(Date.now() - 172800000).toISOString() })
    .eq('id', stale.id),
);
await clean();
assert.ok((await service.storage.from('order-files').download(stale.path)).error);
const secondOrder = await create();
await checked(
  service
    .from('workspaces')
    .update({ storage_limit: bytes.length * 2 })
    .eq('id', workspace),
);
const clients = [0, 1].map(() =>
  createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer ' + login.session.access_token } },
  }),
);
const attempts = await Promise.all(
  clients.map((client, i) =>
    client.rpc('reserve_attachment', {
      p_order: i ? secondOrder : order,
      p_name: 'parallel.png',
      p_mime: 'image/png',
      p_bytes: bytes.length,
      p_purpose: 'proof',
      p_caption: '',
    }),
  ),
);
assert.equal(
  attempts.filter((value) => !value.error).length,
  1,
  'Parallel reservations across different orders must enforce one shared quota.',
);
shop = await checked(
  service.from('workspaces').select('storage_used').eq('id', workspace).single(),
);
assert.equal(Number(shop.storage_used), bytes.length * 2);
const winner = attempts.find((value) => !value.error).data;
await checked(
  service
    .from('attachments')
    .update({ created_at: new Date(Date.now() - 7200000).toISOString() })
    .eq('id', winner.id),
);
await clean();
shop = await checked(
  service.from('workspaces').select('storage_used').eq('id', workspace).single(),
);
assert.equal(Number(shop.storage_used), bytes.length);
assert.ok(!(await service.storage.from('order-files').download(ready.path)).error);
await writeFile(
  '.local/cleanup-check.json',
  JSON.stringify(
    {
      status: 'passed',
      checked_at: new Date().toISOString(),
      scenarios:
        'Authenticated parallel cleanup, expired/failed upload removal, quota release, late-orphan recheck, immutable sent-file preservation, and parallel cross-order quota reservations.',
    },
    null,
    2,
  ),
);
console.log(
  'Real Storage cleanup and parallel quota checks passed. Sent proof files were preserved.',
);

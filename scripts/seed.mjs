import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (
  process.env.NODE_ENV === 'production' ||
  process.env.ALLOW_DEV_SEED !== 'true' ||
  !url ||
  !['localhost', '127.0.0.1'].includes(new URL(url).hostname)
)
  throw new Error('Seed is allowed only on explicitly enabled local Supabase.');
if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  throw new Error('Configure local Supabase keys in .env.local.');
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const password = process.env.DEV_SEED_PASSWORD || randomBytes(24).toString('base64url');
if (password.length < 12) throw new Error('Use a development password of at least 12 characters.');
async function checked(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}
const accounts = [];
for (const [email, shop] of [
  ['owner@cedar-stitch.example.test', 'Cedar Stitch Demo (development)'],
  ['owner@second-shop.example.test', 'Second Shop (isolation test)'],
]) {
  const listed = await checked(service.auth.admin.listUsers({ perPage: 1000 }));
  let user = listed.users.find((u) => u.email === email);
  if (!user)
    user = (await checked(service.auth.admin.createUser({ email, password, email_confirm: true })))
      .user;
  else await checked(service.auth.admin.updateUserById(user.id, { password }));
  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false },
  });
  await checked(client.auth.signInWithPassword({ email, password }));
  const workspace = await checked(
    client.rpc('onboard_shop', {
      p_name: shop,
      p_timezone: 'America/Los_Angeles',
      p_policy:
        'Fictional development policy: please review the design, quantities, placement, and spelling before production. Contact the shop with questions.',
    }),
  );
  accounts.push({ email, password, workspace });
  if (email.startsWith('owner@second')) continue;
  const existing = await checked(
    client.from('orders').select('id').eq('workspace_id', workspace).limit(1),
  );
  if (existing.length) {
    console.log('Existing development orders preserved.');
    continue;
  }
  const garments = [
    {
      description: 'Company polos',
      color: 'Sandstone',
      sizes: [
        { size: 'S', expected: 6, received: 6 },
        { size: 'M', expected: 8, received: 7 },
        { size: 'L', expected: 6, received: 6 },
        { size: 'XL', expected: 4, received: 4 },
      ],
    },
  ];
  const spec = {
    placement: 'Left chest',
    design: 'Northline wordmark',
    dimensions: '3.0 x 1.2 in',
    thread: 'Forest green',
    text: 'NORTHLINE',
    instructions: 'Center above left chest seam.',
  };
  for (const [i, stage] of [
    'intake',
    'pending',
    'changes',
    'approved',
    'production',
    'ready',
    'completed',
  ].entries()) {
    const id = randomUUID();
    await checked(
      client.rpc('create_order', {
        p_title: `Northline polos — ${stage}`,
        p_customer_name: 'Alex Morgan',
        p_email: 'alex@example.test',
        p_company: 'Northline (fictional)',
        p_due: '2026-10-23',
        p_key: id,
      }),
    );
    await checked(
      client.rpc('save_intake', {
        p_order: id,
        p_revision: 0,
        p_garments: garments,
        p_spec: spec,
        p_reason: 'Initial receipt: one medium missing.',
      }),
    );
    if (i === 0) continue;
    const reconciled = structuredClone(garments);
    reconciled[0].sizes[1].received = 8;
    await checked(
      client.rpc('save_intake', {
        p_order: id,
        p_revision: 1,
        p_garments: reconciled,
        p_spec: spec,
        p_reason: 'Customer delivered the missing medium.',
      }),
    );
    const bytes = await readFile('supabase/fixtures/northline-v2.png');
    const reserved = await checked(
      client.rpc('reserve_attachment', {
        p_order: id,
        p_name: 'northline-v2.png',
        p_mime: 'image/png',
        p_bytes: bytes.length,
        p_purpose: 'proof',
        p_caption: '',
      }),
    );
    await checked(
      service.storage
        .from('order-files')
        .upload(reserved.path, bytes, { contentType: 'image/png' }),
    );
    await checked(
      service.rpc('finalize_attachment', {
        p_id: reserved.id,
        p_digest: createHash('sha256').update(bytes).digest('hex'),
        p_success: true,
      }),
    );
    const digest = createHash('sha256').update(randomBytes(32)).digest('hex');
    await checked(
      client.rpc('send_proof', {
        p_order: id,
        p_revision: 2,
        p_files: [reserved.id],
        p_digest: digest,
      }),
    );
    if (i === 1) continue;
    await checked(
      service.rpc('decide_review', {
        p_digest: digest,
        p_choice: i === 2 ? 'changes_requested' : 'approved',
        p_name: i === 2 ? '' : 'Alex Morgan',
        p_comments: i === 2 ? 'Please make the logo smaller.' : '',
        p_design: i !== 2,
        p_policy: i !== 2,
      }),
    );
    if (i < 4) continue;
    await checked(client.rpc('start_production', { p_order: id }));
    if (i < 5) continue;
    await checked(
      client.rpc('mark_ready', {
        p_order: id,
        p_counts: [{ completed: 24, exceptions: 0, reason: '' }],
      }),
    );
    if (i < 6) continue;
    await checked(
      client.rpc('collect_order', {
        p_order: id,
        p_collector: 'Alex Morgan',
        p_confirm: true,
      }),
    );
  }
}
await mkdir('.local', { recursive: true });
await writeFile(
  '.local/seed-credentials.json',
  JSON.stringify(
    {
      notice: 'Local development accounts only. Never use these for production.',
      accounts,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  'Local development seeds ready. Credentials are in ignored .local/seed-credentials.json. No emails sent.',
);

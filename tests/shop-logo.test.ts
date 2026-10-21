import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { validateLogo } from '../src/lib/uploads';
import { orderPdf } from '../src/lib/pdf';
import { demoOrders } from '../src/lib/demo';

const png = (width: number, height: number) =>
  sharp({
    create: { width, height, channels: 4, background: { r: 54, g: 89, b: 227, alpha: 0.5 } },
  })
    .png()
    .toBuffer();

test('logo validation rejects SVG, PDF, executable, and mismatched files', async () => {
  for (const [content, name, type] of [
    ['<svg onload="alert(1)"/>', 'logo.svg', 'image/svg+xml'],
    ['<svg onload="alert(1)"/>', 'logo.png', 'image/png'],
    ['%PDF-1.7 fake', 'logo.pdf', 'application/pdf'],
    ['MZexecutable', 'logo.png', 'image/png'],
  ])
    await expect(validateLogo(new File([content], name, { type }))).rejects.toThrow('must match');
  const real = await png(64, 64);
  await expect(validateLogo(new File([real], 'logo.jpg', { type: 'image/png' }))).rejects.toThrow(
    'must match',
  );
  await expect(validateLogo(new File([real], 'logo.png', { type: 'image/jpeg' }))).rejects.toThrow(
    'must match',
  );
});

test('logo validation enforces size and minimum dimensions', async () => {
  await expect(validateLogo(new File([], 'logo.png', { type: 'image/png' }))).rejects.toThrow(
    '5 MiB',
  );
  const huge = Buffer.concat([await png(64, 64), Buffer.alloc(5 * 1024 * 1024)]);
  await expect(validateLogo(new File([huge], 'logo.png', { type: 'image/png' }))).rejects.toThrow(
    '5 MiB',
  );
  await expect(
    validateLogo(new File([await png(20, 200)], 'logo.png', { type: 'image/png' })),
  ).rejects.toThrow('32 × 32');
});

test('logos are re-encoded to metadata-free PNG and fit within 1024 pixels', async () => {
  const jpeg = await sharp({
    create: { width: 3000, height: 1200, channels: 3, background: '#20212a' },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Copyright: 'Private camera details' } } })
    .toBuffer();
  const logo = await validateLogo(new File([jpeg], 'logo.jpeg', { type: 'image/jpeg' }));
  expect(logo.width).toBe(1024);
  expect(logo.height).toBe(410);
  expect(logo.digest).toMatch(/^[0-9a-f]{64}$/);
  const meta = await sharp(logo.bytes).metadata();
  expect(meta.format).toBe('png');
  expect(meta.exif).toBeUndefined();
  const small = await validateLogo(
    new File([await png(120, 60)], 'logo.PNG', { type: 'image/png' }),
  );
  expect([small.width, small.height]).toEqual([120, 60]);
  expect((await sharp(small.bytes).metadata()).hasAlpha).toBe(true);
});

test('order sheets and approval records embed the shop logo, and survive a bad one', async () => {
  const order = structuredClone(demoOrders[3]);
  const logo = (await validateLogo(new File([await png(400, 100)], 'l.png', { type: 'image/png' })))
    .bytes;
  order.proofs[0].files = [
    {
      id: 'fixture',
      name: 'artwork.png',
      mime: 'image/png',
      digest: createHash('sha256').update(logo).digest('hex'),
    },
  ];
  // Sheets carry QR + logo; records carry logo + one artwork reproduction.
  for (const [proof, expected] of [
    [undefined, 2],
    [order.proofs[0], 2],
  ] as const) {
    const bytes = await orderPdf(
      order,
      'Cedar Stitch Demo',
      'http://127.0.0.1:3000/x',
      proof,
      logo,
      async () => logo,
    );
    const pdf = await PDFDocument.load(bytes);
    const objects = pdf.context
      .enumerateIndirectObjects()
      .map(([ref, o]) => [ref, String(o)] as const);
    // A transparent PNG adds a soft-mask image; count only the drawn images.
    const masks = new Set(
      objects.flatMap(([, o]) => [...o.matchAll(/\/SMask (\d+) 0 R/g)].map((m) => +m[1])),
    );
    const images = objects.filter(
      ([ref, o]) => o.includes('/Subtype /Image') && !masks.has(ref.objectNumber),
    );
    expect(images).toHaveLength(expected);
  }
  const broken = await orderPdf(
    order,
    'Cedar Stitch Demo',
    'http://127.0.0.1:3000/x',
    undefined,
    new Uint8Array([1, 2, 3]),
  );
  expect((await PDFDocument.load(broken)).getPageCount()).toBeGreaterThanOrEqual(1);
});

const db = new PGlite();
const owner = randomUUID(),
  staff = randomUUID(),
  outsider = randomUUID();
let workspace: string, otherWorkspace: string;
const path = (w = workspace) => `${w}/${randomUUID()}.png`;
const digest = 'a'.repeat(64);
async function as(user: string) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec('set role authenticated');
}
async function service() {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub','',false)");
}
const setLogo = (p: string, d = digest, bytes = 2048, width = 400, height = 100) =>
  db.query<{ old: string | null }>('select public.set_shop_logo($1,$2,$3,$4,$5) old', [
    p,
    d,
    bytes,
    width,
    height,
  ]);
beforeAll(async () => {
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema public,auth to authenticated,anon,service_role; grant execute on function auth.uid() to authenticated,anon,service_role;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
  );
  for (const file of [
    '202610190001_foundation',
    '202610190003_review_status',
    '202610190004_review_rate_limits',
    '202610190005_team',
    '202610190006_outbox',
    '202610190007_billing',
    '202610190008_upload_cleanup',
    '202610190009_customers',
    '202610200010_order_controls',
    '202610200011_order_directory',
    '202610200012_shop_logo',
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}.sql`, 'utf8'));
  await db.query('insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now())', [
    owner,
    'owner@example.test',
    staff,
    'staff@example.test',
    outsider,
    'outsider@example.test',
  ]);
  await as(owner);
  workspace = (
    await db.query<{ w: string }>("select public.onboard_shop('Cedar Stitch','UTC','') w")
  ).rows[0].w;
  await as(outsider);
  otherWorkspace = (
    await db.query<{ w: string }>("select public.onboard_shop('Other Shop','UTC','') w")
  ).rows[0].w;
  await service();
  await db.query("insert into public.memberships values($1,$2,'staff')", [workspace, staff]);
});
afterAll(async () => {
  await db.close();
});

test('the private logo bucket accepts only small PNGs', async () => {
  await service();
  const { rows } = await db.query<{ public: boolean; file_size_limit: number; mime: string[] }>(
    "select public,file_size_limit,allowed_mime_types mime from storage.buckets where id='shop-logos'",
  );
  expect(rows[0]).toMatchObject({ public: false, file_size_limit: 1048576, mime: ['image/png'] });
});

test('owners set, replace, and remove logos; each swap returns the displaced path', async () => {
  await as(owner);
  const first = path(),
    second = path();
  expect((await setLogo(first)).rows[0].old).toBeNull();
  expect((await setLogo(second, 'b'.repeat(64))).rows[0].old).toBe(first);
  await expect(setLogo(second)).rejects.toThrow('already saved');
  const { rows } = await db.query<{ logo_path: string; logo_digest: string }>(
    'select logo_path,logo_digest from public.workspaces where id=$1',
    [workspace],
  );
  expect(rows[0]).toEqual({ logo_path: second, logo_digest: 'b'.repeat(64) });
  expect(
    (await db.query<{ old: string }>('select public.remove_shop_logo() old')).rows[0].old,
  ).toBe(second);
  expect(
    (
      await db.query('select 1 from public.workspaces where id=$1 and logo_path is null', [
        workspace,
      ])
    ).rows,
  ).toHaveLength(1);
  expect(
    (await db.query<{ old: string | null }>('select public.remove_shop_logo() old')).rows[0].old,
  ).toBeNull();
});

test('logo paths must belong to the owner workspace and metadata must be valid', async () => {
  await as(owner);
  for (const args of [
    [path(otherWorkspace)],
    [`${workspace}/../${otherWorkspace}/${randomUUID()}.png`],
    [`${workspace}/${randomUUID()}.svg`],
    [`${workspace}/logo.png`],
    [path(), 'not-a-digest'],
    [path(), digest, 2 * 1024 * 1024],
    [path(), digest, 2048, 4096],
    [path(), digest, 2048, 400, 0],
  ] as [string, string?, number?, number?, number?][])
    await expect(setLogo(...args)).rejects.toThrow('Invalid logo upload');
});

test('staff, outsiders, anonymous callers, and expired shops cannot change logos', async () => {
  await as(staff);
  await expect(setLogo(path())).rejects.toThrow('Owner access required');
  await expect(db.query('select public.remove_shop_logo()')).rejects.toThrow(
    'Owner access required',
  );
  await as(outsider);
  await expect(setLogo(path())).rejects.toThrow('Invalid logo upload');
  await db.exec('reset role');
  await db.exec('set role anon');
  await expect(setLogo(path())).rejects.toThrow('permission denied');
  await expect(db.query('select public.review_logo($1)', [digest])).rejects.toThrow(
    'permission denied',
  );
  await service();
  await db.query(
    "update public.workspaces set trial_ends_at=now()-interval '1 day',paid_through=null,grace_until=null where id=$1",
    [workspace],
  );
  await as(owner);
  await expect(setLogo(path())).rejects.toThrow('read-only');
  await service();
  await db.query("update public.workspaces set trial_ends_at=now()+interval '7 days' where id=$1", [
    workspace,
  ]);
});

test('staff can read the shop logo metadata through workspace row access', async () => {
  await as(owner);
  const current = path();
  await setLogo(current);
  await as(staff);
  const { rows } = await db.query<{ logo_path: string }>(
    'select logo_path from public.workspaces where id=$1',
    [workspace],
  );
  expect(rows[0].logo_path).toBe(current);
  await as(outsider);
  expect(
    (await db.query('select logo_path from public.workspaces where id=$1', [workspace])).rows,
  ).toHaveLength(0);
});

test('review links reveal only their own shop logo while active', async () => {
  await service();
  const order = randomUUID(),
    customer = randomUUID(),
    proof = randomUUID(),
    active = 'c'.repeat(64),
    expired = 'd'.repeat(64),
    revoked = 'e'.repeat(64);
  await db.query(
    "insert into public.customers(id,workspace_id,name,email) values($1,$2,'Alex','alex@example.test')",
    [customer, workspace],
  );
  await db.query(
    "insert into public.orders(id,workspace_id,customer_id,number,title) values($1,$2,$3,1,'Polos')",
    [order, workspace, customer],
  );
  await db.query(
    "insert into public.proof_versions(id,workspace_id,order_id,version,spec_revision,snapshot,files) values($1,$2,$3,1,0,'{}','[]')",
    [proof, workspace, order],
  );
  await db.query(
    `insert into public.review_requests(workspace_id,order_id,proof_id,token_digest,expires_at,revoked_at) values
     ($1,$2,$3,$4,now()+interval '1 day',null),($1,$2,$3,$5,now()-interval '1 day',now()),($1,$2,$3,$6,now()+interval '1 day',now())`,
    [workspace, order, proof, active, expired, revoked],
  );
  const look = async (d: string) =>
    (await db.query<{ logo: { path: string } | null }>('select public.review_logo($1) logo', [d]))
      .rows[0].logo;
  const { rows } = await db.query<{ logo_path: string }>(
    'select logo_path from public.workspaces where id=$1',
    [workspace],
  );
  expect((await look(active))?.path).toBe(rows[0].logo_path);
  expect(await look(expired)).toBeNull();
  expect(await look(revoked)).toBeNull();
  expect(await look('f'.repeat(64))).toBeNull();
  await as(owner);
  await db.query('select public.remove_shop_logo()');
  await service();
  expect(await look(active)).toBeNull();
});

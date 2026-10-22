import { createClient } from '@supabase/supabase-js';
import { chromium } from '@playwright/test';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

const app = process.env.APP_URL || 'http://127.0.0.1:3000',
  url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const local = (value) => ['localhost', '127.0.0.1'].includes(new URL(value).hostname);
if (
  process.env.NODE_ENV === 'production' ||
  process.env.ALLOW_DEV_SEED !== 'true' ||
  !url ||
  !local(url) ||
  !local(app)
)
  throw new Error('PDF checks require explicitly enabled local fixtures.');
const pythonEnv = { ...process.env, PYTHONPATH: path.resolve('.local/pdf-tools') };
try {
  execFileSync('python', ['-c', 'import pymupdf'], {
    env: pythonEnv,
    stdio: 'pipe',
    windowsHide: true,
  });
} catch {
  throw new Error(
    'Install local PDF QA tools: python -m pip install --target .local/pdf-tools -r scripts/requirements-pdf-qa.txt',
  );
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const checked = async (request) => {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data;
};
const hash = (value) => createHash('sha256').update(value).digest('hex');
const nonce = randomBytes(6).toString('hex'),
  password = randomBytes(24).toString('base64url');
const checks = [],
  record = (value) => {
    checks.push(value);
    console.log(value);
  };
async function account(label) {
  const email = `pdf-${label}-${nonce}@example.test`;
  const { user } = await checked(
    service.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  const db = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
  await checked(db.auth.signInWithPassword({ email, password }));
  return { email, id: user.id, db };
}
let browser;
try {
  await mkdir('.local/pdf-content', { recursive: true });
  const owner = await account('owner'),
    other = await account('other'),
    staff = await account('staff');
  const shop = await checked(
    owner.db.rpc('onboard_shop', {
      p_name: 'Original PDF Shop',
      p_timezone: 'UTC',
      p_policy: 'ORIGINAL_POLICY_SENTINEL',
    }),
  );
  await checked(
    other.db.rpc('onboard_shop', { p_name: 'Other PDF Shop', p_timezone: 'UTC', p_policy: '' }),
  );
  await checked(
    service.from('memberships').insert({ workspace_id: shop, user_id: staff.id, role: 'staff' }),
  );
  const id = randomUUID();
  await checked(
    owner.db.rpc('create_order', {
      p_title: 'Original proof title',
      p_customer_name: 'Zoë Müller',
      p_email: 'pdf-customer@example.test',
      p_company: '',
      p_due: '2026-11-14',
      p_key: id,
    }),
  );
  const garments = [
    {
      description: 'Original polos',
      color: 'Navy',
      sizes: [{ size: 'M', expected: 24, received: 24 }],
    },
  ];
  const spec = {
    placement: 'Left chest',
    design: 'Original design',
    dimensions: '3 inches',
    thread: 'White',
    text: 'ORIGINAL_TEXT',
    instructions: 'Original instructions',
  };
  let revision = 0;
  const intake = async () => {
    await checked(
      owner.db.rpc('save_intake', {
        p_order: id,
        p_revision: revision++,
        p_garments: garments,
        p_spec: spec,
        p_reason: 'Synthetic PDF acceptance intake',
      }),
    );
  };
  await intake();
  await checked(
    owner.db.rpc('save_internal_note', {
      p_order: id,
      p_revision: revision++,
      p_note: 'PRIVATE_ORDER_NOTE_' + nonce,
    }),
  );
  const customer = await checked(
    owner.db.from('orders').select('customer_id').eq('id', id).single(),
  );
  await checked(
    service
      .from('customers')
      .update({ internal_notes: 'PRIVATE_CUSTOMER_NOTE_' + nonce })
      .eq('id', customer.customer_id),
  );
  const files = [];
  async function upload(name, bytes, mime, purpose = 'proof') {
    const file = await checked(
      owner.db.rpc('reserve_attachment', {
        p_order: id,
        p_name: name,
        p_mime: mime,
        p_bytes: bytes.length,
        p_purpose: purpose,
        p_caption: '',
      }),
    );
    await checked(
      service.storage.from('order-files').upload(file.path, bytes, { contentType: mime }),
    );
    await checked(
      service.rpc('finalize_attachment', { p_id: file.id, p_digest: hash(bytes), p_success: true }),
    );
    const result = { ...file, bytes, mime, name };
    files.push(result);
    return result;
  }
  const image = await upload(
    'original-image.png',
    await readFile('supabase/fixtures/northline-v1.png'),
    'image/png',
  );
  const condition = await upload('private-condition.png', image.bytes, 'image/png', 'condition');
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const angle of [0, 90, 180, 270]) {
    const page = pdf.addPage([420, 300]);
    page.setCropBox(40, 40, 320, 220);
    page.setRotation(degrees(angle));
    page.drawRectangle({ x: 60, y: 70, width: 280, height: 160, color: rgb(0.85, 0.9, 1) });
    page.drawText('ARTWORK_ROTATION_' + angle, { x: 70, y: 160, size: 15, font });
    page.drawText('OUTSIDE_CROP_SENTINEL', { x: 0, y: 10, size: 8, font });
  }
  const pdfFile = await upload('cropped-four-page.pdf', await pdf.save(), 'application/pdf');
  const secret = randomBytes(32).toString('hex');
  const proofId = await checked(
    owner.db.rpc('send_proof', {
      p_order: id,
      p_revision: revision++,
      p_files: [image.id, pdfFile.id],
      p_digest: hash(secret),
    }),
  );
  browser = await chromium.launch();
  async function login(person) {
    const context = await browser.newContext(),
      page = await context.newPage();
    await page.goto(app + '/login');
    await page.getByLabel('Email address', { exact: true }).fill(person.email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.waitForURL('**/app/orders');
    return context;
  }
  const ownerContext = await login(owner),
    staffContext = await login(staff),
    otherContext = await login(other),
    anonymous = await browser.newContext();
  const route = app + '/api/orders/' + id + '/pdf',
    proofRoute = route + '?proof=' + proofId;
  async function inspect(context, target, name, render = false, scale = 1) {
    const response = await context.request.get(target);
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['content-type'], 'application/pdf');
    assert.match(response.headers()['cache-control'], /no-store/);
    const destination = '.local/pdf-content/' + name + '.pdf';
    await writeFile(destination, await response.body());
    const result = JSON.parse(
      execFileSync(
        'python',
        [
          'scripts/inspect-pdf.py',
          destination,
          ...(render ? ['.local/pdf-content/' + render, String(scale)] : []),
        ],
        { env: pythonEnv, encoding: 'utf8', windowsHide: true },
      ),
    );
    const text = result.pages.map((page) => page.text).join('\n');
    assert.ok(!text.includes('PRIVATE_ORDER_NOTE_'));
    assert.ok(!text.includes('PRIVATE_CUSTOMER_NOTE_'));
    assert.ok(!text.includes(secret));
    assert.equal(result.attachments, 0);
    assert.ok(result.pages.every((page) => page.links === 0));
    return { ...result, text };
  }
  const pending = await inspect(ownerContext, proofRoute, 'pending', 'preview');
  assert.ok(pending.text.includes('Awaiting approval'));
  assert.ok(!pending.text.includes('Typed name:'));
  assert.equal(pending.pages.length, 6);
  assert.equal(pending.pages[1].images, 1);
  for (const [index, angle] of [0, 90, 180, 270].entries()) {
    assert.ok(pending.pages[index + 2].text.includes('ARTWORK_ROTATION_' + angle));
    const words = pending.pages[index + 2].words.filter((word) =>
      word.text.startsWith('ARTWORK_ROTATION_'),
    );
    assert.equal(words.length, 1);
    const [left, top, right, bottom] = words[0].rect;
    assert.ok(left >= 50 && top >= 140 && right <= 545 && bottom <= 752);
  }
  assert.ok(pending.text.includes(hash(image.bytes)));
  assert.ok(pending.text.includes(hash(pdfFile.bytes)));
  assert.ok(!pending.text.includes(condition.name));
  record(
    'Pending record includes the selected image and all four cropped/rotated PDF pages, digests and accurate status; private notes/files are excluded.',
  );
  await checked(
    service.rpc('decide_review', {
      p_digest: hash(secret),
      p_choice: 'approved',
      p_name: 'Zoë Müller',
      p_comments: '',
      p_design: true,
      p_policy: true,
    }),
  );
  // Mutable shop/spec/contact state must not rewrite the sent proof's content.
  spec.text = 'NEW_UNAPPROVED_TEXT';
  await intake();
  await checked(
    owner.db.rpc('update_shop', {
      p_name: 'Renamed PDF Shop',
      p_timezone: 'UTC',
      p_policy: 'NEW_UNAPPROVED_POLICY',
      p_email: '',
    }),
  );
  const approved = await inspect(ownerContext, proofRoute, 'approved');
  for (const value of [
    'Original PDF Shop',
    'Original proof title',
    'ORIGINAL_POLICY_SENTINEL',
    'ORIGINAL_TEXT',
    '24 received',
    'Zoë Müller',
    'Recorded at (UTC):',
    'I approve the displayed design',
    'I acknowledge the shop policy',
  ])
    assert.ok(approved.text.includes(value));
  assert.ok(!approved.text.includes('NEW_UNAPPROVED_'));
  assert.ok(!approved.text.includes('Renamed PDF Shop'));
  await inspect(staffContext, proofRoute, 'staff-approved');
  record(
    'Approved records preserve the sent shop/spec/policy, typed acknowledgment/time and artwork after later edits; active staff can download.',
  );
  const changeSecret = randomBytes(32).toString('hex');
  const changeProof = await checked(
    owner.db.rpc('send_proof', {
      p_order: id,
      p_revision: revision++,
      p_files: [image.id],
      p_digest: hash(changeSecret),
    }),
  );
  await checked(
    service.rpc('decide_review', {
      p_digest: hash(changeSecret),
      p_choice: 'changes_requested',
      p_name: '',
      p_comments: 'Please move the design higher.',
      p_design: false,
      p_policy: false,
    }),
  );
  const changed = await inspect(ownerContext, route + '?proof=' + changeProof, 'changes');
  assert.ok(changed.text.includes('Please move the design higher.'));
  assert.ok(!changed.text.includes('I approve the displayed design'));
  const sheet = await inspect(ownerContext, route, 'order-sheet', 'sheet-preview', 3);
  assert.ok(sheet.text.includes('NEW_UNAPPROVED_TEXT'));
  assert.ok(sheet.pages.some((page) => page.images > 0));
  // Decode the printed QR from the rendered pages, as a phone camera would.
  const decoded = [];
  for (const index of sheet.pages.keys()) {
    const { data, info } = await sharp(`.local/pdf-content/sheet-preview/page-${index + 1}.png`)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    if (code) decoded.push(code.data);
  }
  const orderPage = app + '/app/orders/' + id;
  assert.deepEqual(decoded, [orderPage], 'The order sheet must carry one QR code for this order.');
  // A signed-out scan opens the order route and is sent to sign-in.
  const scan = await anonymous.newPage();
  await scan.goto(orderPage);
  await scan.waitForURL(/\/login/);
  assert.ok(!(await scan.content()).includes('NEW_UNAPPROVED_TEXT'));
  await scan.close();
  const ownerScan = await ownerContext.request.get(orderPage);
  assert.equal(ownerScan.status(), 200);
  assert.ok((await ownerScan.text()).includes('NEW_UNAPPROVED_TEXT'));
  assert.ok(
    !(await (await otherContext.request.get(orderPage)).text()).includes('NEW_UNAPPROVED_TEXT'),
  );
  record(
    'Change-request records retain comments without approval confirmations; order sheets retain current instructions, and the printed QR decodes to this order, which requires sign-in and is hidden from other shops.',
  );
  assert.equal((await anonymous.request.get(proofRoute)).status(), 401);
  assert.equal((await anonymous.request.get(proofRoute + '&token=' + secret)).status(), 401);
  assert.equal((await otherContext.request.get(proofRoute)).status(), 404);
  assert.equal((await ownerContext.request.get(route + '?proof=' + randomUUID())).status(), 404);
  await checked(owner.db.rpc('remove_staff', { p_user: staff.id }));
  assert.equal((await staffContext.request.get(proofRoute)).status(), 404);
  record(
    'Anonymous/token-only, foreign-shop, mismatched-proof and removed-staff record requests are denied.',
  );
  const exported = await (await ownerContext.request.get(app + '/api/export')).json();
  assert.equal(exported.attachment_downloads.length, files.length);
  for (const item of exported.attachment_downloads) {
    const response = await ownerContext.request.get(app + item.authenticated_download);
    assert.equal(response.status(), 200);
    assert.equal(hash(await response.body()), item.digest);
  }
  assert.ok(!JSON.stringify(exported).includes(secret));
  record(
    'Owner export includes every ready attachment and its authenticated bytes round-trip to the recorded digest.',
  );
  await checked(
    service.storage
      .from('order-files')
      .update(image.path, Buffer.alloc(image.bytes.length, 1), { contentType: image.mime }),
  );
  const damaged = await ownerContext.request.get(proofRoute);
  assert.equal(damaged.status(), 422);
  assert.match(await damaged.text(), /integrity/);
  await checked(
    service.storage
      .from('order-files')
      .update(image.path, image.bytes, { contentType: image.mime }),
  );
  await checked(service.storage.from('order-files').remove([pdfFile.path]));
  const missing = await ownerContext.request.get(proofRoute);
  assert.equal(missing.status(), 422);
  assert.match(await missing.text(), /missing|damaged/);
  await checked(
    service.storage
      .from('order-files')
      .upload(pdfFile.path, pdfFile.bytes, { contentType: pdfFile.mime }),
  );
  await inspect(ownerContext, proofRoute, 'restored');
  record(
    'Damaged or missing originals return actionable 422 errors without partial PDFs; restoring bytes restores the download.',
  );
  await writeFile(
    '.local/pdf-content-check.json',
    JSON.stringify(
      {
        status: 'passed',
        checked_at: new Date().toISOString(),
        checks,
        limitations:
          'Static PDF page content and saved form appearances only; annotations/interactive features excluded. Images fit within 2400 × 3000 pixels. 40 MiB/100 artwork-page export cap. The order-sheet QR is decoded from a 3x render. Synthetic fixtures only; no credentials/tokens in report.',
      },
      null,
      2,
    ),
  );
} catch (error) {
  await mkdir('.local', { recursive: true });
  await writeFile('.local/pdf-content-failure.txt', String(error), { mode: 0o600 });
  throw new Error(
    'PDF content check failed. Details are in ignored .local/pdf-content-failure.txt.',
  );
} finally {
  await browser?.close();
}

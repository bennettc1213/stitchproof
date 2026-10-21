import { expect, test } from 'vitest';
import { PDFDocument, StandardFonts, degrees, PDFName, PDFString } from 'pdf-lib';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { orderPdf } from '../src/lib/pdf';
import { demoOrders } from '../src/lib/demo';

const sourceOrder = () => structuredClone(demoOrders[3]);
const file = (bytes: Uint8Array, mime: string, id = 'fixture') => ({
  id,
  name: id + (mime === 'application/pdf' ? '.pdf' : '.png'),
  mime,
  digest: createHash('sha256').update(bytes).digest('hex'),
});
test('PNG, JPEG and WebP artwork is reproduced in immutable file order on separate pages', async () => {
  const image = sharp({ create: { width: 120, height: 60, channels: 3, background: '#3155cc' } });
  const sources = [
    await image.clone().png().toBuffer(),
    await image.clone().jpeg().toBuffer(),
    await image.clone().webp().toBuffer(),
  ];
  const order = sourceOrder(),
    proof = order.proofs[0];
  proof.files = sources.map((bytes, index) =>
    file(bytes, ['image/png', 'image/jpeg', 'image/webp'][index], String(index)),
  );
  const record = await orderPdf(
    order,
    'Shop',
    'http://127.0.0.1:3000/x',
    proof,
    null,
    async (f) => sources[Number(f.id)],
  );
  const loaded = await PDFDocument.load(record);
  expect(loaded.getPageCount()).toBe(4);
  for (const page of loaded.getPages().slice(1))
    expect(String(page.node.Resources())).toContain('XObject');
});
test('every PDF page is embedded, including cropped, rotated and blank pages, without active links/actions', async () => {
  const source = await PDFDocument.create(),
    font = await source.embedFont(StandardFonts.Helvetica);
  for (const angle of [0, 90, 180, 270]) {
    const page = source.addPage([420, 300]);
    page.drawText('Static artwork ' + angle, { x: 70, y: 160, font });
    page.setCropBox(40, 40, 320, 220);
    page.setRotation(degrees(angle));
    const annotation = source.context.register(
      source.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [40, 40, 200, 100],
        A: { S: 'URI', URI: PDFString.of('https://private.invalid/DO_NOT_COPY') },
      }),
    );
    page.node.set(PDFName.of('Annots'), source.context.obj([annotation]));
  }
  source.addPage([420, 300]);
  const bytes = await source.save(),
    order = sourceOrder(),
    proof = order.proofs[0];
  proof.files = [file(bytes, 'application/pdf')];
  const output = await PDFDocument.load(
    await orderPdf(order, 'Shop', 'http://127.0.0.1:3000/x', proof, null, async () => bytes),
  );
  expect(output.getPageCount()).toBe(6);
  expect(
    output.context
      .enumerateIndirectObjects()
      .map(([, object]) => String(object))
      .join('\n'),
  ).not.toContain('DO_NOT_COPY');
  for (const page of output.getPages()) expect(page.node.Annots()?.size() || 0).toBe(0);
});
test('missing loaders, corrupted content and digest mismatch fail rather than creating a partial record', async () => {
  const order = sourceOrder(),
    proof = order.proofs[0],
    bytes = Buffer.from('not a real image');
  proof.files = [file(bytes, 'image/png')];
  await expect(orderPdf(order, 'Shop', '', proof)).rejects.toThrow('required');
  await expect(
    orderPdf(order, 'Shop', '', proof, null, async () => Buffer.from('tampered')),
  ).rejects.toThrow('integrity');
  await expect(orderPdf(order, 'Shop', '', proof, null, async () => bytes)).rejects.toThrow(
    'cannot be rendered',
  );
});
test('aggregate artwork page and byte limits are enforced before returning a PDF', async () => {
  const source = await PDFDocument.create();
  for (let index = 0; index < 101; index++) source.addPage();
  const bytes = await source.save(),
    order = sourceOrder(),
    proof = order.proofs[0];
  proof.files = [file(bytes, 'application/pdf')];
  await expect(orderPdf(order, 'Shop', '', proof, null, async () => bytes)).rejects.toThrow(
    '100 pages',
  );
  await expect(
    orderPdf(order, 'Shop', '', proof, null, async () => Buffer.alloc(10 * 1024 * 1024 + 1)),
  ).rejects.toThrow('40 MiB');
});

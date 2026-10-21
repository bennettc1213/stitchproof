import { expect, test } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { orderPdf } from '../src/lib/pdf';
import { demoOrders } from '../src/lib/demo';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
test('order sheets and approval records generate valid PDFs with multi-page text', async () => {
  const order = structuredClone(demoOrders[3]);
  order.customers.name = 'Zoë Müller';
  const sheet = await orderPdf(
    order,
    'Cedar Stitch Demo',
    'http://127.0.0.1:3000/app/orders/' + order.id,
  );
  expect((await PDFDocument.load(sheet)).getPageCount()).toBeGreaterThanOrEqual(1);
  const proof = structuredClone(order.proofs[0]);
  const artwork = await readFile('supabase/fixtures/northline-v1.png');
  proof.files = [
    {
      id: 'fixture',
      name: 'proof.png',
      mime: 'image/png',
      digest: createHash('sha256').update(artwork).digest('hex'),
    },
  ];
  proof.snapshot.policy = 'Please carefully review all garment details. '.repeat(300);
  const record = await orderPdf(
    order,
    'Cedar Stitch Demo',
    'http://127.0.0.1:3000/app/orders/' + order.id,
    proof,
    undefined,
    async () => artwork,
  );
  expect((await PDFDocument.load(record)).getPageCount()).toBeGreaterThan(1);
});

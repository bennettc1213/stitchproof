import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import type { Order, Proof } from './domain';
import { totals, labels, DESIGN_CONFIRMATION, POLICY_CONFIRMATION } from './domain';
import { appendProofArtwork, ProofArtworkError, type ProofFileLoader } from './proof-artwork';
export async function orderPdf(
  order: Order,
  shopName: string,
  orderUrl: string,
  proof?: Proof,
  logo?: Uint8Array | null,
  loadArtwork?: ProofFileLoader,
) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    await readFile(path.join(process.cwd(), 'public/fonts/NotoSans-Regular.ttf')),
    { subset: true },
  );
  const displayShop = proof?.snapshot.shop || shopName;
  const displayTitle = proof?.snapshot.title || order.title;
  const displayNumber = proof?.snapshot.order_number || order.number;
  const displayDue =
    proof && proof.snapshot.due_date !== undefined ? proof.snapshot.due_date : order.due_date;
  pdf.setTitle(
    `${displayShop} - Order ${displayNumber}${proof ? ` - Proof v${proof.version}` : ''}`,
  );
  let page = pdf.addPage([595, 842]),
    y = 792;
  function line(value: string, size = 10) {
    for (const paragraph of value.split('\n')) {
      const words = paragraph.split(/\s+/);
      let row = '';
      for (const word of words) {
        if (font.widthOfTextAtSize(word, size) > 495) {
          if (row) {
            draw(row);
            row = '';
          }
          for (const character of word) {
            if (font.widthOfTextAtSize(row + character, size) > 495 && row) {
              draw(row);
              row = '';
            }
            row += character;
          }
          continue;
        }
        const candidate = row ? row + ' ' + word : word;
        if (font.widthOfTextAtSize(candidate, size) > 495 && row) {
          draw(row);
          row = word;
        } else row = candidate;
      }
      draw(row);
    }
    function draw(text: string) {
      if (y < 60) {
        page = pdf.addPage([595, 842]);
        y = 792;
      }
      page.drawText(text, {
        x: 50,
        y,
        size,
        font,
        color: rgb(0.23, 0.3, 0.23),
        maxWidth: 495,
      });
      y -= size * 1.7;
    }
  }
  if (logo) {
    try {
      // Stored logos are validated PNGs; fit them into the header without distortion.
      const image = await pdf.embedPng(logo);
      const scale = Math.min(180 / image.width, 56 / image.height, 1);
      const height = image.height * scale;
      page.drawImage(image, { x: 50, y: y + 20 - height, width: image.width * scale, height });
      y -= height + 4;
    } catch {
      // A damaged logo must never block an order sheet or approval record.
    }
  }
  line(displayShop, 20);
  line(`Order #${displayNumber} - ${displayTitle}`, 14);
  line(
    proof
      ? `Proof version ${proof.version} - ${labels[proof.choice || 'pending']}`
      : `Status: ${labels[order.lifecycle]} | Approval: ${labels[order.approval]}`,
  );
  y -= 12;
  line(
    `Customer${proof ? ' (current contact)' : ''}: ${order.customers.name}${order.customers.company ? ' / ' + order.customers.company : ''}`,
  );
  line(`Due date: ${displayDue || 'Not set'}`);
  y -= 10;
  const garments = proof?.snapshot.garments || order.garments,
    spec = proof?.snapshot.spec || order.spec;
  line(
    `Garments: ${totals(garments).received} received / ${totals(garments).expected} expected`,
    12,
  );
  for (const g of garments) {
    line(`${g.description} - ${g.color}`);
    for (const s of g.sizes) line(`  ${s.size}: ${s.received} received / ${s.expected} expected`);
  }
  y -= 10;
  line('Decoration instructions', 12);
  for (const [key, value] of Object.entries(spec)) line(`${key}: ${value || 'None specified'}`);
  if (proof) {
    y -= 10;
    line('Policy shown with this proof', 12);
    line(proof.snapshot.policy || 'No additional policy supplied.');
    line(`Policy version: ${proof.snapshot.policy_version}`);
    y -= 10;
    line('Proof files and identifiers', 12);
    for (const file of proof.files) {
      line(file.name);
      line(`SHA-256: ${file.digest}`, 8);
    }
    line(`Decision: ${labels[proof.choice || 'pending']}`, 12);
    if (proof.decided_at) line(`Recorded at (UTC): ${proof.decided_at}`);
    if (proof.name) line(`Typed name: ${proof.name}`);
    if (proof.comments) line(`Requested changes: ${proof.comments}`);
    if (proof.choice === 'approved') {
      line(DESIGN_CONFIRMATION);
      line(POLICY_CONFIRMATION);
    }
    line('A typed acknowledgment is not verified identity or a certified digital signature.', 8);
    line(
      'The following artwork pages reproduce this sent proof version. Images may be scaled for print.',
      8,
    );
    if (proof.files.some((file) => file.mime === 'application/pdf'))
      line(
        'PDF artwork includes static page content and saved form appearances. Interactive features and annotations are excluded; retain and review the original PDF files.',
        8,
      );
    if (proof.files.length && !loadArtwork)
      throw new ProofArtworkError('Proof artwork is required for an approval record.');
    if (loadArtwork) await appendProofArtwork(pdf, proof, font, loadArtwork);
  } else {
    y -= 15;
    const qr = await pdf.embedPng(
      await QRCode.toBuffer(orderUrl, {
        width: 180,
        margin: 1,
        errorCorrectionLevel: 'M',
      }),
    );
    if (y < 190) {
      page = pdf.addPage([595, 842]);
      y = 792;
    }
    page.drawImage(qr, { x: 50, y: y - 110, width: 100, height: 100 });
    y -= 130;
    line('Scan to open this order. Shop sign-in is required.', 8);
  }
  // Internal notes are deliberately never included in either document.
  return pdf.save();
}

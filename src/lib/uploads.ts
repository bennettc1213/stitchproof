import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
const extensions: Record<string, RegExp> = {
  'image/png': /\.png$/i,
  'image/jpeg': /\.jpe?g$/i,
  'image/webp': /\.webp$/i,
  'application/pdf': /\.pdf$/i,
};
function sniff(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
    return 'image/webp';
  if (bytes.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  return '';
}
const matches = (file: File, mime: string) =>
  !!mime && file.type === mime && extensions[mime].test(file.name);
export async function validateUpload(file: File, purpose: string) {
  if (!['proof', 'condition'].includes(purpose) || file.size < 1 || file.size > 10 * 1024 * 1024)
    throw new Error('Choose a proof or condition file up to 10 MiB.');
  let bytes = Buffer.from(await file.arrayBuffer());
  const mime = sniff(bytes);
  if (!matches(file, mime) || (purpose === 'condition' && mime === 'application/pdf'))
    throw new Error(
      'File content, type, and extension must match: JPEG, PNG, WebP, or a proof PDF.',
    );
  try {
    if (mime === 'application/pdf') {
      const pdf = await PDFDocument.load(bytes);
      if (pdf.getPageCount() < 1 || pdf.getPageCount() > 100) throw new Error('Invalid page count');
    } else bytes = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().toBuffer();
  } catch {
    throw new Error('This file cannot be read as a valid image or PDF.');
  }
  if (bytes.length > 10 * 1024 * 1024) throw new Error('Processed file exceeds 10 MiB.');
  return {
    bytes,
    mime,
    digest: createHash('sha256').update(bytes).digest('hex'),
  };
}
export const LOGO_INPUT_LIMIT = 5 * 1024 * 1024;
export const LOGO_STORED_LIMIT = 1024 * 1024;
// Logos are always re-encoded to PNG: it keeps transparency, drops metadata and any
// embedded payloads, and is directly embeddable in generated PDFs. SVG is never accepted.
export async function validateLogo(file: File) {
  if (file.size < 1 || file.size > LOGO_INPUT_LIMIT)
    throw new Error('Choose a logo image up to 5 MiB.');
  const input = Buffer.from(await file.arrayBuffer());
  const mime = sniff(input);
  if (mime === 'application/pdf' || !matches(file, mime))
    throw new Error('Logo content, type, and extension must match: JPEG, PNG, or WebP.');
  let bytes: Buffer, width: number, height: number;
  try {
    const image = sharp(input, { limitInputPixels: 40_000_000 }).rotate();
    const meta = await image.metadata();
    if (Math.min(meta.width || 0, meta.height || 0) < 32) throw new Error('too small');
    const { data, info } = await image
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
    bytes = data;
    width = info.width;
    height = info.height;
  } catch {
    throw new Error('This logo cannot be read as an image at least 32 × 32 pixels.');
  }
  if (bytes.length > LOGO_STORED_LIMIT)
    throw new Error(
      'This logo is too detailed to store under 1 MiB. Try a simpler or smaller file.',
    );
  return {
    bytes,
    width,
    height,
    digest: createHash('sha256').update(bytes).digest('hex'),
  };
}

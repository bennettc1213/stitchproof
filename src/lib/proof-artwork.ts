import { createHash } from 'node:crypto';
import { PDFDocument, PDFName, degrees, type PDFFont } from 'pdf-lib';
import sharp from 'sharp';
import type { Proof } from './domain';

export const ARTWORK_BYTE_LIMIT = 40 * 1024 * 1024;
export const ARTWORK_PAGE_LIMIT = 100;
export class ProofArtworkError extends Error {}
export type ProofFile = Proof['files'][number];
export type ProofFileLoader = (file: ProofFile) => Promise<Uint8Array>;

// Embed only static page content, never source PDF actions, attachments or links.
export async function appendProofArtwork(
  pdf: PDFDocument,
  proof: Proof,
  font: PDFFont,
  load: ProofFileLoader,
) {
  let totalBytes = 0,
    totalPages = 0;
  for (const [index, file] of proof.files.entries()) {
    const bytes = await load(file);
    totalBytes += bytes.length;
    if (!bytes.length || bytes.length > 10 * 1024 * 1024 || totalBytes > ARTWORK_BYTE_LIMIT)
      throw new ProofArtworkError(
        'Artwork exceeds the approval-record limit of 40 MiB. Download the original proof files separately.',
      );
    if (createHash('sha256').update(bytes).digest('hex') !== file.digest)
      throw new ProofArtworkError(
        'A proof file failed its integrity check. Restore the original file before downloading this record.',
      );
    try {
      if (file.mime === 'application/pdf') {
        const source = await PDFDocument.load(bytes);
        const pages = source.getPages();
        if (!pages.length || totalPages + pages.length > ARTWORK_PAGE_LIMIT)
          throw new ProofArtworkError(
            'Artwork exceeds the approval-record limit of 100 pages. Download the original proof files separately.',
          );
        // Saved form appearances are part of the visible record; do not regenerate
        // appearances using a font that may change the original artwork.
        source.getForm().flatten({ updateFieldAppearances: false });
        for (const [pageIndex, original] of pages.entries()) {
          // pdf-lib's page copier also copies unused page dictionary entries.
          // Remove annotations/actions before embedding, after flattening forms.
          for (const key of original.node.keys())
            if (
              ![
                'Type',
                'Parent',
                'Resources',
                'Contents',
                'MediaBox',
                'CropBox',
                'Rotate',
              ].includes(key.decodeText())
            )
              original.node.delete(PDFName.of(key.decodeText()));
          const crop = original.getCropBox(),
            media = original.getMediaBox();
          const left = Math.max(crop.x, media.x),
            bottom = Math.max(crop.y, media.y);
          const right = Math.min(crop.x + crop.width, media.x + media.width);
          const top = Math.min(crop.y + crop.height, media.y + media.height);
          const width = right - left,
            height = top - bottom;
          const angle = ((original.getRotation().angle % 360) + 360) % 360;
          if (!(width > 0 && height > 0) || ![0, 90, 180, 270].includes(angle))
            throw new Error('Invalid page geometry');
          // Empty source pages have no content stream; preserve their blank page.
          const content = original.node.Contents()
            ? await pdf.embedPage(original, { left, right, bottom, top })
            : null;
          const output = artworkPage(index, pageIndex + 1, pages.length);
          const rotated = angle === 90 || angle === 270;
          const scale = Math.min(
            495 / (rotated ? height : width),
            610 / (rotated ? width : height),
          );
          const w = width * scale,
            h = height * scale;
          const x = 50 + (495 - (rotated ? h : w)) / 2;
          const y = 90 + (610 - (rotated ? w : h)) / 2;
          if (content)
            output.drawPage(content, {
              x: x + (angle === 180 ? w : angle === 270 ? h : 0),
              y: y + (angle === 90 ? w : angle === 180 ? h : 0),
              width: w,
              height: h,
              rotate: degrees(-angle),
            });
        }
      } else {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mime))
          throw new Error('Unsupported artwork');
        if (totalPages + 1 > ARTWORK_PAGE_LIMIT)
          throw new ProofArtworkError(
            'Artwork exceeds the approval-record limit of 100 pages. Download the original proof files separately.',
          );
        const png = await sharp(bytes, { limitInputPixels: 40_000_000 })
          .rotate()
          .resize(2400, 3000, { fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer();
        const image = await pdf.embedPng(png);
        const scale = Math.min(495 / image.width, 610 / image.height);
        const width = image.width * scale,
          height = image.height * scale;
        artworkPage(index, 1, 1).drawImage(image, {
          x: 50 + (495 - width) / 2,
          y: 90 + (610 - height) / 2,
          width,
          height,
        });
      }
    } catch (error) {
      if (error instanceof ProofArtworkError) throw error;
      throw new ProofArtworkError(
        'A proof file cannot be rendered. Download its original file and contact support before relying on this record.',
      );
    }
  }

  function artworkPage(fileIndex: number, pageNumber: number, pageCount: number) {
    totalPages++;
    const page = pdf.addPage([595, 842]);
    page.drawText(
      `Proof v${proof.version} - Artwork ${fileIndex + 1}/${proof.files.length} - Page ${pageNumber}/${pageCount}`,
      { x: 50, y: 795, size: 11, font },
    );
    const name = proof.files[fileIndex].name;
    // The complete filename is in the manifest; cap only the per-page caption.
    let caption = name;
    while (font.widthOfTextAtSize(caption, 9) > 480) caption = caption.slice(0, -1);
    if (caption !== name) caption = caption.slice(0, -3) + '...';
    page.drawText(caption, { x: 50, y: 772, size: 9, font });
    page.drawText(`SHA-256: ${proof.files[fileIndex].digest}`, { x: 50, y: 750, size: 7, font });
    page.drawText('Static artwork reproduction; retain original files with this record.', {
      x: 50,
      y: 54,
      size: 8,
      font,
    });
    return page;
  }
}

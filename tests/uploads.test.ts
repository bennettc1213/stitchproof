import { expect, test } from 'vitest';
import { validateUpload } from '../src/lib/uploads';
test('rejects executable/HTML/SVG content despite a claimed image type', async () => {
  for (const content of ['<script>alert(1)</script>', '<svg onload="alert(1)"/>', 'MZexecutable'])
    await expect(
      validateUpload(new File([content], 'proof.png', { type: 'image/png' }), 'proof'),
    ).rejects.toThrow('must match');
});
test('rejects a valid header when the extension or declared MIME disagrees', async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  await expect(
    validateUpload(new File([png], 'proof.html', { type: 'image/png' }), 'proof'),
  ).rejects.toThrow('must match');
  await expect(
    validateUpload(new File([png], 'proof.png', { type: 'text/html' }), 'proof'),
  ).rejects.toThrow('must match');
});

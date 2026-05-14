// Crop a small region around each site's calibrated position so we can view each
// site's printed box individually (slot circles + × marks) and read the data.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve('.');
const positions = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/site-positions-ocr.json'), 'utf8'));

const meta = await sharp(path.join(ROOT, 'assets/board/map.jpg')).metadata();
const outDir = path.join(ROOT, 'assets/site-crops');
fs.mkdirSync(outDir, { recursive: true });

// Crop a generous box around each site so the slot row + × marks are fully visible.
const halfW = 320, halfH = 320;

for (const [name, pos] of Object.entries(positions)) {
  const cx = Math.round(pos.x * meta.width);
  const cy = Math.round(pos.y * meta.height);
  const left = Math.max(0, cx - halfW);
  const top = Math.max(0, cy - halfH);
  const width = Math.min(meta.width - left, halfW * 2);
  const height = Math.min(meta.height - top, halfH * 2);
  const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  await sharp(path.join(ROOT, 'assets/board/map.jpg'))
    .extract({ left, top, width, height })
    .jpeg({ quality: 88 })
    .toFile(path.join(outDir, `${safe}.jpg`));
}
console.log(`Cropped ${Object.keys(positions).length} site boxes to ${outDir}/`);

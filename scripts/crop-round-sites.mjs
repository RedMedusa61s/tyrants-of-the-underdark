// For round (control-marker) sites, the slot tab sits below the circular image.
// Crop a wide-but-short strip centered well below the calibrated label position.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve('.');
const positions = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/site-positions-ocr.json'), 'utf8'));

const ROUND = ['Menzoberranzan', 'Gauntlgrym', 'Araumycos', "Ch'Chitl", "Ss'zuraass'nee", 'The Phaerlin', 'Tsenviilyq'];

const meta = await sharp(path.join(ROOT, 'assets/board/map.jpg')).metadata();
const outDir = path.join(ROOT, 'assets/site-crops-round');
fs.mkdirSync(outDir, { recursive: true });

const safe = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

for (const name of ROUND) {
  const pos = positions[name];
  if (!pos) { console.log('  no position for', name); continue; }
  // Shift down ~14% of board height to catch the slot tab. Crop wide+short.
  const cx = Math.round(pos.x * meta.width);
  const cy = Math.round(pos.y * meta.height + meta.height * 0.13);
  const halfW = 220, halfH = 90;
  const left = Math.max(0, cx - halfW);
  const top = Math.max(0, cy - halfH);
  const width = Math.min(meta.width - left, halfW * 2);
  const height = Math.min(meta.height - top, halfH * 2);
  await sharp(path.join(ROOT, 'assets/board/map.jpg'))
    .extract({ left, top, width, height })
    .jpeg({ quality: 92 })
    .toFile(path.join(outDir, `${safe(name)}.jpg`));
}
console.log(`Wrote ${ROUND.length} round-site crops to ${outDir}/`);

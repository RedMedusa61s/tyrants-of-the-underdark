// OCR the printed VP numbers on each site-control marker.
// Each marker shows the control-side VP and total-control-side VP. Layout varies, so we
// upscale + binarize and let Tesseract pull every digit it finds.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

const ROOT = path.resolve('.');
const markers = [
  { siteId: 'araumycos',      file: 'araumycos-control.jpg' },
  { siteId: 'chchitl',        file: 'chchitl-control.jpg' },
  { siteId: 'gauntlgrym',     file: 'gauntlgrym-control.jpg' },
  { siteId: 'menzoberranzan', file: 'menzoberranzan-control.jpg' },
  { siteId: 'sszuraassnee',   file: 'sszuraassnee-control.jpg' },
  { siteId: 'phaerlin',       file: 'the-phaerlin-control.jpg' },
  { siteId: 'tsenviilyq',     file: 'tsenviilyq-control.jpg' },
];

const worker = await createWorker('eng');
await worker.setParameters({
  tessedit_char_whitelist: '0123456789+',
  tessedit_pageseg_mode: '11', // sparse text
});

for (const m of markers) {
  const file = path.join(ROOT, 'assets/tokens', m.file);
  if (!fs.existsSync(file)) { console.log(`  MISSING ${m.file}`); continue; }
  const buf = await sharp(file)
    .resize({ width: 800 })
    .greyscale()
    .normalise()
    .sharpen()
    .png()
    .toBuffer();
  const { data } = await worker.recognize(buf);
  const text = (data.text || '').replace(/\s+/g, ' ').trim();
  // Also OCR the rotated view (markers often have one side rotated 180° on a single image).
  const buf180 = await sharp(file).resize({ width: 800 }).rotate(180).greyscale().normalise().sharpen().png().toBuffer();
  const r180 = await worker.recognize(buf180);
  const text180 = (r180.data.text || '').replace(/\s+/g, ' ').trim();
  console.log(`${m.siteId.padEnd(16)} 0°: "${text}"  180°: "${text180}"`);
}

await worker.terminate();

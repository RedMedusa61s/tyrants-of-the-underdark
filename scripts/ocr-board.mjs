// Detect site positions on the board by OCR'ing the game-board image with
// bounding boxes, then fuzzy-matching detected text to known site names.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

const ROOT = path.resolve('.');
const BOARD = path.join(ROOT, 'assets/board/map.jpg');

// 26 sites from rulebook appendix. Match these against OCR words/lines.
const SITES = [
  'Araumycos', 'Blingdenstone', 'Buiyrandyn', 'Chasmleap Bridge', 'Chaulssin', "Ch'Chitl",
  'Ched Nasad', 'Eryndlyn', 'Everfire', 'Gauntlgrym', 'Gracklstugh',
  'Halls of the Scoured Legion', 'Jhachalkhyn', 'Kanaglym', 'The Labyrinth',
  'Llacerellyn', 'Mantol-Derith', 'Menzoberranzan', 'The Phaerlin',
  'Ruins of Dekanter', 'Skullport', "Ss'zuraass'nee", 'Stoneshaft Clanhold',
  'Tsenviilyq', 'The Wormwrithings', 'Yathchol',
];

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j-1] + 1, prev + (a[i-1] === b[j-1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}

// Preprocess: the board has dark/blue background with white site labels in caps.
// Tesseract does much better with a clean white-on-black contrast.
const meta = await sharp(BOARD).metadata();
console.log(`Board: ${meta.width}x${meta.height}`);

// Site labels: black text on small white rectangles, OR white text on dark site nodes.
// Best approach: keep both polarities by composing two thresholded variants. For OCR
// we'll preprocess as upscaled grayscale + light auto-thresholding (no hard threshold).
const processed = await sharp(BOARD)
  .resize({ width: 3000 })
  .greyscale()
  .normalise()
  .sharpen()
  .png()
  .toBuffer();

await fs.promises.writeFile(path.join(ROOT, 'assets/board/_ocr-preview.png'), processed);

const worker = await createWorker('eng');
await worker.setParameters({ tessedit_pageseg_mode: '11' }); // sparse text — best for scattered labels
console.log('Running OCR...');
const { data } = await worker.recognize(processed, {}, { blocks: true });

// Walk lines (sometimes a site name spans two words, e.g. "MANTOL DERITH")
const lines = [];
for (const block of data.blocks ?? []) {
  for (const para of block.paragraphs ?? []) {
    for (const line of para.lines ?? []) {
      const text = (line.text || '').replace(/\s+/g, ' ').trim();
      if (text.length < 3) continue;
      lines.push({ text, bbox: line.bbox });
    }
  }
}
console.log(`OCR produced ${lines.length} lines (orientation 0)`);
if (process.env.DUMP) for (const ln of lines) console.log(`  ${JSON.stringify(ln.text)} bbox=${ln.bbox.x0},${ln.bbox.y0}..${ln.bbox.x1},${ln.bbox.y1}`);

// Site labels on this board appear in multiple orientations. OCR both rotations.
// sharp rotate(deg) is clockwise. Original point (x, y) maps as follows:
//   rotate(90):  rotated point = (H - 1 - y, x);  inverse: orig = (y_r, H - 1 - x_r)
//   rotate(-90): rotated point = (y, W - 1 - x);  inverse: orig = (W - 1 - y_r, x_r)
for (const deg of [90, -90]) {
  const rotated = await sharp(processed).rotate(deg).png().toBuffer();
  const { data: dr } = await worker.recognize(rotated, {}, { blocks: true });
  let count = 0;
  for (const block of dr.blocks ?? []) for (const para of block.paragraphs ?? []) for (const line of para.lines ?? []) {
    const text = (line.text || '').replace(/\s+/g, ' ').trim();
    if (text.length < 3) continue;
    let orig;
    if (deg === 90) {
      orig = { x0: line.bbox.y0, x1: line.bbox.y1, y0: meta.height - 1 - line.bbox.x1, y1: meta.height - 1 - line.bbox.x0 };
    } else {
      orig = { x0: meta.width - 1 - line.bbox.y1, x1: meta.width - 1 - line.bbox.y0, y0: line.bbox.x0, y1: line.bbox.x1 };
    }
    lines.push({ text, bbox: orig, rot: deg });
    count++;
  }
  console.log(`OCR produced ${count} lines (orientation ${deg})`);
}
await worker.terminate();

// Try to fuzzy-match each line (and pairs of adjacent lines) to known site names.
const found = new Map(); // site -> { x, y, score, ocrText }

function tryMatch(text, bbox) {
  const t = norm(text);
  if (t.length < 3) return;
  for (const site of SITES) {
    const sn = norm(site);
    // Allow OCR text to contain extra leading/trailing chars; check substring + lev fallback
    let score = lev(t, sn);
    if (t.includes(sn)) score = 0;
    else if (sn.includes(t) && t.length >= sn.length - 2) score = Math.min(score, 1);
    // Threshold relative to site name length (a few characters tolerance)
    const threshold = Math.max(3, Math.floor(sn.length * 0.35));
    if (score <= threshold) {
      const cx = (bbox.x0 + bbox.x1) / 2 / meta.width;
      const cy = (bbox.y0 + bbox.y1) / 2 / meta.height;
      const prev = found.get(site);
      if (!prev || score < prev.score) {
        found.set(site, { x: cx, y: cy, score, ocrText: text });
      }
    }
  }
}

for (const ln of lines) tryMatch(ln.text, ln.bbox);

// Also try pairs of adjacent lines (multi-word site names)
for (let i = 0; i < lines.length - 1; i++) {
  const a = lines[i], b = lines[i+1];
  // Only pair lines that are vertically close
  if (Math.abs((a.bbox.y0 + a.bbox.y1)/2 - (b.bbox.y0 + b.bbox.y1)/2) > meta.height * 0.04) continue;
  const merged = a.text + ' ' + b.text;
  const mergedBbox = {
    x0: Math.min(a.bbox.x0, b.bbox.x0), x1: Math.max(a.bbox.x1, b.bbox.x1),
    y0: Math.min(a.bbox.y0, b.bbox.y0), y1: Math.max(a.bbox.y1, b.bbox.y1),
  };
  tryMatch(merged, mergedBbox);
}

console.log(`\nMatched ${found.size}/${SITES.length} sites:`);
for (const [site, info] of [...found.entries()].sort((a,b)=>a[1].y - b[1].y)) {
  console.log(`  ${site.padEnd(28)} → x=${info.x.toFixed(3)} y=${info.y.toFixed(3)}  (OCR: "${info.ocrText}", dist ${info.score})`);
}
const missing = SITES.filter(s => !found.has(s));
if (missing.length) console.log(`\nNot found by OCR (${missing.length}):`, missing.join(', '));

fs.writeFileSync(path.join(ROOT, 'assets/site-positions-ocr.json'),
  JSON.stringify(Object.fromEntries([...found.entries()].map(([k, v]) => [k, { x: v.x, y: v.y }])), null, 2));
console.log(`\nWrote assets/site-positions-ocr.json`);

// OCR the printed cost from each card's top-right corner and diff against card-data.json.
//
// Approach:
//   1. Crop the top-right corner of each card image (where the cost number sits).
//   2. Upscale + grayscale + threshold for clean digit OCR.
//   3. Parse the digit; compare to card-data.json's cost; print mismatches.
//   4. Write a corrected card-data.json next to the original so you can review the diff.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

const ROOT = path.resolve('.');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/card-data.json'), 'utf8'));

// Cards we actually need accurate costs for: half-deck + always-available recruitable cards.
// Skip starter cards (Noble/Soldier are 0-cost / unrecruitable).
const IN_SCOPE_DECKS = new Set(['drow', 'dragons', 'elemental', 'demons', 'house-guards', 'priestesses', 'insane-outcasts']);

const worker = await createWorker('eng');
await worker.setParameters({
  tessedit_char_whitelist: '0123456789',
  tessedit_pageseg_mode: '8', // single word
});

const mismatches = [];
const unreadable = [];
const corrected = { ...data };

let i = 0;
const total = Object.values(data).filter(c => IN_SCOPE_DECKS.has(c.deck)).length;

for (const [key, card] of Object.entries(data)) {
  if (!IN_SCOPE_DECKS.has(card.deck)) continue;
  i++;
  const file = path.join(ROOT, card.image);
  if (!fs.existsSync(file)) continue;
  const meta = await sharp(file).metadata();
  // Top-right corner. Card aspect ratio ~ 2:3 (W:H). Cost number is in roughly the upper
  // ~12% height and right ~22% width. Tuned empirically below.
  const cropW = Math.round(meta.width * 0.22);
  const cropH = Math.round(meta.height * 0.10);
  const left = meta.width - cropW;
  const top = Math.round(meta.height * 0.01);
  const buf = await sharp(file)
    .extract({ left, top, width: cropW, height: cropH })
    .resize({ width: 400 })
    .greyscale()
    .normalise()
    .threshold(160)
    .negate()  // tesseract works better with dark text on white
    .png()
    .toBuffer();

  const { data: ocr } = await worker.recognize(buf);
  const txt = (ocr.text || '').replace(/\D/g, '');
  // Some cards have a multi-digit cost (e.g. 10), some single digit. Take the first
  // digit run; tolerate Tesseract reading both digits or extra junk.
  const m = txt.match(/\d+/);
  const ocrCost = m ? parseInt(m[0]) : null;

  if (ocrCost == null || ocrCost > 10) {
    unreadable.push({ key, name: card.name, sheetCost: card.cost, raw: ocr.text.trim() });
    continue;
  }
  if (ocrCost !== card.cost) {
    mismatches.push({ key, name: card.name, sheetCost: card.cost, ocrCost });
    corrected[key] = { ...card, cost: ocrCost };
  }
  if (i % 20 === 0) console.log(`  ${i}/${total}`);
}

await worker.terminate();

console.log(`\nScanned ${total} recruitable cards.`);
console.log(`  ${mismatches.length} mismatches`);
console.log(`  ${unreadable.length} unreadable (cost retained from sheet)`);

if (mismatches.length) {
  console.log(`\nMismatches (sheet vs printed):`);
  for (const m of mismatches.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${m.name.padEnd(28)} sheet=${m.sheetCost}  printed=${m.ocrCost}`);
  }
}
if (unreadable.length) {
  console.log(`\nUnreadable (manual check recommended):`);
  for (const m of unreadable.slice(0, 10)) console.log(`  ${m.name}  raw="${m.raw}"`);
  if (unreadable.length > 10) console.log(`  ... and ${unreadable.length - 10} more`);
}

fs.writeFileSync(path.join(ROOT, 'assets/card-data.corrected.json'), JSON.stringify(corrected, null, 2));
console.log(`\nCorrected data written to assets/card-data.corrected.json (review diff, then move into place).`);

// Run OCR over each sliced card image and cross-check against card-name-map.json.
// Reports any slot whose OCR'd name doesn't fuzzy-match the user-assigned name.
//
// Approach:
//   1. Crop the top ~12% strip of each image (where the card name is printed).
//   2. Upscale + grayscale + threshold for better Tesseract accuracy.
//   3. Run OCR, normalize the result, fuzzy-match against the set's known card names.
//   4. Compare best match to the assignment in card-name-map.json.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

const ROOT = path.resolve('.');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/cards.json'), 'utf8'));
const nameMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/card-name-map.json'), 'utf8'));
const csv = fs.readFileSync(path.join(ROOT, 'assets/raw-card-data.csv'), 'utf8');

const CORE_CARDS = new Set(['soldier', 'noble', 'insane outcast', 'priestess of lolth', 'house guard']);
const SET_OVERRIDES = { 'kobold': 'dragons' };

function normalizeSet(raw, name) {
  const nameKey = name.toLowerCase();
  if (CORE_CARDS.has(nameKey)) return 'core';
  if (SET_OVERRIDES[nameKey]) return SET_OVERRIDES[nameKey];
  const lower = (raw || '').toLowerCase();
  if (lower === 'fungus') return 'demons';
  if (lower === 'dragon') return 'dragons';
  if (lower === 'elementals') return 'elemental';
  return lower;
}

function parseCsv(s) {
  const rows = []; let row = []; let cell = ''; let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) { if (c === '"' && s[i+1] === '"') { cell += '"'; i++; } else if (c === '"') inQ = false; else cell += c; }
    else { if (c === '"') inQ = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c; }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Build set -> [name] from the sheet
const sheetRows = parseCsv(csv);
const namesBySet = {};
for (let i = 1; i < sheetRows.length; i++) {
  const r = sheetRows[i];
  const name = r[1]?.trim();
  if (!name) continue;
  const set = normalizeSet(r[5], name);
  (namesBySet[set] ??= []).push(name);
}

// Levenshtein distance for fuzzy match
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

function bestMatch(ocrText, candidates) {
  const o = norm(ocrText);
  if (!o) return { name: null, score: Infinity };
  // Card names appear at the start of the OCR text, followed by cost/icon noise.
  // Score each candidate by Levenshtein against the matching-length prefix of OCR
  // (so trailing garbage doesn't penalize matches).
  let best = { name: null, score: Infinity };
  for (const c of candidates) {
    const cn = norm(c);
    if (!cn) continue;
    const prefix = o.slice(0, cn.length + 2); // small slack for OCR insertions
    const d = lev(prefix, cn);
    if (d < best.score) best = { name: c, score: d };
  }
  return best;
}

async function ocrSlot(worker, imagePath) {
  const buf = await fs.promises.readFile(imagePath);
  const meta = await sharp(buf).metadata();
  // Crop top strip where the card name lives, then upscale + grayscale + threshold for OCR.
  const top = await sharp(buf)
    .extract({ left: 0, top: 0, width: meta.width, height: Math.round(meta.height * 0.12) })
    .resize({ width: 600 })
    .greyscale()
    .normalise()
    .threshold(140)
    .png()
    .toBuffer();
  const { data } = await worker.recognize(top);
  return data.text.replace(/\s+/g, ' ').trim();
}

const slotKeysToCheck = manifest.cards.filter(c =>
  ['drow', 'dragons', 'elemental', 'demons'].includes(c.deck)
);

console.log(`OCR'ing ${slotKeysToCheck.length} card images...`);
const worker = await createWorker('eng');

const mismatches = [];
const matches = [];
const unreadable = [];

for (let i = 0; i < slotKeysToCheck.length; i++) {
  const c = slotKeysToCheck[i];
  const key = `${c.deck}::${c.slot}`;
  const assigned = nameMap[key];
  const candidates = namesBySet[c.deck] ?? [];
  // Also allow core-set matches in case a core card landed in a half-deck slot.
  const allCandidates = candidates.concat(namesBySet['core'] ?? []);

  let ocrText = '';
  try {
    ocrText = await ocrSlot(worker, path.join(ROOT, c.image));
  } catch (e) {
    console.error(`  OCR error on ${key}: ${e.message}`);
    continue;
  }
  const match = bestMatch(ocrText, allCandidates);
  // Tolerate up to 3-edit distance (handles "rn"→"m", missing apostrophes, etc.)
  const ok = match.score <= 3 && match.name === assigned;
  const readable = match.score <= 3;

  if (!readable) unreadable.push({ key, assigned, ocr: ocrText });
  else if (!ok) mismatches.push({ key, assigned, ocrBest: match.name, ocr: ocrText, score: match.score });
  else matches.push({ key, name: assigned });

  if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${slotKeysToCheck.length}`);
}

await worker.terminate();

console.log(`\n=== Results ===`);
console.log(`  ${matches.length} confirmed`);
console.log(`  ${mismatches.length} disagreements (OCR says different card than you assigned)`);
console.log(`  ${unreadable.length} unreadable (OCR confidence too low)`);

if (mismatches.length) {
  console.log(`\nDisagreements:`);
  for (const m of mismatches) {
    console.log(`  ${m.key}`);
    console.log(`    assigned: ${m.assigned}`);
    console.log(`    OCR best: ${m.ocrBest}  (raw: "${m.ocr}", edit dist ${m.score})`);
  }
}
if (unreadable.length) {
  console.log(`\nUnreadable (manual check recommended):`);
  for (const m of unreadable.slice(0, 10)) console.log(`  ${m.key} assigned=${m.assigned} raw="${m.ocr}"`);
  if (unreadable.length > 10) console.log(`  ... and ${unreadable.length - 10} more`);
}

fs.writeFileSync(path.join(ROOT, 'assets/ocr-report.json'), JSON.stringify({ matches, mismatches, unreadable }, null, 2));
console.log(`\nFull report: assets/ocr-report.json`);

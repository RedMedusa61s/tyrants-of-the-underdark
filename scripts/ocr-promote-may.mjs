// One-off audit: OCR the text body of every card that uses flagEotPromote
// and report whether its printed text contains the word "may" — which
// determines whether the promote is optional (per the BGG community
// reading discussed in thread 1712589). Used to rectify our default
// (mandatory) against actual card text per #56-followup.
//
// Output: a markdown table to stdout. Doesn't write to card-data; the
// developer reads the table and decides which flagEotPromote callers
// should be flipped to { optional: true }.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

const ROOT = path.resolve('.');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/card-data.json'), 'utf8'));

// Every card the engine queues an end-of-turn promote on. Update this list
// in lockstep with `flagEotPromote(...)` callers in src/engine/handlers/.
const TARGETS = [
  ['aberrations', 'Ambassador'],
  ['aberrations', 'Puppeteer'],
  ['undead', 'Cultist of Myrkul'],
  ['undead', 'High Priest of Myrkul'],
  ['dragons', 'Wyrmspeaker'],
  ['dragons', 'Cleric of Laogzed'],
  ['dragons', 'Blue Dragon'],
  ['drow', 'Advocate'],
  ['drow', 'Drow Negotiator'],
  ['drow', 'Chosen of Lolth'],
  ['drow', 'Council Member'],
  ['elemental', 'Air Elemental Myrmidon'],
  ['elemental', 'Fire Elemental Myrmidon'],
  ['elemental', 'Water Elemental Myrmidon'],
  ['elemental', 'Earth Elemental Myrmidon'],
  ['elemental', 'Ogremoch'],
  ['elemental', 'Marlos Urnrayle'],
  ['elemental', 'Black Earth Cultist'],
  ['demons', 'Myconid Sovereign'],
  ['demons', 'Zuggtmoy'],
];

function findCard(deck, name) {
  return Object.values(data).find(c => c.deck === deck && c.name === name);
}

const worker = await createWorker('eng');
// Default page-seg mode is fine for paragraphs. No char whitelist —
// punctuation matters for parsing the effect text.

const rows = [];

for (const [deck, name] of TARGETS) {
  const card = findCard(deck, name);
  if (!card) { rows.push({ deck, name, ok: false, msg: 'card-data lookup failed' }); continue; }
  const file = path.join(ROOT, card.image);
  if (!fs.existsSync(file)) { rows.push({ deck, name, ok: false, msg: 'image missing' }); continue; }

  // The effect text on a Tyrants card sits in the lower ~40% of the card,
  // below the art. Crop generously; tesseract handles ragged backgrounds OK
  // and we'd rather over-include than miss a "you may" prefix. Tuned by
  // eyeballing a few sample cards (750x1000 source).
  const meta = await sharp(file).metadata();
  const cropTop = Math.round(meta.height * 0.55);
  const cropH = meta.height - cropTop - Math.round(meta.height * 0.04); // leave VP footer alone
  const buf = await sharp(file)
    .extract({ left: Math.round(meta.width * 0.05), top: cropTop,
               width: Math.round(meta.width * 0.90), height: cropH })
    .resize({ width: 1200 })
    .greyscale()
    .normalise()
    .png()
    .toBuffer();

  const { data: ocr } = await worker.recognize(buf);
  const raw = (ocr.text || '').replace(/\s+/g, ' ').trim();
  // Heuristic: look for "may" as a standalone word in the OCR result.
  // Tesseract sometimes reads it as "rray" / "rnay" / "ray" on stylized
  // fonts — flag those too and let the human disambiguate.
  const hasMay = /\b(?:may|rnay|rray|miay|nay)\b/i.test(raw);
  rows.push({ deck, name, ok: true, hasMay, raw });
}

await worker.terminate();

// Print a clean markdown table.
console.log('| Card | Deck | "may" found? | OCR excerpt |');
console.log('|---|---|---|---|');
for (const r of rows) {
  if (!r.ok) { console.log(`| ${r.name} | ${r.deck} | — | ${r.msg} |`); continue; }
  const flag = r.hasMay ? '✅ may' : '❌ no may';
  const snippet = r.raw.slice(0, 160).replace(/\|/g, '\\|');
  console.log(`| ${r.name} | ${r.deck} | ${flag} | ${snippet} |`);
}

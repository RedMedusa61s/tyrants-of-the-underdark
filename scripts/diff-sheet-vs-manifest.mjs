// Compare the Google Sheet card list against the manifest extracted from TTS.
// Goal: confirm name alignment per deck and surface mismatches.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/cards.json'), 'utf8'));
const csv = fs.readFileSync(path.join(ROOT, 'assets/raw-card-data.csv'), 'utf8');

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

// Sheet: build { setName -> Set<normalizedName -> originalName> }
const rows = parseCsv(csv);
const sheetBySet = {};
for (let i = 1; i < rows.length; i++) {
  const [, name, , , , set] = rows[i];
  if (!name) continue;
  // Apply the rename: sheet's "Fungus" is mislabeled Demons.
  const setKey = set === 'Fungus' ? 'demons' : set?.toLowerCase().replace(/s$/, '').replace('elementa', 'elemental') === 'elemental' ? 'elemental' : set?.toLowerCase();
  const canonical = setKey === 'dragon' ? 'dragons' : setKey === 'aberration' ? 'aberrations' : setKey;
  (sheetBySet[canonical] ??= new Map()).set(norm(name), name);
}

// Manifest: build { deck -> Set<normalizedName -> originalName> }
const manifestByDeck = {};
for (const c of manifest.cards) {
  if (!c.name) continue;
  (manifestByDeck[c.deck] ??= new Map()).set(norm(c.name), c.name);
}

// Compare for decks present in both
const decksToCheck = ['drow', 'dragons', 'elemental', 'demons'];
for (const deck of decksToCheck) {
  const sheet = sheetBySet[deck] ?? new Map();
  const man = manifestByDeck[deck] ?? new Map();
  console.log(`\n=== ${deck.toUpperCase()} (sheet=${sheet.size}, manifest=${man.size}) ===`);

  const onlySheet = [...sheet.entries()].filter(([k]) => !man.has(k)).map(([, v]) => v);
  const onlyManifest = [...man.entries()].filter(([k]) => !sheet.has(k)).map(([, v]) => v);
  const both = [...sheet.entries()].filter(([k]) => man.has(k)).length;

  console.log(`  matched: ${both}`);
  if (onlySheet.length) console.log(`  only in sheet (${onlySheet.length}):`, onlySheet.join(', '));
  if (onlyManifest.length) console.log(`  only in manifest (${onlyManifest.length}):`, onlyManifest.join(', '));
}

// Decks only in sheet (Aberrations, Undead expansions)
console.log(`\n=== Expansion sets (sheet only) ===`);
for (const set of Object.keys(sheetBySet)) {
  if (!decksToCheck.includes(set)) console.log(`  ${set}: ${sheetBySet[set].size} cards`);
}

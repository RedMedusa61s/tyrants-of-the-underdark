// Build assets/card-data.json by joining:
//   - assets/cards.json (manifest: deck, slot, image — from TTS rip)
//   - assets/card-name-map.json (user calibration: "deck::slot" -> "card name")
//   - assets/raw-card-data.csv (Google Sheet export: cost/vp/aspect/benefits per name)
//
// Output keyed by "deck::slot" for fast lookup at runtime. Includes a slugified
// effectKey for the handler registry. Reports unmapped slots and unmatched sheet rows.

import fs from 'node:fs';
import path from 'node:path';

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

const slug = s => (s || '').toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// --- Parse sheet ---
const sheetRows = parseCsv(csv);
const sheetByKey = new Map(); // (set::norm-name) -> row
for (let i = 1; i < sheetRows.length; i++) {
  const r = sheetRows[i];
  const name = r[1]?.trim();
  if (!name) continue;
  const set = normalizeSet(r[5], name);
  const row = {
    count: parseInt(r[0]) || 1,
    name,
    cost: parseInt(r[2]) || 0,
    deckVp: parseInt(r[3]) || 0,
    innerCircleVp: parseInt(r[4]) || 0,
    set,
    benefit1: r[8]?.trim() || '',
    benefit2: r[9]?.trim() || '',
    benefit3: r[10]?.trim() || '',
    aspect: (r[11] || '').trim(),
    type: (r[12] || '').trim(),
  };
  sheetByKey.set(`${set}::${norm(name)}`, row);
}

// --- Build per-slot card-data ---
const cardData = {};

// 1. Half-deck slots from name-map
for (const [key, name] of Object.entries(nameMap)) {
  const [deck, slotStr] = key.split('::');
  const slot = parseInt(slotStr);
  const manifestEntry = manifest.cards.find(c => c.deck === deck && c.slot === slot);
  if (!manifestEntry) continue;
  const sheetEntry = sheetByKey.get(`${deck}::${norm(name)}`);
  cardData[key] = {
    deck,
    slot,
    name,
    image: manifestEntry.image,
    cost: sheetEntry?.cost ?? 0,
    deckVp: sheetEntry?.deckVp ?? 0,
    innerCircleVp: sheetEntry?.innerCircleVp ?? 0,
    aspect: sheetEntry?.aspect ?? '',
    type: sheetEntry?.type ?? '',
    rarity: sheetEntry?.count ?? 1,
    benefits: [sheetEntry?.benefit1, sheetEntry?.benefit2, sheetEntry?.benefit3].filter(Boolean),
    effectKey: slug(name),
    _matchedSheet: !!sheetEntry,
  };
}

// 2. Core / starter / always-available — fixed identities by manifest deck name.
function addCoreCard(deck, slot, sheetNameKey, image) {
  const sheetEntry = sheetByKey.get(`core::${norm(sheetNameKey)}`);
  cardData[`${deck}::${slot}`] = {
    deck, slot,
    name: sheetNameKey,
    image,
    cost: sheetEntry?.cost ?? 0,
    deckVp: sheetEntry?.deckVp ?? 0,
    innerCircleVp: sheetEntry?.innerCircleVp ?? 0,
    aspect: sheetEntry?.aspect ?? '',
    type: sheetEntry?.type ?? 'Drow',
    rarity: sheetEntry?.count ?? 1,
    benefits: [sheetEntry?.benefit1, sheetEntry?.benefit2, sheetEntry?.benefit3].filter(Boolean),
    effectKey: slug(sheetNameKey),
    _matchedSheet: !!sheetEntry,
  };
}

for (const c of manifest.cards) {
  if (c.deck === 'house-guards') addCoreCard(c.deck, c.slot, 'House Guard', c.image);
  else if (c.deck === 'priestesses') addCoreCard(c.deck, c.slot, 'Priestess of Lolth', c.image);
  else if (c.deck === 'insane-outcasts') addCoreCard(c.deck, c.slot, 'Insane Outcast', c.image);
  else if (c.deck.startsWith('starter-')) {
    // starter decks have only 2 unique slots: a Noble image and a Soldier image. We don't
    // know which is which from the manifest alone, so heuristic: lower slot index = Noble.
    // This is a guess; verify visually if names look swapped.
    const isNoble = c.slot === Math.min(...manifest.cards.filter(x => x.deck === c.deck).map(x => x.slot));
    addCoreCard(c.deck, c.slot, isNoble ? 'Noble' : 'Soldier', c.image);
  }
}

// --- Report ---
const allCards = Object.values(cardData);
const matched = allCards.filter(c => c._matchedSheet).length;
const unmatched = allCards.filter(c => !c._matchedSheet);

console.log(`Built ${allCards.length} card-data entries.`);
console.log(`  ${matched} matched a sheet row.`);
if (unmatched.length) {
  console.log(`  ${unmatched.length} unmatched (no sheet row — defaults applied):`);
  for (const c of unmatched.slice(0, 20)) console.log(`    ${c.deck}::${c.slot} ${c.name}`);
  if (unmatched.length > 20) console.log(`    ... and ${unmatched.length - 20} more`);
}

// Unmatched sheet rows (cards in the sheet that don't appear in our half-decks).
const namedSheetKeys = new Set(allCards.map(c => `${c.deck.startsWith('starter-')||['house-guards','priestesses','insane-outcasts'].includes(c.deck) ? 'core' : c.deck}::${norm(c.name)}`));
const orphanSheetRows = [...sheetByKey.values()].filter(r => !namedSheetKeys.has(`${r.set}::${norm(r.name)}`) && ['drow','dragons','elemental','demons','core'].includes(r.set));
if (orphanSheetRows.length) {
  console.log(`\n  ${orphanSheetRows.length} sheet rows for in-scope sets not assigned to any slot:`);
  for (const r of orphanSheetRows) console.log(`    ${r.set}::${r.name}`);
}

fs.writeFileSync(path.join(ROOT, 'assets/card-data.json'), JSON.stringify(cardData, null, 2));
console.log(`\nWrote assets/card-data.json`);

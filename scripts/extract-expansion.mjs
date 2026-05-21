// Focused extraction for the Aberrations & Undead expansion half-decks
// from TTS workshop mod 2745860709 ("Tyrants of the Underdark [SCRIPTED]").
//
// The base extract-assets.mjs reads from mod 881660322, which predates
// the expansion. This script:
//   1. Reads the newer mod's save file
//   2. Locates the Aberrations and Undead half-decks (they share one
//      7×6 sheet image)
//   3. Downloads the sheet to assets/raw/ and measures pixel dimensions
//   4. Slices into per-card JPEGs under assets/cards/aberrations/ and
//      assets/cards/undead/
//   5. Appends entries to assets/cards.json (manifest)
//   6. Adds the sheet to assets/asset-urls.json
//
// Re-runnable: skips re-downloads and re-slicing when output files
// already exist.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import sharp from 'sharp';

const ROOT = path.resolve('.');
const TTS_SAVE = path.join(os.homedir(), 'Documents/My Games/Tabletop Simulator/Mods/Workshop/2745860709.json');
const RAW = path.join(ROOT, 'assets/raw');
const CARDS = path.join(ROOT, 'assets/cards');
const ASSET_URLS_PATH = path.join(ROOT, 'assets/asset-urls.json');
const CARDS_MANIFEST_PATH = path.join(ROOT, 'assets/cards.json');

for (const d of [RAW, CARDS]) fs.mkdirSync(d, { recursive: true });

const slug = s => (s || 'unnamed')
  .toLowerCase()
  .replace(/['']/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) return resolve({ cached: true, dest });
    const f = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        f.close(); fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) { f.close(); fs.unlinkSync(dest); return reject(new Error(`${res.statusCode} ${url}`)); }
      res.pipe(f);
      f.on('finish', () => f.close(() => resolve({ cached: false, dest })));
    }).on('error', err => { f.close(); try { fs.unlinkSync(dest); } catch {} reject(err); });
  });
}

const j = JSON.parse(fs.readFileSync(TTS_SAVE, 'utf8'));

// --- Find the two expansion half-decks ---
const DECK_TARGETS = {
  'Aberrations Half-Deck': 'aberrations',
  'Undead Half-Deck': 'undead',
};
const found = {}; // canonical → { deck object, sheet info }

function walk(arr) {
  for (const o of arr || []) {
    if ((o.Name === 'Deck' || o.Name === 'DeckCustom') && DECK_TARGETS[o.Nickname]) {
      const customDeck = o.CustomDeck || {};
      const firstKey = Object.keys(customDeck)[0];
      const sheet = customDeck[firstKey];
      const canonical = DECK_TARGETS[o.Nickname];
      found[canonical] = {
        nickname: o.Nickname,
        deck: o,
        customDeckId: firstKey,
        sheetUrl: sheet?.FaceURL,
        backUrl: sheet?.BackURL,
        cols: sheet?.NumWidth,
        rows: sheet?.NumHeight,
        containedObjects: o.ContainedObjects || [],
      };
    }
    if (o.ContainedObjects) walk(o.ContainedObjects);
  }
}
walk(j.ObjectStates);

if (!found.aberrations || !found.undead) {
  console.error('Could not locate both Aberrations and Undead half-decks in', TTS_SAVE);
  process.exit(1);
}

// Confirm they share a sheet URL (they do per our earlier reconnaissance, but
// guard against the mod author splitting them in a future update).
if (found.aberrations.sheetUrl !== found.undead.sheetUrl) {
  console.warn('Aberrations and Undead are on DIFFERENT sheets — handling separately.');
}

console.log(`Aberrations: ${found.aberrations.containedObjects.length} cards, sheet ${found.aberrations.cols}×${found.aberrations.rows}`);
console.log(`Undead:      ${found.undead.containedObjects.length} cards, sheet ${found.undead.cols}×${found.undead.rows}`);

// --- Download the shared sheet ---
const sheetUrl = found.aberrations.sheetUrl;
const sheetFile = path.join(RAW, `aberrations-undead-sheet${path.extname(new URL(sheetUrl).pathname) || '.jpg'}`);
console.log(`\nFetching sheet: ${sheetUrl}`);
const dl = await download(sheetUrl, sheetFile);
console.log(`  ${dl.cached ? 'cached' : 'downloaded'} → ${sheetFile}`);

const sheetImg = sharp(sheetFile);
const sheetMeta = await sheetImg.metadata();
console.log(`  pixel dimensions: ${sheetMeta.width}×${sheetMeta.height}`);

// --- Slice each unique card and emit manifest entries ---
const newManifest = [];
const seen = new Set();

async function sliceCard(deckName, c, cols, rows) {
  const slot = c.CardID % 100;
  const key = `${deckName}::${slot}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const tileW = Math.floor(sheetMeta.width / cols);
  const tileH = Math.floor(sheetMeta.height / rows);
  const row = Math.floor(slot / cols);
  const col = slot % cols;

  const outDir = path.join(CARDS, deckName);
  fs.mkdirSync(outDir, { recursive: true });
  const outName = `${String(slot).padStart(2, '0')}-${slug(c.Nickname || 'unnamed')}.jpg`;
  const outPath = path.join(outDir, outName);

  if (!fs.existsSync(outPath)) {
    await sharp(sheetFile)
      .extract({ left: col * tileW, top: row * tileH, width: tileW, height: tileH })
      .jpeg({ quality: 92 })
      .toFile(outPath);
  }
  return {
    deck: deckName,
    slot,
    name: c.Nickname || '',
    image: path.relative(ROOT, outPath).replace(/\\/g, '/'),
  };
}

let sliced = 0;
for (const [canonical, info] of Object.entries(found)) {
  for (const c of info.containedObjects) {
    const m = await sliceCard(canonical, c, info.cols, info.rows);
    if (m) { newManifest.push(m); sliced++; }
  }
}
console.log(`\nSliced ${sliced} unique card images`);

// --- Update assets/cards.json — append, dedupe by (deck, slot) ---
const existingManifest = JSON.parse(fs.readFileSync(CARDS_MANIFEST_PATH, 'utf8'));
const merged = new Map();
for (const c of existingManifest.cards) merged.set(`${c.deck}::${c.slot}`, c);
for (const c of newManifest) merged.set(`${c.deck}::${c.slot}`, c);
existingManifest.cards = [...merged.values()].sort((a, b) =>
  a.deck.localeCompare(b.deck) || a.slot - b.slot);
fs.writeFileSync(CARDS_MANIFEST_PATH, JSON.stringify(existingManifest, null, 2) + '\n');
console.log(`Updated assets/cards.json — total ${existingManifest.cards.length} cards across ${new Set(existingManifest.cards.map(c => c.deck)).size} decks`);

// --- Update assets/asset-urls.json with the new deck sheet entries ---
const assetUrls = JSON.parse(fs.readFileSync(ASSET_URLS_PATH, 'utf8'));
assetUrls.decks.aberrations = {
  nickname: 'Aberrations half-deck',
  sheetUrl: found.aberrations.sheetUrl,
  backUrl: found.aberrations.backUrl,
  cols: found.aberrations.cols,
  rows: found.aberrations.rows,
  width: sheetMeta.width,
  height: sheetMeta.height,
};
assetUrls.decks.undead = {
  nickname: 'Undead half-deck',
  sheetUrl: found.undead.sheetUrl,
  backUrl: found.undead.backUrl,
  cols: found.undead.cols,
  rows: found.undead.rows,
  width: sheetMeta.width,
  height: sheetMeta.height,
};
fs.writeFileSync(ASSET_URLS_PATH, JSON.stringify(assetUrls, null, 2) + '\n');
console.log('Updated assets/asset-urls.json with aberrations + undead entries');

console.log('\nDone.');

// Extract Tyrants of the Underdark assets from the TTS workshop save (881660322).
// - Downloads all imgur-hosted assets (board, tiles, model textures) to assets/raw/
// - Slices the 4 card sheets into per-card PNGs under assets/cards/<deck>/
// - Emits assets/cards.json manifest the React app will consume
//
// Personal-use only; art is © Wizards of the Coast / Gale Force Nine.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import sharp from 'sharp';

const ROOT = path.resolve('.');
const TTS_SAVE = path.join(os.homedir(), 'Documents/My Games/Tabletop Simulator/Mods/Workshop/881660322.json');
const RAW = path.join(ROOT, 'assets/raw');
const CARDS = path.join(ROOT, 'assets/cards');
const TOKENS = path.join(ROOT, 'assets/tokens');
const BOARD = path.join(ROOT, 'assets/board');
const SPIES = path.join(ROOT, 'assets/models');

for (const d of [RAW, CARDS, TOKENS, BOARD, SPIES]) fs.mkdirSync(d, { recursive: true });

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

// --- 1. Walk save tree, collect every card with its deck + sheet info ---
const cards = [];
const decksByName = {};
let starterIdx = 0;

function classifyDeck(nickname, sheetUrl, count) {
  if (nickname && nickname.includes('half-deck')) return nickname.replace(' half-deck', '').toLowerCase();
  if (nickname === 'House Guards') return 'house-guards';
  if (nickname === 'Priestessess of Lolth' || nickname === 'Priestesses of Lolth') return 'priestesses';
  if (nickname === 'Insane Outcasts') return 'insane-outcasts';
  if (!nickname && count === 10) return `starter-${++starterIdx}`;
  return slug(nickname || 'misc');
}

function walk(arr, parentDeck) {
  for (const o of arr || []) {
    if (o.Name === 'Deck' || o.Name === 'DeckCustom') {
      const customDeck = o.CustomDeck || {};
      const firstKey = Object.keys(customDeck)[0];
      const sheet = customDeck[firstKey];
      const deckKey = classifyDeck(o.Nickname, sheet?.FaceURL, (o.ContainedObjects || []).length);
      decksByName[deckKey] = {
        nickname: o.Nickname || `(starter ${starterIdx})`,
        sheetUrl: sheet?.FaceURL,
        backUrl: sheet?.BackURL,
        cols: sheet?.NumWidth,
        rows: sheet?.NumHeight,
        count: (o.ContainedObjects || []).length,
      };
      walk(o.ContainedObjects, { deckKey, customDeck });
      continue;
    }
    if (o.Name === 'Card' && parentDeck) {
      const cardId = o.CardID;
      const customDeckId = Math.floor(cardId / 100);
      const slot = cardId % 100;
      const cd = parentDeck.customDeck[customDeckId];
      cards.push({
        cardId,
        slot,
        name: o.Nickname || '',
        description: o.Description || '',
        deck: parentDeck.deckKey,
        sheetUrl: cd?.FaceURL,
        cols: cd?.NumWidth,
        rows: cd?.NumHeight,
      });
    }
    if (o.ContainedObjects) walk(o.ContainedObjects, parentDeck);
  }
}
walk(j.ObjectStates, null);

console.log(`Found ${cards.length} cards across ${Object.keys(decksByName).length} decks`);
for (const [k, v] of Object.entries(decksByName)) console.log(`  ${k}: ${v.count} cards`);

// --- 2. Download all imgur-hosted assets we care about ---
const tiles = [];
const models = new Map();
(function collectExtras(arr) {
  for (const o of arr || []) {
    if (o.Name === 'Custom_Tile' && o.CustomImage?.ImageURL) {
      tiles.push({ nick: o.Nickname || 'unnamed', url: o.CustomImage.ImageURL });
    }
    if (o.Name === 'Custom_Model' && o.CustomMesh?.DiffuseURL) {
      if (!models.has(o.CustomMesh.DiffuseURL)) models.set(o.CustomMesh.DiffuseURL, o.Nickname);
    }
    if (o.ContainedObjects) collectExtras(o.ContainedObjects);
  }
})(j.ObjectStates);

const downloads = [];
function queue(url, dest) { if (url) downloads.push({ url, dest }); }
queue(j.TableURL, path.join(RAW, 'table.jpg'));
queue(j.SkyURL, path.join(RAW, 'sky.jpg'));
for (const t of tiles) {
  const ext = path.extname(new URL(t.url).pathname) || '.jpg';
  queue(t.url, path.join(RAW, `tile-${slug(t.nick || 'unnamed')}${ext}`));
}
for (const [url, nick] of models) {
  queue(url, path.join(RAW, `model-${slug(nick)}.png`));
}
// Card sheet URLs already downloaded manually earlier; keep them where they are.
for (const d of Object.values(decksByName)) queue(d.sheetUrl, path.join(RAW, path.basename(new URL(d.sheetUrl).pathname)));

console.log(`\nDownloading ${downloads.length} assets...`);
let dlOk = 0, dlSkip = 0, dlFail = 0;
for (const { url, dest } of downloads) {
  try {
    const r = await download(url.replace(/^http:/, 'https:'), dest);
    if (r.cached) dlSkip++; else dlOk++;
  } catch (e) {
    console.error(`  FAIL ${url} -> ${e.message}`);
    dlFail++;
  }
}
console.log(`  ${dlOk} downloaded, ${dlSkip} cached, ${dlFail} failed`);

// --- 3. Slice each card sheet ---
console.log(`\nSlicing card sheets...`);
const sheetCache = new Map(); // sheetUrl -> { img, meta }
async function getSheet(url) {
  if (sheetCache.has(url)) return sheetCache.get(url);
  const file = path.join(RAW, path.basename(new URL(url).pathname));
  const img = sharp(file);
  const meta = await img.metadata();
  const data = { file, meta, buffer: await fs.promises.readFile(file) };
  sheetCache.set(url, data);
  return data;
}

// Group cards by (deck, slot) to dedupe (cards appear multiple times across starter decks etc.)
const seen = new Set();
const manifest = [];
let sliced = 0;
for (const c of cards) {
  const key = `${c.deck}::${c.slot}`;
  if (seen.has(key)) continue;
  seen.add(key);

  if (!c.sheetUrl) continue;
  const sheet = await getSheet(c.sheetUrl);
  const tileW = Math.floor(sheet.meta.width / c.cols);
  const tileH = Math.floor(sheet.meta.height / c.rows);
  const row = Math.floor(c.slot / c.cols);
  const col = c.slot % c.cols;
  const outName = `${String(c.slot).padStart(2, '0')}-${slug(c.name)}.jpg`;
  const outDir = path.join(CARDS, c.deck);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, outName);

  await sharp(sheet.buffer)
    .extract({ left: col * tileW, top: row * tileH, width: tileW, height: tileH })
    .jpeg({ quality: 92 })
    .toFile(outPath);

  manifest.push({
    deck: c.deck,
    slot: c.slot,
    name: c.name,
    image: path.relative(ROOT, outPath).replace(/\\/g, '/'),
  });
  sliced++;
}
console.log(`  ${sliced} unique card images sliced`);

// --- 4. Sort raw extras into board/tokens/spies ---
function move(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
move(path.join(RAW, 'table.jpg'), path.join(BOARD, 'table.jpg'));
move(path.join(RAW, 'sky.jpg'), path.join(BOARD, 'sky.jpg'));
for (const t of tiles) {
  const ext = path.extname(new URL(t.url).pathname) || '.jpg';
  const src = path.join(RAW, `tile-${slug(t.nick || 'unnamed')}${ext}`);
  const nick = (t.nick || '').toLowerCase();
  let bucket = TOKENS;
  if (nick.includes('playmat') || nick.includes('inner-circle')) bucket = BOARD;
  if (!t.nick) bucket = BOARD; // the unnamed tile is the board itself
  move(src, path.join(bucket, `${slug(t.nick || 'game-board')}${ext}`));
}
for (const [url, nick] of models) {
  const src = path.join(RAW, `model-${slug(nick)}.png`);
  move(src, path.join(SPIES, `${slug(nick)}.png`));
}

fs.writeFileSync(
  path.join(ROOT, 'assets/cards.json'),
  JSON.stringify({ decks: decksByName, cards: manifest }, null, 2)
);

console.log(`\nDone. Manifest -> assets/cards.json`);
console.log(`Tree:`);
console.log(`  assets/raw/       (originals, ${fs.readdirSync(RAW).length} files)`);
console.log(`  assets/board/     (table, playmats, inner-circle boards)`);
console.log(`  assets/tokens/    (control markers, VP, first player)`);
console.log(`  assets/models/    (troop + spy textures)`);
console.log(`  assets/cards/<deck>/<slot>-<name>.jpg`);

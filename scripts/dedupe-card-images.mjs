// Perceptual-hash dedup: groups slots by visual similarity rather than byte equality.
// Uses 8x8 grayscale average-hash with Hamming-distance threshold.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

const ROOT = path.resolve('.');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/cards.json'), 'utf8'));
const RAW = path.join(ROOT, 'assets/raw');

const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'Documents/My Games/Tabletop Simulator/Mods/Workshop/881660322.json'), 'utf8'));
const deckSheets = {};
(function walk(arr) {
  for (const o of arr || []) {
    if (o.Name === 'Deck' || o.Name === 'DeckCustom') {
      const cd = o.CustomDeck || {};
      const first = cd[Object.keys(cd)[0]];
      let key;
      if (o.Nickname?.includes('half-deck')) key = o.Nickname.replace(' half-deck', '').toLowerCase();
      else if (o.Nickname === 'House Guards') key = 'house-guards';
      else if (o.Nickname?.startsWith('Priestess')) key = 'priestesses';
      else if (o.Nickname === 'Insane Outcasts') key = 'insane-outcasts';
      if (key && first?.FaceURL) deckSheets[key] = { url: first.FaceURL, cols: first.NumWidth, rows: first.NumHeight };
    }
    if (o.ContainedObjects) walk(o.ContainedObjects);
  }
})(j.ObjectStates);

const sheetCache = new Map();
async function pHashAtSlot(deck, slot) {
  const cfg = deckSheets[deck];
  const file = path.join(RAW, path.basename(new URL(cfg.url).pathname));
  if (!sheetCache.has(file)) {
    const buf = await fs.promises.readFile(file);
    const meta = await sharp(buf).metadata();
    sheetCache.set(file, { buf, meta });
  }
  const { buf, meta } = sheetCache.get(file);
  const tileW = Math.floor(meta.width / cfg.cols);
  const tileH = Math.floor(meta.height / cfg.rows);
  const row = Math.floor(slot / cfg.cols);
  const col = slot % cfg.cols;
  // Crop with a small margin to ignore border/gutter noise. Resize to 9x8 grayscale,
  // then diff-hash: each bit = pixel[i] > pixel[i+1] across a row (more robust than avg-hash).
  const inset = 0.08;
  const px = await sharp(buf)
    .extract({
      left: Math.round(col * tileW + tileW * inset),
      top: Math.round(row * tileH + tileH * inset),
      width: Math.round(tileW * (1 - 2 * inset)),
      height: Math.round(tileH * (1 - 2 * inset)),
    })
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();
  // 9 wide, 8 tall → 8*8=64 bit dhash
  const bits = new Uint8Array(8);
  for (let y = 0; y < 8; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) {
      const i = y * 9 + x;
      if (px[i] > px[i + 1]) byte |= (1 << x);
    }
    bits[y] = byte;
  }
  return bits;
}

function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = a[i] ^ b[i];
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

const THRESHOLD = 6; // tunable

const result = {};
for (const deck of Object.keys(deckSheets)) {
  const slots = manifest.cards.filter(c => c.deck === deck).map(c => c.slot).sort((a,b)=>a-b);
  const items = [];
  for (const slot of slots) items.push({ slot, hash: await pHashAtSlot(deck, slot) });

  // Greedy clustering: walk slots; each one joins the first existing group within threshold.
  const groups = [];
  for (const it of items) {
    let joined = false;
    for (const g of groups) {
      if (hamming(it.hash, g[0].hash) <= THRESHOLD) { g.push(it); joined = true; break; }
    }
    if (!joined) groups.push([it]);
  }

  result[deck] = groups.map(g => ({ slots: g.map(x => x.slot) }));
  const counts = groups.map(g => g.length).sort((a,b)=>b-a);
  const hist = counts.reduce((m, n) => { m[n] = (m[n]||0)+1; return m; }, {});
  console.log(`${deck}: ${slots.length} slots → ${groups.length} unique designs · histogram:`, hist);
}

fs.writeFileSync(path.join(ROOT, 'assets/dedup-groups.json'), JSON.stringify(result, null, 2));
console.log(`\nThreshold: ${THRESHOLD}/64 bits. Wrote assets/dedup-groups.json`);

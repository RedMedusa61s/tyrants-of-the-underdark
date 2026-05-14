// Read the Tabletop Simulator workshop save and emit every public asset URL
// (card sheets, board, table, sky, tiles, model textures) as a JSON config.
//
// Why: the deployed game needs to point a base image-cache at these URLs but
// the TTS save file itself is on the user's local disk only. Run this once
// after the mod is loaded in TTS; commit the resulting `assets/asset-urls.json`
// so anyone deploying the game has the same URL map without needing TTS.
//
// Usage:
//   node scripts/dump-asset-urls.mjs

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TTS_SAVE = path.join(os.homedir(), 'Documents/My Games/Tabletop Simulator/Mods/Workshop/881660322.json');
const OUT = path.resolve('assets/asset-urls.json');

if (!fs.existsSync(TTS_SAVE)) {
  console.error(`TTS save not found at ${TTS_SAVE}`);
  console.error('Subscribe to and open workshop mod 881660322 in TTS at least once to populate the cache.');
  process.exit(1);
}

const slug = s => (s || 'unnamed')
  .toLowerCase()
  .replace(/['']/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const save = JSON.parse(fs.readFileSync(TTS_SAVE, 'utf8'));

const decks = {};
const tiles = [];
const models = [];

function walk(arr, parentDeck) {
  for (const o of arr || []) {
    if (o.Name === 'Deck' || o.Name === 'DeckCustom') {
      const customDeck = o.CustomDeck || {};
      const sheet = customDeck[Object.keys(customDeck)[0]];
      const key = (() => {
        if (o.Nickname?.includes('half-deck')) return o.Nickname.replace(' half-deck', '').toLowerCase();
        if (o.Nickname === 'House Guards') return 'house-guards';
        if (o.Nickname === 'Priestessess of Lolth' || o.Nickname === 'Priestesses of Lolth') return 'priestesses';
        if (o.Nickname === 'Insane Outcasts') return 'insane-outcasts';
        return slug(o.Nickname || 'misc');
      })();
      if (sheet?.FaceURL) {
        decks[key] = {
          nickname: o.Nickname || '(unnamed)',
          sheetUrl: sheet.FaceURL,
          backUrl: sheet.BackURL,
          cols: sheet.NumWidth,
          rows: sheet.NumHeight,
        };
      }
      walk(o.ContainedObjects, key);
      continue;
    }
    if (o.Name === 'Custom_Tile' && o.CustomImage?.ImageURL) {
      tiles.push({ nickname: o.Nickname || '', url: o.CustomImage.ImageURL });
    }
    if (o.Name === 'Custom_Model' && o.CustomMesh?.DiffuseURL) {
      if (!models.some(m => m.url === o.CustomMesh.DiffuseURL)) {
        models.push({ nickname: o.Nickname || '', url: o.CustomMesh.DiffuseURL });
      }
    }
    if (o.ContainedObjects) walk(o.ContainedObjects, parentDeck);
  }
}
walk(save.ObjectStates, null);

const out = {
  ranAt: new Date().toISOString(),
  source: 'TTS Workshop mod 881660322',
  table: save.TableURL ?? null,
  sky: save.SkyURL ?? null,
  decks,
  tiles,
  models,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`Wrote ${OUT}`);
console.log(`  decks: ${Object.keys(decks).length}`);
console.log(`  tiles: ${tiles.length}`);
console.log(`  models: ${models.length}`);
console.log(`  table: ${out.table ? 'yes' : 'no'}, sky: ${out.sky ? 'yes' : 'no'}`);

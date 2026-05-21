// Asset URLs from the Tabletop Simulator workshop save (mod 881660322),
// dumped into assets/asset-urls.json by `node scripts/dump-asset-urls.mjs`.
// Card sheets are referenced as 10×5 grid images sliced client-side via canvas;
// the board / playmats / tiles are fetched whole.

import urls from '../assets/asset-urls.json';

export interface SheetInfo {
  url: string;
  cols: number;
  rows: number;
  /** Native pixel dimensions of the sheet. All four TTS workshop sheets are
   *  the same 7490×5230 — over Safari iOS's ~32MP per-image decode cap, so
   *  loading the sheet via a regular Image element clips the lower-right
   *  tiles. We bake the dimensions so the slicer can use createImageBitmap
   *  with a crop rect (region-only decode) instead, sidestepping the cap. */
  width: number;
  height: number;
}

/** Build the deck → sheet map straight from the JSON. The JSON file is the
 *  canonical source — re-run `npm run dump-asset-urls` if the TTS mod author
 *  ever rehosts the sheets. */
export const DECK_SHEETS: Record<string, SheetInfo> = (() => {
  const out: Record<string, SheetInfo> = {};
  // Base half-deck sheets (drow / dragons / elemental / demons) from TTS
  // mod 881660322 are uniformly 7490×5230. The Aberrations & Undead
  // expansion sheet (from mod 2745860709, shared between both decks) is
  // 5250×6000. Per-deck width/height in asset-urls.json take precedence
  // if present; the constants below are the legacy fallback for entries
  // that don't carry dimensions.
  const LEGACY_WIDTH = 7490;
  const LEGACY_HEIGHT = 5230;
  for (const [key, info] of Object.entries(urls.decks)) {
    const d = info as { sheetUrl: string; cols: number; rows: number; width?: number; height?: number };
    out[key] = {
      url: d.sheetUrl.replace(/^http:/, 'https:'),
      cols: d.cols,
      rows: d.rows,
      width: d.width ?? LEGACY_WIDTH,
      height: d.height ?? LEGACY_HEIGHT,
    };
  }
  // Treat starter-1..N as aliases of the drow sheet (their slots are interleaved
  // with the drow cards on that sheet). The `misc` deck name in cards.json
  // covers what game.ts calls `starter-1`.
  const drowSheet = out['drow'] ?? out['misc'];
  for (const alias of ['starter-1', 'starter-2', 'starter-3', 'starter-4']) {
    if (drowSheet) out[alias] = drowSheet;
  }
  return out;
})();

/** Per-tile URLs by nickname slug (e.g. "araumycos-control" → control marker).
 *  The unnamed tile is the printed board itself, exposed separately as BOARD_URL. */
export const TILE_URLS: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  const slug = (s: string) => s.toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  for (const t of urls.tiles as Array<{ nickname: string; url: string }>) {
    if (!t.nickname) continue;
    out[slug(t.nickname)] = t.url.replace(/^http:/, 'https:');
  }
  return out;
})();

/** The printed game board (cities + routes). It's the texture for the
 *  unnamed Custom_Model in the TTS save — NOT the unnamed Custom_Tile, which
 *  is the central playmat (Market / Devoured / Outcasts / Priestesses / House
 *  Guards stacks). The two unnamed items are easily confused if you only look
 *  at the tile list. */
export const BOARD_URL: string = (() => {
  const unnamedModel = (urls.models as Array<{ nickname: string; url: string }>).find(m => !m.nickname);
  return (unnamedModel?.url ?? '').replace(/^http:/, 'https:');
})();

/** The central playmat tile (Market / Devoured Cards / VP Tokens / Insane
 *  Outcasts / Priestesses of Lolth / House Guards columns). Not currently
 *  rendered, but kept here so we have a name for it if/when we wire a
 *  "supply area" view. */
export const PLAYMAT_URL: string = (() => {
  const unnamedTile = (urls.tiles as Array<{ nickname: string; url: string }>).find(t => !t.nickname);
  return (unnamedTile?.url ?? '').replace(/^http:/, 'https:');
})();

/** The TTS "table" image — landscape composition with the printed game board
 *  on the left and purple felt margins. `image-cache.ts` derives the portrait
 *  cities-and-routes map from this by auto-cropping out the purple and
 *  rotating -90°. */
export const TABLE_URL: string = (urls.table ?? '').replace(/^http:/, 'https:');

/** Generic local-path → external-URL map for non-card assets. Wire here when
 *  we point a UI element at `/board/map.jpg` etc. so the image cache can
 *  fetch + cache it the same way it does card slices.
 *
 *  Note: the printed cities-and-routes game map is NOT in the TTS workshop
 *  save (the unnamed tile is the playmat; the unnamed model is the 3D
 *  pawn-area texture). Until we settle on a host for the map, the entry is
 *  intentionally omitted — useCachedImage('assets/board/map.jpg') will fall
 *  through to the local Vite publicDir path. */
export const ASSET_URLS: Record<string, string> = {};

/** Parse `assets/cards/<deck>/<slot>-<slug>.jpg` into { deck, slot }. */
export function parseCardPath(relativePath: string): { deck: string; slot: number } | null {
  const m = /^assets\/cards\/([^/]+)\/(\d+)-/.exec(relativePath);
  if (!m) return null;
  return { deck: m[1], slot: parseInt(m[2], 10) };
}

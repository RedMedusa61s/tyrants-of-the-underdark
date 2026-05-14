// Asset URLs from the Tabletop Simulator workshop save (mod 881660322),
// dumped into assets/asset-urls.json by `node scripts/dump-asset-urls.mjs`.
// Card sheets are referenced as 10×5 grid images sliced client-side via canvas;
// the board / playmats / tiles are fetched whole.

import urls from '../assets/asset-urls.json';

export interface SheetInfo {
  url: string;
  cols: number;
  rows: number;
}

/** Build the deck → sheet map straight from the JSON. The JSON file is the
 *  canonical source — re-run `npm run dump-asset-urls` if the TTS mod author
 *  ever rehosts the sheets. */
export const DECK_SHEETS: Record<string, SheetInfo> = (() => {
  const out: Record<string, SheetInfo> = {};
  for (const [key, info] of Object.entries(urls.decks)) {
    const d = info as { sheetUrl: string; cols: number; rows: number };
    out[key] = {
      url: d.sheetUrl.replace(/^http:/, 'https:'),
      cols: d.cols,
      rows: d.rows,
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

/** The printed game board, normalized to https. Used by MapView et al. */
export const BOARD_URL: string = (() => {
  const unnamed = (urls.tiles as Array<{ nickname: string; url: string }>).find(t => !t.nickname);
  return (unnamed?.url ?? '').replace(/^http:/, 'https:');
})();

/** Generic local-path → external-URL map for non-card assets. Wire here when
 *  we point a UI element at `/board/map.jpg` etc. so the image cache can
 *  fetch + cache it the same way it does card slices. */
export const ASSET_URLS: Record<string, string> = {
  'assets/board/map.jpg': BOARD_URL,
};

/** Parse `assets/cards/<deck>/<slot>-<slug>.jpg` into { deck, slot }. */
export function parseCardPath(relativePath: string): { deck: string; slot: number } | null {
  const m = /^assets\/cards\/([^/]+)\/(\d+)-/.exec(relativePath);
  if (!m) return null;
  return { deck: m[1], slot: parseInt(m[2], 10) };
}

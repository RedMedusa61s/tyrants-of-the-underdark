// Imgur sheet URLs for the four half-decks. The TTS workshop mod (881660322)
// uploads each half-deck as a single 10×5 grid image; we fetch those once and
// slice individual cards on demand via canvas, then cache the per-card blobs
// in IndexedDB.
//
// Per-card paths follow the convention `assets/cards/<deck>/<slot>-<slug>.jpg`
// — slot is the position on the sheet (row * cols + col, 0-indexed).

export interface SheetInfo {
  url: string;
  cols: number;
  rows: number;
}

export const DECK_SHEETS: Record<string, SheetInfo> = {
  drow:      { url: 'https://i.imgur.com/p7TkLjk.jpg', cols: 10, rows: 5 },
  dragons:   { url: 'https://i.imgur.com/l4SqNiD.jpg', cols: 10, rows: 5 },
  elemental: { url: 'https://i.imgur.com/iBmGf64.jpg', cols: 10, rows: 5 },
  demons:    { url: 'https://i.imgur.com/UrS3eUS.jpg', cols: 10, rows: 5 },
  // House Guards + Priestesses share the Drow sheet on the TTS mod.
  'house-guards': { url: 'https://i.imgur.com/p7TkLjk.jpg', cols: 10, rows: 5 },
  priestesses:    { url: 'https://i.imgur.com/p7TkLjk.jpg', cols: 10, rows: 5 },
  // Starter cards (Noble, Soldier, Insane Outcast) live on the dragons sheet
  // per the TTS save; tweak here if the slug ever drifts.
  'starter-1': { url: 'https://i.imgur.com/l4SqNiD.jpg', cols: 10, rows: 5 },
};

/** Parse `assets/cards/<deck>/<slot>-<slug>.jpg` into { deck, slot }. */
export function parseCardPath(relativePath: string): { deck: string; slot: number } | null {
  const m = /^assets\/cards\/([^/]+)\/(\d+)-/.exec(relativePath);
  if (!m) return null;
  return { deck: m[1], slot: parseInt(m[2], 10) };
}

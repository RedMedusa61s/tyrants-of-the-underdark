// Card / board image cache backed by IndexedDB.
//
// Goal: on first run the app fetches every image once from a configured remote
// source (e.g. an Imgur mirror or your own CDN) and stores the blob bytes in
// IndexedDB. On every subsequent load the images are served from the local
// store — zero network traffic, instant render.
//
// The remote source is configured via VITE_TOTU_IMAGE_BASE_URL (a base URL
// that mirrors the `assets/` directory layout). If unset, we fall back to
// relative paths (`/cards/<file>`), which is what the dev server provides
// when you've run `npm run extract-assets` locally.
//
// All Card usages should call `useCachedImage(relativePath)` instead of
// embedding the path directly; the hook handles cache hit, miss, in-flight
// fetch, and error-fallback.

import { useEffect, useState } from 'react';
import { DECK_SHEETS, ASSET_URLS, parseCardPath, type SheetInfo } from './sheet-config';

const DB_NAME = 'totu.image-cache';
const STORE = 'blobs';
const DB_VERSION = 1;

/** Open (or create) the IndexedDB. Cached promise so we open once. */
let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function dbGet(key: string): Promise<Blob | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(key: string, blob: Blob): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbKeys(): Promise<string[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
  });
}

export async function clearImageCache(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Map a relative `assets/*` path to its remote source URL. Lookup order:
 *  (1) explicit ASSET_URLS entry (e.g. the board image → Imgur),
 *  (2) optional VITE_TOTU_IMAGE_BASE_URL prefix,
 *  (3) local dev path under the Vite publicDir.
 */
function remoteUrlFor(relativePath: string): string {
  const mapped = ASSET_URLS[relativePath];
  if (mapped) return mapped;
  const base = (import.meta.env.VITE_TOTU_IMAGE_BASE_URL as string | undefined)?.replace(/\/$/, '');
  const trimmed = relativePath.replace(/^assets\//, '');
  if (base) return `${base}/${trimmed}`;
  return `/${trimmed}`;
}

/** Fetch a raw URL into a blob (for sheets / non-card images). */
async function fetchBlob(url: string): Promise<Blob> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch ${url} → HTTP ${resp.status}`);
  return await resp.blob();
}

/** Cache of in-memory Image objects per sheet URL — slicing reuses one decoded
 *  bitmap for the 40 cards on that sheet rather than re-decoding each time.
 *  Caches the in-flight Promise so concurrent slice requests don't all race
 *  to fetch the same sheet. */
const sheetImagePromises = new Map<string, Promise<HTMLImageElement>>();

function loadSheetImage(sheetUrl: string): Promise<HTMLImageElement> {
  const cached = sheetImagePromises.get(sheetUrl);
  if (cached) return cached;
  const p = (async () => {
    // Pull the sheet blob (from IndexedDB if previously cached; else fetch).
    let blob = await dbGet(sheetUrl);
    if (!blob) {
      blob = await fetchBlob(sheetUrl);
      await dbPut(sheetUrl, blob);
    }
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`decode failed: ${sheetUrl}`));
      img.src = objectUrl;
    });
    return img;
  })();
  sheetImagePromises.set(sheetUrl, p);
  return p;
}

/** Derive the cities-and-routes board map from the workshop mod's 8449×4992
 *  table image. The crop offsets and dimensions below were computed offline
 *  by sharp using a purple-background bbox detection at 0.005 inset; baking
 *  them as constants makes the in-browser canvas pipeline produce the same
 *  cropped region sharp did, byte-for-byte alignment-wise (the JPEG bytes
 *  may differ due to encoder choices, but the pixel grid matches).
 *
 *  Calibrated site / slot positions in the app are stored as fractions of
 *  the post-crop, post-rotate image — so any drift in either operation
 *  would shift all the tokens off the printed slots. The constants here
 *  ensure no drift. */
const BOARD_CROP = { left: 2999, top: 152, width: 4605, height: 4646 } as const;

async function deriveBoardMap(): Promise<Blob> {
  const { TABLE_URL } = await import('./sheet-config');
  const tableBlob = await fetchBlob(TABLE_URL);
  const bmp = await createImageBitmap(tableBlob);
  if (bmp.width !== 8449 || bmp.height !== 4992) {
    // The mod author re-uploaded the table at a different size. Surface this
    // loudly — slot positions would drift and the smart fix is to recompute
    // the crop offsets, not silently rescale.
    // eslint-disable-next-line no-console
    console.warn(`[deriveBoardMap] table image dims ${bmp.width}×${bmp.height} != expected 8449×4992; crop offsets may be wrong`);
  }
  // Rotate -90° (CCW): the cropped region (4605×4646) becomes (4646×4605).
  const rotCanvas = document.createElement('canvas');
  rotCanvas.width = BOARD_CROP.height;   // 4646
  rotCanvas.height = BOARD_CROP.width;   // 4605
  const cx = rotCanvas.getContext('2d');
  if (!cx) throw new Error('no 2d context');
  // For rotate(-90°) (CCW): translate by (0, cropW), then rotate, then draw.
  cx.translate(0, BOARD_CROP.width);
  cx.rotate(-Math.PI / 2);
  cx.drawImage(bmp,
    BOARD_CROP.left, BOARD_CROP.top, BOARD_CROP.width, BOARD_CROP.height,
    0, 0, BOARD_CROP.width, BOARD_CROP.height);
  bmp.close();
  return await new Promise<Blob>((resolve, reject) => {
    rotCanvas.toBlob(
      b => b ? resolve(b) : reject(new Error('canvas.toBlob returned null')),
      'image/jpeg',
      0.92
    );
  });
}

/** Slice a single tile out of the sheet at `slot`, return a JPEG blob. */
async function sliceTile(sheet: SheetInfo, slot: number): Promise<Blob> {
  const img = await loadSheetImage(sheet.url);
  const tileW = Math.floor(img.naturalWidth / sheet.cols);
  const tileH = Math.floor(img.naturalHeight / sheet.rows);
  const row = Math.floor(slot / sheet.cols);
  const col = slot % sheet.cols;
  const canvas = document.createElement('canvas');
  canvas.width = tileW;
  canvas.height = tileH;
  const cx = canvas.getContext('2d');
  if (!cx) throw new Error('no 2d context');
  cx.drawImage(img, col * tileW, row * tileH, tileW, tileH, 0, 0, tileW, tileH);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      b => b ? resolve(b) : reject(new Error('canvas.toBlob returned null')),
      'image/jpeg',
      0.9
    );
  });
}

/** Fetch (or slice/derive) a single image into the cache. Resolves with the blob. */
async function fetchAndStore(relativePath: string): Promise<Blob> {
  // Card paths get sliced out of the deck's sheet.
  const parsed = parseCardPath(relativePath);
  if (parsed && DECK_SHEETS[parsed.deck]) {
    const sheet = DECK_SHEETS[parsed.deck];
    const blob = await sliceTile(sheet, parsed.slot);
    await dbPut(relativePath, blob);
    return blob;
  }
  // The board map is derived from the workshop mod's table image: auto-crop
  // out the purple background, then rotate -90° (the table is stored
  // landscape; the map is portrait). The exact pipeline produces a byte-
  // identical result to what we computed offline earlier, so all calibrated
  // slot/site positions stay accurate.
  if (relativePath === 'assets/board/map.jpg') {
    const blob = await deriveBoardMap();
    await dbPut(relativePath, blob);
    return blob;
  }
  // Non-card path → fall back to the per-path remote URL.
  const url = remoteUrlFor(relativePath);
  const blob = await fetchBlob(url);
  await dbPut(relativePath, blob);
  return blob;
}

/** Public: get a blob-URL for the image. Reads from cache; on miss, fetches
 *  and caches. The blob URL is reusable across the same page lifetime — the
 *  caller is responsible for revoking it when no longer needed (or just let
 *  the page unload clean it up). */
const blobUrlCache = new Map<string, string>();

export async function getImageBlobUrl(relativePath: string): Promise<string> {
  if (blobUrlCache.has(relativePath)) return blobUrlCache.get(relativePath)!;
  let blob = await dbGet(relativePath);
  if (!blob) blob = await fetchAndStore(relativePath);
  const url = URL.createObjectURL(blob);
  blobUrlCache.set(relativePath, url);
  return url;
}

export interface BulkImportProgress {
  total: number;
  done: number;
  failed: number;
  current: string | null;
  finished: boolean;
}

/** Import every image in `paths` into the cache. Skips already-cached entries.
 *  Calls `onProgress` after each fetch. Resolves when all have been processed
 *  (success or failure). */
export async function bulkImport(
  paths: string[],
  onProgress: (p: BulkImportProgress) => void,
  concurrency = 6,
): Promise<BulkImportProgress> {
  const existing = new Set(await dbKeys());
  const pending = paths.filter(p => !existing.has(p));
  const state: BulkImportProgress = {
    total: pending.length,
    done: 0, failed: 0, current: null, finished: false,
  };
  onProgress({ ...state });
  if (pending.length === 0) {
    state.finished = true;
    onProgress({ ...state });
    return state;
  }

  // Worker-pool concurrency.
  let nextIdx = 0;
  const workers = Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
    while (true) {
      const i = nextIdx++;
      if (i >= pending.length) return;
      const p = pending[i];
      state.current = p;
      try { await fetchAndStore(p); state.done++; }
      catch { state.failed++; }
      onProgress({ ...state });
    }
  });
  await Promise.all(workers);
  state.current = null;
  state.finished = true;
  onProgress({ ...state });
  return state;
}

/** React hook: resolves a relative-path image to a usable URL. Returns the
 *  remote URL string for an immediate render (so the browser shows something
 *  while we're loading the cached blob), then swaps to a blob URL once
 *  available. On any error, returns the remote URL — the consumer can render
 *  it normally and let onError fall through to a placeholder. */
export function useCachedImage(relativePath: string): string {
  const [url, setUrl] = useState<string>(() => remoteUrlFor(relativePath));
  useEffect(() => {
    let cancelled = false;
    getImageBlobUrl(relativePath)
      .then(blobUrl => { if (!cancelled) setUrl(blobUrl); })
      .catch(() => { /* keep the initial remote-URL fallback */ });
    return () => { cancelled = true; };
  }, [relativePath]);
  return url;
}

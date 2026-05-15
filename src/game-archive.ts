// Local archive of completed game records, persisted via IndexedDB. Every
// finished game is appended here on gameover so the player can re-upload to
// the public log relay later — useful if the auto-publish failed (network
// hiccup, relay down, ran offline), or just to bulk-submit a backlog.
//
// The relay dedups by SHA256 of the inner `game` payload, so re-uploading the
// same record is safe and reads as a no-op server-side. That lets us be
// indiscriminate here and queue every record without tracking "uploaded?"
// state locally.

import type { TyrantsState } from './game';
import { buildGameRecord, type PublishContext } from './publish-game-log';

const DB_NAME = 'totu-games';
const STORE = 'archive';
const DB_VERSION = 1;

export interface ArchivedGame {
  /** Local autoincrement key. */
  id?: number;
  /** ISO timestamp when the game was archived (typically game-over). */
  archivedAt: string;
  /** PublishContext sans `source` so we can re-publish later with a
   *  context-appropriate source tag (e.g. 'browser-bulk-upload'). */
  context: Omit<PublishContext, 'source'>;
  /** The full game record built by buildGameRecord — same shape the relay
   *  expects under its `game` field. Stored as a plain object (IndexedDB
   *  serialises structurally), not stringified. */
  record: unknown;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Append one game to the archive. Safe to call multiple times for the same
 *  game (game-over, "new game" click, page unload, etc.) — each call writes a
 *  distinct entry stamped with its own timestamp, and uploads embed that
 *  timestamp into the published record so the relay's content-hash dedup
 *  doesn't collapse separate sessions into one another. */
export async function archiveGame(
  G: TyrantsState,
  context: Omit<PublishContext, 'source'>,
): Promise<void> {
  const archivedAt = new Date().toISOString();
  const record = buildGameRecord(G, { ...context, source: 'browser-archive' });
  const entry: ArchivedGame = { archivedAt, context, record };
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(entry);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** Build the payload that gets POSTed to the relay for one archive entry.
 *  Splices the entry's archivedAt into the inner game record so two archive
 *  entries from different sessions don't dedup against each other on content
 *  hash, even when the underlying game state was identical (e.g., the user
 *  hit "New game" twice in a row without playing). */
export function payloadForArchivedGame(entry: ArchivedGame): { game: unknown; source: string; meta: unknown } {
  return {
    game: { ...(entry.record as Record<string, unknown>), archivedAt: entry.archivedAt },
    source: 'browser-bulk-upload',
    meta: {
      numPlayers: entry.context.numPlayers,
      halfDecks: entry.context.halfDecks,
      aiStyles: entry.context.aiStyles,
      archivedAt: entry.archivedAt,
    },
  };
}

/** Return every archived game, oldest first. */
export async function getAllArchivedGames(): Promise<ArchivedGame[]> {
  const db = await openDb();
  return new Promise<ArchivedGame[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => { db.close(); resolve((req.result as ArchivedGame[]) ?? []); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/** Erase the archive. */
export async function clearArchive(): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

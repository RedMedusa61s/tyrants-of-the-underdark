// Per-browser memory of online games this device created or joined. The URL
// token is the only handle; we just remember it locally so the lobby can list
// "games in progress". Lose the browser/storage and the list is gone (the games
// still exist server-side; you'd need the invite link). Mirrors the
// tic-tac-toe example's myGames, with PlayerId seats ('0'..'3').

import type { PlayerId } from '../adapter/tyrantsAdapter';

export interface MyGame {
  gameId: string;
  createdAt: string;
  numPlayers: number;
  seats: Partial<Record<PlayerId, string>>; // seat → token (a creator knows all)
}

const KEY = 'totu:mygames';

function read(): MyGame[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function write(games: MyGame[]): void {
  localStorage.setItem(KEY, JSON.stringify(games));
}

function upsert(game: MyGame): void {
  write([...read().filter((g) => g.gameId !== game.gameId), game]);
}

export function listMyGames(): MyGame[] {
  return read().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Called by the creator after createGame — their device knows every seat token.
export function rememberCreatedGame(gameId: string, invites: Record<PlayerId, string>): void {
  const seats: Partial<Record<PlayerId, string>> = {};
  (Object.keys(invites) as PlayerId[]).forEach((s) => {
    seats[s] = new URL(invites[s]).searchParams.get('as') ?? undefined;
  });
  upsert({ gameId, createdAt: new Date().toISOString(), numPlayers: Object.keys(invites).length, seats });
}

// Called when a player opens a /play link — they know only their own seat token.
export function rememberOpenedGame(gameId: string, seat: PlayerId, token: string): void {
  const existing = read().find((g) => g.gameId === gameId);
  upsert({
    gameId,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    numPlayers: existing?.numPlayers ?? 0,
    seats: { ...(existing?.seats ?? {}), [seat]: token },
  });
}

export function forgetGame(gameId: string): void {
  write(read().filter((g) => g.gameId !== gameId));
}

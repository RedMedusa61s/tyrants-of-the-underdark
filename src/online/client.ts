// Browser-side API client for online multiplayer. Imports ONLY from the
// framework's /client and the adapter types — never /server. The browser
// bundle must not pull in the server barrel (node:fs).

import type { GameClientApi, MessagingClientApi } from 'digital-boardgame-framework/client';
import type { BgioState, TyrantsAction, PlayerId } from '../adapter/tyrantsAdapter';

export interface Invites {
  gameId: string;
  invites: Record<PlayerId, string>;
}

// Create a new game with a player count (2-4). Returns one invite URL per seat.
export async function createGame(numPlayers: number): Promise<Invites> {
  const r = await fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numPlayers }),
  });
  if (!r.ok) {
    const data: any = await r.json().catch(() => ({}));
    throw new Error(data?.error || `createGame failed: ${r.status}`);
  }
  return r.json();
}

// Lightweight status read for the lobby's "games in progress" list. Returns
// { deleted: true } if the game no longer exists.
export async function fetchStatus(
  gameId: string,
  token: string,
): Promise<
  | { deleted: true }
  | { deleted?: false; yourTurn: boolean; gameOver: boolean; turn: number; you: PlayerId }
> {
  const r = await fetch(`/api/games/${gameId}?as=${encodeURIComponent(token)}`);
  if (r.status === 404) return { deleted: true };
  const data: any = await r.json();
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
  return data;
}

// End a game server-side (token-gated). 404 is treated as success (already gone).
export async function deleteGame(gameId: string, token: string): Promise<void> {
  const r = await fetch(`/api/games/${gameId}?as=${encodeURIComponent(token)}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 404) throw new Error(`delete failed: ${r.status}`);
}

// Attach the player's hub identity to their seat (ranked attribution).
// Best-effort: a failure just leaves the seat unattributed (casual play).
export async function claimSeat(gameId: string, token: string, identityToken: string): Promise<void> {
  try {
    await fetch(`/api/games/${gameId}/claim?as=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityToken }),
    });
  } catch { /* ignore — ranked attribution is optional */ }
}

// Per-(game, token) client the useGame hook consumes.
export function makeClient(gameId: string, token: string): GameClientApi<BgioState, TyrantsAction> {
  const base = `/api/games/${gameId}`;
  const q = `?as=${encodeURIComponent(token)}`;
  const json = async (r: Response): Promise<any> => {
    const data: any = await r.json();
    if (!r.ok) throw new Error((data && data.error) || `HTTP ${r.status}`);
    return data;
  };
  return {
    fetch: () => fetch(`${base}${q}`).then(json),
    submit: (action) =>
      fetch(`${base}/submit${q}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      }).then(json),
    legalActions: () => fetch(`${base}/legal${q}`).then(json),
    report: (body) =>
      fetch(`${base}/report${q}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(json),
  };
}

// In-game chat transport for the framework's ChatPanel/useMessages. Both calls
// hit /api/games/:id/chat (auth-gated by the token; the server stamps the seat)
// and return the refreshed ChatMessage[].
export function makeMessagingClient(gameId: string, token: string): MessagingClientApi {
  const base = `/api/games/${gameId}/chat`;
  const q = `?as=${encodeURIComponent(token)}`;
  const json = async (r: Response): Promise<any> => {
    const data: any = await r.json();
    if (!r.ok) throw new Error((data && data.error) || `HTTP ${r.status}`);
    return data;
  };
  return {
    listMessages: () => fetch(`${base}${q}`).then(json),
    postMessage: (body) =>
      fetch(`${base}${q}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      }).then(json),
  };
}

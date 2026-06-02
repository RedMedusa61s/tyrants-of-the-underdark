// Platform-agnostic API router for Tyrants online multiplayer. Both the Vite
// dev middleware (FsStore) and the Cloudflare Pages Function (SupabaseStore)
// build a GameServer and call this. Keeping routing in one place is what makes
// local dev and production true parity — only the store/notifier differs.
//
// KEY DIFFERENCE from the tic-tac-toe example: createGame accepts a player
// count (2-4) and builds the full boardgame.io initial state for it via the
// adapter's initialBgioState (boardgame.io's InitializeGame under the hood).
// The seats are the bgio seat-index strings '0'..'3'.

import type { GameServer } from 'digital-boardgame-framework/server';
import type { BgioState, TyrantsAction, PlayerId } from '../src/adapter/tyrantsAdapter';
import { initialBgioState } from '../src/adapter/tyrantsAdapter';

export interface ApiResult {
  status: number;
  body: unknown;
}

type Server = GameServer<BgioState, TyrantsAction, PlayerId>;

// Map known framework error strings to HTTP status codes.
function errToStatus(message: string): number {
  if (message.includes('not found')) return 404;
  if (message.includes('Invalid token')) return 401;
  if (message.includes('Not your turn')) return 403;
  if (message.includes('Illegal action')) return 422;
  if (message.includes('No snapshot')) return 404;
  if (message.includes('already exists')) return 409; // ConflictError (concurrent write)
  return 500;
}

// Per the rulebook: 2P = center only, 3P = center + one outer, 4P = all three.
function activeSectionsFor(numPlayers: number): Array<'left' | 'center' | 'right'> {
  if (numPlayers <= 2) return ['center'];
  if (numPlayers === 3) return ['center', 'left'];
  return ['left', 'center', 'right'];
}

export async function handleApi(
  server: Server,
  method: string,
  pathname: string,
  query: URLSearchParams,
  body: unknown,
): Promise<ApiResult> {
  const segs = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (segs[0] !== 'api') return { status: 404, body: { error: 'not found' } };

  const token = query.get('as') ?? '';

  try {
    // ---- games ----
    if (segs[1] === 'games') {
      // POST /api/games  → create. Body: { numPlayers: 2..4 }
      if (segs.length === 2 && method === 'POST') {
        const raw = (body as { numPlayers?: unknown })?.numPlayers;
        const numPlayers = Math.trunc(Number(raw ?? 2));
        if (!Number.isFinite(numPlayers) || numPlayers < 2 || numPlayers > 4) {
          return { status: 422, body: { error: 'numPlayers must be 2, 3, or 4' } };
        }
        const players: PlayerId[] = Array.from({ length: numPlayers }, (_, i) => String(i));
        const r = await server.createGame({
          initialState: initialBgioState(numPlayers, {
            activeSections: activeSectionsFor(numPlayers),
          }),
          players,
        });
        return { status: 200, body: r };
      }

      const gameId = segs[2];
      if (!gameId) return { status: 404, body: { error: 'not found' } };

      // GET /api/games/:id  → fetch
      if (segs.length === 3 && method === 'GET') {
        return { status: 200, body: await server.fetch(gameId, token) };
      }
      // DELETE /api/games/:id  → end/clean up the game (token-gated)
      if (segs.length === 3 && method === 'DELETE') {
        await server.deleteGame(gameId, token);
        return { status: 200, body: { ok: true } };
      }
      // GET /api/games/:id/legal
      if (segs[3] === 'legal' && method === 'GET') {
        return { status: 200, body: await server.legalActions(gameId, token) };
      }
      // POST /api/games/:id/submit
      if (segs[3] === 'submit' && method === 'POST') {
        const action = (body as { action: TyrantsAction }).action;
        return { status: 200, body: await server.submit(gameId, token, action) };
      }
      // POST /api/games/:id/report
      if (segs[3] === 'report' && method === 'POST') {
        return { status: 200, body: await server.report(gameId, token, body as { message: string }) };
      }
    }

    // ---- reports (public triage) ----
    if (segs[1] === 'reports') {
      // GET /api/reports
      if (segs.length === 2 && method === 'GET') {
        const unresolved = query.get('unresolved') === '1';
        return { status: 200, body: await server.listReports(unresolved ? { unresolved: true } : undefined) };
      }
      // POST /api/reports/:id/resolve
      if (segs[3] === 'resolve' && method === 'POST') {
        const note = (body as { note?: string }).note ?? '';
        await server.resolveReport(segs[2]!, note);
        return { status: 200, body: { ok: true } };
      }
    }

    return { status: 404, body: { error: 'no route', pathname, method } };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { status: errToStatus(message), body: { error: message } };
  }
}

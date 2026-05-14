// Game-log publishing helper.
//
// Builds a self-contained record of a completed game and POSTs it to the
// Cloudflare relay's /game-log route (when VITE_TOTU_RELAY_URL is set) or to
// the local Vite middleware (/__publish-game-log) for dev. The relay
// deduplicates by SHA256 over the `game` payload, so re-publishing the same
// completed game (e.g., the player reloads after game-over) is a no-op on the
// server side.

import type { TyrantsState } from './game';
import { scoreAll } from './engine/scoring';

export interface PublishContext {
  numPlayers: number;
  halfDecks: string[];
  aiStyles: string[];
  source: string; // e.g. "browser-game", "sim:heuristic-vs-random"
}

export interface PublishResult {
  ok: boolean;
  deduped?: boolean;
  hash?: string;
  path?: string;
  htmlUrl?: string;
  downloadUrl?: string;
  filePath?: string;
  error?: string;
}

/** Build the canonical record of a finished game. Same shape used by the
 *  browser-side publisher and the headless sim's --publish flag. */
export function buildGameRecord(G: TyrantsState, ctx: PublishContext): unknown {
  const scores = scoreAll(G);
  return {
    schemaVersion: 1,
    source: ctx.source,
    numPlayers: ctx.numPlayers,
    halfDecks: ctx.halfDecks,
    aiStyles: ctx.aiStyles,
    firstPlayerId: G.firstPlayerId,
    endGameTriggeredAtTurn: G.endGameTriggeredAtTurn,
    scores,
    players: Object.fromEntries(Object.entries(G.players).map(([pid, p]) => [pid, {
      color: p.color, vp: p.vp,
      barracksLeft: p.barracksLeft,
      trophyHall: p.trophyHall,
      deckSize: p.deck.length,
      discardSize: p.discard.length,
      handSize: p.hand.length,
      innerCircleSize: p.innerCircle.length,
    }])),
    finalSiteControl: G.siteControl,
    finalControlMarkers: Object.fromEntries(
      Object.entries(G.controlMarkers).filter(([, m]) => m.holder != null)
    ),
    finalTroops: Object.fromEntries(
      Object.entries(G.troops).filter(([, v]) => v != null)
    ),
    finalSpies: Object.fromEntries(
      Object.entries(G.spies).filter(([, arr]) => arr.length > 0)
    ),
    turnLogs: G.turnLogs,
    snapshots: G.snapshots, // per-turn base64 codecs for replay
    log: G.log,
  };
}

export async function publishGameLog(
  G: TyrantsState,
  ctx: PublishContext
): Promise<PublishResult> {
  const record = buildGameRecord(G, ctx);
  const meta = {
    numPlayers: ctx.numPlayers,
    halfDecks: ctx.halfDecks,
    aiStyles: ctx.aiStyles,
    winner: (() => {
      // Compute the winner's seat for the commit message convenience field.
      const scores = scoreAll(G);
      let best = '0';
      for (const [pid, s] of Object.entries(scores)) {
        if (s.total > scores[best].total) best = pid;
      }
      return best;
    })(),
    endedAtTurn: G.endGameTriggeredAtTurn,
  };

  const relayUrl = import.meta.env.VITE_TOTU_RELAY_URL as string | undefined;
  const submitUrl = relayUrl
    ? `${relayUrl.replace(/\/$/, '')}/game-log`
    : '/__publish-game-log';

  try {
    const resp = await fetch(submitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: record, source: ctx.source, meta }),
    });
    return (await resp.json().catch(() => ({ ok: false, error: 'non-json response' }))) as PublishResult;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

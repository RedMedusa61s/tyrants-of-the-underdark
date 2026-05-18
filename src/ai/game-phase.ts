// Game-phase awareness for the heuristic AI.
//
// User-supplied strategic notes:
//   - The game usually ends when one player's barracks hits 0. So the
//     SMALLEST barracks count across all players is the best single
//     proxy for "how close is the end?" (40 = fresh, 0 = game over now).
//   - The relationship to wall-clock time isn't linear: cards get
//     stronger as the game goes on, so the last 8 barracks vanish much
//     faster than the first 8. We bucket into phases rather than try
//     to estimate exact turns remaining.
//   - "Ahead vs behind" matters strategically: an ahead player wants
//     to ACCELERATE the end (deploy aggressively → drain own barracks
//     → game ends while still ahead). A behind player wants to FARM
//     for more score (assassinate for trophy VP, recruit & promote
//     high-VP cards, avoid deploying which only hastens defeat).

import type { TyrantsState } from '../game';
import { scoreAll } from '../engine/scoring';

export type GamePhase = 'early' | 'mid' | 'late' | 'endgame';

/** Smallest barracks count across all players. The game ends when any
 *  player's barracks hits 0, so this is the right proxy for "how close
 *  is the end?" — not the AI's own barracks, which might be 30 while a
 *  rival is at 4 and about to trigger game-end. */
export function minBarracksAcross(G: TyrantsState): number {
  let m = Infinity;
  for (const p of Object.values(G.players)) {
    if (p.barracksLeft < m) m = p.barracksLeft;
  }
  return Number.isFinite(m) ? m : 40;
}

export function gamePhase(
  G: TyrantsState,
  lateThreshold: number,
  endgameThreshold: number,
): GamePhase {
  const min = minBarracksAcross(G);
  // Players start with 40 barracks (game.ts). Boundaries are inclusive
  // on the LOW side so a value exactly at the threshold counts as the
  // more-advanced phase ("at 5 barracks left we're in the endgame").
  if (min <= endgameThreshold) return 'endgame';
  if (min <= lateThreshold) return 'late';
  // Early/mid split: half of "not late" barracks. Cheap and good enough;
  // we don't expose this threshold as a weight to avoid knob proliferation
  // — the late/endgame thresholds are the strategically important ones.
  if (min <= (40 + lateThreshold) / 2) return 'mid';
  return 'early';
}

/** Score lead for `pid` vs the best opponent. Positive = ahead, negative
 *  = behind. Uses the full `scoreAll` so trophies / control markers /
 *  inner-circle / final-scoring riders are all reflected — not just raw
 *  VP. Cost: O(players × owned-cards); a few ms per call on a normal-
 *  size game state, fine for per-move use in the heuristic. */
export function scoreLead(G: TyrantsState, pid: string): number {
  const all = scoreAll(G);
  const my = all[pid]?.total ?? 0;
  let bestOpp = -Infinity;
  for (const [id, s] of Object.entries(all)) {
    if (id === pid) continue;
    if (s.total > bestOpp) bestOpp = s.total;
  }
  if (!Number.isFinite(bestOpp)) return 0;
  return my - bestOpp;
}

export interface PhaseSnapshot {
  phase: GamePhase;
  minBarracks: number;
  lead: number;
}

/** One-stop snapshot for a move decision. Computed once per
 *  decideHeuristicMove call to avoid re-running scoreAll. */
export function takePhaseSnapshot(
  G: TyrantsState,
  pid: string,
  lateThreshold: number,
  endgameThreshold: number,
): PhaseSnapshot {
  return {
    phase: gamePhase(G, lateThreshold, endgameThreshold),
    minBarracks: minBarracksAcross(G),
    lead: scoreLead(G, pid),
  };
}

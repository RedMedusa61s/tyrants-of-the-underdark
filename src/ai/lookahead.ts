// 1-ply lookahead utilities for the heuristic AI.
//
// The engine is deterministic given the current state + move (RNG is only
// used for reshuffles and rare reveals; for in-turn decisions the next
// state is fully determined). That means we can ask "if I made this move,
// what would the resulting state look like?" by running the move through
// the boardgame.io reducer and inspecting the new G.
//
// 1-ply lookahead (no opponent reply) is the simplest useful version:
//   for each candidate move:
//     next = simulate(G, pid, move)
//     value = stateValue(next, pid)
//   pick argmax
//
// This catches consequence-aware mistakes the heuristic's per-component
// scoring misses — e.g. "this assassinate target nets me total control
// AND a trophy; that one just gives me a trophy" or "this deploy is the
// one that flips site control."
//
// The lookahead path is opt-in: heuristic-ai accepts an optional
// SimulateMoveFn and falls back to pure heuristic scoring when no
// simulator is provided. The tournament runner and headless harness
// construct the simulator from their boardgame.io reducer and pass it in;
// the live web client (no lookahead) skips it.

import type { TyrantsState } from '../game';
import { scoreAll } from '../engine/scoring';

/** Apply one move to G and return the resulting G, or null if the move
 *  was rejected (INVALID_MOVE). The implementation lives in the harness
 *  (tournament-runner / headless) since it needs the boardgame.io reducer. */
export type SimulateMoveFn = (
  G: TyrantsState,
  playerId: string,
  moveName: string,
  args: unknown[],
) => TyrantsState | null;

/** Value of a state from `pid`'s perspective: own total VP minus the
 *  strongest opponent's total VP. Positive means we're ahead. Uses the
 *  full scoreAll so trophies, control markers, inner-circle VP, and
 *  final-scoring riders all count. */
export function stateValue(G: TyrantsState, pid: string): number {
  const all = scoreAll(G);
  const my = all[pid]?.total ?? 0;
  let bestOpp = -Infinity;
  for (const [id, s] of Object.entries(all)) {
    if (id === pid) continue;
    if (s.total > bestOpp) bestOpp = s.total;
  }
  if (!Number.isFinite(bestOpp)) return my;
  return my - bestOpp;
}

/** Pick the best candidate by 1-ply lookahead.
 *
 *  Score = stateValue(after-move) + TIEBREAK_WEIGHT * heuristicScore(candidate).
 *
 *  The heuristic-tiebreak term is critical: most moves in this game produce
 *  identical immediate state-values (deploying into an uncontested space
 *  adds 0 VP, assassinating any troop adds +1 trophy = +1 VP, etc.). Without
 *  a tiebreak, lookahead picks arbitrarily among indistinguishable options
 *  and throws away the heuristic's per-component guidance ("this assassinate
 *  target sits at a control-marker site so it's strategically richer").
 *
 *  The tiebreak weight is small (0.01) so a genuine VP-changing consequence
 *  always trumps a heuristic preference — but among VP-equivalent options,
 *  heuristic order wins. If heuristicScore is omitted the function behaves
 *  as pure state-value argmax (identical to the prior version).
 *
 *  If simulate returns null for ALL candidates (every move rejected), the
 *  first candidate is returned as a fallback. */
const TIEBREAK_WEIGHT = 0.01;

export function lookaheadPick<C>(
  candidates: C[],
  toMove: (c: C) => { name: string; args: unknown[] },
  G: TyrantsState,
  pid: string,
  simulate: SimulateMoveFn,
  heuristicScore?: (c: C) => number,
): C {
  if (candidates.length === 1) return candidates[0];
  let bestC = candidates[0];
  let bestScore = -Infinity;
  let anyValid = false;
  for (const c of candidates) {
    const { name, args } = toMove(c);
    const next = simulate(G, pid, name, args);
    if (!next) continue;
    anyValid = true;
    let score = stateValue(next, pid);
    if (heuristicScore) score += TIEBREAK_WEIGHT * heuristicScore(c);
    if (score > bestScore) {
      bestScore = score;
      bestC = c;
    }
  }
  return anyValid ? bestC : candidates[0];
}

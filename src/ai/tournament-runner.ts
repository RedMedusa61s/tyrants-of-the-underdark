// Reusable tournament core. Pits two heuristic weight-sets against each
// other over N games with seat rotation and returns aggregate stats.
//
// Used by both:
//   - scripts/tournament.ts  (one-shot CLI comparison)
//   - scripts/tune.ts        (hill-climber that runs many tournaments)

import { CreateGameReducer, InitializeGame } from 'boardgame.io/internal';
import { TyrantsGame, type TyrantsState } from '../game';
import { decideHeuristicMoveWithWeights } from './heuristic-ai';
import type { HeuristicWeights } from './heuristic-weights';
import type { SimulateMoveFn, RolloutToTurnEndFn } from './lookahead';
import { decideHeuristicMoveWithWeights as decideMoveBare } from './heuristic-ai';
import { scoreAll } from '../engine/scoring';

export interface TournamentOpts {
  games: number;
  numPlayers: 2 | 3 | 4;
  halfDecks: string[];
  /** Cap moves per game; safety against infinite loops. Default 20000. */
  safetyLimit?: number;
}

export interface TournamentResult {
  /** Per-variant aggregates across seat-games (i.e., per seat the variant
   *  filled, not per game). Total seat-games per variant = games *
   *  numPlayers / 2 in a balanced rotation. */
  a: { wins: number; scoreSum: number; seatGames: number };
  b: { wins: number; scoreSum: number; seatGames: number };
  /** Win-rate gap A − B in percentage points. */
  gapPp: number;
  /** ±2σ binomial noise floor for the win-rate gap, in percentage points.
   *  A gap whose absolute value exceeds this is considered "real" at ~95%
   *  confidence under the null hypothesis of equal strength. */
  noiseFloorPp: number;
  /** Wall-clock seconds the tournament took. */
  wallSeconds: number;
}

interface BgState {
  G: TyrantsState;
  ctx: { currentPlayer: string; turn: number; gameover?: unknown; numPlayers: number };
}
type Reducer = (state: BgState, action: unknown) => BgState;

const makeMoveAction = (type: string, moveArgs: unknown[], playerID: string) => ({
  type: 'MAKE_MOVE',
  payload: { type, args: moveArgs, playerID },
});

/** Build a seat assignment that balances A/B across seats over many games.
 *  For game g, rotate so seat (⌊g/2⌋ mod n) holds variant A and the rest hold
 *  B in even games, and inverted in odd games. Across enough games every
 *  seat sees both variants roughly equally — eliminates first-player bias. */
export function rotateSeats(numPlayers: number, gameIdx: number): ('A' | 'B')[] {
  const odd = gameIdx % 2 === 1;
  const rotation = Math.floor(gameIdx / 2) % numPlayers;
  return Array.from({ length: numPlayers }, (_, i) => {
    const isA = i === rotation;
    return (odd ? !isA : isA) ? 'A' : 'B';
  });
}

function runOneGame(
  seats: ('A' | 'B')[],
  weightsA: HeuristicWeights,
  weightsB: HeuristicWeights,
  opts: TournamentOpts,
): { scores: number[]; winner: number; seats: ('A' | 'B')[]; turns: number } {
  const wrappedGame = {
    ...TyrantsGame,
    setup: (sa: Parameters<NonNullable<typeof TyrantsGame.setup>>[0]) =>
      TyrantsGame.setup!(sa, { halfDecks: opts.halfDecks }),
  };
  const reducer = CreateGameReducer({ game: wrappedGame }) as unknown as Reducer;
  let state = InitializeGame({ game: wrappedGame, numPlayers: opts.numPlayers }) as unknown as BgState;

  // 1-ply lookahead simulator: applies one move via the reducer and
  // returns the resulting G. Closes over `state` to inherit the current
  // ctx/plugins/etc.; overrides .G with the caller's G so lookahead can
  // explore counterfactual board positions. boardgame.io's reducer is
  // pure, so calling it doesn't mutate the input state.
  const simulate: SimulateMoveFn = (G, playerId, moveName, args) => {
    // Override ctx.currentPlayer to match the simulating player so the
    // reducer doesn't reject as a wrong-turn move. Matches what the live
    // app does in its simulate closure (App.tsx). Without this, every
    // lookahead call for a non-current-player floods stderr with
    // "ERROR: invalid move" — noise, but it spooked us during debugging.
    const wrapped = { ...state, G, ctx: { ...state.ctx, currentPlayer: playerId } };
    const next = reducer(wrapped, makeMoveAction(moveName, args, playerId));
    if (next === wrapped) return null; // INVALID_MOVE
    return next.G;
  };

  // Turn-end rollout: apply the candidate move, then continue playing
  // heuristically (no recursive lookahead) until either the player's turn
  // ends or the game is over. Returns the end-of-turn G. Used by tactical-
  // phase decision points (assassinate / deploy / supplant / spy site)
  // where end-of-turn consequences differ from the immediate post-move
  // state — e.g. "Master of Melee → unlocks Advance Scout → 2 trophies."
  const rollout: RolloutToTurnEndFn = (G, playerId, moveName, args) => {
    let s: BgState = { ...state, G, ctx: { ...state.ctx, currentPlayer: playerId } };
    s = reducer(s, makeMoveAction(moveName, args, playerId));
    if (s.G === G) return null; // INVALID_MOVE (reducer rejected)
    // Continue with pure heuristic (no simulator/rollout passed) until
    // the player's turn ends or game over. Safety cap on the inner loop
    // to bound rollout cost.
    let innerSafety = 50;
    while (innerSafety-- > 0) {
      if (s.ctx.gameover) break;
      if (s.ctx.currentPlayer !== playerId) break; // turn rolled to next player
      // Use the SAME weights this player is using; pass undefined for
      // simulate + rollout so the recursive call uses pure heuristic.
      // We need this player's weights — peek at the current seat.
      const seatOfPid = seats[Number(playerId)];
      const w = seatOfPid === 'A' ? weightsA : weightsB;
      const m = decideMoveBare(s.G, playerId, w);
      if (!m) {
        s = reducer(s, makeMoveAction('endTurn', [], playerId));
        continue;
      }
      const next = reducer(s, makeMoveAction(m.name, m.args as unknown[], playerId));
      if (next === s) {
        // Heuristic produced an invalid move — bail out via endTurn.
        s = reducer(s, makeMoveAction('endTurn', [], playerId));
      } else {
        s = next;
      }
    }
    return s.G;
  };

  let safety = opts.safetyLimit ?? 20000;
  while (safety-- > 0) {
    if (state.ctx.gameover) break;
    // Cross-player pendingChoice (forced-discard etc.): the prompted player
    // — not the turn-holder — must resolve before the turn can continue.
    // Without this branch the loop stalls trying to endTurn with a prompt
    // still live ("ERROR: invalid move: endTurn").
    const pc = state.G.pendingChoice;
    const pid = pc?.playerId && pc.playerId !== state.ctx.currentPlayer
      ? pc.playerId
      : state.ctx.currentPlayer;
    const seat = seats[Number(pid)];
    const weights = seat === 'A' ? weightsA : weightsB;
    const move = decideHeuristicMoveWithWeights(state.G, pid, weights, simulate, rollout);
    if (!move) {
      // Always endTurn under the real current player; if the cross-player
      // resolver has no move (shouldn't happen — pendingChoice was set),
      // fall through to letting the turn-holder advance.
      state = reducer(state, makeMoveAction('endTurn', [], state.ctx.currentPlayer));
      continue;
    }
    // For cross-player prompts (forced discard): the responder isn't the
    // turn-holder, so boardgame.io's reducer would reject their move if we
    // submitted it under state.ctx.currentPlayer. Briefly fake ctx so the
    // reducer accepts; restore the real currentPlayer afterward.
    const isCrossPlayer = pid !== state.ctx.currentPlayer;
    const submitState = isCrossPlayer
      ? { ...state, ctx: { ...state.ctx, currentPlayer: pid } }
      : state;
    const submittedNext = reducer(submitState, makeMoveAction(move.name, move.args as unknown[], pid));
    const next = isCrossPlayer
      ? { ...submittedNext, ctx: { ...submittedNext.ctx, currentPlayer: state.ctx.currentPlayer } }
      : submittedNext;
    if (next === submitState || next === state) {
      state = reducer(state, makeMoveAction('endTurn', [], state.ctx.currentPlayer));
    } else {
      state = next;
    }
  }

  const scores = scoreAll(state.G);
  const arr = Array.from({ length: opts.numPlayers }, (_, i) => scores[String(i)]?.total ?? 0);
  let winner = 0;
  for (let i = 1; i < opts.numPlayers; i++) if (arr[i] > arr[winner]) winner = i;
  return { scores: arr, winner, seats, turns: state.ctx.turn };
}

/** Run a head-to-head tournament. No I/O — caller can render the result
 *  however it likes (CLI, accept/reject decision in a tuner, etc.). */
export function runTournament(
  weightsA: HeuristicWeights,
  weightsB: HeuristicWeights,
  opts: TournamentOpts,
): TournamentResult {
  const t0 = Date.now();
  const a = { wins: 0, scoreSum: 0, seatGames: 0 };
  const b = { wins: 0, scoreSum: 0, seatGames: 0 };

  for (let g = 0; g < opts.games; g++) {
    const seats = rotateSeats(opts.numPlayers, g);
    const r = runOneGame(seats, weightsA, weightsB, opts);
    for (let i = 0; i < opts.numPlayers; i++) {
      const v = r.seats[i];
      const stats = v === 'A' ? a : b;
      stats.seatGames++;
      stats.scoreSum += r.scores[i];
      if (r.winner === i) stats.wins++;
    }
  }

  const wallSeconds = (Date.now() - t0) / 1000;
  const gapPp = (100 * a.wins / a.seatGames) - (100 * b.wins / b.seatGames);
  // Half-width of the 95% CI for a difference of two binomial proportions
  // under H0 p=0.5: ±2·sqrt(p(1-p)·(1/nA + 1/nB))·100. With nA=nB=n: ±2·100·sqrt(0.5/n).
  const noiseFloorPp = 2 * 100 * Math.sqrt(0.5 / Math.min(a.seatGames, b.seatGames));
  return { a, b, gapPp, noiseFloorPp, wallSeconds };
}

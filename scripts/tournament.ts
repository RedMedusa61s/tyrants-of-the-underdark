// Tournament harness: pit two heuristic weight-sets against each other
// over N games and report win-rate + average-score delta.
//
// Two-AI mode (default): each seat is filled by either "A" or "B" via a
// rotation that balances seat positioning, so neither variant gets a
// fixed first-player advantage. Per game we randomize which variant sits
// in P1 — the seat that almost always wins in current data (P0 / P1 are
// just labels; we randomize the *assignment* of variants to seats).
//
// Usage:
//   npm run tournament -- --games 50 --a weights/baseline.json --b weights/v2.json
//   npm run tournament -- --games 50 --b weights/v2.json   # A defaults to DEFAULT_WEIGHTS
//   npm run tournament -- --games 50 --num-players 2 --half-decks drow,dragons
//
// Exit code 0 always; the report is printed to stdout.

import { CreateGameReducer, InitializeGame } from 'boardgame.io/internal';
import { readFileSync } from 'node:fs';
import { TyrantsGame, type TyrantsState } from '../src/game';
import { decideHeuristicMoveWithWeights } from '../src/ai/heuristic-ai';
import { DEFAULT_WEIGHTS, type HeuristicWeights } from '../src/ai/heuristic-weights';
import { scoreAll } from '../src/engine/scoring';

interface Args {
  games: number;
  numPlayers: number;
  halfDecks: string[];
  aPath: string | null;
  bPath: string | null;
  verbose: boolean;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (k: string, d: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
  const has = (k: string) => a.includes(`--${k}`);
  return {
    games: parseInt(get('games', '20')),
    numPlayers: parseInt(get('num-players', '4')),
    halfDecks: get('half-decks', 'drow,dragons').split(',').map(s => s.trim()),
    aPath: a.indexOf('--a') >= 0 ? a[a.indexOf('--a') + 1] : null,
    bPath: a.indexOf('--b') >= 0 ? a[a.indexOf('--b') + 1] : null,
    verbose: has('verbose'),
  };
}

function loadWeights(path: string | null, label: string): HeuristicWeights {
  if (!path) {
    console.log(`Weights ${label}: DEFAULT_WEIGHTS`);
    return DEFAULT_WEIGHTS;
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<HeuristicWeights>;
  const merged: HeuristicWeights = { ...DEFAULT_WEIGHTS, ...raw };
  console.log(`Weights ${label}: ${path}`);
  return merged;
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

interface GameResult {
  scores: number[];
  winner: number;
  /** seat[i] = 'A' | 'B' — which variant held seat i. */
  seats: ('A' | 'B')[];
  turns: number;
}

function runOneGame(
  seats: ('A' | 'B')[],
  weightsA: HeuristicWeights,
  weightsB: HeuristicWeights,
  args: Args,
): GameResult {
  const wrappedGame = {
    ...TyrantsGame,
    setup: (sa: Parameters<NonNullable<typeof TyrantsGame.setup>>[0]) =>
      TyrantsGame.setup!(sa, { halfDecks: args.halfDecks }),
  };
  const reducer = CreateGameReducer({ game: wrappedGame }) as unknown as Reducer;
  let state = InitializeGame({ game: wrappedGame, numPlayers: args.numPlayers }) as unknown as BgState;

  let safety = 20000;
  while (safety-- > 0) {
    if (state.ctx.gameover) break;
    const pid = state.ctx.currentPlayer;
    const seat = seats[Number(pid)];
    const weights = seat === 'A' ? weightsA : weightsB;
    const move = decideHeuristicMoveWithWeights(state.G, pid, weights);
    if (!move) {
      state = reducer(state, makeMoveAction('endTurn', [], pid));
      continue;
    }
    const next = reducer(state, makeMoveAction(move.name, move.args as unknown[], pid));
    if (next === state) {
      // Invalid — bail out of this seat via endTurn rather than spinning.
      state = reducer(state, makeMoveAction('endTurn', [], pid));
    } else {
      state = next;
    }
  }

  const scores = scoreAll(state.G);
  const arr = Array.from({ length: args.numPlayers }, (_, i) => scores[String(i)]?.total ?? 0);
  let winner = 0;
  for (let i = 1; i < args.numPlayers; i++) if (arr[i] > arr[winner]) winner = i;
  return { scores: arr, winner, seats, turns: state.ctx.turn };
}

/** Build a seat assignment that balances A/B across seats. For 4P with
 *  game index g we rotate so seat (g % numPlayers) holds variant A and the
 *  rest hold B in even games, and inverted in odd games. This gives both
 *  variants equal exposure to every seat across enough games. */
function rotateSeats(numPlayers: number, gameIdx: number): ('A' | 'B')[] {
  const odd = gameIdx % 2 === 1;
  const rotation = Math.floor(gameIdx / 2) % numPlayers;
  return Array.from({ length: numPlayers }, (_, i) => {
    const isA = i === rotation;
    return (odd ? !isA : isA) ? 'A' : 'B';
  });
}

async function main() {
  const args = parseArgs();
  const weightsA = loadWeights(args.aPath, 'A');
  const weightsB = loadWeights(args.bPath, 'B');

  console.log(`Tournament: ${args.games} games, ${args.numPlayers}P, half-decks=${args.halfDecks.join('+')}`);
  console.log();

  // Per-variant aggregates: counted across seats-played.
  const stats = {
    A: { wins: 0, scoreSum: 0, seatGames: 0 },
    B: { wins: 0, scoreSum: 0, seatGames: 0 },
  };

  const t0 = Date.now();
  for (let g = 0; g < args.games; g++) {
    const seats = rotateSeats(args.numPlayers, g);
    const r = runOneGame(seats, weightsA, weightsB, args);
    for (let i = 0; i < args.numPlayers; i++) {
      const v = r.seats[i];
      stats[v].seatGames++;
      stats[v].scoreSum += r.scores[i];
      if (r.winner === i) stats[v].wins++;
    }
    if (args.verbose) {
      console.log(
        `Game ${g + 1}: seats=[${r.seats.join(',')}] scores=[${r.scores.join(',')}] ` +
        `winner=P${r.winner + 1}(${r.seats[r.winner]}) turns=${r.turns}`
      );
    }
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log();
  console.log('=== Results ===');
  for (const v of ['A', 'B'] as const) {
    const s = stats[v];
    const wr = (100 * s.wins / s.seatGames).toFixed(1);
    const avg = (s.scoreSum / s.seatGames).toFixed(2);
    console.log(`${v}: wins=${s.wins}/${s.seatGames} (${wr}%) avgScore=${avg}`);
  }
  const diff = (100 * stats.A.wins / stats.A.seatGames) - (100 * stats.B.wins / stats.B.seatGames);
  console.log();
  console.log(`Win-rate gap A−B: ${diff >= 0 ? '+' : ''}${diff.toFixed(1)} pp`);
  console.log(`Wall clock: ${dt}s (${(args.games / Number(dt)).toFixed(1)} games/sec)`);

  // Rough significance: ±2σ binomial halfwidth around 50% baseline.
  // n = total seat-games per variant. σ = sqrt(p(1-p)/n) * 100.
  const n = stats.A.seatGames;
  const sigmaPP = 100 * Math.sqrt(0.25 / n);
  console.log(`Approx ±2σ noise floor for win-rate gap: ±${(2 * sigmaPP).toFixed(1)} pp (n=${n} seat-games per variant)`);
}

await main();

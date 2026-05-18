// Tournament harness CLI. Thin wrapper around src/ai/tournament-runner.ts.
//
// Usage:
//   npm run tournament -- --games 100 --a weights/baseline.json --b weights/v2.json
//   npm run tournament -- --games 100 --b weights/v2.json   # A defaults to DEFAULT_WEIGHTS
//   npm run tournament -- --games 200 --num-players 2 --half-decks demons,drow
//
// Output: per-variant win count + avg score, the A−B gap, and a ±2σ noise
// floor. If |gap| < noise floor, treat the result as a tie.

import { readFileSync } from 'node:fs';
import { DEFAULT_WEIGHTS, type HeuristicWeights } from '../src/ai/heuristic-weights';
import { runTournament } from '../src/ai/tournament-runner';

interface Args {
  games: number;
  numPlayers: 2 | 3 | 4;
  halfDecks: string[];
  aPath: string | null;
  bPath: string | null;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (k: string, d: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
  const np = parseInt(get('num-players', '4'));
  if (np !== 2 && np !== 3 && np !== 4) throw new Error(`--num-players must be 2|3|4, got ${np}`);
  return {
    games: parseInt(get('games', '20')),
    numPlayers: np as 2 | 3 | 4,
    halfDecks: get('half-decks', 'drow,dragons').split(',').map(s => s.trim()),
    aPath: a.indexOf('--a') >= 0 ? a[a.indexOf('--a') + 1] : null,
    bPath: a.indexOf('--b') >= 0 ? a[a.indexOf('--b') + 1] : null,
  };
}

function loadWeights(path: string | null, label: string): HeuristicWeights {
  if (!path) {
    console.log(`Weights ${label}: DEFAULT_WEIGHTS`);
    return DEFAULT_WEIGHTS;
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<HeuristicWeights>;
  console.log(`Weights ${label}: ${path}`);
  return { ...DEFAULT_WEIGHTS, ...raw };
}

const args = parseArgs();
const weightsA = loadWeights(args.aPath, 'A');
const weightsB = loadWeights(args.bPath, 'B');

console.log(`Tournament: ${args.games} games, ${args.numPlayers}P, half-decks=${args.halfDecks.join('+')}`);
console.log();

const r = runTournament(weightsA, weightsB, {
  games: args.games,
  numPlayers: args.numPlayers,
  halfDecks: args.halfDecks,
});

console.log('=== Results ===');
for (const [label, s] of [['A', r.a], ['B', r.b]] as const) {
  const wr = (100 * s.wins / s.seatGames).toFixed(1);
  const avg = (s.scoreSum / s.seatGames).toFixed(2);
  console.log(`${label}: wins=${s.wins}/${s.seatGames} (${wr}%) avgScore=${avg}`);
}
console.log();
console.log(`Win-rate gap A−B: ${r.gapPp >= 0 ? '+' : ''}${r.gapPp.toFixed(1)} pp`);
console.log(`±2σ noise floor:  ±${r.noiseFloorPp.toFixed(1)} pp`);
console.log(`Wall clock: ${r.wallSeconds.toFixed(1)}s (${(args.games / r.wallSeconds).toFixed(1)} games/sec)`);

const verdict = Math.abs(r.gapPp) < r.noiseFloorPp ? 'TIE' : (r.gapPp > 0 ? 'A wins' : 'B wins');
console.log(`Verdict: ${verdict}`);

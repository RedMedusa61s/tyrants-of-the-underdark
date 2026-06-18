// Hill-climbing tuner for the heuristic AI's weights.
//
// Algorithm:
//   1. Load current-best weights (default: DEFAULT_WEIGHTS, or --seed FILE).
//   2. Pick a random knob; mutate it (multiplicative perturbation).
//   3. Run a head-to-head tournament: candidate vs current-best.
//   4. If candidate's win-rate gap exceeds the ±2σ noise floor AND is
//      positive, accept the mutation. Otherwise reject.
//   5. Repeat for --iters trials or until --wall-budget seconds elapse.
//
// Outputs:
//   - weights/tuned.json     latest accepted weights (updated each accept)
//   - weights/tune-log.json  append-only journal of every trial
//                            (mutation, gap, accept/reject)
//
// Usage:
//   npm run tune -- --iters 30 --games-per-trial 80 --num-players 2
//   npm run tune -- --seed weights/tuned.json --iters 20    # resume
//
// Pragmatics:
//   * Default tournament size of 80 games gives ±10 pp noise floor. With
//     small expected effects, you need MORE games per trial — but that
//     means fewer trials per wall hour. 80 is a balance.
//   * The acceptance rule is conservative (gap > noise floor). Many trials
//     will reject; that's expected and not a bug.
//   * "Accept" is a one-shot test against the current best — no separate
//     held-out validation. The tuner can drift on a lucky run. For real
//     deployment, run a confirmation tournament at 200+ games before
//     promoting tuned.json into shipped defaults.

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_WEIGHTS, type HeuristicWeights } from '../src/ai/heuristic-weights';
import { runTournament } from '../src/ai/tournament-runner';

interface Args {
  iters: number;
  gamesPerTrial: number;
  numPlayers: 2 | 3 | 4;
  halfDecks: string[];
  seedPath: string | null;
  outPath: string;
  logPath: string;
  wallBudgetSeconds: number | null;
  mutateStrength: number;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (k: string, d: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
  const np = parseInt(get('num-players', '2'));
  if (np !== 2 && np !== 3 && np !== 4) throw new Error('--num-players must be 2|3|4');
  return {
    iters: parseInt(get('iters', '30')),
    gamesPerTrial: parseInt(get('games-per-trial', '80')),
    numPlayers: np as 2 | 3 | 4,
    halfDecks: get('half-decks', 'drow,dragons').split(',').map(s => s.trim()),
    seedPath: a.indexOf('--seed') >= 0 ? a[a.indexOf('--seed') + 1] : null,
    outPath: get('out', 'weights/tuned.json'),
    logPath: get('log', 'weights/tune-log.json'),
    wallBudgetSeconds: a.indexOf('--wall-budget') >= 0 ? parseInt(a[a.indexOf('--wall-budget') + 1]) : null,
    mutateStrength: parseFloat(get('mutate-strength', '0.35')),
  };
}

const KNOBS = Object.keys(DEFAULT_WEIGHTS) as (keyof HeuristicWeights)[];

/** Integer-valued knobs that must stay positive integers. */
const INT_KNOBS = new Set<keyof HeuristicWeights>([
  'minCyclingDeck',
  'powerThresholdForAssassinate',
  'openingVarianceTopK',
]);

function loadSeed(path: string | null): HeuristicWeights {
  if (!path) return { ...DEFAULT_WEIGHTS };
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<HeuristicWeights>;
  return { ...DEFAULT_WEIGHTS, ...raw };
}

/** Pick a knob and perturb it. Multiplicative for continuous weights;
 *  ±1 step for integer knobs (powerThreshold, minCyclingDeck). Returns
 *  the mutated weights AND a description of the mutation for the log. */
function mutate(
  base: HeuristicWeights,
  strength: number,
): { mutated: HeuristicWeights; knob: keyof HeuristicWeights; from: number; to: number } {
  const knob = KNOBS[Math.floor(Math.random() * KNOBS.length)];
  const from = base[knob];
  let to: number;
  if (INT_KNOBS.has(knob)) {
    // ±1 with equal probability; floor at 0.
    to = from + (Math.random() < 0.5 ? -1 : +1);
    if (to < 0) to = 0;
  } else {
    // Multiply by a factor in [1-strength, 1+strength]. Allow sign flips
    // by drawing the offset around 0 instead when from==0.
    if (from === 0) {
      to = (Math.random() < 0.5 ? -1 : +1) * strength * 2;
    } else {
      const factor = 1 + (Math.random() * 2 - 1) * strength;
      to = from * factor;
      // Round to 2 decimals to keep weight files readable.
      to = Math.round(to * 100) / 100;
    }
  }
  const mutated = { ...base, [knob]: to } as HeuristicWeights;
  return { mutated, knob, from, to };
}

interface TrialRecord {
  iter: number;
  knob: string;
  from: number;
  to: number;
  gamesPerTrial: number;
  gapPp: number;
  noiseFloorPp: number;
  accepted: boolean;
  reason: string;
  candidateWinPct: number;
  bestWinPct: number;
  ts: string;
}

function ensureDir(filepath: string) {
  const d = dirname(filepath);
  if (d && !existsSync(d)) mkdirSync(d, { recursive: true });
}

function writeJson(path: string, data: unknown) {
  ensureDir(path);
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function appendJsonLine(path: string, data: unknown) {
  ensureDir(path);
  appendFileSync(path, JSON.stringify(data) + '\n');
}

async function main() {
  const args = parseArgs();
  let best = loadSeed(args.seedPath);
  console.log(`Tuner: ${args.iters} iters, ${args.gamesPerTrial} games/trial, ${args.numPlayers}P, decks=${args.halfDecks.join('+')}`);
  console.log(`Seed:  ${args.seedPath ?? 'DEFAULT_WEIGHTS'}`);
  console.log(`Out:   ${args.outPath}`);
  console.log(`Log:   ${args.logPath}`);
  if (args.wallBudgetSeconds) console.log(`Wall budget: ${args.wallBudgetSeconds}s`);
  console.log();

  // Stamp the run start in the journal so concatenated logs are
  // self-explanatory after a few sessions.
  appendJsonLine(args.logPath, {
    runStart: new Date().toISOString(),
    seed: args.seedPath ?? 'DEFAULT_WEIGHTS',
    args: { iters: args.iters, gamesPerTrial: args.gamesPerTrial, numPlayers: args.numPlayers, halfDecks: args.halfDecks, mutateStrength: args.mutateStrength },
  });

  // Always write the seed to outPath so the file exists even if no trial accepts.
  writeJson(args.outPath, best);

  const t0 = Date.now();
  let accepts = 0;

  for (let i = 1; i <= args.iters; i++) {
    if (args.wallBudgetSeconds && (Date.now() - t0) / 1000 > args.wallBudgetSeconds) {
      console.log(`[wall-budget reached at iter ${i - 1}; stopping]`);
      break;
    }
    const m = mutate(best, args.mutateStrength);
    // Run candidate (A) vs current-best (B). A positive gap means
    // the candidate is better.
    const r = runTournament(m.mutated, best, {
      games: args.gamesPerTrial,
      numPlayers: args.numPlayers,
      halfDecks: args.halfDecks,
    });
    const candidateWinPct = 100 * r.a.wins / r.a.seatGames;
    const bestWinPct = 100 * r.b.wins / r.b.seatGames;
    // Accept rule: candidate's win-rate exceeds best's by more than the
    // ±2σ noise floor. We're testing one-sided ("did the candidate get
    // better?"), but using the symmetric ±2σ bar keeps the bar honest;
    // a one-sided 95% test would be ~1.65σ, slightly easier to clear.
    const accepted = r.gapPp > r.noiseFloorPp;
    const reason = accepted
      ? `gap ${r.gapPp.toFixed(1)} > noise ${r.noiseFloorPp.toFixed(1)}`
      : (Math.abs(r.gapPp) < r.noiseFloorPp
          ? `tie (|gap|=${Math.abs(r.gapPp).toFixed(1)} ≤ noise ${r.noiseFloorPp.toFixed(1)})`
          : `regress (gap ${r.gapPp.toFixed(1)} ≤ -noise)`);

    const rec: TrialRecord = {
      iter: i, knob: m.knob, from: m.from, to: m.to,
      gamesPerTrial: args.gamesPerTrial,
      gapPp: Math.round(r.gapPp * 10) / 10,
      noiseFloorPp: Math.round(r.noiseFloorPp * 10) / 10,
      accepted, reason,
      candidateWinPct: Math.round(candidateWinPct * 10) / 10,
      bestWinPct: Math.round(bestWinPct * 10) / 10,
      ts: new Date().toISOString(),
    };
    appendJsonLine(args.logPath, rec);

    const tag = accepted ? '✓ ACCEPT' : '·  reject';
    console.log(
      `[${i}/${args.iters}] ${tag} ${m.knob}: ${m.from} → ${m.to}  ` +
      `(cand ${candidateWinPct.toFixed(1)}% vs best ${bestWinPct.toFixed(1)}%, ` +
      `gap ${r.gapPp >= 0 ? '+' : ''}${r.gapPp.toFixed(1)} pp ±${r.noiseFloorPp.toFixed(1)})`
    );

    if (accepted) {
      best = m.mutated;
      writeJson(args.outPath, best);
      accepts++;
    }
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log();
  console.log(`=== Done ===  accepted ${accepts}/${args.iters} trials in ${dt}s`);
  console.log(`Final weights written to ${args.outPath}`);
  console.log(`Run confirmation: npm run tournament -- --games 300 --num-players ${args.numPlayers} --b ${args.outPath}`);
}

await main();

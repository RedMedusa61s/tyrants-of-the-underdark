// Headless game runner for AI training/eval.
//
// Bypasses boardgame.io's React-flavored Client and uses the raw reducer
// (CreateGameReducer + InitializeGame from boardgame.io/internal). Dispatches
// one AI move per tick until ctx.gameover, then reports per-game scores and
// aggregate win/avg-score stats.
//
// Usage:
//   npm run sim -- --games 50 --p1 heuristic --p2 random --p3 random --p4 random
//
// Flags:
//   --games N            number of games to play (default 10)
//   --p1..p4 NAME        AI per seat (random | heuristic)
//   --verbose            print per-turn move log
//   --out DIR            write per-game JSON logs (default: training-logs/<timestamp>)
//   --no-save            disable on-disk logging

import { CreateGameReducer, InitializeGame } from 'boardgame.io/internal';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TyrantsGame, type TyrantsState } from '../src/game';
import { decideAiMove, type AiMove } from '../src/ai/random-ai';
import { decideHeuristicMove } from '../src/ai/heuristic-ai';
import { scoreAll } from '../src/engine/scoring';
import { checkTokenConservation } from '../src/engine/map-state';

type AiFn = (G: TyrantsState, pid: string) => AiMove | null;
const AIS: Record<string, AiFn> = {
  random: decideAiMove,
  heuristic: decideHeuristicMove,
};

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k: string, d: string) => {
    const i = a.indexOf(`--${k}`);
    return i >= 0 ? a[i + 1] : d;
  };
  const has = (k: string) => a.includes(`--${k}`);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    games: parseInt(get('games', '10')),
    verbose: has('verbose'),
    save: !has('no-save'),
    outDir: get('out', join('training-logs', ts)),
    players: [
      get('p1', 'heuristic'),
      get('p2', 'random'),
      get('p3', 'random'),
      get('p4', 'random'),
    ],
  };
}

const args = parseArgs();

interface BgState {
  G: TyrantsState;
  ctx: { currentPlayer: string; turn: number; gameover?: unknown; numPlayers: number };
}

type Reducer = (state: BgState, action: unknown) => BgState;

const makeMoveAction = (type: string, moveArgs: unknown[], playerID: string) => ({
  type: 'MAKE_MOVE',
  payload: { type, args: moveArgs, playerID },
});

interface MoveRecord {
  turn: number;
  playerId: string;
  ai: string;
  move: string;
  args: unknown[];
  invalid?: boolean;
}

function runOneGame(gameIdx: number): {
  scores: number[];
  winner: number;
  turns: number;
  endReason: string;
  trace: MoveRecord[];
  finalLog: string[];
  turnLogs: TyrantsState['turnLogs'];
  snapshots: TyrantsState['snapshots'];
} {
  const reducer = CreateGameReducer({ game: TyrantsGame }) as unknown as Reducer;
  let state = InitializeGame({ game: TyrantsGame, numPlayers: 4 }) as unknown as BgState;

  const trace: MoveRecord[] = [];
  let safety = 20000;
  let lastDesc = '';
  while (safety-- > 0) {
    if (state.ctx.gameover) break;
    const pid = state.ctx.currentPlayer;
    const aiName = args.players[Number(pid)] ?? 'random';
    const ai = AIS[aiName] ?? decideAiMove;
    const move = ai(state.G, pid);
    if (!move) {
      lastDesc = `P${Number(pid) + 1} stuck → endTurn`;
      trace.push({ turn: state.ctx.turn, playerId: pid, ai: aiName, move: 'endTurn', args: [], invalid: true });
      state = reducer(state, makeMoveAction('endTurn', [], pid));
      continue;
    }
    if (args.verbose) {
      console.log(`G${gameIdx + 1} T${state.ctx.turn} P${Number(pid) + 1}(${aiName}): ${move.name}(${move.args.join(',')})`);
    }
    lastDesc = `${move.name}(${move.args.join(',')})`;
    const next = reducer(state, makeMoveAction(move.name, move.args as unknown[], pid));
    const invalid = next === state;
    trace.push({ turn: state.ctx.turn, playerId: pid, ai: aiName, move: move.name, args: move.args as unknown[], ...(invalid && { invalid: true }) });
    if (invalid) {
      lastDesc = `INVALID ${move.name} → endTurn`;
      state = reducer(state, makeMoveAction('endTurn', [], pid));
    } else {
      state = next;
    }
    // Surface conservation violations the moment they happen (the move that
    // introduced the discrepancy will be the last trace entry).
    const violations = checkTokenConservation(state.G);
    if (violations.length > 0) {
      console.error(
        `[G${gameIdx + 1} T${state.ctx.turn}] TOKEN CONSERVATION VIOLATION after ${move.name}(${move.args.join(',')}):`,
        JSON.stringify(violations, null, 2)
      );
    }
  }

  const G = state.G;
  const scores = scoreAll(G);
  const arr = ['0', '1', '2', '3'].map(p => scores[p]?.total ?? 0);
  let winner = 0;
  for (let i = 1; i < 4; i++) if (arr[i] > arr[winner]) winner = i;
  const endReason = state.ctx.gameover ? 'gameover' : (safety <= 0 ? 'safety-exceeded' : `last:${lastDesc}`);
  return {
    scores: arr,
    winner,
    turns: state.ctx.turn,
    endReason,
    trace,
    finalLog: G.log,
    turnLogs: G.turnLogs,
    snapshots: G.snapshots,
  };
}

const wins = [0, 0, 0, 0];
const totalScore = [0, 0, 0, 0];
let totalTurns = 0;
const t0 = Date.now();

if (args.save) {
  mkdirSync(args.outDir, { recursive: true });
  console.log(`Saving logs → ${args.outDir}`);
}

const sessionSummary: Array<{
  game: number; scores: number[]; winner: number; turns: number;
  endReason: string; players: string[];
}> = [];

for (let g = 0; g < args.games; g++) {
  const r = runOneGame(g);
  wins[r.winner]++;
  for (let i = 0; i < 4; i++) totalScore[i] += r.scores[i];
  totalTurns += r.turns;
  console.log(
    `Game ${g + 1}: scores=[${r.scores.join(', ')}] winner=P${r.winner + 1} ` +
    `(${args.players[r.winner]}) turns=${r.turns} end=${r.endReason}`
  );
  sessionSummary.push({
    game: g + 1, scores: r.scores, winner: r.winner, turns: r.turns,
    endReason: r.endReason, players: args.players,
  });
  if (args.save) {
    const fname = `game-${String(g + 1).padStart(4, '0')}.json`;
    writeFileSync(
      join(args.outDir, fname),
      JSON.stringify({
        game: g + 1,
        players: args.players,
        scores: r.scores,
        winner: r.winner,
        turns: r.turns,
        endReason: r.endReason,
        trace: r.trace,
        turnLogs: r.turnLogs,
        snapshots: r.snapshots, // base64 codec at the start of each turn
        finalLogTail: r.finalLog.slice(-50),
      })
    );
  }
}

if (args.save) {
  writeFileSync(
    join(args.outDir, 'summary.json'),
    JSON.stringify({
      ranAt: new Date().toISOString(),
      games: args.games,
      players: args.players,
      wins,
      avgScore: totalScore.map(s => s / args.games),
      avgTurns: totalTurns / args.games,
      perGame: sessionSummary,
    }, null, 2)
  );
}

const dt = ((Date.now() - t0) / 1000).toFixed(1);
console.log('\n=== Summary ===');
for (let i = 0; i < 4; i++) {
  const rate = ((wins[i] / args.games) * 100).toFixed(1);
  const avg = (totalScore[i] / args.games).toFixed(1);
  console.log(`P${i + 1} (${args.players[i].padEnd(10)}): wins=${wins[i]}/${args.games} (${rate}%) avgScore=${avg}`);
}
console.log(`Avg turns/game: ${(totalTurns / args.games).toFixed(1)}`);
console.log(`Wall clock: ${dt}s (${(args.games / Number(dt)).toFixed(1)} games/sec)`);

// Recruit-divergence analyzer: for each human turn that included a recruit,
// compare the cards the human acquired vs what the AI would acquire from
// the same turn-start state.
//
// Companion to scripts/replay-divergence.ts. The general divergence script
// surfaced the AI's biggest tactical leak (chooseOne option 0); this one
// focuses on the multi-turn strategic dimension: WHICH cards humans buy.
//
// Methodology:
//   For each human turn in each log:
//     1. Decode turn-start snapshot → G_before.
//     2. Parse human's recruits from turnLogs[i].lines (regex on
//        "P1 recruited <Name>" entries).
//     3. Replay the same turn with the AI; record every recruitFromMarket
//        and recruitFromAuxStack move it made.
//     4. Compare the two sets.
//
// Output:
//   - Per-card counts: how often humans recruited X, how often AI did.
//   - Top "human picks, AI doesn't" cards (likely undervalued by the AI).
//   - Top "AI picks, human doesn't" cards (likely overvalued).
//   - Sample turns with influence + market context for the worst gaps.
//
// Usage:
//   npm run recruit-divergence -- --browser-only --top 20
//   npm run recruit-divergence -- --player 0 --no-lookahead    # faster

import { CreateGameReducer, InitializeGame } from 'boardgame.io/internal';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TyrantsGame, type TyrantsState } from '../src/game';
import { decideHeuristicMoveWithWeights } from '../src/ai/heuristic-ai';
import type { AiMove } from '../src/ai/random-ai';
import { DEFAULT_WEIGHTS } from '../src/ai/heuristic-weights';
import { lookupCard } from '../src/card-data';
import type { SimulateMoveFn, RolloutToTurnEndFn } from '../src/ai/lookahead';

interface Args {
  logsDir: string;
  topN: number;
  browserOnly: boolean;
  playerFilter: string | null;
  noLookahead: boolean;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (k: string, d: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
  const has = (k: string) => a.includes(`--${k}`);
  return {
    logsDir: get('logs-dir', 'logs'),
    topN: parseInt(get('top', '15')),
    browserOnly: has('browser-only'),
    playerFilter: a.indexOf('--player') >= 0 ? a[a.indexOf('--player') + 1] : null,
    noLookahead: has('no-lookahead'),
  };
}

interface SnapshotRec { turn: number; playerId: string; color: string; codec: string }
interface TurnLogRec { turn: number; playerId: string; color: string; lines: string[] }
interface GameLog {
  source: string;
  meta?: { numPlayers?: number; aiStyles?: string[] };
  game: {
    numPlayers: number;
    halfDecks: string[];
    aiStyles?: string[];
    snapshots: SnapshotRec[];
    turnLogs: TurnLogRec[];
  };
}

function decodeCodec(codec: string): Partial<TyrantsState> {
  const json = Buffer.from(codec.trim(), 'base64').toString('utf-8');
  return JSON.parse(json) as Partial<TyrantsState>;
}

function isHumanSeat(log: GameLog, pid: string): boolean {
  const styles = log.game.aiStyles ?? log.meta?.aiStyles ?? [];
  const idx = Number(pid);
  if (idx === 0) return styles.length > 0;
  return styles[idx - 1] === undefined;
}

interface BgState {
  G: TyrantsState;
  ctx: { currentPlayer: string; turn: number; gameover?: unknown; numPlayers: number; phase?: string };
  _stateID?: number;
  plugins?: unknown;
}
type Reducer = (state: BgState, action: unknown) => BgState;
const makeMoveAction = (type: string, args: unknown[], playerID: string) => ({
  type: 'MAKE_MOVE',
  payload: { type, args, playerID },
});

/** Parse "P1 recruited <Name>" (and "P1 recruited <Name> (N left in stack)" for
 *  aux stacks) from a turn's log lines. */
function parseHumanRecruits(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const m = /^P\d+ recruited (.+?)(?: \(\d+ left in stack\))?$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

interface ReplayResult {
  aiRecruits: string[];
  marketAtStart: string[];
  influenceAtStart: number;
}

function replayTurn(log: GameLog, snapIdx: number, noLookahead: boolean): ReplayResult | null {
  const snap = log.game.snapshots[snapIdx];
  const pid = snap.playerId;
  const gBefore = decodeCodec(snap.codec) as TyrantsState;

  const wrappedGame = {
    ...TyrantsGame,
    setup: (sa: Parameters<NonNullable<typeof TyrantsGame.setup>>[0]) =>
      TyrantsGame.setup!(sa, { halfDecks: log.game.halfDecks }),
  };
  const reducer = CreateGameReducer({ game: wrappedGame }) as unknown as Reducer;
  let state = InitializeGame({ game: wrappedGame, numPlayers: log.game.numPlayers }) as unknown as BgState;
  state = { ...state, G: { ...gBefore, snapshots: [], turnLogs: [] } as TyrantsState };
  state.ctx = { ...state.ctx, currentPlayer: pid, turn: snap.turn };

  const marketAtStart = (gBefore.market?.row ?? []).filter(Boolean).map(c => c!.name);
  const influenceAtStart = gBefore.players?.[pid]?.influence ?? 0;

  const simulate: SimulateMoveFn = (G, playerId, moveName, args) => {
    const wrapped = { ...state, G };
    const next = reducer(wrapped, makeMoveAction(moveName, args, playerId));
    if (next === wrapped) return null;
    return next.G;
  };
  const rollout: RolloutToTurnEndFn = (G, playerId, moveName, args) => {
    let s: BgState = { ...state, G };
    s = reducer(s, makeMoveAction(moveName, args, playerId));
    if (s.G === G) return null;
    let inner = 50;
    while (inner-- > 0) {
      if (s.ctx.gameover) break;
      if (s.ctx.currentPlayer !== playerId) break;
      const m = decideHeuristicMoveWithWeights(s.G, playerId, DEFAULT_WEIGHTS);
      if (!m) { s = reducer(s, makeMoveAction('endTurn', [], playerId)); continue; }
      const next = reducer(s, makeMoveAction(m.name, m.args as unknown[], playerId));
      if (next === s) s = reducer(s, makeMoveAction('endTurn', [], playerId));
      else s = next;
    }
    return s.G;
  };

  const aiRecruits: string[] = [];
  let safety = 100;
  while (safety-- > 0) {
    if (state.ctx.gameover) break;
    if (state.ctx.currentPlayer !== pid) break;
    const move: AiMove | null = noLookahead
      ? decideHeuristicMoveWithWeights(state.G, pid, DEFAULT_WEIGHTS)
      : decideHeuristicMoveWithWeights(state.G, pid, DEFAULT_WEIGHTS, simulate, rollout);
    if (!move) {
      state = reducer(state, makeMoveAction('endTurn', [], pid));
      continue;
    }
    // Track recruits BEFORE applying — read the card name from current G.
    if (move.name === 'recruitFromMarket') {
      const idx = move.args[0] as number;
      const c = state.G.market.row[idx];
      if (c) aiRecruits.push(c.name);
    } else if (move.name === 'recruitFromAuxStack') {
      const stack = move.args[0] as string;
      aiRecruits.push(stack === 'priestesses' ? 'Priestess of Lolth' : 'House Guard');
    }
    const next = reducer(state, makeMoveAction(move.name, move.args as unknown[], pid));
    if (next === state) state = reducer(state, makeMoveAction('endTurn', [], pid));
    else state = next;
  }
  if (safety <= 0) return null;
  return { aiRecruits, marketAtStart, influenceAtStart };
}

interface PairDivergence {
  file: string;
  turn: number;
  pid: string;
  influence: number;
  humanRecruits: string[];
  aiRecruits: string[];
  marketAtStart: string[];
}

async function main() {
  const args = parseArgs();
  const files = readdirSync(args.logsDir).filter(f => f.endsWith('.json'));

  const humanCounts = new Map<string, number>();
  const aiCounts = new Map<string, number>();
  const allDivergences: PairDivergence[] = [];
  let analyzed = 0;
  let skipped = 0;

  for (const f of files) {
    const raw = JSON.parse(readFileSync(join(args.logsDir, f), 'utf-8')) as GameLog;
    if (args.browserOnly && raw.source !== 'browser-game') continue;
    const log = raw;
    const snapshots = log.game.snapshots;
    if (!snapshots || snapshots.length < 2) continue;

    for (let i = 0; i < snapshots.length - 1; i++) {
      const snap = snapshots[i];
      if (args.playerFilter && snap.playerId !== args.playerFilter) continue;
      if (!args.playerFilter && !isHumanSeat(log, snap.playerId)) continue;

      const turnLog = log.game.turnLogs.find(t => t.turn === snap.turn && t.playerId === snap.playerId);
      if (!turnLog) continue;
      const humanRecruits = parseHumanRecruits(turnLog.lines);

      try {
        const r = replayTurn(log, i, args.noLookahead);
        if (!r) { skipped++; continue; }

        // Only record turns with at least one recruit on either side; pure-
        // skip turns aren't interesting for THIS analysis.
        if (humanRecruits.length === 0 && r.aiRecruits.length === 0) continue;

        for (const c of humanRecruits) humanCounts.set(c, (humanCounts.get(c) ?? 0) + 1);
        for (const c of r.aiRecruits) aiCounts.set(c, (aiCounts.get(c) ?? 0) + 1);

        if (JSON.stringify(humanRecruits.slice().sort()) !== JSON.stringify(r.aiRecruits.slice().sort())) {
          allDivergences.push({
            file: f, turn: snap.turn, pid: snap.playerId,
            influence: r.influenceAtStart,
            humanRecruits, aiRecruits: r.aiRecruits,
            marketAtStart: r.marketAtStart,
          });
        }
        analyzed++;
      } catch (e) {
        skipped++;
        if (skipped < 3) console.error(`Skip ${f} turn ${snap.turn}: ${e}`);
      }
    }
  }

  console.log(`\n=== Recruit-divergence summary ===`);
  console.log(`Turns analyzed: ${analyzed}  Skipped: ${skipped}`);
  console.log(`Turns with diverging recruits: ${allDivergences.length} (${(100 * allDivergences.length / analyzed).toFixed(1)}%)`);

  // Per-card divergence table.
  const allCards = new Set([...humanCounts.keys(), ...aiCounts.keys()]);
  const rows: Array<{ card: string; h: number; a: number; diff: number; humanIcVp: number; humanCost: number }> = [];
  for (const card of allCards) {
    const h = humanCounts.get(card) ?? 0;
    const a = aiCounts.get(card) ?? 0;
    // Look up the card data — handy context for interpreting the gap.
    let icVp = 0, cost = 0;
    // Try every (deck, slot) combination via lookupCard — best-effort. Could be slow, but
    // there are <200 distinct cards. Cache once per script run.
    const found = lookupByName(card);
    if (found) { icVp = found.innerCircleVp ?? 0; cost = found.cost ?? 0; }
    rows.push({ card, h, a, diff: h - a, humanIcVp: icVp, humanCost: cost });
  }
  rows.sort((a, b) => b.diff - a.diff);

  console.log(`\n=== Cards HUMANS buy more than AI (top ${args.topN}) ===`);
  console.log(`(name, human_picks, ai_picks, diff, cost, IC_VP)`);
  for (const r of rows.slice(0, args.topN)) {
    if (r.diff <= 0) break;
    console.log(`  ${r.card.padEnd(28)}  h=${r.h.toString().padStart(3)}  a=${r.a.toString().padStart(3)}  diff=+${r.diff.toString().padStart(3)}  cost=${r.humanCost}  IC=${r.humanIcVp}`);
  }

  rows.sort((a, b) => a.diff - b.diff);
  console.log(`\n=== Cards AI buys more than humans (top ${args.topN}) ===`);
  for (const r of rows.slice(0, args.topN)) {
    if (r.diff >= 0) break;
    console.log(`  ${r.card.padEnd(28)}  h=${r.h.toString().padStart(3)}  a=${r.a.toString().padStart(3)}  diff=${r.diff.toString().padStart(4)}  cost=${r.humanCost}  IC=${r.humanIcVp}`);
  }

  // Print a few concrete divergence cases — illustrates the "what was in
  // market, what did each pick, given how much influence."
  console.log(`\n=== Sample turn-level divergences (first 10) ===`);
  for (const d of allDivergences.slice(0, 10)) {
    console.log(`\n[${d.file}] turn ${d.turn} P${Number(d.pid) + 1}: influence=${d.influence}`);
    console.log(`  market: [${d.marketAtStart.join(', ')}]`);
    console.log(`  human:  [${d.humanRecruits.join(', ') || '(none)'}]`);
    console.log(`  AI:     [${d.aiRecruits.join(', ') || '(none)'}]`);
  }
}

// Lookup card by display name — small caching wrapper since cards have
// human-readable names but we want their (deck, slot) row in card-data.
import data from '../assets/card-data.json';
let NAME_INDEX: Map<string, { cost: number; innerCircleVp: number }> | null = null;
function lookupByName(name: string): { cost: number; innerCircleVp: number } | null {
  if (!NAME_INDEX) {
    NAME_INDEX = new Map();
    for (const [, c] of Object.entries(data as Record<string, { name: string; cost: number; innerCircleVp: number }>)) {
      if (!NAME_INDEX.has(c.name)) NAME_INDEX.set(c.name, { cost: c.cost ?? 0, innerCircleVp: c.innerCircleVp ?? 0 });
    }
  }
  return NAME_INDEX.get(name) ?? null;
}
// Suppress unused-var warning for lookupCard (kept imported for parity with replay-divergence).
void lookupCard;

await main();

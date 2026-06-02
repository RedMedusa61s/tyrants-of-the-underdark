// Validation harness for tyrantsAdapter (Phase 1).
//
// 1. RandomAI-vs-RandomAI rollouts THROUGH THE ADAPTER. Asserts: never throws,
//    never deadlocks (legalActions non-empty until game over), terminates, and
//    result() is non-null at the end.
// 2. Replay determinism: same seeded game played twice through the adapter ->
//    identical final snapshots (the RNG-in-snapshot guarantee).
//
// Run: npx vite-node scripts/adapter-rollout.ts

import { InitializeGame } from 'boardgame.io/internal';
import { Rng, jsonCodec } from 'digital-boardgame-framework';
import { TyrantsGame } from '../src/game';
import {
  tyrantsAdapter as adapter,
  type BgioState,
  type TyrantsAction,
} from '../src/adapter/tyrantsAdapter';

const codec = jsonCodec<BgioState>();

/** Build a deterministic initial bgio state by pinning the bgio random seed.
 *  Without a fixed seed, bgio auto-generates one per InitializeGame and replays
 *  would diverge. Pinning `seed` on the Game def lands it in the random plugin's
 *  serialized data inside the snapshot. */
function initialState(bgioSeed: string, numPlayers: number): BgioState {
  const seededGame = {
    ...TyrantsGame,
    seed: bgioSeed,
    setup: (sa: Parameters<NonNullable<typeof TyrantsGame.setup>>[0]) =>
      TyrantsGame.setup!(sa, { halfDecks: ['drow', 'dragons'] }),
  };
  return InitializeGame({ game: seededGame, numPlayers }) as unknown as BgioState;
}

/** Play a full game through the adapter using a seeded RandomAI for move choice.
 *  Returns the final state and a step count. Throws on any adapter violation. */
function playGame(bgioSeed: string, aiSeed: number, numPlayers: number): { state: BgioState; steps: number } {
  let state = initialState(bgioSeed, numPlayers);
  const rng = new Rng(aiSeed);
  let steps = 0;
  const MAX_STEPS = 20000;

  while (adapter.currentActor(state) !== null) {
    if (steps++ > MAX_STEPS) throw new Error(`game did not terminate within ${MAX_STEPS} steps`);
    const actor = adapter.currentActor(state)!;
    const legal: TyrantsAction[] = adapter.legalActions(state, actor);
    if (legal.length === 0) {
      throw new Error(`DEADLOCK: no legal actions for actor ${actor} at step ${steps} ` +
        `(turn ${state.ctx.turn}, setup=${state.G.setupPhase}, pending=${state.G.pendingChoice?.kind ?? 'none'})`);
    }
    const action = rng.pick(legal);
    // Exercise tryApplyAction as the submit gate, then applyAction.
    const probe = adapter.tryApplyAction!(state, action, actor);
    if (!probe.ok) {
      throw new Error(`tryApplyAction rejected a legalActions() action: ${JSON.stringify(action)} — ${probe.reason}`);
    }
    const next = adapter.applyAction(state, action, actor);
    // tryApplyAction and applyAction must agree.
    if (codec.encode(next) !== codec.encode(probe.state)) {
      throw new Error(`tryApplyAction and applyAction disagree on ${JSON.stringify(action)}`);
    }
    state = next;
  }

  const res = adapter.result!(state);
  if (res === null) throw new Error('result() returned null at game over');
  return { state, steps };
}

// --- 1. Rollouts ---
const N_GAMES = 30;
console.log(`Running ${N_GAMES} RandomAI-vs-RandomAI games through the adapter...`);
let totalSteps = 0;
for (let i = 0; i < N_GAMES; i++) {
  const numPlayers = 2 + (i % 3); // 2,3,4 players cycling
  const { state, steps } = playGame(`bgio-seed-${i}`, 1000 + i, numPlayers);
  totalSteps += steps;
  const res = adapter.result!(state)!;
  if (i < 5 || i === N_GAMES - 1) {
    console.log(`  game ${i} (${numPlayers}p): ${steps} steps, winners=[${res.winners.join(',')}] (${res.reason})`);
  }
}
console.log(`OK: ${N_GAMES} games, ${totalSteps} total steps, none threw / deadlocked, all resolved.`);

// --- 2. Replay determinism ---
console.log('\nReplay determinism: same seeds twice -> identical final snapshots...');
let allDet = true;
for (let i = 0; i < 5; i++) {
  const a = playGame(`det-seed-${i}`, 5000 + i, 2 + (i % 3));
  const b = playGame(`det-seed-${i}`, 5000 + i, 2 + (i % 3));
  const ea = codec.encode(a.state);
  const eb = codec.encode(b.state);
  const same = ea === eb && a.steps === b.steps;
  console.log(`  replay ${i}: steps ${a.steps}/${b.steps}, final snapshot identical: ${same}`);
  if (!same) allDet = false;
}

// --- 3. viewFor redaction spot-checks ---
console.log('\nviewFor redaction spot-checks...');
{
  const s = initialState('view-seed', 4);
  const v0 = adapter.viewFor(s, '0');
  const spec = adapter.viewFor(s, null);
  const checks: Array<[string, boolean]> = [];
  // Own hand visible to viewer 0.
  checks.push(['viewer 0 sees own hand', v0.G.players['0'].hand.every(c => c.deck !== '__hidden__')]);
  // Opponent hand hidden from viewer 0.
  checks.push(['viewer 0 cannot see P1 hand', v0.G.players['1'].hand.every(c => c.deck === '__hidden__')]);
  // Hand counts preserved (honest redaction).
  checks.push(['P1 hand count preserved', v0.G.players['1'].hand.length === s.G.players['1'].hand.length]);
  // Every player's draw deck hidden, count preserved.
  checks.push(['own deck order hidden', v0.G.players['0'].deck.every(c => c.deck === '__hidden__')]);
  checks.push(['deck count preserved', v0.G.players['0'].deck.length === s.G.players['0'].deck.length]);
  // Market deck hidden, count preserved.
  checks.push(['market deck hidden', v0.G.market.deck.every(c => c.deck === '__hidden__')]);
  checks.push(['market deck count preserved', v0.G.market.deck.length === s.G.market.deck.length]);
  // Market row (face-up) public.
  checks.push(['market row visible', v0.G.market.row.every(c => c === null || c.deck !== '__hidden__')]);
  // Spectator sees no hands.
  checks.push(['spectator sees no hands', Object.values(spec.G.players).every(p => p.hand.every(c => c.deck === '__hidden__'))]);
  // undoStack / snapshots stripped.
  checks.push(['undoStack stripped', v0.G.undoStack.length === 0]);
  checks.push(['snapshots stripped', v0.G.snapshots.length === 0]);
  // ctx / plugins ride along (still a valid full state for the viewer).
  checks.push(['view keeps ctx', !!v0.ctx]);
  checks.push(['view keeps plugins', !!(v0 as { plugins?: unknown }).plugins]);
  // Original state untouched by viewFor (purity).
  checks.push(['viewFor did not mutate original', s.G.players['1'].hand.every(c => c.deck !== '__hidden__')]);

  for (const [label, pass] of checks) {
    console.log(`  ${pass ? 'OK ' : 'FAIL'} ${label}`);
    if (!pass) allDet = false;
  }
}

// --- 3b. pendingChoice redaction: owner sees it, non-owner does NOT (Bug 1) ---
console.log('\npendingChoice redaction (hidden-info-leak class)...');
{
  const s = initialState('pc-seed', 4);
  // Inject a peek-style pending choice OWNED by player '0' carrying options +
  // a leaky prompt. viewFor must keep it whole for '0', strip payload for '1'.
  s.G.pendingChoice = {
    kind: 'select-card-in-hand',
    prompt: 'Discard the Drow Soldier you just drew',
    options: [0, 1, 2],
    response: undefined,
    playerId: '0',
    cardKey: 'drow::5',
  } as unknown as typeof s.G.pendingChoice;

  const owner = adapter.viewFor(s, '0');
  const other = adapter.viewFor(s, '1');

  const pcChecks: Array<[string, boolean]> = [];
  // Owner keeps the full choice (kind, prompt, options).
  pcChecks.push(['owner keeps options', JSON.stringify(owner.G.pendingChoice?.options) === JSON.stringify([0, 1, 2])]);
  pcChecks.push(['owner keeps prompt', owner.G.pendingChoice?.prompt === 'Discard the Drow Soldier you just drew']);
  // Non-owner: options/payload/prompt fully stripped, only { kind, playerId } survive.
  pcChecks.push(['non-owner has NO options', other.G.pendingChoice?.options === undefined]);
  pcChecks.push(['non-owner prompt redacted', !other.G.pendingChoice?.prompt]);
  pcChecks.push(['non-owner cardKey blanked', !(other.G.pendingChoice as { cardKey?: string } | null)?.cardKey]);
  pcChecks.push(['non-owner has no response', (other.G.pendingChoice as { response?: unknown } | null)?.response === undefined]);
  // Indicator-grade fields survive so UI can show "opponent is choosing…".
  pcChecks.push(['non-owner keeps playerId', other.G.pendingChoice?.playerId === '0']);
  pcChecks.push(['non-owner keeps kind', other.G.pendingChoice?.kind === 'select-card-in-hand']);
  // Original state untouched.
  pcChecks.push(['viewFor did not mutate pendingChoice', JSON.stringify(s.G.pendingChoice?.options) === JSON.stringify([0, 1, 2])]);

  for (const [label, pass] of pcChecks) {
    console.log(`  ${pass ? 'OK ' : 'FAIL'} ${label}`);
    if (!pass) allDet = false;
  }
}

console.log('\n==== RESULT:', allDet ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED', '====');
process.exit(allDet ? 0 : 1);

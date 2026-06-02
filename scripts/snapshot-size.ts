// Measure the persisted-snapshot size win from snapshotCodec vs jsonCodec.
//
// Plays a seeded RandomAI game to a mid-to-late-game state, then prints the
// encoded snapshot size (bytes) under the framework jsonCodec (full state,
// including undoStack + in-state snapshots) vs the stripping snapshotCodec.
// Also breaks down the size contribution of log / turnLogs so we can justify
// leaving them intact.
//
// Run: npm run snapshot-size  (vite-node, from project root)

import { InitializeGame } from 'boardgame.io/internal';
import { Rng, jsonCodec } from 'digital-boardgame-framework';
import { TyrantsGame } from '../src/game';
import { tyrantsAdapter as adapter, type BgioState } from '../src/adapter/tyrantsAdapter';
import { snapshotCodec } from '../src/online/snapshotCodec';

function initialState(seed: string, numPlayers: number): BgioState {
  const seededGame = {
    ...TyrantsGame,
    seed,
    setup: (sa: Parameters<NonNullable<typeof TyrantsGame.setup>>[0]) =>
      TyrantsGame.setup!(sa, { halfDecks: ['drow', 'dragons'] }),
  };
  return InitializeGame({ game: seededGame, numPlayers }) as unknown as BgioState;
}

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
const kb = (n: number) => (n / 1024).toFixed(1) + ' KB';

// Play roughly to the target turn so undoStack (seat 0) + snapshots have grown.
function playToTurn(seed: string, aiSeed: number, numPlayers: number, targetTurn: number): BgioState {
  let state = initialState(seed, numPlayers);
  const rng = new Rng(aiSeed);
  let steps = 0;
  while (adapter.currentActor(state) !== null && steps++ < 20000) {
    if (state.ctx.turn >= targetTurn && !state.G.setupPhase && !state.G.pendingChoice) break;
    const actor = adapter.currentActor(state)!;
    const legal = adapter.legalActions(state, actor);
    if (legal.length === 0) break;
    state = adapter.applyAction(state, rng.pick(legal), actor);
  }
  return state;
}

const full = jsonCodec<BgioState>();
const strip = snapshotCodec();

console.log('Snapshot size: jsonCodec (full) vs snapshotCodec (stripped)\n');

for (const target of [10, 20, 30]) {
  const state = playToTurn('size-seed', 4242, 4, target);
  const fullEnc = full.encode(state);
  const stripEnc = strip.encode(state);

  // Component breakdown (rough — measured as standalone JSON of each field).
  const undoBytes = bytes(JSON.stringify(state.G.undoStack ?? []));
  const snapsBytes = bytes(JSON.stringify(state.G.snapshots ?? []));
  const logBytes = bytes(JSON.stringify(state.G.log ?? []));
  const turnLogsBytes = bytes(JSON.stringify(state.G.turnLogs ?? []));

  const fb = bytes(fullEnc);
  const sb = bytes(stripEnc);
  console.log(`-- reached turn ${state.ctx.turn} (target ${target}) --`);
  console.log(`  full (jsonCodec):     ${kb(fb)}  (${fb} bytes)`);
  console.log(`  stripped:             ${kb(sb)}  (${sb} bytes)`);
  console.log(`  reduction:            ${(100 * (1 - sb / fb)).toFixed(1)}%  (saved ${kb(fb - sb)})`);
  console.log(`  component sizes in G: undoStack=${kb(undoBytes)}  snapshots=${kb(snapsBytes)}  log=${kb(logBytes)}  turnLogs=${kb(turnLogsBytes)}`);

  // Decode-restores-defaults sanity.
  const dec = strip.decode(stripEnc);
  const okArrays = Array.isArray(dec.G.undoStack) && Array.isArray(dec.G.snapshots)
    && dec.G.undoStack.length === 0 && dec.G.snapshots.length === 0;
  console.log(`  decode restores empty arrays: ${okArrays}\n`);
}

console.log('Done.');

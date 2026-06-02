// THROWAWAY: verify the Option-A core assumption — that the FULL bgio state
// ({G, ctx, plugins, ...}) round-trips through jsonCodec intact, especially
// ctx and the random plugin's seed/state. If this fails, Option A is dead.

import { CreateGameReducer, InitializeGame } from 'boardgame.io/internal';
import { jsonCodec } from 'digital-boardgame-framework';
import { TyrantsGame } from '../src/game';

const wrappedGame = {
  ...TyrantsGame,
  setup: (sa: Parameters<NonNullable<typeof TyrantsGame.setup>>[0]) =>
    TyrantsGame.setup!(sa, { halfDecks: ['drow', 'dragons'] }),
};

const reducer = CreateGameReducer({ game: wrappedGame }) as unknown as (s: any, a: any) => any;
const fresh = InitializeGame({ game: wrappedGame, numPlayers: 4 }) as any;

const codec = jsonCodec<any>();

function checkRoundtrip(label: string, state: any) {
  const enc = codec.encode(state);
  const dec = codec.decode(enc);
  const reEnc = codec.encode(dec);
  const stable = enc === reEnc;
  // Deep-equality via canonical JSON of the original-vs-decoded.
  const equal = JSON.stringify(state) === JSON.stringify(dec);
  console.log(`\n[${label}]`);
  console.log('  encode->decode->encode stable:', stable);
  console.log('  state === decoded (JSON):', equal);
  console.log('  has ctx:', !!dec.ctx, '| has plugins:', !!dec.plugins);
  // Inspect the random plugin specifically.
  const randBefore = state.plugins?.random?.data ?? state._random ?? state.ctx?._random;
  const randAfter = dec.plugins?.random?.data ?? dec._random ?? dec.ctx?._random;
  console.log('  random plugin data (before):', JSON.stringify(randBefore));
  console.log('  random plugin data (after): ', JSON.stringify(randAfter));
  console.log('  random plugin survived:', JSON.stringify(randBefore) === JSON.stringify(randAfter));
  console.log('  ctx.currentPlayer:', dec.ctx?.currentPlayer, '| ctx.turn:', dec.ctx?.turn, '| numPlayers:', dec.ctx?.numPlayers);
  return equal && stable;
}

console.log('Top-level keys of fresh bgio state:', Object.keys(fresh));
let ok = checkRoundtrip('fresh initial state', fresh);

// Now make a move so the random plugin advances + pendingChoice/turn machinery changes,
// then round-trip and replay to prove determinism survives serialization.
const mkAction = (type: string, args: any[], pid: string) =>
  ({ type: 'MAKE_MOVE', payload: { type, args, playerID: pid } });

// Determinism: round-trip the fresh state, then advance setup on original vs
// decoded by trying each starting site; assert identical resulting full states.
import { SITES } from '../src/data/sites';

function advanceSetup(state: any): any {
  let st = state;
  let g = 0;
  while (st.G.setupPhase && g++ < 30) {
    const pid = st.ctx.currentPlayer;
    // try each starting site until the move takes
    let moved = false;
    for (const site of SITES) {
      if (!(site as any).isStartingSite) continue;
      const next = reducer(st, mkAction('deployStartingTroop', [site.id], pid));
      if (next !== st && next.G !== st.G) { st = next; moved = true; break; }
    }
    if (!moved) break;
  }
  return st;
}

const decFresh = codec.decode(codec.encode(fresh));
const a = advanceSetup(fresh);
const b = advanceSetup(decFresh);
const detEqual = JSON.stringify(a) === JSON.stringify(b);
console.log('\n[determinism through serialization]');
console.log('  setup-advanced original === setup-advanced(decoded):', detEqual);
ok = ok && detEqual;

checkRoundtrip('post-setup state', a);

console.log('\n==== RESULT:', ok ? 'ROUND-TRIP OK — Option A viable' : 'ROUND-TRIP FAILED', '====');
process.exit(ok ? 0 : 1);

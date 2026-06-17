// Regression test for #81 / #82: "AI player is performing actions in the
// OUT OF PLAY zone." In 2P games only the center board section is in play; in
// 3P it's center + one outer. Per setup, only spaces in active sections are
// keys in G.troops — out-of-play sites, AND the routes connecting an active
// site to an inactive one (e.g. stoneshaft-skullport), are absent entirely.
//
// The deploy paths checked occupancy with a falsy test (`if (G.troops[id])
// continue`) and presence, but never that the space was in play. Since an
// out-of-play space reads back `undefined`, it looked "empty"; presence could
// reach it across a connecting route; and map-state.deployTroop then ADDED a
// brand-new key, quietly extending the live board into the unused sections.
// The fix gates every deploy on `spaceId in G.troops` at three layers
// (mutation, base move, AI candidate lists).
import { CreateGameReducer, InitializeGame } from 'boardgame.io/internal';
import { TyrantsGame, type TyrantsState } from '../src/game';
import { deployTroop } from '../src/engine/map-state';
import { decideHeuristicMove } from '../src/ai/heuristic-ai';
import { TROOP_SPACES } from '../src/data/troop-spaces';

type BgState = { G: TyrantsState; ctx: { currentPlayer: string; turn: number; gameover?: unknown } };
type Reducer = (s: BgState, a: unknown) => BgState;
const action = (type: string, args: unknown[], playerID: string) => ({
  type: 'MAKE_MOVE', payload: { type, args, playerID },
});

let ok = true;
const check = (label: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) ok = false;
};

// 2P game limited to the center section (what the live client does for ≤2 players).
const centerGame = {
  ...TyrantsGame,
  setup: (sa: Parameters<NonNullable<typeof TyrantsGame.setup>>[0]) =>
    TyrantsGame.setup!(sa, { activeSections: ['center'] }),
};
const reducer = CreateGameReducer({ game: centerGame as never }) as unknown as Reducer;
const freshState = () => InitializeGame({ game: centerGame as never, numPlayers: 2 }) as unknown as BgState;

// A space that exists in the data but is out of play in a center-only game.
// stoneshaft-skullport bridges active skullport to out-of-play stoneshaft — it
// is exactly the path the #82 reporter called out.
const OUT_OF_PLAY_IDS = ['stoneshaft-skullport:0', 'stoneshaft-skullport:1', 'stoneshaft:0', 'buiyrandyn:0'];

// 1. Setup invariant: out-of-play spaces are absent from G.troops.
{
  const { G } = freshState();
  const known = OUT_OF_PLAY_IDS.filter(id => TROOP_SPACES.some(t => t.id === id));
  check('test ids reference real spaces in the data', known.length === OUT_OF_PLAY_IDS.length);
  check('out-of-play spaces are absent from G.troops at setup',
    OUT_OF_PLAY_IDS.every(id => !(id in G.troops)));
}

// 2. map-state.deployTroop refuses an out-of-play space and adds no key.
{
  const { G } = freshState();
  const color = G.players['0'].color;
  const before = Object.keys(G.troops).length;
  const placed = deployTroop(G, color, 'stoneshaft-skullport:1');
  check('deployTroop() returns false for an out-of-play space', placed === false);
  check('deployTroop() did NOT add a key for the out-of-play space',
    !('stoneshaft-skullport:1' in G.troops) && Object.keys(G.troops).length === before);
}

// 3. The base deploy MOVE rejects an out-of-play target without side effects
//    (no spent power, no minted VP), even when barracks is empty.
{
  let state = freshState();
  // Fast-forward through setup by letting the AI play until seat 0's clean turn.
  let guard = 0;
  while (guard++ < 4000) {
    const { G, ctx } = state;
    if (!G.setupPhase && ctx.currentPlayer === '0' && !G.pendingChoice) break;
    const pid = ctx.currentPlayer;
    const mv = decideHeuristicMove(G, pid);
    state = mv ? reducer(state, action(mv.name, (mv.args as unknown[]) ?? [], pid))
               : reducer(state, action('endTurn', [], pid));
  }
  // Hand seat 0 power and an empty barracks to exercise the deploy→VP branch.
  // The reducer returns immer-frozen state, so clone before mutating.
  const primed = structuredClone(state);
  primed.G.players['0'].power = 3;
  primed.G.players['0'].barracksLeft = 0;
  primed.G.players['0'].vp = 0;
  const next = reducer(primed, action('deployTroop', ['stoneshaft-skullport:1'], '0'));
  check('base move leaves power unchanged on out-of-play deploy', next.G.players['0'].power === 3);
  check('base move mints no VP on out-of-play deploy (barracks empty)', next.G.players['0'].vp === 0);
  check('base move adds no out-of-play key', !('stoneshaft-skullport:1' in next.G.troops));
}

// 4. End-to-end: drive a full center-only game with the heuristic AI (the style
//    in the reports) and assert the live board NEVER grows beyond its initial
//    active spaces — i.e. no troop ever lands out of play.
{
  let state = freshState();
  const activeKeys = new Set(Object.keys(state.G.troops));
  let leaked: string | null = null;
  let guard = 0;
  while (guard++ < 8000 && !state.ctx.gameover) {
    const { G, ctx } = state;
    const pid = ctx.currentPlayer;
    const mv = decideHeuristicMove(G, pid);
    state = mv ? reducer(state, action(mv.name, (mv.args as unknown[]) ?? [], pid))
               : reducer(state, action('endTurn', [], pid));
    for (const id of Object.keys(state.G.troops)) {
      if (!activeKeys.has(id)) { leaked = id; break; }
    }
    if (leaked) break;
  }
  check('heuristic AI never deploys/leaks a troop into an out-of-play space',
    leaked === null);
  if (leaked) console.log(`   leaked space: ${leaked}`);
}

console.log(ok ? '\nALL DEPLOY-OUT-OF-PLAY TESTS PASSED' : '\nTESTS FAILED');
process.exit(ok ? 0 : 1);

// Regression test for #78: "Multiplayer game not ending when it should, no
// troops left." The end-of-game trigger (a player empties their barracks, or
// the market deck runs out) was only checked inside the deployTroop and
// recruitFromMarket MOVES. But barracks also empty via CARD EFFECTS (the
// deployChoice handler — Gibbering Mouther, supplants, etc.), which never route
// through the deploy move; and once barracks is already 0 the deploy move
// early-returns (deploy → +1 VP) before its trigger check. So a game could run
// forever with a player at zero troops. The fix re-checks the trigger in
// turn.onEnd, so it fires by the end of whatever turn the barracks empties on.
import { CreateGameReducer, InitializeGame } from 'boardgame.io/internal';
import { TyrantsGame, type TyrantsState } from '../src/game';
import { decideAiMove } from '../src/ai/random-ai';

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

const reducer = CreateGameReducer({ game: TyrantsGame as never }) as unknown as Reducer;

// Drive random play until it's seat 0's clean turn (setup complete, no prompt).
function toCleanSeat0(): BgState {
  let state = InitializeGame({ game: TyrantsGame as never, numPlayers: 2 }) as unknown as BgState;
  let guard = 0;
  while (guard++ < 5000) {
    const { G, ctx } = state;
    if (!G.setupPhase && ctx.currentPlayer === '0' && !G.pendingChoice) break;
    const pid = ctx.currentPlayer;
    const mv = decideAiMove(G, pid);
    state = mv ? reducer(state, action(mv.name, (mv.args as unknown[]) ?? [], pid))
               : reducer(state, action('endTurn', [], pid));
  }
  return state;
}

// 1. Baseline — early in the game, with everyone holding troops and a full
//    market, the trigger has NOT fired.
{
  const state = toCleanSeat0();
  check('reached seat-0 clean turn', !state.G.setupPhase && state.ctx.currentPlayer === '0' && !state.G.pendingChoice);
  check('baseline: no end-game trigger early in the game', state.G.endGameTriggeredAtTurn === null);
}

// 2. The fix — simulate barracks emptying via a CARD EFFECT (set directly,
//    bypassing the deployTroop move entirely), then end the turn. onEnd's
//    safety-net check must fire the trigger. (bgio freezes reducer output, so
//    inject the empty barracks into a deep clone the reducer can read.)
{
  const clean = toCleanSeat0();
  check('pre: trigger unset before barracks empties', clean.G.endGameTriggeredAtTurn === null);
  const injected = structuredClone(clean) as BgState;
  injected.G.players['0'].barracksLeft = 0;   // a card-effect deploy drained the last troop
  const state = reducer(injected, action('endTurn', [], '0'));
  check('end-game trigger fires at turn end when a player has 0 troops',
    state.G.endGameTriggeredAtTurn !== null);
}

// 3. The game actually ENDS after the trigger round completes. From the trigger
//    state, play it out with random moves and confirm ctx.gameover is set.
{
  const clean = toCleanSeat0();
  const injected = structuredClone(clean) as BgState;
  injected.G.players['0'].barracksLeft = 0;
  let state = reducer(injected, action('endTurn', [], '0'));
  let guard = 0;
  while (guard++ < 5000 && !state.ctx.gameover) {
    const { G, ctx } = state;
    const pid = ctx.currentPlayer;
    const mv = decideAiMove(G, pid);
    state = mv ? reducer(state, action(mv.name, (mv.args as unknown[]) ?? [], pid))
               : reducer(state, action('endTurn', [], pid));
  }
  check('game reaches gameover after the trigger round finishes', !!state.ctx.gameover);
}

console.log(ok ? '\nALL ENDGAME-TRIGGER TESTS PASSED' : '\nTESTS FAILED');
process.exit(ok ? 0 : 1);

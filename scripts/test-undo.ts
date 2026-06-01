// Focused end-to-end test for the within-turn undo feature.
// Drives the real boardgame.io reducer (same as headless.ts) and asserts:
//   1. Undoable actions (playing a non-drawing card) push restore-points.
//   2. `undo` reverts state one step and shrinks the stack.
//   3. A hidden-info reveal (market refill on recruit) clears the stack (barrier).
import { CreateGameReducer, InitializeGame } from 'boardgame.io/internal';
import { TyrantsGame, type TyrantsState } from '../src/game';
import { decideAiMove } from '../src/ai/random-ai';

type BgState = { G: TyrantsState; ctx: { currentPlayer: string; gameover?: unknown } };
type Reducer = (s: BgState, a: unknown) => BgState;

const action = (type: string, args: unknown[], playerID: string) => ({
  type: 'MAKE_MOVE', payload: { type, args, playerID },
});

const reducer = CreateGameReducer({ game: TyrantsGame as never }) as unknown as Reducer;
let state = InitializeGame({ game: TyrantsGame as never, numPlayers: 4 }) as unknown as BgState;

let ok = true;
const check = (label: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) ok = false;
};

// Drive random AI until it's seat 0's clean turn (setup done, no pending prompt).
let guard = 0;
while (guard++ < 5000) {
  const { G, ctx } = state;
  if (!G.setupPhase && ctx.currentPlayer === '0' && !G.pendingChoice) break;
  const pid = ctx.currentPlayer;
  const mv = decideAiMove(G, pid);
  state = mv ? reducer(state, action(mv.name, (mv.args as unknown[]) ?? [], pid))
             : reducer(state, action('endTurn', [], pid));
}
check('reached seat-0 clean turn', !state.G.setupPhase && state.ctx.currentPlayer === '0' && !state.G.pendingChoice);

const G0 = state.G;
check('undo stack starts empty at turn start', (G0.undoStack?.length ?? 0) === 0);

// Find a Noble in hand (gain influence, no draw, no target → undoable, no prompt).
const nobleIdx = G0.players['0'].hand.findIndex(c => c.name === 'Noble');
check('have a Noble in hand', nobleIdx >= 0);

const inflBefore = G0.players['0'].influence;
const handLenBefore = G0.players['0'].hand.length;

// 1. Play a Noble → stack grows, influence up, no pending prompt.
state = reducer(state, action('playCard', [nobleIdx], '0'));
check('playing Noble pushed 1 undo point', state.G.undoStack.length === 1);
check('influence increased after Noble', state.G.players['0'].influence > inflBefore);
check('no pending prompt after Noble', !state.G.pendingChoice);

// Play a second Noble if present.
const noble2 = state.G.players['0'].hand.findIndex(c => c.name === 'Noble');
if (noble2 >= 0) {
  state = reducer(state, action('playCard', [noble2], '0'));
  check('second Noble → 2 undo points', state.G.undoStack.length === 2);
}

const inflPeak = state.G.players['0'].influence;
const stackPeak = state.G.undoStack.length;

// 2. Undo once → stack shrinks by 1, influence drops, a card returns to hand.
state = reducer(state, action('undo', [], '0'));
check('undo shrank stack by 1', state.G.undoStack.length === stackPeak - 1);
check('undo lowered influence', state.G.players['0'].influence < inflPeak);
check('undo returned a card to hand', state.G.players['0'].hand.length > handLenBefore - stackPeak);

// Undo all the way back.
while (state.G.undoStack.length > 0) state = reducer(state, action('undo', [], '0'));
check('fully undone → influence back to turn start', state.G.players['0'].influence === inflBefore);
check('fully undone → hand restored', state.G.players['0'].hand.length === handLenBefore);

// 3. Reveal barrier: build up influence, then recruit from the market (refill reveals a card).
//    Replay Nobles to afford something, then buy the cheapest affordable row card.
let replayGuard = 0;
while (replayGuard++ < 10) {
  const i = state.G.players['0'].hand.findIndex(c => c.name === 'Noble' || c.name === 'Soldier');
  if (i < 0) break;
  state = reducer(state, action('playCard', [i], '0'));
}
const stackAfterReplays = state.G.undoStack.length;
check('replays built an undo stack again', stackAfterReplays > 0);

const infl = state.G.players['0'].influence;
const rowAfford = state.G.market.row.findIndex(c => !!c); // any card; affordability checked by move
// Find a row card we can afford by cost lookup is overkill here; try each until one succeeds.
let bought = false;
for (let i = 0; i < state.G.market.row.length; i++) {
  if (!state.G.market.row[i]) continue;
  const before = state.G.players['0'].discard.length;
  const next = reducer(state, action('recruitFromMarket', [i], '0'));
  if (next.G.players['0'].discard.length > before) { state = next; bought = true; break; }
}
check('was able to buy a market card', bought);
check('market recruit cleared the undo stack (reveal barrier)', state.G.undoStack.length === 0);
void rowAfford; void infl;

console.log(ok ? '\nALL UNDO TESTS PASSED' : '\nUNDO TESTS FAILED');
process.exit(ok ? 0 : 1);

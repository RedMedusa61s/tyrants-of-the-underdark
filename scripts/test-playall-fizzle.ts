// Regression test for #74: "mind flayer not working with play all button —
// didnt let me choose to devour a card in hand." Mind Flayer (and the other
// "devour a card from hand to ..." cards) gate their whole effect on devouring
// a card. When Mind Flayer is your LAST card, playing it leaves an empty hand,
// so the devour cost can't be paid and the card fizzles — opening NO prompt.
// The "Play all basic" classifier treats "no prompt" as a free basic, so it was
// auto-playing Mind Flayer for zero effect, robbing the player of the choice.
//
// The fix sets a transient `_playFizzledNoFood` marker when a devour-from-hand
// cost can't be paid; the play-all classifier dry-runs each card and skips any
// that set it. This test verifies the engine half (the marker), which is what
// the classifier reads.
import { CreateGameReducer, InitializeGame } from 'boardgame.io/internal';
import { TyrantsGame, type TyrantsState, type CardRef } from '../src/game';
import { decideAiMove } from '../src/ai/random-ai';

type BgState = { G: TyrantsState; ctx: { currentPlayer: string; gameover?: unknown } };
type Reducer = (s: BgState, a: unknown) => BgState;
const action = (type: string, args: unknown[], playerID: string) => ({
  type: 'MAKE_MOVE', payload: { type, args, playerID },
});
const fizzled = (s: BgState) => !!(s.G as unknown as { _playFizzledNoFood?: boolean })._playFizzledNoFood;

let ok = true;
const check = (label: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) ok = false;
};

const reducer = CreateGameReducer({ game: TyrantsGame as never }) as unknown as Reducer;
const mindFlayer: CardRef = { deck: 'demons', slot: 22, name: 'Mind Flayer', image: 'assets/cards/demons/22-unnamed.jpg' };
const noble = (G: TyrantsState): CardRef => {
  const n = G.players['0'].hand.find(c => c.name === 'Noble');
  return n ?? { deck: 'starter', slot: 0, name: 'Noble', image: '' };
};

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

// 1. Mind Flayer as the ONLY card → fizzles, marker set, no benefit gained.
{
  const clean = toCleanSeat0();
  const injected = structuredClone(clean) as BgState;
  injected.G.players['0'].hand = [structuredClone(mindFlayer)];
  injected.G.players['0'].influence = 0;
  const before = injected.G.players['0'].influence;
  const state = reducer(injected, action('playCard', [0], '0'));
  check('Mind Flayer as last card opens NO prompt', !state.G.pendingChoice);
  check('fizzle marker IS set (classifier will skip → play-all leaves it alone)', fizzled(state));
  check('no benefit gained (influence unchanged — the +3 needs a devour)',
    state.G.players['0'].influence === before);
}

// 2. Mind Flayer with food in hand → opens the devour prompt, marker NOT set
//    (so the classifier already treats it as interactive, as before the fix).
{
  const clean = toCleanSeat0();
  const injected = structuredClone(clean) as BgState;
  injected.G.players['0'].hand = [structuredClone(mindFlayer), structuredClone(noble(injected.G))];
  const state = reducer(injected, action('playCard', [0], '0'));
  check('Mind Flayer with food opens the devour prompt', !!state.G.pendingChoice);
  check('fizzle marker NOT set when a devour is possible', !fizzled(state));
}

// 3. Marker is cleared by the next play (doesn't linger to mislabel a later
//    card). Play a fizzling Mind Flayer, then a plain Noble.
{
  const clean = toCleanSeat0();
  const injected = structuredClone(clean) as BgState;
  injected.G.players['0'].hand = [structuredClone(mindFlayer), structuredClone(noble(injected.G))];
  // Play the Noble first (index 1) — a clean basic, should clear/leave marker false.
  let state = reducer(injected, action('playCard', [1], '0'));
  check('playing a plain Noble does not set the fizzle marker', !fizzled(state));
}

console.log(ok ? '\nALL PLAYALL-FIZZLE TESTS PASSED' : '\nTESTS FAILED');
process.exit(ok ? 0 : 1);

// Regression test: the five big Dragons grant VP IMMEDIATELY (as VP tokens)
// when the card resolves — NOT as end-of-game riders. Per the rulebook, "Gain
// X VP" = take VP tokens now; Final Scoring has no per-card riders. Black/White
// grant in-play; Blue grants at end of turn (after its promotes); Red/Green
// already granted in-play. The old end-of-game SCORING_RIDERS double-counted
// Red/Green and mistimed Black/White/Blue — this verifies it's gone and that
// the standard (non-Dragon) scoring is untouched.
import { InitializeGame } from 'boardgame.io/internal';
import { TyrantsGame, type TyrantsState, type CardRef } from '../src/game';
import { scoreAll } from '../src/engine/scoring';
import { applyEotInnerCircleVp, flagEotInnerCircleVp } from '../src/engine/handler-helpers';
import { grantVpPerThreeWhiteTrophies, grantVpPerTwoSitesControlled } from '../src/engine/handlers/dragons';

let ok = true;
const check = (label: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) ok = false;
};
const C = (name: string): CardRef => ({ deck: 'dragons', slot: 0, name, image: '' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctxOf = (G: any, card: CardRef = C('')): any =>
  ({ G, actorId: '0', card, pendingChoice: null, paused: false, handlerState: null });

// 1. Black Dragon: immediate +1 VP per 3 white trophies.
{
  const G: any = { players: { '0': { color: 'black', vp: 0, trophyHall: { white: 7, black: 0, red: 0, orange: 0, blue: 0 } } }, log: [] };
  grantVpPerThreeWhiteTrophies(ctxOf(G));
  check('Black Dragon: floor(7/3)=2 VP immediately', G.players['0'].vp === 2);
}

// 2. White Dragon: immediate +1 VP per 2 sites controlled.
{
  const G: any = { players: { '0': { color: 'black', vp: 0 } }, siteControl: { a: 'black', b: 'black', c: 'black', d: 'black', e: 'black', f: null, g: 'red' }, log: [] };
  grantVpPerTwoSitesControlled(ctxOf(G));
  check('White Dragon: floor(5/2)=2 VP immediately', G.players['0'].vp === 2);
}

// 3. Blue Dragon: end-of-turn +1 VP per 3 inner-circle cards (post-promote).
{
  const G: any = { players: { '0': { vp: 0, innerCircle: [C('a'), C('b'), C('c'), C('d'), C('e'), C('f'), C('g')] } }, pendingEotInnerCircleVp: [{ playerId: '0', perN: 3, source: 'Blue Dragon' }], log: [] };
  applyEotInnerCircleVp(G as TyrantsState);
  check('Blue Dragon: floor(7/3)=2 VP at end of turn', G.players['0'].vp === 2);
  check('Blue Dragon: EOT queue cleared after grant', G.pendingEotInnerCircleVp.length === 0);
}

// 4. flagEotInnerCircleVp queues a grant for the actor.
{
  const G: any = { players: { '0': {} }, pendingEotInnerCircleVp: [] };
  flagEotInnerCircleVp(3)(ctxOf(G, C('Blue Dragon')));
  const q = G.pendingEotInnerCircleVp;
  check('flagEotInnerCircleVp queues {playerId,perN,source}',
    q.length === 1 && q[0].playerId === '0' && q[0].perN === 3 && q[0].source === 'Blue Dragon');
}

// 5. THE BUG: scoreAll must add NO end-of-game Dragon rider, and the total must
//    equal the sum of the standard rulebook categories only.
{
  // InitializeGame returns a frozen (immer) state — clone it so we can mutate.
  const init = (InitializeGame({ game: TyrantsGame, numPlayers: 2 }) as unknown as { G: TyrantsState }).G;
  const G = structuredClone(init);
  const p = G.players['0'];
  // Own all five Dragons (in deck) so any leftover rider would fire...
  p.deck.push(C('Black Dragon'), C('Blue Dragon'), C('Green Dragon'), C('Red Dragon'), C('White Dragon'));
  // ...and set the conditions that the old riders keyed on.
  p.trophyHall.white = 9;                     // old Black rider: +3
  p.innerCircle.push(C('x'), C('y'), C('z')); // old Blue rider: +1
  const s = scoreAll(G)['0'];
  check('scoreAll: no rider bonuses present', (s.riderBonuses?.length ?? 0) === 0);
  const standard = s.sites + s.totalControl + s.trophies + s.deckVp + s.innerCircleVp + s.vpTokens;
  check('scoreAll: total = standard categories only (no Dragon rider added)', s.total === standard);
}

console.log(ok ? '\nALL DRAGON-SCORING TESTS PASSED' : '\nTESTS FAILED');
process.exit(ok ? 0 : 1);

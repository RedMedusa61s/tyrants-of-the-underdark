// Regression test for #76: "if my deck becomes too small, i can infinitely draw
// cards over and over again." Root cause — cards you PLAY this turn live in your
// play area until end of turn, but the engine keeps them in `discard` for
// bookkeeping (also tracked by reference in `cardsPlayedThisTurn`). A mid-turn
// reshuffle (deck empty → shuffle discard back in) used to scoop those in-play
// cards up, so a freshly-played "draw" card could be reshuffled and drawn again
// and again on the same turn. The fix: exclude this-turn's plays from the
// reshuffle pool (by object identity), so they stay in front of you until the
// turn ends.
import { InitializeGame } from 'boardgame.io/internal';
import { Mechanics } from '../src/engine/mechanics';
import { TyrantsGame, type TyrantsState, type CardRef } from '../src/game';

let ok = true;
const check = (label: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) ok = false;
};

function freshGame(): TyrantsState {
  const init = (InitializeGame({ game: TyrantsGame as never, numPlayers: 2 }) as unknown as { G: TyrantsState }).G;
  return structuredClone(init);
}
const card = (name: string): CardRef => ({ deck: 'demons', slot: 99, name, image: '' });
// Deterministic RNG stand-in for Mechanics.draw (Fisher-Yates uses .Number()).
const rng = { Number: () => 0 };

// A. The infinite-draw guard. Deck empty; the ONLY thing in discard is the
//    card you just played this turn. Drawing must NOT reshuffle it back — it
//    stays in play, and you draw nothing.
{
  const G = freshGame();
  const p = G.players['0'];
  const played = card('Information Broker');
  p.deck = [];
  p.discard = [played];        // bookkeeping copy of the in-play card
  p.hand = [];
  G.cardsPlayedThisTurn = [played];   // SAME reference → it's in your play area

  Mechanics.draw(G, '0', 1, rng);
  check('A: nothing drawn — the in-play card is not reshuffled', p.hand.length === 0);
  check('A: the played card stays in the play area (still in discard)', p.discard.length === 1 && p.discard[0] === played);
  check('A: deck remains empty (no reshuffle happened)', p.deck.length === 0);
}

// B. Mixed pile. Discard has one genuinely-discarded card plus the in-play
//    card. A reshuffle should pull in ONLY the genuine discard; the in-play
//    card is left behind and cannot be drawn this turn.
{
  const G = freshGame();
  const p = G.players['0'];
  const played = card('Information Broker');
  const real = card('Noble');
  p.deck = [];
  p.discard = [played, real];
  p.hand = [];
  G.cardsPlayedThisTurn = [played];

  Mechanics.draw(G, '0', 1, rng);
  check('B: drew the genuinely-discarded card', p.hand.length === 1 && p.hand[0] === real);
  check('B: did NOT draw the in-play card', !p.hand.includes(played));
  check('B: the in-play card remains in discard/play area', p.discard.length === 1 && p.discard[0] === played);
}

// C. Control — with NOTHING marked as played this turn, the same small pile
//    reshuffles normally (proving the fix only excludes in-play cards, not all
//    reshuffles).
{
  const G = freshGame();
  const p = G.players['0'];
  const c = card('Noble');
  p.deck = [];
  p.discard = [c];
  p.hand = [];
  G.cardsPlayedThisTurn = [];

  Mechanics.draw(G, '0', 1, rng);
  check('C: with no in-play cards, the discard reshuffles and is drawn', p.hand.length === 1 && p.hand[0] === c);
  check('C: discard emptied by the reshuffle', p.discard.length === 0);
}

// D. Stress — repeatedly drawing when the deck+real-discard are exhausted and
//    only in-play cards remain must terminate (no infinite loop) and draw zero.
{
  const G = freshGame();
  const p = G.players['0'];
  const played = [card('Vrock'), card('Information Broker')];
  p.deck = [];
  p.discard = [...played];
  p.hand = [];
  G.cardsPlayedThisTurn = [...played];

  Mechanics.draw(G, '0', 10, rng);   // ask for far more than available
  check('D: drawing 10 from an all-in-play pile draws nothing', p.hand.length === 0);
  check('D: both in-play cards still parked in discard', p.discard.length === 2);
}

// E. ONLINE case (the real-world failure). The server serializes the whole
//    state to the store and back on every move (JSON), which does NOT preserve
//    shared object references: after a round-trip the played card in `discard`
//    is a DIFFERENT object than the one in `cardsPlayedThisTurn`. A
//    reference-based guard silently fails here and reshuffles the in-play card
//    back — the Information Broker infinite loop players actually hit online.
//    The guard must exclude by VALUE, so it survives serialization.
{
  const G0 = freshGame();
  const played = card('Information Broker');
  const real = card('Noble');
  // Distinct slots so value-matching is unambiguous for this case.
  const ib = { ...played, slot: 42 };
  const nb = { ...real, slot: 7 };
  G0.players['0'].deck = [];
  G0.players['0'].discard = [ib, nb];
  G0.players['0'].hand = [];
  G0.cardsPlayedThisTurn = [ib];

  // Simulate the store round-trip: references between discard and
  // cardsPlayedThisTurn are now broken, exactly as in online play.
  const G = JSON.parse(JSON.stringify(G0)) as TyrantsState;
  const p = G.players['0'];
  check('E: round-trip broke reference identity (reproduces the online bug)',
    p.discard[0] !== G.cardsPlayedThisTurn[0] &&
    p.discard[0].slot === G.cardsPlayedThisTurn[0].slot);

  Mechanics.draw(G, '0', 5, rng);   // ask for more than the one real card
  check('E: only the genuinely-discarded card is drawn', p.hand.length === 1 && p.hand[0].slot === 7);
  check('E: the played card is NOT redrawn after serialization', !p.hand.some(c => c.slot === 42));
  check('E: the played card stays parked in discard (no infinite loop)',
    p.discard.length === 1 && p.discard[0].slot === 42);
}

// F. ONLINE duplicates. Two copies of the same card played this turn, plus one
//    real copy in discard from an earlier turn — after a round-trip, exclude
//    exactly TWO by value and leave the third drawable.
{
  const dup = (slot: number) => ({ deck: 'demons', slot, name: 'House Guard', image: '' });
  const G0 = freshGame();
  G0.players['0'].deck = [];
  // same (deck,slot) for all three copies — the true duplicate case
  G0.players['0'].discard = [dup(5), dup(5), dup(5)];
  G0.players['0'].hand = [];
  G0.cardsPlayedThisTurn = [dup(5), dup(5)];   // two played this turn

  const G = JSON.parse(JSON.stringify(G0)) as TyrantsState;
  const p = G.players['0'];
  Mechanics.draw(G, '0', 5, rng);
  check('F: exactly one duplicate (the earlier-turn copy) is drawn', p.hand.length === 1);
  check('F: the two played-this-turn copies stay parked', p.discard.length === 2);
}

console.log(ok ? '\nALL INFINITE-DRAW TESTS PASSED' : '\nTESTS FAILED');
process.exit(ok ? 0 : 1);

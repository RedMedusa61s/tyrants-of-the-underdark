// Regression test for #73: "view deck is bugged i think - cant see the cards."
// In online games the server redacts state per seat. It used to blank out EVERY
// player's draw deck — including the viewer's OWN deck — so the pile inspector's
// "view deck" rendered a stack of face-down backs with no card identities. A
// player can already derive their own deck's contents from public piles; only
// the draw ORDER is secret. The fix: a viewer sees their own deck's contents,
// sent SORTED so the next-draw order isn't leaked; opponents' decks stay fully
// hidden.
import { InitializeGame } from 'boardgame.io/internal';
import { tyrantsAdapter } from '../src/adapter/tyrantsAdapter';
import { TyrantsGame, type TyrantsState } from '../src/game';

let ok = true;
const check = (label: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) ok = false;
};

const HIDDEN = '__hidden__';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hiddenCount = (cards: any[]) => cards.filter(c => c && c.deck === HIDDEN).length;

// A real post-init bgio state (setup phase, but decks are already dealt).
const state = InitializeGame({ game: TyrantsGame as never, numPlayers: 2 }) as unknown as
  { G: TyrantsState; ctx: unknown };

const v0 = tyrantsAdapter.viewFor(state as never, '0' as never) as unknown as { G: TyrantsState };
const p0 = v0.G.players['0'];   // viewer's own deck
const p1 = v0.G.players['1'];   // opponent deck, as seen by seat 0

check('seat 0 sees its OWN deck contents (no blank backs)', p0.deck.length > 0 && hiddenCount(p0.deck) === 0);

const keys = p0.deck.map(c => `${c.deck}:${c.slot}:${c.name}`);
const sorted = [...keys].sort();
check('own deck is sent SORTED (draw order not leaked)', JSON.stringify(keys) === JSON.stringify(sorted));

check('opponent deck stays FULLY hidden to seat 0', p1.deck.length > 0 && hiddenCount(p1.deck) === p1.deck.length);

// A spectator (viewer = null) must not see anyone's deck contents.
const vNull = tyrantsAdapter.viewFor(state as never, null as never) as unknown as { G: TyrantsState };
check('spectator sees seat 0 deck hidden',
  hiddenCount(vNull.G.players['0'].deck) === vNull.G.players['0'].deck.length);

console.log(ok ? '\nALL OWN-DECK-VISIBLE TESTS PASSED' : '\nTESTS FAILED');
process.exit(ok ? 0 : 1);

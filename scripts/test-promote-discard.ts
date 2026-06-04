// Regression test for #65: promote-from-discard (Matron Mother / Necromancer)
// must NOT offer cards played this turn — those sit in the play area, not the
// discard pile, even though the engine pushes them into `discard` during the
// turn. Tests promoteFromDiscardChoice's option list directly (no reducer).
import { promoteFromDiscardChoice } from '../src/engine/handler-helpers';
import type { CardRef } from '../src/game';

let ok = true;
const check = (label: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) ok = false;
};
const C = (deck: string, slot: number, name: string): CardRef => ({ deck, slot, name, image: '' });

function optionsFor(discard: CardRef[], playedThisTurn: CardRef[]): number[] {
  const ctx: any = {
    G: { players: { '0': { discard } }, cardsPlayedThisTurn: playedThisTurn },
    actorId: '0',
    pendingChoice: null,
    paused: false,
    handlerState: null,
  };
  const done = promoteFromDiscardChoice()(ctx);
  if (done) return []; // handler returned true => no eligible options
  return (ctx.pendingChoice.options as number[]);
}

// 1. A card played this turn is excluded from the discard options.
{
  const discard = [C('drow', 1, 'X'), C('drow', 2, 'Y-played'), C('drow', 3, 'Z')];
  const opts = optionsFor(discard, [C('drow', 2, 'Y-played')]);
  check('excludes the played-this-turn card (idx 1)', JSON.stringify(opts) === JSON.stringify([0, 2]));
}

// 2. Multiset: only ONE copy is excluded when a duplicate also sits in old discard.
{
  // Two Nobles in discard; ONE Noble played this turn -> exactly one excluded.
  const discard = [C('s', 42, 'Noble'), C('s', 44, 'Soldier'), C('s', 42, 'Noble')];
  const opts = optionsFor(discard, [C('s', 42, 'Noble')]);
  check('multiset excludes exactly one duplicate (keeps the other)',
    JSON.stringify(opts) === JSON.stringify([1, 2]));
}

// 3. The reporter's case: all discard entries are cards played this turn -> no options.
{
  const played = [C('drow', 10, 'A'), C('drow', 11, 'B'), C('drow', 12, 'C'), C('drow', 13, 'D')];
  const discard = [...played]; // engine dumped them all into discard during the turn
  const opts = optionsFor(discard, played);
  check('all-played-this-turn -> zero promotable discard cards (#65)', opts.length === 0);
}

// 4. Nothing played this turn -> every discard card is offered (Necromancer mid-deck).
{
  const discard = [C('drow', 1, 'X'), C('drow', 2, 'Y')];
  const opts = optionsFor(discard, []);
  check('no plays this turn -> all discard offered', JSON.stringify(opts) === JSON.stringify([0, 1]));
}

console.log(ok ? '\nALL PROMOTE-FROM-DISCARD TESTS PASSED' : '\nTESTS FAILED');
process.exit(ok ? 0 : 1);

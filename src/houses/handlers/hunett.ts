// House Hun'ett — logic only. Names/rules text live in houses/house-data.ts.
//
// Death from the Shadows is implemented by chaining two EXISTING
// handler-helpers.ts building blocks exactly as-is: returnOwnSpyChoice()
// (return one of your spies) then assassinateAtLastReturnedSpySite()
// (assassinate a troop at that same site) — the latter was written for
// the base-game Cloaker card and already does precisely "return a spy →
// assassinate a troop there." The printed card's extra clause (an
// assassination that would target a white troop may instead redirect to
// another player's troop there) isn't modeled — see house-data.ts's text
// for that simplification; this treats every troop at the site (white or
// otherwise) as a legal target, which is the more permissive reading.

import { HouseRegistry } from '../registry';
import { Mechanics } from '../../engine/mechanics';
import { sequence, returnOwnSpyChoice, assassinateAtLastReturnedSpySite } from '../../engine/handler-helpers';

HouseRegistry.registerAction('hunett', 'death-from-the-shadows', {
  handler: sequence(returnOwnSpyChoice(), assassinateAtLastReturnedSpySite()),
});

const PAID_IN_BLOOD_USED = 'paidInBloodUsedThisTurn';

HouseRegistry.registerPassives('hunett', {
  onTurnBegin(G, pid) {
    G.players[pid].houseState.data[PAID_IN_BLOOD_USED] = false;
  },

  onAssassinate(G, pid) {
    const me = G.players[pid];
    if (me.houseState.data[PAID_IN_BLOOD_USED]) return;
    me.houseState.data[PAID_IN_BLOOD_USED] = true;
    Mechanics.gainPower(G, pid, 1);
    Mechanics.log(G, `P${Number(pid) + 1} +1 Power (Paid in Blood)`);
  },
});

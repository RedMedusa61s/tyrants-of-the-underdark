// House Barrison Del'Armgo — logic only. Names/rules text live in houses/house-data.ts.
//
// Conquest Doctrine reads "once per turn: WHEN you gain total control of a
// site, you may deploy 1 troop" — an event trigger, not a live-state check
// (you could gain TC, lose it, and still be owed the deploy for the rest of
// the turn). onTotalControlGain sets a per-turn flag; the action button's
// `available` reads that flag. Firing the hook redundantly while TC is
// sustained is harmless — it's just a boolean latch consumed once via the
// normal frequency:'turn' gate.

import { HouseRegistry } from '../registry';
import { deployChoice } from '../../engine/handler-helpers';

const GAINED_TC_THIS_TURN = 'gainedTotalControlThisTurn';

HouseRegistry.registerAction('barrison-delarmgo', 'conquest-doctrine', {
  handler: deployChoice({ count: 1, optional: true }),
  available: (G, actorId) => !!G.players[actorId].houseState.data[GAINED_TC_THIS_TURN],
});

HouseRegistry.registerPassives('barrison-delarmgo', {
  returnSpyPowerCost: 2,

  onTurnBegin(G, pid) {
    G.players[pid].houseState.data[GAINED_TC_THIS_TURN] = false;
  },

  onTotalControlGain(G, pid) {
    G.players[pid].houseState.data[GAINED_TC_THIS_TURN] = true;
  },
});

// House Melarn — logic only. Names/rules text live in houses/house-data.ts.
//
// Exalted Priesthood modifies the base game's Priestess of Lolth card via
// the generic onCardPlayed hook (fired for every card any player plays) —
// rather than editing engine/handlers/starter.ts's 'priestess-of-lolth'
// handler directly, keeping that shared starter-deck file untouched.

import { HouseRegistry } from '../registry';
import { Mechanics } from '../../engine/mechanics';
import { flagEotPromote } from '../../engine/handler-helpers';
import { deployFreeToEmptyStartingSite, hasTotalControlOfMarkerSite } from '../handler-helpers';

HouseRegistry.registerAction('melarn', 'established-shrines', {
  handler: deployFreeToEmptyStartingSite(),
  available: (G, actorId) => !!G.players[actorId].houseState.data.isFirstTurn,
});

HouseRegistry.registerAction('melarn', 'rite-of-ascension', {
  handler: flagEotPromote(),
  available: (G, actorId) =>
    hasTotalControlOfMarkerSite(G, actorId) && G.players[actorId].innerCircle.length < 4,
});

HouseRegistry.registerPassives('melarn', {
  onCardPlayed(G, pid, card, data) {
    if (data?.effectKey !== 'priestess-of-lolth') return;
    const me = G.players[pid];
    if (me.innerCircle.length >= 4) {
      Mechanics.gainPower(G, pid, 1);
      Mechanics.log(G, `P${Number(pid) + 1} +1 Power (Exalted Priesthood — ${card.name})`);
    }
  },
});

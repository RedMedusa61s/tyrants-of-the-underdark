// House Faen Tlabbar — logic only. Names/rules text live in houses/house-data.ts.

import { HouseRegistry } from '../registry';
import { Mechanics } from '../../engine/mechanics';
import { placeSpyAtChosenSite } from '../../engine/handler-helpers';
import type { TyrantsState, Color } from '../../game';

const EVER_GAINED_MARKER_CONTROL = 'everGainedMarkerSiteControl';

function spyCount(G: TyrantsState, color: Color): number {
  let n = 0;
  for (const arr of Object.values(G.spies)) if (arr.includes(color)) n++;
  return n;
}

HouseRegistry.registerAction('faen-tlabbar', 'eyes-everywhere', {
  handler: placeSpyAtChosenSite(),
  available: (G, actorId) => !!G.players[actorId].houseState.data[EVER_GAINED_MARKER_CONTROL],
});

HouseRegistry.registerPassives('faen-tlabbar', {
  presenceCountsSpies: true,

  onControlGain(G, pid, _siteId, hasMarker) {
    if (hasMarker) G.players[pid].houseState.data[EVER_GAINED_MARKER_CONTROL] = true;
  },

  onTurnBegin(G, pid) {
    const p = G.players[pid];
    const n = spyCount(G, p.color);
    if (n >= 5) {
      Mechanics.gainPower(G, pid, 1);
      Mechanics.gainInfluence(G, pid, 1);
      Mechanics.log(G, `P${Number(pid) + 1} +1 Power, +1 Influence (Web of Informants — ${n} spies)`);
    } else if (n >= 3) {
      Mechanics.gainInfluence(G, pid, 1);
      Mechanics.log(G, `P${Number(pid) + 1} +1 Influence (Web of Informants — ${n} spies)`);
    }
  },
});

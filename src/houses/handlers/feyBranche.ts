// House Fey-Branche — logic only. Names/rules text live in houses/house-data.ts.

import { HouseRegistry } from '../registry';
import { Mechanics } from '../../engine/mechanics';
import { peekAndMaybeRecruitDeckTop } from '../handler-helpers';

HouseRegistry.registerAction('fey-branche', 'ritual-exhibition', { handler: peekAndMaybeRecruitDeckTop() });

HouseRegistry.registerPassives('fey-branche', {
  onRecruit(G, pid, card) {
    if (card.cost >= 6) {
      Mechanics.gainVpTokens(G, pid, 1);
      Mechanics.log(G, `P${Number(pid) + 1} +1 VP (Ceremonial Elevation — recruited ${card.name})`);
    }
  },
});

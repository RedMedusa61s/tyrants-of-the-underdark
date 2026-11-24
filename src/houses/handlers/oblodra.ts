// House Oblodra — logic only. Names/rules text live in houses/house-data.ts.

import { HouseRegistry } from '../registry';
import { Mechanics } from '../../engine/mechanics';
import { peekAndReorderOwnDeckTop, shuffleMarketRowIntoDeck } from '../handler-helpers';
import type { EffectHandler } from '../../engine/types';

HouseRegistry.registerAction('oblodra', 'precognitive-glimpse', { handler: peekAndReorderOwnDeckTop() });

const payThenShuffle: EffectHandler = ctx => {
  if (!Mechanics.expendPower(ctx.G, ctx.actorId, 2)) return true;
  return shuffleMarketRowIntoDeck()(ctx);
};

HouseRegistry.registerAction('oblodra', 'psionic-storm', {
  handler: payThenShuffle,
  available: (G, actorId) => G.players[actorId].power >= 2,
});

// House Xorlarrin — logic only. Names/rules text live in houses/house-data.ts.

import { HouseRegistry } from '../registry';
import { devourFromHandCost, grant } from '../../engine/handler-helpers';
import { hasTotalControlOfMarkerSite, drawThenDiscard } from '../handler-helpers';
import { Mechanics } from '../../engine/mechanics';
import type { EffectHandler } from '../../engine/types';

HouseRegistry.registerAction('xorlarrin', 'forbidden-knowledge', {
  handler: devourFromHandCost(grant({ power: 2 }), { promptLabel: 'Forbidden Knowledge: devour a card from your hand for +2 Power?' }),
  available: (G, actorId) => hasTotalControlOfMarkerSite(G, actorId),
});

/** Pay 1 Power once, up front, then run drawThenDiscard()'s draw/discard
 *  state machine. The cost is charged only on the very first call — once
 *  `handlerState.paid` is set, resumptions (the discard pendingChoice
 *  response) skip straight to the inner handler. */
function payPowerThenDrawDiscard(): EffectHandler {
  const inner = drawThenDiscard();
  return ctx => {
    const state = (ctx.handlerState as { paid?: boolean; childState?: unknown } | null) ?? {};
    if (!state.paid) {
      if (!Mechanics.expendPower(ctx.G, ctx.actorId, 1)) return true;
      state.paid = true;
    }
    const childCtx = { ...ctx, handlerState: state.childState };
    const done = inner(childCtx);
    if (!done) {
      ctx.pendingChoice = childCtx.pendingChoice;
      ctx.paused = true;
      ctx.handlerState = { paid: true, childState: childCtx.handlerState };
      return false;
    }
    ctx.handlerState = null;
    return true;
  };
}

HouseRegistry.registerAction('xorlarrin', 'unstable-ritual', {
  handler: payPowerThenDrawDiscard(),
  available: (G, actorId) => G.players[actorId].power >= 1,
});

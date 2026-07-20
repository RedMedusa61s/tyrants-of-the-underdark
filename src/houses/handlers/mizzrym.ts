// House Mizzrym — logic only. Names/rules text live in houses/house-data.ts.

import { HouseRegistry } from '../registry';
import { Mechanics } from '../../engine/mechanics';
import { chooseOne } from '../../engine/handler-helpers';
import { convert, hasControlOfMarkerSite } from '../handler-helpers';
import type { EffectHandler, PendingChoice } from '../../engine/types';

HouseRegistry.registerAction('mizzrym', 'shrewd-bargains', {
  handler: chooseOne(
    { label: 'Pay 2 Power \u2192 gain 1 Influence', handler: convert({ power: 2 }, { influence: 1 }),
      available: (G, actorId) => G.players[actorId].power >= 2 },
    { label: 'Pay 2 Influence \u2192 gain 1 Power', handler: convert({ influence: 2 }, { power: 1 }),
      available: (G, actorId) => G.players[actorId].influence >= 2 },
  ),
});

/** Discard a card, then place (or add to) a 1-VP token on a chosen market
 *  row slot. The token is tracked in G.marketVpTokens (added to TyrantsState
 *  in game.ts) and paid out from Mechanics.recruitFromMarket — see
 *  engine/mechanics.ts. */
function discardThenPlaceMarketToken(): EffectHandler {
  return ctx => {
    const state = (ctx.handlerState as { discarded?: boolean } | null) ?? {};
    const me = ctx.G.players[ctx.actorId];
    if (!state.discarded) {
      if (!ctx.pendingChoice) {
        if (me.hand.length === 0) {
          Mechanics.log(ctx.G, '(Shadow Investment: your hand is empty — skipped)');
          return true;
        }
        ctx.pendingChoice = {
          kind: 'select-card-in-hand',
          prompt: 'Shadow Investment: discard a card.',
          options: me.hand.map((_, i) => i),
        } as PendingChoice;
        ctx.paused = true;
        return false;
      }
      const idx = ctx.pendingChoice.response as number | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      if (idx == null) { ctx.handlerState = null; return true; }
      const card = me.hand[idx];
      if (!card) { ctx.handlerState = null; return true; }
      Mechanics.discardCard(ctx.G, ctx.actorId, card);
      Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} discarded ${card.name} (Shadow Investment)`);
    }
    if (!ctx.pendingChoice) {
      const eligible: number[] = [];
      for (let i = 0; i < ctx.G.market.row.length; i++) if (ctx.G.market.row[i]) eligible.push(i);
      if (eligible.length === 0) { ctx.handlerState = null; return true; }
      ctx.pendingChoice = {
        kind: 'select-market-card',
        prompt: 'Shadow Investment: place a Victory Point token on which market card?',
        options: eligible,
      } as PendingChoice;
      ctx.paused = true;
      ctx.handlerState = { discarded: true };
      return false;
    }
    const idx = ctx.pendingChoice.response as number | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    ctx.handlerState = null;
    if (idx == null) return true;
    if (!ctx.G.marketVpTokens) ctx.G.marketVpTokens = {};
    const existing = ctx.G.marketVpTokens[idx];
    ctx.G.marketVpTokens[idx] = { pid: existing?.pid ?? ctx.actorId, vp: (existing?.vp ?? 0) + 1 };
    Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} placed a VP token on market slot ${idx} (Shadow Investment)`);
    return true;
  };
}

HouseRegistry.registerAction('mizzrym', 'shadow-investment', {
  handler: discardThenPlaceMarketToken(),
  available: (G, actorId) => hasControlOfMarkerSite(G, actorId),
});

// House Nasadra — logic only. Names/rules text live in houses/house-data.ts.
//
// The First House's Privilege has two parts wired OUTSIDE this file because
// they hook setup-phase mechanics rather than the normal per-turn engine
// chokepoints:
//   - "deploy 3 troops to your starting site instead of 1" — game.ts's
//     deployStartingTroop move reads `houseState.data.startingDeploysRemaining`
//     (seeded to 3 for Nasadra players, 1 otherwise) instead of always
//     ending the setup turn after a single deploy.
//   - "draw 1 additional card for your first turn" — granted below, gated
//     by the generic `isFirstTurn` flag game.ts's turn.onBegin already
//     tracks for every player (Melarn's Established Shrines reuses the
//     same flag).

import { HouseRegistry } from '../registry';
import { Mechanics } from '../../engine/mechanics';
import { RESERVED_MARKET_CARD_KEY } from '../types';
import type { EffectHandler, PendingChoice } from '../../engine/types';

function reserveMarketCard(): EffectHandler {
  return ctx => {
    if (!ctx.pendingChoice) {
      const eligible: number[] = [];
      for (let i = 0; i < ctx.G.market.row.length; i++) {
        if (ctx.G.market.row[i]) eligible.push(i);
      }
      if (eligible.length === 0) {
        Mechanics.log(ctx.G, '(Web of Debts: market row is empty — skipped)');
        return true;
      }
      if (!Mechanics.expendInfluence(ctx.G, ctx.actorId, 3)) return true;
      ctx.pendingChoice = {
        kind: 'select-market-card',
        prompt: 'Web of Debts: reserve which market card? (only you may recruit it, at 1 less Influence)',
        options: eligible,
      } as PendingChoice;
      ctx.paused = true;
      return false;
    }
    const idx = ctx.pendingChoice.response as number | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    if (idx == null) return true;
    const card = ctx.G.market.row[idx];
    if (!card) return true;
    const me = ctx.G.players[ctx.actorId];
    me.houseState.data[RESERVED_MARKET_CARD_KEY] = card;
    const refill = ctx.G.market.deck.shift() ?? null;
    if (refill) Mechanics.markInfoRevealed(ctx.G);
    ctx.G.market.row[idx] = refill;
    Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} reserved ${card.name} (Web of Debts)`);
    return true;
  };
}

HouseRegistry.registerAction('nasadra', 'web-of-debts', {
  handler: reserveMarketCard(),
  available: (G, actorId) => !G.players[actorId].houseState.data[RESERVED_MARKET_CARD_KEY]
    && G.players[actorId].influence >= 3,
});

HouseRegistry.registerPassives('nasadra', {
  onTurnBegin(G, pid) {
    const me = G.players[pid];
    if (me.houseState.data.isFirstTurn) {
      Mechanics.draw(G, pid, 1);
      Mechanics.log(G, `P${Number(pid) + 1} drew an extra card (Nasadra — first turn)`);
    }
  },
});

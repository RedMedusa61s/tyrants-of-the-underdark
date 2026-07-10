// House Baenre — logic only. Names/rules text live in houses/house-data.ts.

import { HouseRegistry } from '../registry';
import { Mechanics } from '../../engine/mechanics';
import { hasTotalControlOfMarkerSite } from '../handler-helpers';
import type { EffectHandler, PendingChoice } from '../../engine/types';

/** "Promote up to 3 cards from your played cards and/or discard pile for
 *  free." Both played-this-turn cards and older discard-pile cards are
 *  eligible (unlike the card-effect promoteFromDiscardChoice(), which
 *  deliberately EXCLUDES played-this-turn cards for other cards' "discard
 *  only" text) — so this offers every index in `discard` unfiltered. Loops
 *  up to 3 times, each optional (an explicit "stop" via decline). */
function promoteUpToThreeFromPlayedOrDiscard(): EffectHandler {
  return ctx => {
    const state = (ctx.handlerState as { remaining: number } | null) ?? { remaining: 3 };
    const me = ctx.G.players[ctx.actorId];
    if (state.remaining <= 0) { ctx.handlerState = null; return true; }
    if (!ctx.pendingChoice) {
      if (me.discard.length === 0) { ctx.handlerState = null; return true; }
      ctx.pendingChoice = {
        kind: 'select-card-in-discard',
        prompt: `Absolute Rule: promote a card for free (${state.remaining} left).`,
        options: me.discard.map((_, i) => i),
        optional: true,
      } as PendingChoice;
      ctx.paused = true;
      ctx.handlerState = state;
      return false;
    }
    const idx = ctx.pendingChoice.response as number | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    if (idx == null) { ctx.handlerState = null; return true; } // player stopped
    const card = me.discard[idx];
    if (!card) { ctx.handlerState = null; return true; }
    me.discard.splice(idx, 1);
    // Also drop it from cardsPlayedThisTurn if it was a play-area card, same
    // bookkeeping game.ts's own EOT-promote path does.
    const playedIdx = ctx.G.cardsPlayedThisTurn.findIndex(c => c.deck === card.deck && c.slot === card.slot);
    if (playedIdx >= 0) ctx.G.cardsPlayedThisTurn.splice(playedIdx, 1);
    const pPlayedIdx = me.cardsPlayed.findIndex(c => c.deck === card.deck && c.slot === card.slot);
    if (pPlayedIdx >= 0) me.cardsPlayed.splice(pPlayedIdx, 1);
    Mechanics.promote(ctx.G, ctx.actorId, card);
    ctx.handlerState = { remaining: state.remaining - 1 };
    return false;
  };
}

HouseRegistry.registerAction('baenre', 'absolute-rule', {
  handler: promoteUpToThreeFromPlayedOrDiscard(),
  available: (G, actorId) => hasTotalControlOfMarkerSite(G, actorId),
});

HouseRegistry.registerPassives('baenre', {
  onTurnBegin(G, pid) {
    const color = G.players[pid].color;
    const controlled = Object.values(G.siteControl).filter(c => c === color).length;
    if (controlled >= 4) {
      Mechanics.gainPower(G, pid, 1);
      Mechanics.log(G, `P${Number(pid) + 1} +1 Power (Lolth's Favor — controls ${controlled} sites)`);
    }
  },
});

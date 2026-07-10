// House Do'Urden — logic only. Names/rules text live in houses/house-data.ts.

import { HouseRegistry } from '../registry';
import { Mechanics } from '../../engine/mechanics';
import { lookupCard } from '../../card-data';
import type { EffectHandler, PendingChoice } from '../../engine/types';
import type { CardRef } from '../../game';

const SET_ASIDE_KEY = 'silkenSnareCard';
const WATCH_KEY = 'venomousPrecisionWatch';

function setAsideCard(): EffectHandler {
  return ctx => {
    const me = ctx.G.players[ctx.actorId];
    if (!ctx.pendingChoice) {
      if (me.hand.length === 0) {
        Mechanics.log(ctx.G, '(Silken Snare: your hand is empty — skipped)');
        return true;
      }
      ctx.pendingChoice = {
        kind: 'select-card-in-hand',
        prompt: 'Silken Snare: set aside which card? (returns to your hand at the start of your next turn)',
        options: me.hand.map((_, i) => i),
      } as PendingChoice;
      ctx.paused = true;
      return false;
    }
    const idx = ctx.pendingChoice.response as number | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    if (idx == null) return true;
    const card = me.hand[idx];
    if (!card) return true;
    me.hand.splice(idx, 1);
    me.houseState.data[SET_ASIDE_KEY] = card;
    Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} set aside ${card.name} (Silken Snare)`);
    return true;
  };
}

HouseRegistry.registerAction('do-urden', 'silken-snare', { handler: setAsideCard() });

HouseRegistry.registerPassives('do-urden', {
  onTurnBegin(G, pid) {
    const me = G.players[pid];
    const asideCard = me.houseState.data[SET_ASIDE_KEY] as CardRef | undefined;
    if (asideCard) {
      me.hand.push(asideCard);
      me.houseState.data[SET_ASIDE_KEY] = undefined;
      me.houseState.data[WATCH_KEY] = asideCard;
      Mechanics.log(G, `P${Number(pid) + 1} revealed and returned ${asideCard.name} to hand (Silken Snare)`);
    }
  },

  onCardPlayed(G, pid, card) {
    const me = G.players[pid];
    const watch = me.houseState.data[WATCH_KEY] as CardRef | undefined;
    if (!watch || watch.deck !== card.deck || watch.slot !== card.slot) return;
    me.houseState.data[WATCH_KEY] = undefined;
    const data = lookupCard(card.deck, card.slot);
    const aspect = data?.aspect?.toLowerCase();
    if (aspect === 'malice' || aspect === 'conquest') {
      Mechanics.gainPower(G, pid, 1);
      Mechanics.log(G, `P${Number(pid) + 1} +1 Power (Venomous Precision — ${data?.aspect})`);
    } else if (aspect === 'guile' || aspect === 'ambition') {
      Mechanics.gainInfluence(G, pid, 1);
      Mechanics.log(G, `P${Number(pid) + 1} +1 Influence (Venomous Precision — ${data?.aspect})`);
    }
  },
});

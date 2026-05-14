// Starter-deck card effects.
//
// Noble and Soldier are the only cards in every player's starting deck (7 + 3, rulebook p.4).
// Their printed effects are the simplest in the game: each grants one resource.
// Verify against the physical card before locking these in.

import { CardRegistry } from '../registry';
import { Mechanics } from '../mechanics';

// Noble — provides Influence (the recruiting resource).
CardRegistry.register('noble', ctx => {
  Mechanics.gainInfluence(ctx.G, ctx.actorId, 1);
  return true;
});

// Soldier — provides Power (the map-action resource).
CardRegistry.register('soldier', ctx => {
  Mechanics.gainPower(ctx.G, ctx.actorId, 1);
  return true;
});

// Insane Outcast — no resources; optional "discard a card → return to supply" ability.
// Self-eject rules (return to supply if would be devoured/promoted) live in Mechanics.
// effectKey slugified from "Insane Outcast" → "insane-outcast".
CardRegistry.register('insane-outcast', ctx => {
  // The discard-to-eject ability is a player decision; surface it as a choice.
  const player = ctx.G.players[ctx.actorId];
  if (player.hand.length === 0) return true; // nothing to discard, do nothing

  if (!ctx.pendingChoice) {
    ctx.pendingChoice = {
      kind: 'select-card-in-hand',
      prompt: 'Insane Outcast: discard a card to return this Outcast to the supply?',
      optional: true,
    };
    ctx.paused = true;
    return false;
  }

  const handIdx = ctx.pendingChoice.response as number | null;
  ctx.pendingChoice = null;
  ctx.paused = false;

  if (handIdx == null) return true; // declined
  const card = player.hand[handIdx];
  if (!card) return true;
  Mechanics.discardCard(ctx.G, ctx.actorId, card);
  // Return the Outcast to the supply rather than putting it in discard.
  // (Caller will skip the normal "add to discard" step when handler signals this.)
  Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} returned Insane Outcast to supply (discarded ${card.name})`);
  ctx.handlerState = { returnedToSupply: true };
  return true;
});

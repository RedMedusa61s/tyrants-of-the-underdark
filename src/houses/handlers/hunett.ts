// House Hun'ett — logic only. Names/rules text live in houses/house-data.ts.
//
// Death from the Shadows does NOT bundle a free assassinate — it's a pure
// return-a-spy action that leaves a rules exception behind at that site
// until the end of the turn: the player is still considered to have
// presence there (returnOwnSpyChoice()'s site is stashed on
// G._lastReturnedSpySite, then recorded into G.phantomPresenceSites), and
// any assassinate effect that would normally be restricted to white troops
// only (many cards' `assassinateChoice({ whiteOnly: true })`) may target a
// player's troop there instead. Both consequences are read generically off
// G.phantomPresenceSites by map-state.ts's hasPresenceAtSite and by the
// whiteOnly filters in handler-helpers.ts / card-targets.ts — nothing
// site/ability-specific lives outside this file.

import { HouseRegistry } from '../registry';
import { Mechanics } from '../../engine/mechanics';
import { returnOwnSpyChoice } from '../../engine/handler-helpers';
import type { EffectHandler } from '../../engine/types';

function returnSpyGrantPresence(): EffectHandler {
  const returnSpy = returnOwnSpyChoice();
  return ctx => {
    const Gx = ctx.G as unknown as { _lastReturnedSpySite?: string };
    // Clear any stale stash from an earlier, unrelated return-spy use before
    // attempting this one, so a "no spies to return" skip here can't pick up
    // a leftover siteId and grant phantom presence at the wrong site.
    if (!ctx.pendingChoice) Gx._lastReturnedSpySite = undefined;
    const done = returnSpy(ctx);
    if (!done) return false;
    const siteId = Gx._lastReturnedSpySite;
    Gx._lastReturnedSpySite = undefined;
    if (!siteId) return true;
    const me = ctx.G.players[ctx.actorId];
    const list = ctx.G.phantomPresenceSites[siteId] ?? (ctx.G.phantomPresenceSites[siteId] = []);
    if (!list.includes(me.color)) list.push(me.color);
    Mechanics.log(
      ctx.G,
      `P${Number(ctx.actorId) + 1} still has presence at ${siteId} this turn — assassinations there may target a player's troop instead of white (Death from the Shadows)`
    );
    return true;
  };
}

HouseRegistry.registerAction('hunett', 'death-from-the-shadows', {
  handler: returnSpyGrantPresence(),
});

const PAID_IN_BLOOD_USED = 'paidInBloodUsedThisTurn';

HouseRegistry.registerPassives('hunett', {
  onTurnBegin(G, pid) {
    G.players[pid].houseState.data[PAID_IN_BLOOD_USED] = false;
  },

  onAssassinate(G, pid) {
    const me = G.players[pid];
    if (me.houseState.data[PAID_IN_BLOOD_USED]) return;
    me.houseState.data[PAID_IN_BLOOD_USED] = true;
    Mechanics.gainInfluence(G, pid, 1);
    Mechanics.log(G, `P${Number(pid) + 1} +1 Influence (Paid in Blood)`);
  },
});

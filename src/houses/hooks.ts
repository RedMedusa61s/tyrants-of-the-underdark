// Thin dispatch layer between the engine's few chokepoints (turn begin,
// card resolution, recruit, control recompute, assassinate, base-action
// costs) and whichever house a player picked. Kept dependency-light (only
// the registry + types + the game/card-data TYPES) so it's safe to import
// from engine/mechanics.ts and engine/map-state.ts without creating an
// import cycle with houses/handlers/*.ts (which import Mechanics /
// handler-helpers and register themselves into HouseRegistry).
//
// Every function is a no-op if the player has no house, or their house
// doesn't define that hook — every engine call site stays a single
// unconditional line at the existing chokepoint.

import { HouseRegistry } from './registry';
import { HOUSES_BY_ID } from './house-data';
import type { TyrantsState, Color, CardRef } from '../game';
import type { CardData } from '../card-data';
import type { HouseId } from './types';

function passivesFor(G: TyrantsState, pid: string) {
  const houseId = G.players[pid]?.house as HouseId | null | undefined;
  if (!houseId) return undefined;
  return HouseRegistry.getPassives(houseId);
}

function pidForColor(G: TyrantsState, color: Color): string | undefined {
  return Object.keys(G.players).find(k => G.players[k].color === color);
}

export const HouseHooks = {
  onTurnBegin(G: TyrantsState, pid: string): void {
    passivesFor(G, pid)?.onTurnBegin?.(G, pid);
  },

  onCardPlayed(G: TyrantsState, pid: string, card: CardRef, data: CardData | undefined): void {
    passivesFor(G, pid)?.onCardPlayed?.(G, pid, card, data);
  },

  onRecruit(G: TyrantsState, pid: string, card: CardData): void {
    passivesFor(G, pid)?.onRecruit?.(G, pid, card);
  },

  onControlGain(G: TyrantsState, color: Color, siteId: string, hasMarker: boolean): void {
    const pid = pidForColor(G, color);
    if (!pid) return;
    passivesFor(G, pid)?.onControlGain?.(G, pid, siteId, hasMarker);
  },

  onTotalControlGain(G: TyrantsState, color: Color, siteId: string, hasMarker: boolean): void {
    const pid = pidForColor(G, color);
    if (!pid) return;
    passivesFor(G, pid)?.onTotalControlGain?.(G, pid, siteId, hasMarker);
  },

  onAssassinate(G: TyrantsState, pid: string, killed: Color | 'white'): void {
    passivesFor(G, pid)?.onAssassinate?.(G, pid, killed);
  },

  /** True if `color`'s house passively counts their spies as troops toward
   *  the site-control majority tally (Faen Tlabbar's Deep Cover). */
  colorCountsSpiesForControl(G: TyrantsState, color: Color): boolean {
    const pid = pidForColor(G, color);
    if (!pid) return false;
    return !!passivesFor(G, pid)?.presenceCountsSpies;
  },

  /** Power cost override for the base "Return an enemy spy" action, if this
   *  player's house sets one (Barrison Del'Armgo's Security Sweep).
   *  Undefined = no override; caller (game.ts) falls back to
   *  BASE_ACTION_POWER_COST itself, avoiding a value-import cycle back into
   *  game.ts from this module. */
  returnSpyPowerCostOverride(G: TyrantsState, pid: string): number | undefined {
    return passivesFor(G, pid)?.returnSpyPowerCost;
  },

  /** Look up (and run) an 'action' ability's engine implementation. Used by
   *  game.ts's `houseAction` move + resolveChoice — see there for the
   *  pendingChoice/cardKey plumbing. */
  getAction: HouseRegistry.getAction.bind(HouseRegistry),

  /** Every manually-triggerable ability key (kind:'action', not endOfTurn)
   *  this player's house currently offers: not yet used this turn/game (per
   *  its `frequency`), registered, and passing its `available` predicate.
   *  Shared by ai/house-ai.ts (picks one to fire) and anything else that
   *  wants to enumerate rather than just dispatch (e.g. an online-play
   *  legal-actions list). Deliberately does NOT re-check whether the
   *  ability would actually find a target once run — abilities with no
   *  eligible target already fizzle gracefully inside their own handler
   *  (log + mark used, no pendingChoice) — this is just "is it currently
   *  offerable at all." */
  eligibleActionKeys(G: TyrantsState, pid: string): string[] {
    const houseId = G.players[pid]?.house as HouseId | null | undefined;
    if (!houseId) return [];
    const house = HOUSES_BY_ID[houseId];
    if (!house) return [];
    const player = G.players[pid];
    const out: string[] = [];
    for (const ability of house.abilities) {
      if (ability.kind !== 'action' || ability.endOfTurn) continue;
      if (ability.frequency === 'turn' && player.houseState.usedThisTurn[ability.key]) continue;
      if (ability.frequency === 'game' && player.houseState.usedThisGame[ability.key]) continue;
      const impl = HouseRegistry.getAction(houseId, ability.key);
      if (!impl) continue;
      if (impl.available && !impl.available(G, pid)) continue;
      out.push(ability.key);
    }
    return out;
  },
};

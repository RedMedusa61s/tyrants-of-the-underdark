// Drow House system — structural types.
//
// Mirrors the card-effect system's own split:
//   engine/types.ts        (contract)   ↔  houses/types.ts        (contract)
//   card-data.ts            (data)      ↔  houses/house-data.ts    (data)
//   engine/registry.ts     (registry)   ↔  houses/registry.ts     (registry)
//   engine/handler-helpers (shared fns) ↔  houses/handler-helpers.ts
//   engine/handlers/*.ts   (per-deck)   ↔  houses/handlers/*.ts   (per-house)
//
// A house ability is either:
//   - 'passive' — always-on / auto-triggered. No button; an engine hook
//     (onTurnBegin / onRecruit / onCardPlayed / ...) applies it directly.
//     Shown in the House Bar as a read-only tag.
//   - 'action'  — player-triggered. Shown as a button in the House Bar,
//     dispatched through the `houseAction` move (mirrors how `playCard`
//     dispatches CardRegistry effect handlers), gated by frequency +
//     live availability.

import type { EffectHandler } from '../engine/types';
import type { TyrantsState, Color, CardRef } from '../game';
import type { CardData } from '../card-data';

export type HouseId =
  | 'do-urden'
  | 'fey-branche'
  | 'agrach-dyrr'
  | 'nasadra'
  | 'baenre'
  | 'barrison-delarmgo'
  | 'faen-tlabbar'
  | 'xorlarrin'
  | 'hunett'
  | 'mizzrym'
  | 'oblodra'
  | 'melarn';

/** Passive lifecycle hooks + flags a house may implement. All optional;
 *  missing = no-op. Registered per-house via HouseRegistry.registerPassives
 *  in houses/handlers/<house>.ts, and read only through houses/hooks.ts. */
export interface HousePassiveHooks {
  /** Fires at the start of every turn this player takes, after the engine's
   *  own per-turn resets (game.ts turn.onBegin). */
  onTurnBegin?(G: TyrantsState, pid: string): void;
  /** Fires once a card this player played has fully resolved (including
   *  cards whose effect suspended on a pendingChoice and resumed later). */
  onCardPlayed?(G: TyrantsState, pid: string, card: CardRef, data: CardData | undefined): void;
  /** Fires whenever this player successfully recruits ANY card, from the
   *  market row or an aux stack (Mechanics.recruitFromMarket /
   *  recruitFromAuxStack — the two chokepoints every recruit path funnels
   *  through, including card-effect-driven free recruits). */
  onRecruit?(G: TyrantsState, pid: string, card: CardData): void;
  /** Fires whenever this player is credited with control of a site. May
   *  fire repeatedly while they hold it (see map-state.ts
   *  recomputeSiteControl) — treat as "at least once while true", not a
   *  strict once-per-transition edge. `hasMarker` = site has a control marker. */
  onControlGain?(G: TyrantsState, pid: string, siteId: string, hasMarker: boolean): void;
  /** Same firing caveat as onControlGain, but only when the player holds
   *  TOTAL control of the site. */
  onTotalControlGain?(G: TyrantsState, pid: string, siteId: string, hasMarker: boolean): void;
  /** Fires whenever this player assassinates (or supplants) a troop — the
   *  single map-state.ts assassinateTroop() chokepoint. */
  onAssassinate?(G: TyrantsState, pid: string, killed: Color | 'white'): void;

  /** This house's spies count as troops toward the CONTROL majority tally
   *  at a site (Faen Tlabbar's Deep Cover). Consulted directly by
   *  map-state.ts recomputeSiteControl. */
  presenceCountsSpies?: boolean;
  /** Overrides the base-action "Return an enemy spy" Power cost for this
   *  player (Barrison Del'Armgo's Security Sweep). Undefined = normal
   *  BASE_ACTION_POWER_COST. */
  returnSpyPowerCost?: number;
}

/** Everything needed to actually RUN one 'action' ability. Registered per
 *  ability via HouseRegistry.registerAction. Kept separate from the
 *  descriptive HouseAbilityData in house-data.ts, same as CardData (text)
 *  vs CardRegistry (handler) for cards. */
export interface HouseActionImpl {
  handler: EffectHandler;
  /** Gates whether the button is currently usable, beyond the frequency
   *  budget (e.g. "only while you have total control of a marker site").
   *  Re-checked live by both the engine (rejects the move if false) and
   *  the UI (disables the button). */
  available?: (G: TyrantsState, actorId: string) => boolean;
}

/** Shared houseState.data key for "a market-row card reserved exclusively
 *  for this player" (Nasadra's Web of Debts). Defined here rather than in
 *  houses/handlers/nasadra.ts so game.ts's `recruitReservedCard` move can
 *  reference it without importing a specific house's handler file. */
export const RESERVED_MARKET_CARD_KEY = 'reservedMarketCard';

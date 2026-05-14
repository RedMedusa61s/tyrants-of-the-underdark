// Effect handler contract — ported from the Impulse/Innovation patterns onto boardgame.io.
//
// One handler per unique effectKey. Handlers may suspend by setting ctx.pendingChoice
// and returning false; the engine will surface the choice to the UI/AI and re-invoke
// the handler with ctx.pendingChoice.response populated.

import type { TyrantsState, CardRef } from '../game';

export type Color = 'black' | 'red' | 'orange' | 'blue';

export type PendingChoiceKind =
  | 'select-card-in-hand'
  | 'select-card-in-discard'
  | 'select-card-in-inner-circle'
  | 'select-played-card'
  | 'select-market-card'
  | 'select-site'
  | 'select-troop-space'
  | 'select-enemy-troop'
  | 'select-enemy-spy'
  | 'choose-one'
  | 'select-player';

export interface PendingChoice {
  kind: PendingChoiceKind;
  prompt: string;
  options?: unknown[];        // semantics vary by kind
  optional?: boolean;
  response?: unknown;         // filled in by UI/AI before resume
}

export interface EffectContext {
  /** The card being resolved. */
  card: CardRef;
  /** Player who triggered the effect (usually the current player). */
  actorId: string;
  /** Game state — handlers mutate this directly under boardgame.io's Immer-backed proxy. */
  G: TyrantsState;
  /** Pending choice request. Null when the handler is not awaiting input. */
  pendingChoice: PendingChoice | null;
  /** True when handler suspended awaiting input. */
  paused: boolean;
  /** Opaque slot for multi-stage handlers to stash progress between resumptions. */
  handlerState: unknown;
}

/**
 * Returns true when the effect ran to completion this call; false when it suspended.
 * On suspension, the handler must have set ctx.pendingChoice and ctx.paused = true.
 */
export type EffectHandler = (ctx: EffectContext) => boolean;

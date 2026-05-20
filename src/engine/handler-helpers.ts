// Composable building blocks for effect handlers.
//
// Most cards combine 1–3 of: grant resources, draw, place a spy, assassinate a troop,
// deploy a troop, supplant, promote, end-of-turn promote, devour-cost, choose-one.
// These helpers cover the recurring shapes so individual card handlers stay one-liners.

import { CardRegistry } from './registry';
import { Mechanics } from './mechanics';
import type { EffectContext, EffectHandler, PendingChoice } from './types';
import { placeSpy, assassinateTroop, deployTroop, hasPresence, returnSpy, returnTroop, moveTroop } from './map-state';
import { SITES } from '../data/sites';
import { ROUTES } from '../data/routes';
import { TROOP_SPACES } from '../data/troop-spaces';
import { lookupCard, cardsInDeck } from '../card-data';
import type { CardRef, Color } from '../game';

// ---------- Pure grants ----------

export function grant(opts: { power?: number; influence?: number; draw?: number }): EffectHandler {
  return ctx => {
    if (opts.power) Mechanics.gainPower(ctx.G, ctx.actorId, opts.power);
    if (opts.influence) Mechanics.gainInfluence(ctx.G, ctx.actorId, opts.influence);
    if (opts.draw) Mechanics.draw(ctx.G, ctx.actorId, opts.draw, ctx.random);
    return true;
  };
}

// ---------- End-of-turn promote-a-card flag ----------
//
// "At the end of your turn, promote a card played this turn" — set a flag that the
// turn-end step will surface as a "select a played card to promote" prompt. The
// played-card list lives on the per-turn promotion queue.

export function flagEotPromote(opts?: { count?: number; aspectFilter?: string }): EffectHandler {
  return ctx => {
    const n = opts?.count ?? 1;
    // Push the triggering card N times so the endTurn picker can exclude it from each
    // resulting prompt (most cards specify "another card played this turn"). The
    // optional aspectFilter (e.g. 'Obedience' for the Air/Fire/Water Myrmidons)
    // is carried as a property on the queued entry; game.ts filters the
    // 'select-played-card' eligible list by aspect when set.
    const trigger = opts?.aspectFilter
      ? { ...ctx.card, aspectFilter: opts.aspectFilter }
      : ctx.card;
    for (let i = 0; i < n; i++) ctx.G.pendingEotPromotions.push(trigger);
    const tag = opts?.aspectFilter ? ` ${opts.aspectFilter} card` : ' another card';
    Mechanics.log(ctx.G, `(eot: queued ${n} promote —${tag} played this turn)`);
    return true;
  };
}

// ---------- Place a spy ----------
//
// Surfaces a site picker. Resolves to the chosen siteId (string) or null if declined
// (placement is mandatory in rulebook terms; we keep it optional via PendingChoice
// only for cards that explicitly offer it as a choice).

/** Self-heal the spiesLeft count for games saved before the spy-supply
 *  field was added. If me.spiesLeft is missing (undefined), back-fill it
 *  from the current board: 5 minus the player's spies currently placed.
 *  Cap at >= 0 so an over-spied legacy save doesn't go negative.
 *  Idempotent — once the field is a real number, this is a no-op. */
export function ensureSpiesLeftInitialized(G: import('../game').TyrantsState, color: import('../game').Color): void {
  const pid = Object.keys(G.players).find(k => G.players[k].color === color);
  if (!pid) return;
  const me = G.players[pid];
  if (typeof me.spiesLeft === 'number') return;
  let onBoard = 0;
  for (const arr of Object.values(G.spies)) {
    if (arr.includes(color)) onBoard++;
  }
  me.spiesLeft = Math.max(0, 5 - onBoard);
}

export function placeSpyAtChosenSite(opts?: { optional?: boolean }): EffectHandler {
  return ctx => {
    const me = ctx.G.players[ctx.actorId];
    const myColor = me.color;
    ensureSpiesLeftInitialized(ctx.G, myColor);
    type Phase = 'init' | 'place' | 'empty-choice' | 'empty-return' | 'empty-place';
    const state = (ctx.handlerState as { phase: Phase } | null) ?? { phase: 'init' as Phase };

    // Helper: list of sites where a fresh spy could land. Must be in play
    // and not already have one of my spies.
    const placeableSites = () => SITES
      .filter(s => s.id in ctx.G.siteControl && !(ctx.G.spies[s.id] ?? []).includes(myColor))
      .map(s => s.id);
    // Helper: sites where I currently have a spy (eligible to return).
    const ownSpySites = () => SITES
      .filter(s => (ctx.G.spies[s.id] ?? []).includes(myColor))
      .map(s => s.id);

    // ---- Phase 0: entry. Branch on whether the supply has any spies left.
    if (state.phase === 'init') {
      if (me.spiesLeft > 0) {
        // Normal path: prompt for the site to place at.
        ctx.pendingChoice = {
          kind: 'select-site',
          prompt: 'Place a spy at which site?',
          options: placeableSites(),
          optional: opts?.optional,
        } as PendingChoice;
        ctx.paused = true;
        ctx.handlerState = { phase: 'place' };
        return false;
      }
      // Supply empty (rulebook: "either do nothing OR first return one of
      // your existing spies and then place it"). Offer the choice. If the
      // player has no own spies on the board either — somehow — only the
      // skip path is available, so we skip silently.
      if (ownSpySites().length === 0) {
        Mechanics.log(ctx.G, `(place spy: supply empty and no spies on board — skipped)`);
        ctx.handlerState = null;
        return true;
      }
      ctx.pendingChoice = {
        kind: 'choose-one',
        prompt: 'Your spy supply is empty. What would you like to do?',
        options: ['Do nothing', 'Return a placed spy, then place it at a new site'],
      } as PendingChoice;
      ctx.paused = true;
      ctx.handlerState = { phase: 'empty-choice' };
      return false;
    }

    // ---- Phase: normal place — resume from the place-site prompt.
    if (state.phase === 'place') {
      const siteId = ctx.pendingChoice?.response as string | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      ctx.handlerState = null;
      if (siteId && placeSpy(ctx.G, myColor, siteId)) {
        me.spiesLeft -= 1;
        Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} placed spy at ${siteId} (spies left: ${me.spiesLeft})`);
        (ctx.G as unknown as { _lastPlacedSpySite?: string })._lastPlacedSpySite = siteId;
      }
      return true;
    }

    // ---- Phase: empty-supply skip-vs-return choice.
    if (state.phase === 'empty-choice') {
      const idx = ctx.pendingChoice?.response as number | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      if (idx == null || idx === 0) {
        // "Do nothing" or implicit dismissal.
        Mechanics.log(ctx.G, `(place spy: supply empty, declined to return-and-replace)`);
        ctx.handlerState = null;
        return true;
      }
      // Picked "return a placed spy, then place". Prompt for the return site.
      ctx.pendingChoice = {
        kind: 'select-site',
        prompt: 'Return a spy from which site?',
        options: ownSpySites(),
      } as PendingChoice;
      ctx.paused = true;
      ctx.handlerState = { phase: 'empty-return' };
      return false;
    }

    // ---- Phase: empty-supply return-site picked, now do the return and
    // immediately re-prompt for the new place-site.
    if (state.phase === 'empty-return') {
      const siteId = ctx.pendingChoice?.response as string | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      if (!siteId) {
        // User dismissed the return picker — back out gracefully.
        ctx.handlerState = null;
        return true;
      }
      if (returnSpy(ctx.G, myColor, siteId)) {
        me.spiesLeft += 1;
        Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} returned spy from ${siteId} to refill supply (spies left: ${me.spiesLeft})`);
      }
      ctx.pendingChoice = {
        kind: 'select-site',
        prompt: 'Place the spy at which site?',
        options: placeableSites(),
      } as PendingChoice;
      ctx.paused = true;
      ctx.handlerState = { phase: 'empty-place' };
      return false;
    }

    // ---- Phase: empty-supply place site picked.
    if (state.phase === 'empty-place') {
      const siteId = ctx.pendingChoice?.response as string | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      ctx.handlerState = null;
      if (siteId && placeSpy(ctx.G, myColor, siteId)) {
        me.spiesLeft -= 1;
        Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} placed spy at ${siteId} (spies left: ${me.spiesLeft})`);
        (ctx.G as unknown as { _lastPlacedSpySite?: string })._lastPlacedSpySite = siteId;
      }
      return true;
    }

    // Defensive: unknown phase. Reset.
    ctx.handlerState = null;
    return true;
  };
}

/** Supplant a troop at the site where you just placed a spy (used by Green Dragon's primary). */
export function supplantAtLastPlacedSpySite(): EffectHandler {
  return ctx => {
    // Stash the target site in handlerState on first call so it survives the pause
    // between prompt and click. We deliberately do NOT clear the transient stash
    // up front (older code did, which made the click silently no-op).
    const Gx = ctx.G as unknown as { _lastPlacedSpySite?: string };
    const stashed = ctx.handlerState as { siteId?: string } | null;
    const siteId = stashed?.siteId ?? Gx._lastPlacedSpySite;
    if (!siteId) { ctx.handlerState = null; return true; }
    ctx.handlerState = { siteId };
    if (!ctx.pendingChoice) {
      const me = ctx.G.players[ctx.actorId];
      const eligible = TROOP_SPACES.filter(t => t.parentSite === siteId).map(t => t.id)
        .filter(id => {
          const occ = ctx.G.troops[id];
          return occ && occ !== me.color;
        });
      if (eligible.length === 0) return true;
      ctx.pendingChoice = {
        kind: 'select-troop-space',
        prompt: `Supplant a troop at ${siteId} (the spy's site).`,
        options: eligible,
        optional: true,
      } as PendingChoice;
      ctx.paused = true;
      return false;
    }
    const spaceId = ctx.pendingChoice.response as string | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    ctx.handlerState = null;
    Gx._lastPlacedSpySite = undefined;
    if (!spaceId) return true;
    const me = ctx.G.players[ctx.actorId];
    const killed = assassinateTroop(ctx.G, spaceId);
    if (!killed) return true;
    if (killed === 'white') me.trophyHall.white += 1;
    else if (killed !== me.color) me.trophyHall[killed] = (me.trophyHall[killed] ?? 0) + 1;
    if (me.barracksLeft > 0) {
      if (deployTroop(ctx.G, me.color, spaceId)) {
        me.barracksLeft -= 1;
        Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} supplanted ${killed} at ${spaceId} (barracks: ${me.barracksLeft})`);
      }
    } else {
      me.vp += 1;
      Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} supplanted ${killed} at ${spaceId} — barracks empty, +1 VP`);
    }
    return true;
  };
}

/** Assassinate a troop at the site where you just placed a spy (used by Succubus, Yan-C-Bin). */
export function assassinateAtLastPlacedSpySite(): EffectHandler {
  return ctx => {
    const Gx = ctx.G as unknown as { _lastPlacedSpySite?: string };
    // Stash the target site in handlerState on first entry so it survives
    // the pause for the user's troop-pick. The earlier implementation read
    // _lastPlacedSpySite AND cleared it on every entry, so on re-entry
    // after the user picked a target the siteId was undefined and the
    // assassinate silently bailed out (Succubus place-then-assassinate
    // chain visibly skipped the assassinate step).
    const stashed = ctx.handlerState as { siteId?: string } | null;
    const siteId = stashed?.siteId ?? Gx._lastPlacedSpySite;
    if (!siteId) { ctx.handlerState = null; return true; }

    if (!ctx.pendingChoice) {
      const me = ctx.G.players[ctx.actorId];
      const eligible = TROOP_SPACES.filter(t => t.parentSite === siteId).map(t => t.id)
        .filter(id => {
          const occ = ctx.G.troops[id];
          return occ && occ !== me.color;
        });
      if (eligible.length === 0) {
        Mechanics.log(ctx.G, `(assassinate at ${siteId}: no enemy/white troops to target — skipped)`);
        Gx._lastPlacedSpySite = undefined;
        ctx.handlerState = null;
        return true;
      }
      Mechanics.log(ctx.G, `(assassinate at ${siteId}: choose a troop or dismiss to skip — ${eligible.length} eligible)`);
      ctx.pendingChoice = {
        kind: 'select-troop-space',
        prompt: `Assassinate a troop at ${siteId}.`,
        options: eligible,
        optional: true,
      } as PendingChoice;
      ctx.paused = true;
      ctx.handlerState = { siteId };
      return false;
    }
    const spaceId = ctx.pendingChoice.response as string | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    // The site has been consumed by either path (target chosen or declined),
    // so clear the transient stash for any downstream handlers and our own
    // handlerState ledger.
    Gx._lastPlacedSpySite = undefined;
    ctx.handlerState = null;
    if (!spaceId) {
      Mechanics.log(ctx.G, `(assassinate at ${siteId}: declined)`);
      return true;
    }
    const me = ctx.G.players[ctx.actorId];
    const killed = assassinateTroop(ctx.G, spaceId);
    if (killed === 'white') me.trophyHall.white += 1;
    else if (killed) me.trophyHall[killed] = (me.trophyHall[killed] ?? 0) + 1;
    Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} assassinated ${killed} at ${spaceId}`);
    return true;
  };
}

// ---------- Devour-from-hand optional cost ----------
//
// Surfaces a "select-card-in-hand" prompt; on pick, devours that card and runs the
// follow-up effect. Decline (or no cards in hand) skips the effect entirely — the
// devour is the cost for the bonus effect.

interface DevourState { paid?: boolean; childState?: unknown }

export function devourFromHandCost(thenEffect: EffectHandler, opts?: { promptLabel?: string }): EffectHandler {
  return ctx => {
    let state = (ctx.handlerState as DevourState | null) ?? {};
    if (!state.paid) {
      if (!ctx.pendingChoice) {
        const me = ctx.G.players[ctx.actorId];
        if (me.hand.length === 0) { ctx.handlerState = null; return true; }
        ctx.pendingChoice = {
          kind: 'select-card-in-hand',
          prompt: opts?.promptLabel ?? 'Devour a card from your hand to trigger this effect?',
          optional: true,
        } as PendingChoice;
        ctx.paused = true;
        return false;
      }
      const idx = ctx.pendingChoice.response as number | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      if (idx == null) { ctx.handlerState = null; return true; } // declined cost
      const me = ctx.G.players[ctx.actorId];
      const card = me.hand[idx];
      if (!card) { ctx.handlerState = null; return true; }
      me.hand.splice(idx, 1);
      Mechanics.devour(ctx.G, card);
      Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} devoured ${card.name} from hand`);
      state = { paid: true, childState: null };
    }
    // Run the gated follow-up.
    const childCtx: EffectContext = {
      ...ctx,
      pendingChoice: ctx.pendingChoice,
      handlerState: state.childState,
      paused: ctx.paused,
    };
    const done = thenEffect(childCtx);
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

// ---------- Return one of your own spies ----------
//
// Surfaces a site picker over sites where the player has a spy. Returns the spy on
// resolve. If onReturned is provided, calls it with the chosen siteId so the caller
// can chain a follow-up (e.g. "supplant a troop there").

export function returnOwnSpyChoice(opts?: { optional?: boolean }): EffectHandler {
  return ctx => {
    if (!ctx.pendingChoice) {
      const me = ctx.G.players[ctx.actorId];
      ensureSpiesLeftInitialized(ctx.G, me.color);
      const eligible = SITES
        .filter(s => (ctx.G.spies[s.id] ?? []).includes(me.color))
        .map(s => s.id);
      if (eligible.length === 0) {
        Mechanics.log(ctx.G, '(return own spy: you have no spies on the board — skipped)');
        return true;
      }
      // Auto-resolve the trivial case: exactly one eligible site (and the prompt
      // is mandatory — for optional callers we still surface so the user can
      // decline). This avoids an "accidental" click on a slot at the only-spy
      // site being misread later as a supplant target (Spellspinner et al).
      if (eligible.length === 1 && !opts?.optional) {
        const siteId = eligible[0];
        if (returnSpy(ctx.G, me.color, siteId)) {
          me.spiesLeft += 1;
          Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} returned spy from ${siteId} (auto: only one) (spies left: ${me.spiesLeft})`);
          (ctx.G as unknown as { _lastReturnedSpySite?: string })._lastReturnedSpySite = siteId;
        }
        return true;
      }
      ctx.pendingChoice = {
        kind: 'select-site',
        prompt: 'Return one of your spies from which site?',
        options: eligible,
        optional: opts?.optional,
      } as PendingChoice;
      ctx.paused = true;
      return false;
    }
    const siteId = ctx.pendingChoice.response as string | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    if (!siteId) return true;
    const me = ctx.G.players[ctx.actorId];
    ensureSpiesLeftInitialized(ctx.G, me.color);
    if (returnSpy(ctx.G, me.color, siteId)) {
      me.spiesLeft += 1;
      Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} returned spy from ${siteId} (spies left: ${me.spiesLeft})`);
      // Stash the site for any chained handlers that need it.
      (ctx.G as unknown as { _lastReturnedSpySite?: string })._lastReturnedSpySite = siteId;
    }
    return true;
  };
}

/** Supplant a troop at the most-recently returned spy's site (used by Spellspinner). */
export function supplantAtLastReturnedSpySite(): EffectHandler {
  return ctx => {
    // Stash the target site in handlerState so it survives across the
    // prompt→click pause. Previously this cleared `_lastReturnedSpySite` on the
    // first call, then re-read it after resume → undefined → silent no-op.
    const Gx = ctx.G as unknown as { _lastReturnedSpySite?: string };
    const stashed = ctx.handlerState as { siteId?: string } | null;
    const siteId = stashed?.siteId ?? Gx._lastReturnedSpySite;
    if (!siteId) { ctx.handlerState = null; return true; }
    ctx.handlerState = { siteId };
    if (!ctx.pendingChoice) {
      const me = ctx.G.players[ctx.actorId];
      // Only spaces at that site, occupied by an enemy.
      const eligible = TROOP_SPACES.filter(t => t.parentSite === siteId).map(t => t.id)
        .filter(id => {
          const occ = ctx.G.troops[id];
          return occ && occ !== me.color;
        });
      if (eligible.length === 0) return true;
      ctx.pendingChoice = {
        kind: 'select-troop-space',
        prompt: `Supplant a troop at ${siteId}.`,
        options: eligible,
        optional: true,
      } as PendingChoice;
      ctx.paused = true;
      return false;
    }
    const spaceId = ctx.pendingChoice.response as string | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    ctx.handlerState = null;
    Gx._lastReturnedSpySite = undefined;
    if (!spaceId) return true;
    const me = ctx.G.players[ctx.actorId];
    const killed = assassinateTroop(ctx.G, spaceId);
    if (!killed) return true;
    if (killed === 'white') me.trophyHall.white += 1;
    else if (killed !== me.color) me.trophyHall[killed] = (me.trophyHall[killed] ?? 0) + 1;
    if (me.barracksLeft > 0) {
      if (deployTroop(ctx.G, me.color, spaceId)) {
        me.barracksLeft -= 1;
        Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} supplanted ${killed} at ${spaceId} (barracks: ${me.barracksLeft})`);
      }
    } else {
      me.vp += 1;
      Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} supplanted ${killed} at ${spaceId} — barracks empty, +1 VP`);
    }
    return true;
  };
}

// ---------- Troop-space targeting helpers ----------

/** Spaces a player has presence at (the legal targets for assassinate/return from spaces).
 *  Filtered to spaces in active sections only (membership in G.troops). */
export function spacesWithPresence(G: import('../game').TyrantsState, color: import('../game').Color): string[] {
  const out: string[] = [];
  for (const ts of TROOP_SPACES) {
    if (!(ts.id in G.troops)) continue;
    if (ts.parentSite) {
      if (hasPresence(G, color, { site: ts.parentSite })) out.push(ts.id);
    } else if (ts.parentRoute) {
      if (hasPresence(G, color, { space: ts.id })) out.push(ts.id);
    }
  }
  return out;
}

/** Empty spaces the player may deploy into (presence required unless `anywhere` is true,
 *  per rulebook p.12). Restricted to spaces in active sections — inactive
 *  spaces are absent from G.troops entirely (their id is not a key), so the
 *  `id in G.troops` test acts as both an "exists" and "in play" check. */
function legalDeployTargets(
  G: import('../game').TyrantsState,
  color: import('../game').Color,
  anywhere: boolean
): string[] {
  const empty = TROOP_SPACES.filter(ts => ts.id in G.troops && G.troops[ts.id] === null);
  if (anywhere) return empty.map(ts => ts.id);
  const out: string[] = [];
  for (const ts of empty) {
    if (ts.parentSite && hasPresence(G, color, { site: ts.parentSite })) out.push(ts.id);
    else if (ts.parentRoute && hasPresence(G, color, { space: ts.id })) out.push(ts.id);
  }
  return out;
}

/** Assassinate `count` enemy troops the player has presence at. Trophy hall is auto-updated. */
export function assassinateChoice(opts?: { count?: number; whiteOnly?: boolean }): EffectHandler {
  const count = opts?.count ?? 1;
  return ctx => {
    let state = (ctx.handlerState as { remaining: number } | null) ?? { remaining: count };

    // 1. Process the prior response, if any.
    if (ctx.pendingChoice) {
      const spaceId = ctx.pendingChoice.response as string | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      if (!spaceId) { ctx.handlerState = null; return true; }
      const killed = assassinateTroop(ctx.G, spaceId);
      if (killed === 'white') ctx.G.players[ctx.actorId].trophyHall.white += 1;
      else if (killed) ctx.G.players[ctx.actorId].trophyHall[killed] = (ctx.G.players[ctx.actorId].trophyHall[killed] ?? 0) + 1;
      Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} assassinated ${killed} at ${spaceId}`);
      state = { remaining: state.remaining - 1 };
    }

    // 2. Set up next prompt or finish.
    if (state.remaining <= 0) { ctx.handlerState = null; return true; }
    const me = ctx.G.players[ctx.actorId];
    const eligible = spacesWithPresence(ctx.G, me.color).filter(id => {
      const occ = ctx.G.troops[id];
      if (!occ || occ === me.color) return false;
      if (opts?.whiteOnly && occ !== 'white') return false;
      return true;
    });
    if (eligible.length === 0) {
      Mechanics.log(ctx.G, `(${opts?.whiteOnly ? 'assassinate white' : 'assassinate'}: no eligible targets at any space where you have presence — skipped)`);
      ctx.handlerState = null;
      return true;
    }
    ctx.pendingChoice = {
      kind: 'select-troop-space',
      prompt: opts?.whiteOnly ? `Assassinate a white troop (${state.remaining} left).` : `Assassinate an enemy troop (${state.remaining} left).`,
      options: eligible,
      optional: true,
    } as PendingChoice;
    ctx.paused = true;
    ctx.handlerState = state;
    return false;
  };
}

/** Deploy `count` of the player's own troops. `anywhere` waives presence checks. */
export function deployChoice(opts?: { count?: number; anywhere?: boolean; costless?: boolean }): EffectHandler {
  const count = opts?.count ?? 1;
  return ctx => {
    let state = (ctx.handlerState as { remaining: number } | null) ?? { remaining: count };

    // 1. Process the prior response, if any.
    if (ctx.pendingChoice) {
      const spaceId = ctx.pendingChoice.response as string | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      if (!spaceId) { ctx.handlerState = null; return true; }
      const me = ctx.G.players[ctx.actorId];
      // Costless: the token isn't coming from this player's barracks (e.g. Orcus
      // moves an opponent's troop from their trophy hall onto the board as the
      // active player's color). Skip the barracks bookkeeping and the
      // empty-barracks → +1 VP fallback.
      if (opts?.costless) {
        if (deployTroop(ctx.G, me.color, spaceId)) {
          Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} placed a free troop at ${spaceId}`);
        }
      } else if (me.barracksLeft <= 0) {
        // Rulebook p.12: with empty barracks, each deploy converts to +1 VP
        // instead of placing a token.
        me.vp += 1;
        Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} deploy → +1 VP (barracks empty)`);
      } else if (deployTroop(ctx.G, me.color, spaceId)) {
        me.barracksLeft -= 1;
        Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} deployed at ${spaceId} (barracks: ${me.barracksLeft})`);
      }
      state = { remaining: state.remaining - 1 };
    }

    // 2. Set up next prompt or finish.
    if (state.remaining <= 0) { ctx.handlerState = null; return true; }
    const me = ctx.G.players[ctx.actorId];
    const eligible = legalDeployTargets(ctx.G, me.color, !!opts?.anywhere);
    if (eligible.length === 0) {
      Mechanics.log(ctx.G, `(deploy: no empty space ${opts?.anywhere ? 'on the board' : 'where you have presence'} — skipped)`);
      ctx.handlerState = null;
      return true;
    }
    ctx.pendingChoice = {
      kind: 'select-troop-space',
      prompt: `Deploy a troop (${state.remaining} left).${opts?.anywhere ? ' Anywhere on the board.' : ''}`,
      options: eligible,
      optional: true,
    } as PendingChoice;
    ctx.paused = true;
    ctx.handlerState = state;
    return false;
  };
}

/** Supplant: assassinate a target and then deploy in the same space. */
export function supplantChoice(opts?: { whiteOnly?: boolean; anywhere?: boolean }): EffectHandler {
  return ctx => {
    const state = (ctx.handlerState as { picked?: string } | null) ?? {};
    if (!ctx.pendingChoice && !state.picked) {
      const me = ctx.G.players[ctx.actorId];
      const eligible = (opts?.anywhere
        ? TROOP_SPACES.map(t => t.id).filter(id => {
            const occ = ctx.G.troops[id];
            return occ && occ !== me.color && (!opts?.whiteOnly || occ === 'white');
          })
        : spacesWithPresence(ctx.G, me.color).filter(id => {
            const occ = ctx.G.troops[id];
            return occ && occ !== me.color && (!opts?.whiteOnly || occ === 'white');
          })
      );
      if (eligible.length === 0) {
        Mechanics.log(ctx.G, `(supplant${opts?.whiteOnly ? ' white' : ''}: no eligible targets ${opts?.anywhere ? 'on the board' : 'where you have presence'} — skipped)`);
        ctx.handlerState = null;
        return true;
      }
      ctx.pendingChoice = {
        kind: 'select-troop-space',
        prompt: opts?.whiteOnly ? 'Supplant a white troop.' : 'Supplant a troop.',
        options: eligible,
        optional: true,
      } as PendingChoice;
      ctx.paused = true;
      return false;
    }
    if (ctx.pendingChoice) {
      const spaceId = ctx.pendingChoice.response as string | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      if (!spaceId) { ctx.handlerState = null; return true; }
      const me = ctx.G.players[ctx.actorId];
      const killed = assassinateTroop(ctx.G, spaceId);
      if (!killed) {
        Mechanics.log(ctx.G, `(supplant skipped: no troop at ${spaceId})`);
        ctx.handlerState = null;
        return true;
      }
      if (killed === 'white') me.trophyHall.white += 1;
      else if (killed !== me.color) me.trophyHall[killed] = (me.trophyHall[killed] ?? 0) + 1;
      // Per rulebook: supplant = assassinate + deploy. The placed troop comes from
      // your barracks; if your barracks is empty, treat per p.12 (deploy converts to
      // +1 VP token instead). We still place a token visually but cap barracks at 0.
      if (me.barracksLeft > 0) {
        if (deployTroop(ctx.G, me.color, spaceId)) {
          me.barracksLeft -= 1;
          Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} supplanted ${killed} at ${spaceId} (barracks: ${me.barracksLeft})`);
        }
      } else {
        me.vp += 1;
        Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} supplanted ${killed} at ${spaceId} — barracks empty, +1 VP instead of deploy`);
      }
    }
    ctx.handlerState = null;
    return true;
  };
}

// ---------- Choose one of N sub-handlers ----------
//
// Surfaces a choose-one PendingChoice, then runs the picked sub-handler. The sub-handler
// may suspend; state is preserved across resumptions in `handlerState`.

export interface ChoiceOption {
  label: string;
  handler: EffectHandler;
  /** Predicate: option is offered only when this returns true. Used to hide options
   *  whose action isn't currently legal (e.g. "return a spy → ..." when you have no
   *  spies on the board). Eligibility is re-evaluated when the prompt is set up, not
   *  on every state tick. */
  available?: (G: import('../game').TyrantsState, actorId: string) => boolean;
}

interface ChooseOneState { selectedLabel: string | null; childState: unknown }

export function chooseOne(...opts: ChoiceOption[]): EffectHandler {
  return ctx => {
    let state = (ctx.handlerState as ChooseOneState | null) ?? { selectedLabel: null, childState: null };

    // Phase 1: present choice (filter to legal options), capture response on resume.
    if (state.selectedLabel === null) {
      const legal = opts.filter(o => !o.available || o.available(ctx.G, ctx.actorId));
      if (legal.length === 0) { ctx.handlerState = null; return true; }

      if (!ctx.pendingChoice) {
        ctx.pendingChoice = {
          kind: 'choose-one',
          prompt: 'Choose one:',
          options: legal.map(o => o.label),
        } as PendingChoice;
        ctx.paused = true;
        return false;
      }
      const idx = ctx.pendingChoice.response as number | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      if (idx == null || idx < 0 || idx >= legal.length) { ctx.handlerState = null; return true; }
      state = { selectedLabel: legal[idx].label, childState: null };
    }

    // Phase 2: run the selected sub-handler (matched by label so we don't store
    // functions in the immer-tracked state).
    const selectedOpt = opts.find(o => o.label === state.selectedLabel);
    if (!selectedOpt) { ctx.handlerState = null; return true; }
    const childCtx: EffectContext = {
      ...ctx,
      pendingChoice: ctx.pendingChoice,
      handlerState: state.childState,
      paused: ctx.paused,
    };
    const done = selectedOpt.handler(childCtx);
    if (!done) {
      ctx.pendingChoice = childCtx.pendingChoice;
      ctx.paused = true;
      ctx.handlerState = { selectedLabel: state.selectedLabel, childState: childCtx.handlerState };
      return false;
    }
    ctx.handlerState = null;
    return true;
  };
}

// ---------- Common availability predicates ----------

/** True when the player has at least one spy on the board AND at least one of
 *  those spy sites has a troop the player could supplant (i.e. an enemy or
 *  white troop in any slot of that site). Used to gate Graz'zt's
 *  "return-spies-and-supplant" option so it isn't offered when no spy can
 *  produce a benefit. */
export function playerHasUsefulSpyForSupplant(G: import('../game').TyrantsState, actorId: string): boolean {
  const color = G.players[actorId].color;
  for (const s of SITES) {
    if (!(G.spies[s.id] ?? []).includes(color)) continue;
    // Site has my spy; does it have a troop I could supplant?
    for (const t of TROOP_SPACES) {
      if (t.parentSite !== s.id) continue;
      const occ = G.troops[t.id];
      if (occ && occ !== color) return true;
    }
  }
  return false;
}

export function playerHasOwnSpy(G: import('../game').TyrantsState, actorId: string): boolean {
  const color = G.players[actorId].color;
  for (const arr of Object.values(G.spies)) if (arr.includes(color)) return true;
  return false;
}

export function playerHasOwnTroopOnBoard(G: import('../game').TyrantsState, actorId: string): boolean {
  const color = G.players[actorId].color;
  for (const t of Object.values(G.troops)) if (t === color) return true;
  return false;
}

// ---------- Move an enemy troop ----------
//
// Two-phase pick: first the enemy troop to move (any space with an enemy occupant — by
// rulebook p.11 "enemy" includes white troops), then the empty destination space (anywhere
// on the board). Loops `count` times.

interface MoveState { remaining: number; from: string | null }

export function moveEnemyTroopChoice(opts?: { count?: number }): EffectHandler {
  const count = opts?.count ?? 1;
  return ctx => {
    let state = (ctx.handlerState as MoveState | null) ?? { remaining: count, from: null };

    // 1. Process any pending response from the previous prompt.
    if (ctx.pendingChoice) {
      const picked = ctx.pendingChoice.response as string | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      if (state.from === null) {
        // Was the "pick troop to move" prompt.
        if (!picked) { ctx.handlerState = null; return true; }
        state = { remaining: state.remaining, from: picked };
      } else {
        // Was the "pick destination" prompt.
        if (picked && moveTroop(ctx.G, state.from, picked)) {
          Mechanics.log(ctx.G, `Moved troop ${state.from} → ${picked}`);
        }
        state = { remaining: state.remaining - 1, from: null };
      }
    }

    // 2. Decide what to do next.
    if (state.remaining <= 0) { ctx.handlerState = null; return true; }

    const me = ctx.G.players[ctx.actorId];
    if (state.from === null) {
      // Rulebook p.12 "Move a Troop": you may move a troop ONLY from a
      // space where you have Presence. Destination is unrestricted (any
      // empty troop space) — that part the handler already gets right.
      const eligible = TROOP_SPACES.filter(t => {
        if (!(t.id in ctx.G.troops)) return false;
        const occ = ctx.G.troops[t.id];
        if (!occ || occ === me.color) return false;
        if (t.parentSite) return hasPresence(ctx.G, me.color, { site: t.parentSite });
        if (t.parentRoute) return hasPresence(ctx.G, me.color, { space: t.id });
        return false;
      }).map(t => t.id);
      if (eligible.length === 0) {
        Mechanics.log(ctx.G, '(move enemy troop: no enemy / white troops at any space where you have presence — skipped)');
        ctx.handlerState = null;
        return true;
      }
      ctx.pendingChoice = {
        kind: 'select-troop-space',
        prompt: `Move an enemy troop — pick the troop (${state.remaining} left).`,
        options: eligible,
        optional: true,
      } as PendingChoice;
    } else {
      const empty = TROOP_SPACES.filter(t => t.id in ctx.G.troops && ctx.G.troops[t.id] === null).map(t => t.id);
      if (empty.length === 0) { ctx.handlerState = null; return true; }
      ctx.pendingChoice = {
        kind: 'select-troop-space',
        prompt: `Move the ${ctx.G.troops[state.from]} troop to which empty space?`,
        options: empty,
        optional: true,
      } as PendingChoice;
    }
    ctx.paused = true;
    ctx.handlerState = state;
    return false;
  };
}

// ---------- Compose multiple sub-handlers in sequence ----------
//
// Runs sub-handlers in order; if any suspends, the parent suspends too. Resumes from
// the same sub-handler on the next call. Uses `handlerState` to track progress.

interface SeqState { stepIdx: number; childState: unknown }

export function sequence(...steps: EffectHandler[]): EffectHandler {
  return ctx => {
    let state = (ctx.handlerState as SeqState | null) ?? { stepIdx: 0, childState: null };
    while (state.stepIdx < steps.length) {
      // Run the current step with its preserved childState.
      const childCtx: EffectContext = {
        ...ctx,
        pendingChoice: ctx.pendingChoice,
        handlerState: state.childState,
        paused: ctx.paused,
      };
      const done = steps[state.stepIdx](childCtx);
      if (!done) {
        // Sub-handler suspended.
        ctx.pendingChoice = childCtx.pendingChoice;
        ctx.paused = true;
        ctx.handlerState = { stepIdx: state.stepIdx, childState: childCtx.handlerState };
        return false;
      }
      // Sub-handler completed; advance.
      state = { stepIdx: state.stepIdx + 1, childState: null };
      // After resume of a sub-handler, clear pendingChoice for the next step.
      ctx.pendingChoice = null;
      ctx.paused = false;
    }
    ctx.handlerState = null;
    return true;
  };
}

// ---------- Focus keyword (Elemental half-deck) ----------
//
// Rulebook p.9: "Whenever you play a card with Focus, if you played another card of that
// card's aspect this turn OR if you reveal a card of that aspect from your hand, you get
// the Focus effect."
//
// Implementation: auto-triggers when `turnAspectsPlayed[aspect] > 1` (current card + at
// least one other of the same aspect already in the turn tally). The manual-reveal path
// is not yet supported; if the count is 1, the Focus effect is silently skipped.

interface FocusState { revealChecked?: boolean; childState?: unknown }

export function focus(aspect: string, bonus: EffectHandler): EffectHandler {
  const key = aspect.toLowerCase();
  return ctx => {
    let state = (ctx.handlerState as FocusState | null) ?? {};
    const count = ctx.G.turnAspectsPlayed[key] ?? 0;

    // Auto-trigger: another same-aspect card was already played this turn.
    if (count > 1) {
      if (!state.revealChecked) Mechanics.log(ctx.G, `Focus (${aspect}) triggered (chain).`);
      const childCtx: EffectContext = { ...ctx, pendingChoice: ctx.pendingChoice, handlerState: state.childState, paused: ctx.paused };
      const done = bonus(childCtx);
      if (!done) {
        ctx.pendingChoice = childCtx.pendingChoice; ctx.paused = true;
        ctx.handlerState = { revealChecked: true, childState: childCtx.handlerState };
        return false;
      }
      ctx.handlerState = null;
      return true;
    }

    // Otherwise surface a reveal prompt over aspect-matching hand cards.
    if (!state.revealChecked) {
      if (!ctx.pendingChoice) {
        const me = ctx.G.players[ctx.actorId];
        const eligible: number[] = [];
        for (let i = 0; i < me.hand.length; i++) {
          const d = lookupCard(me.hand[i].deck, me.hand[i].slot);
          if (d?.aspect.toLowerCase() === key) eligible.push(i);
        }
        if (eligible.length === 0) { ctx.handlerState = null; return true; } // no eligible reveal
        ctx.pendingChoice = {
          kind: 'select-card-in-hand',
          prompt: `Reveal a ${aspect} card from hand for the Focus bonus?`,
          options: eligible,
          optional: true,
        } as PendingChoice;
        ctx.paused = true;
        return false;
      }
      const idx = ctx.pendingChoice.response as number | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      if (idx == null) { ctx.handlerState = null; return true; } // declined
      Mechanics.log(ctx.G, `Focus (${aspect}) triggered (revealed).`);
      state = { revealChecked: true, childState: null };
    }

    const childCtx: EffectContext = { ...ctx, pendingChoice: ctx.pendingChoice, handlerState: state.childState, paused: ctx.paused };
    const done = bonus(childCtx);
    if (!done) {
      ctx.pendingChoice = childCtx.pendingChoice; ctx.paused = true;
      ctx.handlerState = { revealChecked: true, childState: childCtx.handlerState };
      return false;
    }
    ctx.handlerState = null;
    return true;
  };
}

// ---------- Promote the top card(s) of the player's deck ----------
//
// Pops the top of the deck and promotes it via Mechanics.promote, which already honors
// the Insane Outcast self-eject rule (returns to supply instead of joining inner circle).
// Reshuffles the discard into the deck if the deck is empty.

export function promoteTopOfDeck(opts?: { count?: number }): EffectHandler {
  const count = opts?.count ?? 1;
  return ctx => {
    const me = ctx.G.players[ctx.actorId];
    for (let i = 0; i < count; i++) {
      if (me.deck.length === 0) {
        if (me.discard.length === 0) break;
        // Deterministic Fisher-Yates with the boardgame.io seeded RNG when
        // available. Mirrors the shuffle in Mechanics.draw so promote-on-empty
        // and draw-on-empty behave the same way under replay.
        const rng = ctx.random ? () => ctx.random!.Number() : () => Math.random();
        const deck = me.discard.slice();
        for (let k = deck.length - 1; k > 0; k--) {
          const j = Math.floor(rng() * (k + 1));
          [deck[k], deck[j]] = [deck[j], deck[k]];
        }
        me.deck = deck;
        me.discard = [];
      }
      const card = me.deck.shift();
      if (!card) break;
      Mechanics.promote(ctx.G, ctx.actorId, card);
    }
    return true;
  };
}

// ---------- Free filtered recruit from market ----------
//
// Aerisi Kalinoth / Gar Shatterkeel / Marlos Urnrayle / Vanifer all read:
//   "Recruit a [Aspect] card from the market that costs N or less."
// Surfaces a market picker filtered to slots matching aspect + cost cap. Recruit is
// free (no influence spent).

export function recruitFromMarketFiltered(opts: { aspect: string; maxCost: number }): EffectHandler {
  return ctx => {
    if (!ctx.pendingChoice) {
      const eligible: number[] = [];
      for (let i = 0; i < ctx.G.market.row.length; i++) {
        const c = ctx.G.market.row[i];
        if (!c) continue;
        const data = lookupCard(c.deck, c.slot);
        if (!data) continue;
        if (data.aspect.toLowerCase() !== opts.aspect.toLowerCase()) continue;
        if (data.cost > opts.maxCost) continue;
        eligible.push(i);
      }
      if (eligible.length === 0) return true;
      ctx.pendingChoice = {
        kind: 'select-market-card',
        prompt: `Recruit a ${opts.aspect} card costing ≤${opts.maxCost} (free).`,
        options: eligible,
        optional: true,
      } as PendingChoice;
      ctx.paused = true;
      return false;
    }
    const idx = ctx.pendingChoice.response as number | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    if (idx == null) return true;
    Mechanics.recruitFromMarket(ctx.G, ctx.actorId, idx);
    return true;
  };
}

// ---------- Give Insane Outcasts to opponents ----------
//
// Places a fresh Insane Outcast card into the target opponent's discard pile (rulebook
// p.13: "If the supply of … Insane Outcasts runs out, the game continues, but you'll no
// longer be able to recruit one of those cards."). We don't yet track the 30-card
// supply cap; that's deferred until end-game scoring needs it.

function makeOutcastRef(): CardRef | null {
  const data = cardsInDeck('insane-outcasts')[0];
  if (!data) return null;
  return { deck: data.deck, slot: data.slot, name: data.name, image: data.image };
}

/** "Give an Insane Outcast to each opponent" (rulebook-phrased: each opponent recruits one). */
export function giveOutcastToEachOpponent(opts?: { count?: number }): EffectHandler {
  const count = opts?.count ?? 1;
  return ctx => {
    const ref = makeOutcastRef();
    if (!ref) return true;
    for (const pid of Object.keys(ctx.G.players)) {
      if (pid === ctx.actorId) continue;
      for (let i = 0; i < count; i++) {
        ctx.G.players[pid].discard.push({ ...ref });
      }
      Mechanics.log(ctx.G, `P${Number(pid) + 1} received ${count} Insane Outcast${count > 1 ? 's' : ''}`);
    }
    return true;
  };
}

/** "Give an Insane Outcast to a chosen opponent." Surfaces a select-player picker. */
export function giveOutcastToChosenOpponent(): EffectHandler {
  return ctx => {
    if (!ctx.pendingChoice) {
      const opponents = Object.keys(ctx.G.players).filter(id => id !== ctx.actorId);
      if (opponents.length === 0) return true;
      ctx.pendingChoice = {
        kind: 'select-player',
        prompt: 'Give an Insane Outcast to which opponent?',
        options: opponents,
        optional: true,
      } as PendingChoice;
      ctx.paused = true;
      return false;
    }
    const pid = ctx.pendingChoice.response as string | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    if (!pid) return true;
    const ref = makeOutcastRef();
    if (!ref) return true;
    ctx.G.players[pid].discard.push({ ...ref });
    Mechanics.log(ctx.G, `P${Number(pid) + 1} received Insane Outcast`);
    return true;
  };
}

// ---------- Whole-deck-to-discard + promote-from-discard (Matron Mother) ----------

export function moveDeckToDiscard(): EffectHandler {
  return ctx => {
    const me = ctx.G.players[ctx.actorId];
    if (me.deck.length === 0) return true;
    Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} moved ${me.deck.length} cards from deck to discard`);
    me.discard.push(...me.deck);
    me.deck = [];
    return true;
  };
}

export function promoteFromDiscardChoice(opts?: { optional?: boolean }): EffectHandler {
  return ctx => {
    if (!ctx.pendingChoice) {
      const me = ctx.G.players[ctx.actorId];
      if (me.discard.length === 0) return true;
      ctx.pendingChoice = {
        kind: 'select-card-in-discard',
        prompt: 'Promote a card from your discard.',
        options: me.discard.map((_, i) => i),
        optional: opts?.optional,
      } as PendingChoice;
      ctx.paused = true;
      return false;
    }
    const idx = ctx.pendingChoice.response as number | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    if (idx == null) return true;
    const me = ctx.G.players[ctx.actorId];
    const card = me.discard[idx];
    if (!card) return true;
    me.discard.splice(idx, 1);
    Mechanics.promote(ctx.G, ctx.actorId, card);
    return true;
  };
}

// ---------- Devour-from-inner-circle optional cost (Zuggtmoy) ----------

interface DevourICState { paid?: boolean; childState?: unknown }

export function devourFromInnerCircleCost(thenEffect: EffectHandler, opts?: { promptLabel?: string }): EffectHandler {
  return ctx => {
    let state = (ctx.handlerState as DevourICState | null) ?? {};
    if (!state.paid) {
      if (!ctx.pendingChoice) {
        const me = ctx.G.players[ctx.actorId];
        if (me.innerCircle.length === 0) { ctx.handlerState = null; return true; }
        ctx.pendingChoice = {
          kind: 'select-card-in-inner-circle',
          prompt: opts?.promptLabel ?? 'Devour a card from your inner circle to trigger this effect?',
          options: me.innerCircle.map((_, i) => i),
          optional: true,
        } as PendingChoice;
        ctx.paused = true;
        return false;
      }
      const idx = ctx.pendingChoice.response as number | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      if (idx == null) { ctx.handlerState = null; return true; }
      const me = ctx.G.players[ctx.actorId];
      const card = me.innerCircle[idx];
      if (!card) { ctx.handlerState = null; return true; }
      me.innerCircle.splice(idx, 1);
      Mechanics.devour(ctx.G, card);
      Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} devoured ${card.name} from inner circle`);
      state = { paid: true, childState: null };
    }
    const childCtx: EffectContext = {
      ...ctx,
      pendingChoice: ctx.pendingChoice,
      handlerState: state.childState,
      paused: ctx.paused,
    };
    const done = thenEffect(childCtx);
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

// ---------- Return one of your own troops (rulebook p.13) ----------
//
// Return from a troop space or site anywhere on the board to your barracks.

export function returnOwnTroopChoice(opts?: { optional?: boolean }): EffectHandler {
  return ctx => {
    if (!ctx.pendingChoice) {
      const me = ctx.G.players[ctx.actorId];
      const eligible = TROOP_SPACES.filter(t => ctx.G.troops[t.id] === me.color).map(t => t.id);
      if (eligible.length === 0) {
        Mechanics.log(ctx.G, '(return own troop: you have no troops on the board — skipped)');
        return true;
      }
      ctx.pendingChoice = {
        kind: 'select-troop-space',
        prompt: 'Return one of your troops to barracks.',
        options: eligible,
        optional: opts?.optional ?? true,
      } as PendingChoice;
      ctx.paused = true;
      return false;
    }
    const spaceId = ctx.pendingChoice.response as string | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    if (!spaceId) return true;
    const me = ctx.G.players[ctx.actorId];
    if (ctx.G.troops[spaceId] === me.color) {
      ctx.G.troops[spaceId] = null;
      me.barracksLeft += 1;
      Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} returned troop ${spaceId} to barracks`);
    }
    return true;
  };
}

/** "Return one of your troops or spies" — chooses kind first, then targets. */
export function returnOwnTroopOrSpyChoice(): EffectHandler {
  return chooseOne(
    { label: 'Return one of your troops', handler: returnOwnTroopChoice({ optional: false }) },
    { label: 'Return one of your spies',  handler: returnOwnSpyChoice() },
  );
}

/** Return an enemy troop from a space where you have presence (rulebook p.13). */
export function returnEnemyTroopChoice(): EffectHandler {
  return ctx => {
    if (!ctx.pendingChoice) {
      const me = ctx.G.players[ctx.actorId];
      const eligible = TROOP_SPACES.filter(t => {
        const occ = ctx.G.troops[t.id];
        if (!occ || occ === me.color || occ === 'white') return false;
        if (t.parentSite) return hasPresence(ctx.G, me.color, { site: t.parentSite });
        if (t.parentRoute) return hasPresence(ctx.G, me.color, { space: t.id });
        return false;
      }).map(t => t.id);
      if (eligible.length === 0) {
        Mechanics.log(ctx.G, '(return enemy troop: no enemy troops at any space where you have presence — skipped)');
        return true;
      }
      ctx.pendingChoice = {
        kind: 'select-troop-space',
        prompt: "Return an enemy troop (to its owner's barracks).",
        options: eligible,
        optional: true,
      } as PendingChoice;
      ctx.paused = true;
      return false;
    }
    const spaceId = ctx.pendingChoice.response as string | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    if (!spaceId) return true;
    const occ = ctx.G.troops[spaceId];
    if (occ && occ !== 'white') {
      // Use returnTroop so the site-control recompute fires (and the
      // marker transfer / return-to-map logic runs). The earlier
      // implementation null'd the slot directly, which left
      // G.siteControl and the marker holder stale until the next mutation
      // triggered a recompute — visible as "I returned the enemy's
      // troop but the marker still says they control the site".
      const returned = returnTroop(ctx.G, spaceId);
      if (returned && returned !== 'white') {
        const ownerEntry = Object.entries(ctx.G.players).find(([, p]) => p.color === returned);
        if (ownerEntry) ownerEntry[1].barracksLeft += 1;
        Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} returned ${returned} troop from ${spaceId}`);
      }
    }
    return true;
  };
}

/** Return an enemy spy from a site where you have presence (rulebook p.13). */
export function returnEnemySpyChoice(): EffectHandler {
  return ctx => {
    if (!ctx.pendingChoice) {
      const me = ctx.G.players[ctx.actorId];
      const eligible = SITES.filter(s => {
        if (!hasPresence(ctx.G, me.color, { site: s.id })) return false;
        return (ctx.G.spies[s.id] ?? []).some(c => c !== me.color);
      }).map(s => s.id);
      if (eligible.length === 0) {
        Mechanics.log(ctx.G, '(return enemy spy: no enemy spies at any site where you have presence — skipped)');
        return true;
      }
      ctx.pendingChoice = {
        kind: 'select-site',
        prompt: 'Return an enemy spy from which site?',
        options: eligible,
        optional: true,
      } as PendingChoice;
      ctx.paused = true;
      return false;
    }
    const siteId = ctx.pendingChoice.response as string | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    if (!siteId) return true;
    const me = ctx.G.players[ctx.actorId];
    const arr = ctx.G.spies[siteId] ?? [];
    const enemyColor = arr.find(c => c !== me.color);
    if (enemyColor) {
      if (returnSpy(ctx.G, enemyColor, siteId)) {
        // The returned spy goes back to its owner's supply, not yours.
        ensureSpiesLeftInitialized(ctx.G, enemyColor);
        const ownerPid = Object.keys(ctx.G.players).find(k => ctx.G.players[k].color === enemyColor);
        if (ownerPid) ctx.G.players[ownerPid].spiesLeft += 1;
        Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} returned ${enemyColor} spy from ${siteId}`);
      }
    }
    return true;
  };
}

/** "Return an enemy troop or spy" — Blue Wyrmling's secondary effect. */
export function returnEnemyTroopOrSpyChoice(): EffectHandler {
  return chooseOne(
    { label: 'Return an enemy troop', handler: returnEnemyTroopChoice(), available: playerCanReturnEnemyTroop },
    { label: 'Return an enemy spy',   handler: returnEnemySpyChoice(),   available: playerCanReturnEnemySpy },
  );
}

/** True when the player has at least one enemy player-color troop they could
 *  legally return — i.e. a troop in a space where they have presence. */
export function playerCanReturnEnemyTroop(G: import('../game').TyrantsState, actorId: string): boolean {
  const me = G.players[actorId];
  for (const t of TROOP_SPACES) {
    const occ = G.troops[t.id];
    if (!occ || occ === me.color || occ === 'white') continue;
    if (t.parentSite && hasPresence(G, me.color, { site: t.parentSite })) return true;
    if (t.parentRoute && hasPresence(G, me.color, { space: t.id })) return true;
  }
  return false;
}

/** True when the player has at least one troop they could legally assassinate
 *  — a non-self, non-empty troop in a space where they have presence.
 *  `whiteOnly` restricts the eligible-target set to the white pile (used by
 *  Weaponmaster's "Assassinate a white troop" option so it doesn't surface
 *  when no whites are within reach). */
export function playerCanAssassinate(
  G: import('../game').TyrantsState,
  actorId: string,
  opts?: { whiteOnly?: boolean },
): boolean {
  const me = G.players[actorId];
  for (const t of TROOP_SPACES) {
    if (!(t.id in G.troops)) continue; // outside active sections
    const occ = G.troops[t.id];
    if (!occ || occ === me.color) continue;
    if (opts?.whiteOnly && occ !== 'white') continue;
    if (t.parentSite && hasPresence(G, me.color, { site: t.parentSite })) return true;
    if (t.parentRoute && hasPresence(G, me.color, { space: t.id })) return true;
  }
  return false;
}

/** True when the player has at least one enemy spy they could legally return —
 *  a spy at a site where the player has presence. */
export function playerCanReturnEnemySpy(G: import('../game').TyrantsState, actorId: string): boolean {
  const me = G.players[actorId];
  for (const s of SITES) {
    if (!hasPresence(G, me.color, { site: s.id })) continue;
    if ((G.spies[s.id] ?? []).some(c => c !== me.color)) return true;
  }
  return false;
}

// ---------- Conditional grants gated on the last placed spy site ----------
//
// Three variants over `_lastPlacedSpySite` (stashed by placeSpyAtChosenSite):
//   - ifTroopAtLastPlacedSpySite           — your own troop at the site
//   - ifEnemyTroopAtLastPlacedSpySite      — any non-self troop (incl. white)
//   - ifAnotherPlayerTroopAtLastPlacedSpySite
//       — strictly another PLAYER's troop (non-self, non-white). This is the
//         exact phrasing on Infiltrator's printed card ("another player's
//         troop"), and white/unaligned troops don't satisfy "another player".

export function ifTroopAtLastPlacedSpySite(bonus: EffectHandler): EffectHandler {
  return ctx => {
    const siteId = (ctx.G as unknown as { _lastPlacedSpySite?: string })._lastPlacedSpySite;
    if (!siteId) return true;
    const me = ctx.G.players[ctx.actorId];
    const hasTroop = TROOP_SPACES.some(t => t.parentSite === siteId && ctx.G.troops[t.id] === me.color);
    if (!hasTroop) return true;
    Mechanics.log(ctx.G, `(spy-site own-troop bonus triggered at ${siteId})`);
    return bonus(ctx);
  };
}

/** Bonus only fires if at least one space at the spy's site has a troop
 *  owned by another PLAYER (i.e. an enemy color — white doesn't count, since
 *  white is unaligned, not "another player"). */
export function ifAnotherPlayerTroopAtLastPlacedSpySite(bonus: EffectHandler): EffectHandler {
  return ctx => {
    const siteId = (ctx.G as unknown as { _lastPlacedSpySite?: string })._lastPlacedSpySite;
    if (!siteId) return true;
    const me = ctx.G.players[ctx.actorId];
    const hasOpponent = TROOP_SPACES.some(t => {
      if (t.parentSite !== siteId) return false;
      const occ = ctx.G.troops[t.id];
      return !!occ && occ !== me.color && occ !== 'white';
    });
    if (!hasOpponent) return true;
    Mechanics.log(ctx.G, `(spy-site another-player-troop bonus triggered at ${siteId})`);
    return bonus(ctx);
  };
}

/** "If an enemy troop is at the spy-placed site, run bonus."
 *  Used by Green Wyrmling: place a spy, then if enemy troops at that site, +2 Influence.
 *  "Enemy" includes white troops per rulebook p.11. */
export function ifEnemyTroopAtLastPlacedSpySite(bonus: EffectHandler): EffectHandler {
  return ctx => {
    const siteId = (ctx.G as unknown as { _lastPlacedSpySite?: string })._lastPlacedSpySite;
    if (!siteId) return true;
    const me = ctx.G.players[ctx.actorId];
    const hasEnemy = TROOP_SPACES.some(t => {
      if (t.parentSite !== siteId) return false;
      const occ = ctx.G.troops[t.id];
      return occ && occ !== me.color;
    });
    if (!hasEnemy) return true;
    Mechanics.log(ctx.G, `(spy-site enemy-troop bonus triggered at ${siteId})`);
    return bonus(ctx);
  };
}

// ---------- Devour a market card ----------

export function devourMarketChoice(opts?: { optional?: boolean }): EffectHandler {
  return ctx => {
    if (!ctx.pendingChoice) {
      const eligible: number[] = [];
      for (let i = 0; i < ctx.G.market.row.length; i++) if (ctx.G.market.row[i]) eligible.push(i);
      if (eligible.length === 0) return true;
      ctx.pendingChoice = {
        kind: 'select-market-card',
        prompt: 'Devour a card in the market.',
        options: eligible,
        optional: opts?.optional ?? true,
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
    Mechanics.devour(ctx.G, card);
    ctx.G.market.row[idx] = ctx.G.market.deck.shift() ?? null;
    return true;
  };
}

// ---------- Add an Insane Outcast to your own discard (e.g. Derro) ----------

export function recruitOutcastToSelf(): EffectHandler {
  return ctx => {
    const ref = makeOutcastRef();
    if (!ref) return true;
    ctx.G.players[ctx.actorId].discard.push({ ...ref });
    Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} added Insane Outcast to discard`);
    return true;
  };
}

// ---------- Adjacency-aware Outcast giver (Gibbering Mouther) ----------
//
// After a deploy, give an Outcast to a player who has a troop "adjacent" to the just-
// deployed space. We define adjacency as: same site (for site spaces), the spaces of any
// route touching that site, and (for route spaces) the same route's spaces and the two
// endpoint sites' spaces.

function spacesAdjacentTo(spaceId: string): string[] {
  const s = TROOP_SPACES.find(t => t.id === spaceId);
  if (!s) return [];
  const out = new Set<string>();
  if (s.parentSite) {
    for (const t of TROOP_SPACES) if (t.parentSite === s.parentSite && t.id !== spaceId) out.add(t.id);
    for (const r of ROUTES) {
      if (r.a === s.parentSite || r.b === s.parentSite) {
        for (let i = 0; i < r.spaces; i++) out.add(`${r.id}:${i}`);
      }
    }
  } else if (s.parentRoute) {
    const r = ROUTES.find(rr => rr.id === s.parentRoute)!;
    for (let i = 0; i < r.spaces; i++) if (i !== s.index) out.add(`${r.id}:${i}`);
    for (const endpoint of [r.a, r.b]) {
      for (const t of TROOP_SPACES) if (t.parentSite === endpoint) out.add(t.id);
    }
  }
  return [...out];
}

export function giveOutcastToOpponentAdjacentToLastDeploy(): EffectHandler {
  return ctx => {
    const Gx = ctx.G as unknown as { _lastDeploySpace?: string; _recentDeploySpaces?: string[] };
    // Prefer the full list of deploys made during this card's resolution (Gibbering
    // Mouther deploys 2, opponent must be adjacent to AT LEAST 1 of them). Fall back
    // to the last deploy for single-deploy callers.
    const deploys = (Gx._recentDeploySpaces && Gx._recentDeploySpaces.length > 0)
      ? Gx._recentDeploySpaces
      : (Gx._lastDeploySpace ? [Gx._lastDeploySpace] : []);
    if (deploys.length === 0) return true;
    const myColor = ctx.G.players[ctx.actorId].color;
    const opponentColors = new Set<string>();
    for (const deploySpace of deploys) {
      for (const sp of spacesAdjacentTo(deploySpace)) {
        const occ = ctx.G.troops[sp];
        if (occ && occ !== 'white' && occ !== myColor) opponentColors.add(occ);
      }
    }
    // Map troop colors back to player IDs.
    const opponentIds: string[] = [];
    for (const pid of Object.keys(ctx.G.players)) {
      if (pid === ctx.actorId) continue;
      if (opponentColors.has(ctx.G.players[pid].color)) opponentIds.push(pid);
    }
    if (opponentIds.length === 0) {
      Mechanics.log(ctx.G, '(no opponent has a troop adjacent to a deployed troop — no Outcast given)');
      return true;
    }
    if (!ctx.pendingChoice) {
      ctx.pendingChoice = {
        kind: 'select-player',
        prompt: 'Give an Insane Outcast to which adjacent opponent?',
        options: opponentIds,
        optional: true,
      } as PendingChoice;
      ctx.paused = true;
      return false;
    }
    const pid = ctx.pendingChoice.response as string | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    if (!pid) return true;
    const ref = makeOutcastRef();
    if (!ref) return true;
    ctx.G.players[pid].discard.push({ ...ref });
    Mechanics.log(ctx.G, `P${Number(pid) + 1} received Insane Outcast (adjacent to deploy)`);
    return true;
  };
}

// ---------- Return ALL your spies, supplanting at each (Graz'zt) ----------
//
// User chooses ANY NUMBER of their placed spies; for each one they pick, the spy
// returns to their supply and they supplant a troop at that spy's site. They can
// stop at any point. If a chosen spy's site has no supplantable troops, we
// surface a confirmation before returning it for no benefit (the user can either
// confirm "yes, return anyway" or back out and pick a different spy).
//
// State machine:
//   - phase 'pick-spy-or-stop': chooseOne over remaining spy sites + "Stop".
//   - phase 'confirm-empty':    confirm returning a spy at a site with no
//                               supplantable troops (no benefit).
//   - phase 'supplant':         select-troop-space picker for the supplant.

interface GrazztState {
  phase: 'pick-spy-or-stop' | 'confirm-empty' | 'supplant';
  /** Sites the player has spies at right now. Refreshed each pass so a
   *  mid-card effect that moves spies stays consistent. */
  remaining: string[];
  /** Which site the player most recently picked — relevant during
   *  'confirm-empty' and 'supplant' phases. */
  picked?: string;
}

function grazztRefreshRemaining(G: import('../game').TyrantsState, color: import('../game').Color): string[] {
  return SITES.filter(s => (G.spies[s.id] ?? []).includes(color)).map(s => s.id);
}

function grazztSupplantTargets(G: import('../game').TyrantsState, color: import('../game').Color, siteId: string): string[] {
  return TROOP_SPACES.filter(t => t.parentSite === siteId).map(t => t.id).filter(id => {
    const occ = G.troops[id];
    return occ && occ !== color;
  });
}

export function returnAnySpiesAndSupplantAtEach(): EffectHandler {
  return ctx => {
    const me = ctx.G.players[ctx.actorId];
    const myColor = me.color;
    let state = ctx.handlerState as GrazztState | null;

    // First entry — open the pick-spy-or-stop prompt.
    if (!state) {
      ensureSpiesLeftInitialized(ctx.G, myColor);
      const remaining = grazztRefreshRemaining(ctx.G, myColor);
      if (remaining.length === 0) {
        Mechanics.log(ctx.G, `(Graz'zt return: no spies on the board — skipped)`);
        return true;
      }
      ctx.pendingChoice = {
        kind: 'choose-one',
        prompt: 'Return a spy and supplant at its site (or stop).',
        options: [...remaining.map(s => `Return spy from ${s}`), 'Stop'],
      } as PendingChoice;
      ctx.paused = true;
      ctx.handlerState = { phase: 'pick-spy-or-stop', remaining };
      return false;
    }

    // Phase: user just picked a spy site (or stop).
    if (state.phase === 'pick-spy-or-stop') {
      const idx = ctx.pendingChoice?.response as number | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      if (idx == null || idx >= state.remaining.length) {
        // Picked "Stop" (or response invalid).
        ctx.handlerState = null;
        return true;
      }
      const picked = state.remaining[idx];
      const targets = grazztSupplantTargets(ctx.G, myColor, picked);
      if (targets.length === 0) {
        // No supplantable troops — confirm before wasting the spy.
        ctx.pendingChoice = {
          kind: 'choose-one',
          prompt: `${picked} has no enemy / white troops to supplant. Return this spy anyway (no benefit)?`,
          options: ['Yes, return the spy', 'No, pick a different spy'],
        } as PendingChoice;
        ctx.paused = true;
        ctx.handlerState = { phase: 'confirm-empty', remaining: state.remaining, picked };
        return false;
      }
      // Eligible supplant targets — return the spy now and prompt the supplant pick.
      ensureSpiesLeftInitialized(ctx.G, myColor);
      if (returnSpy(ctx.G, myColor, picked)) {
        me.spiesLeft += 1;
        Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} returned spy from ${picked} (spies left: ${me.spiesLeft})`);
      }
      ctx.pendingChoice = {
        kind: 'select-troop-space',
        prompt: `Supplant a troop at ${picked}.`,
        options: targets,
        optional: true,
      } as PendingChoice;
      ctx.paused = true;
      ctx.handlerState = { phase: 'supplant', remaining: state.remaining, picked };
      return false;
    }

    // Phase: confirm-empty (the spy's site has no supplantable troops).
    if (state.phase === 'confirm-empty') {
      const idx = ctx.pendingChoice?.response as number | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      if (idx === 0 && state.picked) {
        // User confirmed — return the spy with no supplant.
        ensureSpiesLeftInitialized(ctx.G, myColor);
        if (returnSpy(ctx.G, myColor, state.picked)) {
          me.spiesLeft += 1;
          Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} returned spy from ${state.picked} (no supplant — site had no targets) (spies left: ${me.spiesLeft})`);
        }
      }
      // Either way, re-open the pick-spy-or-stop loop with refreshed remaining.
      const remaining = grazztRefreshRemaining(ctx.G, myColor);
      if (remaining.length === 0) {
        ctx.handlerState = null;
        return true;
      }
      ctx.pendingChoice = {
        kind: 'choose-one',
        prompt: 'Return another spy and supplant at its site (or stop).',
        options: [...remaining.map(s => `Return spy from ${s}`), 'Stop'],
      } as PendingChoice;
      ctx.paused = true;
      ctx.handlerState = { phase: 'pick-spy-or-stop', remaining };
      return false;
    }

    // Phase: supplant pick at the just-returned spy's site.
    if (state.phase === 'supplant') {
      const spaceId = ctx.pendingChoice?.response as string | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      if (spaceId) {
        const killed = assassinateTroop(ctx.G, spaceId);
        if (killed) {
          if (killed === 'white') me.trophyHall.white += 1;
          else if (killed !== myColor) me.trophyHall[killed] = (me.trophyHall[killed] ?? 0) + 1;
          if (me.barracksLeft > 0) {
            if (deployTroop(ctx.G, myColor, spaceId)) {
              me.barracksLeft -= 1;
              Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} supplanted ${killed} at ${spaceId} (barracks: ${me.barracksLeft})`);
            }
          } else {
            me.vp += 1;
            Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} supplanted ${killed} at ${spaceId} — barracks empty, +1 VP`);
          }
        }
      }
      const remaining = grazztRefreshRemaining(ctx.G, myColor);
      if (remaining.length === 0) {
        ctx.handlerState = null;
        return true;
      }
      ctx.pendingChoice = {
        kind: 'choose-one',
        prompt: 'Return another spy and supplant at its site (or stop).',
        options: [...remaining.map(s => `Return spy from ${s}`), 'Stop'],
      } as PendingChoice;
      ctx.paused = true;
      ctx.handlerState = { phase: 'pick-spy-or-stop', remaining };
      return false;
    }

    // Defensive: unknown phase.
    ctx.handlerState = null;
    return true;
  };
}

// ---------- Take a trophy and place it (Orcus) ----------
//
// Up to N iterations. Each iteration:
//   1. Pick a (player, color) pair — any trophy hall, any color with count > 0.
//   2. Pick an empty board space (anywhere).
//   3. Remove 1 trophy of that color from that hall; place a token OF THAT COLOR
//      at the chosen space.
// Each iteration is optional; declining a pick ends the whole effect early
// (per "the player could choose not to do it or to only do one").
// The placed token is the literal color taken — could be white, an enemy color,
// or even the active player's own color (if they take from their own hall).

interface OrcusIterState {
  remaining: number;
  /** When set, we've already picked the (player, color) and are waiting for a space. */
  picked?: { playerId: string; color: Color | 'white'; label: string };
}

export function takeTrophyAndPlace(opts: { count: number }): EffectHandler {
  return ctx => {
    let state = (ctx.handlerState as OrcusIterState | null) ?? { remaining: opts.count };

    // Step 2 resume: a space was picked → place the token, then loop.
    if (ctx.pendingChoice && state.picked) {
      const spaceId = ctx.pendingChoice.response as string | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      if (!spaceId) { ctx.handlerState = null; return true; } // declined → stop
      const { playerId: srcId, color, label } = state.picked;
      const src = ctx.G.players[srcId];
      if ((src.trophyHall[color] ?? 0) > 0) {
        src.trophyHall[color] = (src.trophyHall[color] ?? 0) - 1;
        // Place the token of that color (NOT the active player's color, unless
        // the color happens to be the active player's).
        if (!ctx.G.troops[spaceId]) {
          ctx.G.troops[spaceId] = color;
          Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} took ${label} trophy and placed ${color} at ${spaceId}`);
        }
      }
      state = { remaining: state.remaining - 1 };
      ctx.handlerState = state;
    }

    // Step 1 resume: a (player, color) pair was picked → prompt for board space.
    if (ctx.pendingChoice && !state.picked) {
      const idx = ctx.pendingChoice.response as number | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      if (idx == null) { ctx.handlerState = null; return true; } // declined → stop
      const choices = enumerateTrophies(ctx.G);
      const sel = choices[idx];
      if (!sel) { ctx.handlerState = null; return true; }
      state = { remaining: state.remaining, picked: sel };
      ctx.pendingChoice = {
        kind: 'select-troop-space',
        prompt: `Place the ${sel.color} trophy on any empty space (or decline to skip).`,
        options: TROOP_SPACES.filter(t => t.id in ctx.G.troops && ctx.G.troops[t.id] === null).map(t => t.id),
        optional: true,
      } as PendingChoice;
      ctx.paused = true;
      ctx.handlerState = state;
      return false;
    }

    // Loop end?
    if (state.remaining <= 0) { ctx.handlerState = null; return true; }

    // Step 1 fresh prompt: list every (player, color) with > 0 trophies.
    const choices = enumerateTrophies(ctx.G);
    if (choices.length === 0) { ctx.handlerState = null; return true; }
    ctx.pendingChoice = {
      kind: 'choose-one',
      prompt: `Take a trophy (${state.remaining} remaining). Pick which trophy hall + color:`,
      options: choices.map(c => c.label),
      optional: true,
    } as PendingChoice;
    ctx.paused = true;
    ctx.handlerState = { remaining: state.remaining, picked: undefined };
    return false;
  };
}

function enumerateTrophies(G: import('../game').TyrantsState): Array<{ playerId: string; color: Color | 'white'; label: string }> {
  const out: Array<{ playerId: string; color: Color | 'white'; label: string }> = [];
  for (const [pid, p] of Object.entries(G.players)) {
    for (const [color, n] of Object.entries(p.trophyHall)) {
      if (n > 0) out.push({
        playerId: pid,
        color: color as Color | 'white',
        label: `P${Number(pid) + 1} hall · ${color} (×${n})`,
      });
    }
  }
  return out;
}

// ---------- Repeat a handler N times ----------
//
// Just builds a sequence of N copies of `handler`. Used by Weaponmaster
// ("repeat three times: deploy a troop or assassinate a white troop").

export function times(n: number, handler: EffectHandler): EffectHandler {
  return sequence(...Array.from({ length: n }, () => handler));
}

// ---------- Conditional one-shot grants (read state, maybe grant) ----------

/** Grant something if a predicate on G + actorId is true (e.g. "+3 money if 4+ promoted"). */
export function conditionalGrant(
  predicate: (G: import('../game').TyrantsState, actorId: string) => boolean,
  bonus: EffectHandler,
  description: string
): EffectHandler {
  return ctx => {
    if (predicate(ctx.G, ctx.actorId)) {
      Mechanics.log(ctx.G, `Conditional met: ${description}.`);
      return bonus(ctx);
    }
    return true;
  };
}

// ---------- Tiny convenience: register many handlers at once ----------

export function registerAll(table: Record<string, EffectHandler>) {
  for (const [key, fn] of Object.entries(table)) CardRegistry.register(key, fn);
}

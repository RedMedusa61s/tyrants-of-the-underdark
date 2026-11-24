// Small building blocks specific to house abilities that don't already have
// an engine/handler-helpers.ts equivalent. Written in the exact same
// EffectHandler / ctx.handlerState state-machine style so they compose with
// sequence()/chooseOne()/times() the same way card effects do, and so
// houses/handlers/*.ts stay one-liners wiring these together — the same
// relationship engine/handler-helpers.ts has to engine/handlers/*.ts.

import { Mechanics } from '../engine/mechanics';
import { deployTroop, moveTroop, hasTotalControl } from '../engine/map-state';
import { spacesAdjacentTo } from '../engine/handler-helpers';
import { SITES } from '../data/sites';
import { TROOP_SPACES, sitesSpaces } from '../data/troop-spaces';
import { lookupCard } from '../card-data';
import { HouseHooks } from './hooks';
import type { EffectContext, EffectHandler, PendingChoice } from '../engine/types';
import type { TyrantsState } from '../game';

// ---------- Live-state predicates (for `available`) ----------

/** True if the player currently holds (plain) control of any site that has
 *  a control marker. */
export function hasControlOfMarkerSite(G: TyrantsState, actorId: string): boolean {
  const color = G.players[actorId].color;
  return Object.values(G.controlMarkers).some(m => G.siteControl[m.siteId] === color);
}

/** True if the player currently holds TOTAL control of any site that has a
 *  control marker. */
export function hasTotalControlOfMarkerSite(G: TyrantsState, actorId: string): boolean {
  const color = G.players[actorId].color;
  return Object.values(G.controlMarkers).some(
    m => G.siteControl[m.siteId] === color && hasTotalControl(G, color, m.siteId)
  );
}

// ---------- Move one of your own troops to an adjacent tunnel/site ----------
// (Agrach Dyrr's Tunnel Patrols)

interface MoveOwnState { from?: string }

export function moveOwnTroopToAdjacent(): EffectHandler {
  return ctx => {
    const state = (ctx.handlerState as MoveOwnState | null) ?? {};
    const me = ctx.G.players[ctx.actorId];

    if (!state.from) {
      if (!ctx.pendingChoice) {
        const eligible = TROOP_SPACES
          .filter(t => t.id in ctx.G.troops && ctx.G.troops[t.id] === me.color)
          .filter(t => spacesAdjacentTo(t.id).some(adj => ctx.G.troops[adj] === null))
          .map(t => t.id);
        if (eligible.length === 0) {
          Mechanics.log(ctx.G, '(Tunnel Patrols: no troop with an empty adjacent space — skipped)');
          ctx.handlerState = null;
          return true;
        }
        ctx.pendingChoice = {
          kind: 'select-troop-space',
          prompt: 'Tunnel Patrols: move which of your troops?',
          options: eligible,
          optional: true,
        } as PendingChoice;
        ctx.paused = true;
        return false;
      }
      const from = ctx.pendingChoice.response as string | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      if (!from) { ctx.handlerState = null; return true; }
      ctx.handlerState = { from };
      return moveOwnTroopToAdjacentDest(ctx, from);
    }
    return moveOwnTroopToAdjacentDest(ctx, state.from);
  };
}

function moveOwnTroopToAdjacentDest(ctx: EffectContext, from: string): boolean {
  if (!ctx.pendingChoice) {
    const dest = spacesAdjacentTo(from).filter(id => ctx.G.troops[id] === null);
    if (dest.length === 0) {
      Mechanics.log(ctx.G, '(Tunnel Patrols: no empty adjacent space left — skipped)');
      ctx.handlerState = null;
      return true;
    }
    ctx.pendingChoice = {
      kind: 'select-troop-space',
      prompt: 'Tunnel Patrols: move to which adjacent tunnel/site?',
      options: dest,
    } as PendingChoice;
    ctx.paused = true;
    return false;
  }
  const to = ctx.pendingChoice.response as string | null;
  ctx.pendingChoice = null;
  ctx.paused = false;
  ctx.handlerState = null;
  if (!to) return true;
  if (moveTroop(ctx.G, from, to)) {
    Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} (Tunnel Patrols) moved a troop ${from} → ${to}`);
  }
  return true;
}

// ---------- Sacrifice a trophy to reclaim one of your own troops ----------
// (Agrach Dyrr's The Lich-Matron's Claim)

interface ClaimState { phase: 'sacrifice' | 'reclaim' | 'deploy'; sacrificedColor?: string; reclaimedFromPid?: string }

export function sacrificeTrophyThenReclaimTroop(): EffectHandler {
  return ctx => {
    let state = (ctx.handlerState as ClaimState | null) ?? { phase: 'sacrifice' };
    const me = ctx.G.players[ctx.actorId];

    if (state.phase === 'sacrifice') {
      if (!ctx.pendingChoice) {
        const options = (Object.entries(me.trophyHall) as [string, number][]).filter(([, n]) => n > 0).map(([c]) => c);
        if (options.length === 0) {
          Mechanics.log(ctx.G, "(The Lich-Matron's Claim: your Trophy Hall is empty — skipped)");
          ctx.handlerState = null;
          return true;
        }
        ctx.pendingChoice = {
          kind: 'choose-one',
          prompt: 'Remove which trophy from your Trophy Hall?',
          options,
        } as PendingChoice;
        ctx.paused = true;
        return false;
      }
      const idx = ctx.pendingChoice.response as number | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      const options = (Object.entries(me.trophyHall) as [string, number][]).filter(([, n]) => n > 0).map(([c]) => c);
      if (idx == null || !options[idx]) { ctx.handlerState = null; return true; }
      const color = options[idx];
      me.trophyHall[color] -= 1;
      Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} removed a ${color} trophy (Lich-Matron's Claim)`);
      state = { phase: 'reclaim', sacrificedColor: color };
    }

    if (state.phase === 'reclaim') {
      if (!ctx.pendingChoice) {
        const myColor = me.color;
        const holders = Object.keys(ctx.G.players).filter(
          pid => pid !== ctx.actorId && (ctx.G.players[pid].trophyHall[myColor] ?? 0) > 0
        );
        if (holders.length === 0) {
          Mechanics.log(ctx.G, "(Lich-Matron's Claim: no opponent holds one of your troops — nothing reclaimed)");
          ctx.handlerState = null;
          return true;
        }
        ctx.pendingChoice = {
          kind: 'select-player',
          prompt: "Reclaim one of your troops from which opponent's Trophy Hall?",
          options: holders,
        } as PendingChoice;
        ctx.paused = true;
        ctx.handlerState = state;
        return false;
      }
      const targetPid = ctx.pendingChoice.response as string | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      if (!targetPid) { ctx.handlerState = null; return true; }
      const myColor = me.color;
      ctx.G.players[targetPid].trophyHall[myColor] -= 1;
      me.barracksLeft += 1;
      Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} reclaimed a troop from P${Number(targetPid) + 1}'s Trophy Hall`);
      state = { phase: 'deploy', reclaimedFromPid: targetPid };
    }

    // 'deploy': optional free placement of the reclaimed troop.
    if (!ctx.pendingChoice) {
      const eligible = TROOP_SPACES.filter(t => t.id in ctx.G.troops && ctx.G.troops[t.id] === null).map(t => t.id);
      if (eligible.length === 0) { ctx.handlerState = null; return true; }
      ctx.pendingChoice = {
        kind: 'select-troop-space',
        prompt: 'Deploy the reclaimed troop for free? (optional)',
        options: eligible,
        optional: true,
      } as PendingChoice;
      ctx.paused = true;
      ctx.handlerState = state;
      return false;
    }
    const spaceId = ctx.pendingChoice.response as string | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    ctx.handlerState = null;
    if (!spaceId) return true;
    // Free placement — this troop was already restored to barracks above, so
    // deploying it now is just moving it barracks → board (no double count).
    me.barracksLeft -= 1;
    if (deployTroop(ctx.G, me.color, spaceId)) {
      Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} deployed the reclaimed troop at ${spaceId}`);
    } else {
      me.barracksLeft += 1;
    }
    return true;
  };
}

// ---------- Peek + reorder top of own deck (Oblodra's Precognitive Glimpse) ----------

export function peekAndReorderOwnDeckTop(): EffectHandler {
  return ctx => {
    const me = ctx.G.players[ctx.actorId];
    if (me.deck.length === 0) {
      Mechanics.log(ctx.G, '(Precognitive Glimpse: deck is empty — skipped)');
      return true;
    }
    // Looking at the top card is hidden information becoming known to the
    // acting player only; still closes the undo door like any other peek.
    Mechanics.markInfoRevealed(ctx.G);
    if (!ctx.pendingChoice) {
      ctx.pendingChoice = {
        kind: 'choose-one',
        prompt: `Top of your deck: ${me.deck[0].name}. What do you do with it?`,
        options: ['Keep it on top', 'Discard it', 'Put it on the bottom'],
      } as PendingChoice;
      ctx.paused = true;
      return false;
    }
    const idx = ctx.pendingChoice.response as number | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    if (idx === 1) {
      const card = me.deck.shift()!;
      me.discard.push(card);
      Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} discarded ${card.name} from the top of their deck`);
    } else if (idx === 2) {
      const card = me.deck.shift()!;
      me.deck.push(card);
      Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} moved the top of their deck to the bottom`);
    } else {
      Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} left the top of their deck as is`);
    }
    return true;
  };
}

// ---------- Shuffle the whole market row back into the market deck (Oblodra) ----------

export function shuffleMarketRowIntoDeck(): EffectHandler {
  return ctx => {
    const row = ctx.G.market.row.filter((c): c is NonNullable<typeof c> => c != null);
    if (row.length === 0) return true;
    ctx.G.market.deck.push(...row);
    const rng = ctx.random ? () => ctx.random!.Number() : () => Math.random();
    const deck = ctx.G.market.deck;
    for (let k = deck.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      [deck[k], deck[j]] = [deck[j], deck[k]];
    }
    Mechanics.markInfoRevealed(ctx.G);
    for (let i = 0; i < ctx.G.market.row.length; i++) {
      ctx.G.market.row[i] = ctx.G.market.deck.shift() ?? null;
    }
    Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} shuffled the market row into the market deck (Psionic Storm)`);
    return true;
  };
}

// ---------- Deploy for free to an empty STARTING site (Melarn's Established Shrines) ----------
//
// "Empty black site" refers to the game's starting sites (data/sites.ts's
// `isStartingSite` flag — the same sites deployStartingTroop targets during
// setup) that no one has claimed yet, not an arbitrary empty site.
export function deployFreeToEmptyStartingSite(): EffectHandler {
  return ctx => {
    const me = ctx.G.players[ctx.actorId];
    if (!ctx.pendingChoice) {
      const emptyStartingSites = SITES.filter(s =>
        s.isStartingSite &&
        sitesSpaces(s.id).length > 0 &&
        sitesSpaces(s.id).every(sp => sp.id in ctx.G.troops && ctx.G.troops[sp.id] === null)
      );
      const options = emptyStartingSites.map(s => sitesSpaces(s.id)[0].id);
      if (options.length === 0) {
        Mechanics.log(ctx.G, '(Established Shrines: no fully-empty starting site — skipped)');
        return true;
      }
      ctx.pendingChoice = {
        kind: 'select-troop-space',
        prompt: 'Established Shrines: deploy a troop for free to an empty starting site.',
        options,
        optional: true,
      } as PendingChoice;
      ctx.paused = true;
      return false;
    }
    const spaceId = ctx.pendingChoice.response as string | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    if (!spaceId) return true;
    if (deployTroop(ctx.G, me.color, spaceId)) {
      Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} deployed for free at ${spaceId} (Established Shrines)`);
    }
    return true;
  };
}

// ---------- Simple resource conversion (Mizzrym's Shrewd Bargains) ----------

export function convert(cost: { power?: number; influence?: number }, gain: { power?: number; influence?: number }): EffectHandler {
  return ctx => {
    const pid = ctx.actorId;
    if (cost.power && !Mechanics.expendPower(ctx.G, pid, cost.power)) return true;
    if (cost.influence && !Mechanics.expendInfluence(ctx.G, pid, cost.influence)) return true;
    if (gain.power) Mechanics.gainPower(ctx.G, pid, gain.power);
    if (gain.influence) Mechanics.gainInfluence(ctx.G, pid, gain.influence);
    return true;
  };
}

// ---------- Pay Power, draw 1, then discard 1 (Xorlarrin's Unstable Ritual) ----------

export function drawThenDiscard(): EffectHandler {
  return ctx => {
    const state = (ctx.handlerState as { drew?: boolean } | null) ?? {};
    const me = ctx.G.players[ctx.actorId];
    if (!state.drew) {
      Mechanics.draw(ctx.G, ctx.actorId, 1, ctx.random);
      if (me.hand.length === 0) return true;
    }
    if (!ctx.pendingChoice) {
      ctx.pendingChoice = {
        kind: 'select-card-in-hand',
        prompt: 'Unstable Ritual: discard a card.',
        options: me.hand.map((_, i) => i),
      } as PendingChoice;
      ctx.paused = true;
      ctx.handlerState = { drew: true };
      return false;
    }
    const idx = ctx.pendingChoice.response as number | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    ctx.handlerState = null;
    if (idx == null) return true;
    const card = me.hand[idx];
    if (!card) return true;
    Mechanics.discardCard(ctx.G, ctx.actorId, card);
    Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} discarded ${card.name} (Unstable Ritual)`);
    return true;
  };
}

// ---------- Recruit the top card of the market DECK (not the row) ----------
// (Fey-Branche's Ritual Exhibition)

export function peekAndMaybeRecruitDeckTop(): EffectHandler {
  return ctx => {
    const me = ctx.G.players[ctx.actorId];
    if (ctx.G.market.deck.length === 0) {
      Mechanics.log(ctx.G, '(Ritual Exhibition: market deck is empty — skipped)');
      return true;
    }
    const top = ctx.G.market.deck[0];
    const data = lookupCard(top.deck, top.slot);
    const cost = data?.cost ?? 999;
    Mechanics.markInfoRevealed(ctx.G);
    if (!ctx.pendingChoice) {
      ctx.pendingChoice = {
        kind: 'choose-one',
        prompt: `Top of the market deck: ${top.name} (cost ${cost}). Recruit it?`,
        options: me.influence >= cost ? [`Recruit for ${cost} Influence`, 'Leave it'] : ['Leave it (not enough Influence)'],
      } as PendingChoice;
      ctx.paused = true;
      return false;
    }
    const idx = ctx.pendingChoice.response as number | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    if (idx !== 0 || me.influence < cost) return true;
    if (!Mechanics.expendInfluence(ctx.G, ctx.actorId, cost)) return true;
    const card = ctx.G.market.deck.shift()!;
    me.discard.push(card);
    Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} recruited ${card.name} off the top of the market deck (Ritual Exhibition)`);
    if (data) HouseHooks.onRecruit(ctx.G, ctx.actorId, data);
    return true;
  };
}

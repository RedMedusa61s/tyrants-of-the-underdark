// Heuristic AI based on user strategy notes:
//   - Spend all influence on the highest-cost affordable card (smallest # of cards per turn).
//   - Devour/promote-out-of-cycle low-influence cards (Nobles) but keep cycling deck >= 5.
//   - Spread troops across sites; prefer control-marker sites.
//   - Assassinate enemy troops where possible (trophies = end-game VP).
//   - Grab site control whenever practical.

import type { TyrantsState } from '../game';
import { SITES, SITES_BY_ID } from '../data/sites';
import { TROOP_SPACES, TROOP_SPACES_BY_ID, sitesSpaces } from '../data/troop-spaces';
import { lookupCard } from '../card-data';
import { hasPresence } from '../engine/map-state';
import type { AiMove } from './random-ai';

const MIN_CYCLING_DECK = 5;

function cyclingDeckSize(G: TyrantsState, pid: string): number {
  const p = G.players[pid];
  return p.deck.length + p.hand.length + p.discard.length;
}

function cardCost(deck: string, slot: number): number {
  return lookupCard(deck, slot)?.cost ?? 0;
}

/** Lower = better candidate for removal from cycling deck (devour from hand, promote
 *  to Inner Circle). Starter cards (Noble, Soldier) are equally bad — both pump the
 *  ratio of "dead-weight" draws — so they share the lowest score. Among recruited
 *  cards, prefer to trash the cheapest (lowest-influence-payoff) ones.
 *
 *  Goal per user: raise the average influence of remaining cycling cards so future
 *  hands draw a smaller but more powerful set. */
function trashScore(deck: string, slot: number): number {
  const isStarter = deck === 'starter-1';
  // Starters score 0; recruited cards score by their cost (higher cost = worse to trash).
  return isStarter ? 0 : 10 + cardCost(deck, slot);
}

function pickRandom<T>(arr: T[]): T | undefined {
  return arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined;
}

/** Score an empty troop space for deployment. Higher = better. */
function scoreDeploySpace(G: TyrantsState, pid: string, spaceId: string): number {
  const me = G.players[pid];
  const t = TROOP_SPACES_BY_ID[spaceId];
  if (!t) return -Infinity;
  let s = 0;
  if (t.parentSite) {
    s += 5;
    const site = SITES_BY_ID[t.parentSite];
    if (site?.hasControlMarker) s += 12;
    s += (site?.vp ?? 0);
    // Spread: penalize sites where we already own multiple slots.
    let mine = 0, total = 0, enemy = 0;
    for (const sp of sitesSpaces(t.parentSite)) {
      total++;
      const occ = G.troops[sp.id];
      if (occ === me.color) mine++;
      else if (occ && occ !== 'white') enemy++;
    }
    s -= mine * 2;
    // Bonus if this deploy could establish control (we'd tie or beat enemy lead).
    if (mine + 1 > Math.max(enemy, mine)) s += 3;
    // Slightly prefer sites that aren't already full of our troops.
    if (mine === 0 && total > 0) s += 2;
  } else {
    // Route space: useful for reach, but lower priority.
    s += 1;
  }
  return s;
}

function scoreAssassinateSpace(G: TyrantsState, pid: string, spaceId: string): number {
  const me = G.players[pid];
  const occ = G.troops[spaceId];
  if (!occ || occ === me.color) return -Infinity;
  let s = occ === 'white' ? 2 : 6;
  const t = TROOP_SPACES_BY_ID[spaceId];
  const siteId = t?.parentSite;
  if (siteId) {
    const site = SITES_BY_ID[siteId];
    if (site?.hasControlMarker) s += 6;
    s += (site?.vp ?? 0);
  }
  return s;
}

function legalDeployTargets(G: TyrantsState, pid: string): string[] {
  const me = G.players[pid];
  const hasAnyMapPresence = SITES.some(s => hasPresence(G, me.color, { site: s.id }));
  const out: string[] = [];
  for (const t of TROOP_SPACES) {
    if (G.troops[t.id]) continue;
    let ok = !hasAnyMapPresence;
    if (!ok) {
      ok = t.parentSite
        ? hasPresence(G, me.color, { site: t.parentSite })
        : hasPresence(G, me.color, { space: t.id });
    }
    if (ok) out.push(t.id);
  }
  return out;
}

function legalAssassinateTargets(G: TyrantsState, pid: string): string[] {
  const me = G.players[pid];
  const out: string[] = [];
  for (const t of TROOP_SPACES) {
    const occ = G.troops[t.id];
    if (!occ || occ === me.color) continue;
    const presence = t.parentSite
      ? hasPresence(G, me.color, { site: t.parentSite })
      : hasPresence(G, me.color, { space: t.id });
    if (presence) out.push(t.id);
  }
  return out;
}

function resolveChoice(G: TyrantsState, pid: string): AiMove {
  const pc = G.pendingChoice!;
  const me = G.players[pid];
  const opts = (pc.options ?? []) as unknown[];

  switch (pc.kind) {
    case 'select-card-in-hand': {
      // Devour-from-hand: permanently trash a card from your cycling deck. Pick the
      // worst-to-keep card (starter Nobles/Soldiers, then lowest-cost recruits).
      // Skip if optional and trashing would drop the cycling deck below threshold.
      const idxs = (opts as number[]).length > 0
        ? (opts as number[])
        : me.hand.map((_, i) => i);
      if (idxs.length === 0) return { name: 'resolveChoice', args: [null] };
      if (pc.optional && cyclingDeckSize(G, pid) - 1 < MIN_CYCLING_DECK) {
        return { name: 'resolveChoice', args: [null] };
      }
      let bestIdx = idxs[0];
      let bestScore = Infinity;
      for (const i of idxs) {
        const c = me.hand[i];
        if (!c) continue;
        const score = trashScore(c.deck, c.slot);
        if (score < bestScore) { bestScore = score; bestIdx = i; }
      }
      return { name: 'resolveChoice', args: [bestIdx] };
    }
    case 'select-card-in-discard':
    case 'select-played-card': {
      // Promote into Inner Circle: this REMOVES the card from your cycling deck and
      // banks its inner-circle VP for end-game. Strategic value lies in deck-thinning
      // your weakest cards (Nobles / Soldiers / cheap recruits), NOT in promoting your
      // best cards. Guard against shrinking cycling deck below threshold.
      const idxs = opts as number[];
      if (idxs.length === 0) return { name: 'resolveChoice', args: [null] };
      if (pc.optional && cyclingDeckSize(G, pid) - 1 < MIN_CYCLING_DECK) {
        return { name: 'resolveChoice', args: [null] };
      }
      const pool = pc.kind === 'select-card-in-discard' ? me.discard : G.cardsPlayedThisTurn;
      let best = idxs[0], bestScore = Infinity;
      for (const i of idxs) {
        const c = pool[i];
        if (!c) continue;
        const score = trashScore(c.deck, c.slot);
        if (score < bestScore) { bestScore = score; best = i; }
      }
      return { name: 'resolveChoice', args: [best] };
    }
    case 'select-card-in-inner-circle': {
      // Devour from inner circle: drop lowest-value card.
      const idxs = opts as number[];
      if (idxs.length === 0) return { name: 'resolveChoice', args: [null] };
      let worst = idxs[0], worstCost = Infinity;
      for (const i of idxs) {
        const c = me.innerCircle[i];
        if (!c) continue;
        const cost = cardCost(c.deck, c.slot);
        if (cost < worstCost) { worstCost = cost; worst = i; }
      }
      return { name: 'resolveChoice', args: [worst] };
    }
    case 'select-market-card': {
      const idxs = opts as number[];
      if (idxs.length === 0) return { name: 'resolveChoice', args: [null] };
      let best = idxs[0], bestCost = -1;
      for (const i of idxs) {
        const c = G.market.row[i];
        if (!c) continue;
        const cost = cardCost(c.deck, c.slot);
        if (cost > bestCost) { bestCost = cost; best = i; }
      }
      return { name: 'resolveChoice', args: [best] };
    }
    case 'select-troop-space': {
      const ids = opts as string[];
      if (ids.length === 0) return { name: 'resolveChoice', args: [pc.optional ? null : null] };
      // If any option is occupied by an enemy, treat as assassinate/return target — pick by enemy score.
      const enemies = ids.filter(id => {
        const occ = G.troops[id];
        return occ && occ !== me.color;
      });
      if (enemies.length > 0) {
        enemies.sort((a, b) => scoreAssassinateSpace(G, pid, b) - scoreAssassinateSpace(G, pid, a));
        return { name: 'resolveChoice', args: [enemies[0]] };
      }
      // Otherwise empty space — deploy heuristic.
      const empties = ids.filter(id => !G.troops[id]);
      if (empties.length > 0) {
        empties.sort((a, b) => scoreDeploySpace(G, pid, b) - scoreDeploySpace(G, pid, a));
        return { name: 'resolveChoice', args: [empties[0]] };
      }
      return { name: 'resolveChoice', args: [ids[0]] };
    }
    case 'select-site': {
      const ids = opts as string[];
      if (ids.length === 0) return { name: 'resolveChoice', args: [pc.optional ? null : null] };
      // Prefer control-marker sites we don't already dominate.
      const ranked = ids.slice().sort((a, b) => {
        const sa = SITES_BY_ID[a], sb = SITES_BY_ID[b];
        let av = (sa?.hasControlMarker ? 10 : 0) + (sa?.vp ?? 0);
        let bv = (sb?.hasControlMarker ? 10 : 0) + (sb?.vp ?? 0);
        // Prefer sites where we don't already have a spy.
        if ((G.spies[a] ?? []).includes(me.color)) av -= 5;
        if ((G.spies[b] ?? []).includes(me.color)) bv -= 5;
        return bv - av;
      });
      return { name: 'resolveChoice', args: [ranked[0]] };
    }
    case 'choose-one': {
      // Without semantic info, default to option 0 (typically the "primary" effect).
      const arr = opts as string[];
      if (arr.length === 0) return { name: 'resolveChoice', args: [null] };
      return { name: 'resolveChoice', args: [0] };
    }
    case 'select-player': {
      const ids = opts as string[];
      // Pick the player with highest score (give them the outcast / steal from them).
      let best = ids[0] ?? null, bestScore = -Infinity;
      for (const id of ids) {
        const score = (G.players[id]?.vp ?? 0)
          + (G.players[id] ? Object.values(G.players[id].trophyHall).reduce((s, n) => s + n, 0) : 0);
        if (score > bestScore) { bestScore = score; best = id; }
      }
      return { name: 'resolveChoice', args: [best] };
    }
    default:
      return { name: 'resolveChoice', args: [opts[0] ?? null] };
  }
}

export function decideHeuristicMove(G: TyrantsState, currentPlayer: string): AiMove | null {
  // 1. Resolve pending choice if it's ours.
  if (G.pendingChoice && G.pendingChoice.playerId === currentPlayer) {
    return resolveChoice(G, currentPlayer);
  }
  if (G.pendingChoice) return null;

  // 2. Setup phase.
  if (G.setupPhase) {
    const open = SITES.filter(s =>
      s.isStartingSite && sitesSpaces(s.id).every(sp => !G.troops[sp.id])
    );
    // Prefer a starting site with a control marker / highest VP.
    open.sort((a, b) => {
      const av = (a.hasControlMarker ? 10 : 0) + a.vp;
      const bv = (b.hasControlMarker ? 10 : 0) + b.vp;
      return bv - av;
    });
    const pick = open[0] ?? pickRandom(open);
    return pick ? { name: 'deployStartingTroop', args: [pick.id] } : null;
  }

  const me = G.players[currentPlayer];

  // 3a. Play all hand cards first (always strictly better than not playing).
  if (me.hand.length > 0) {
    return { name: 'playCard', args: [0] };
  }

  // 3b. Spend Power on board.
  //   - Assassinate where we have presence (3 power, +trophy).
  //   - Else deploy (1 power) preferring control-marker sites.
  if (me.power >= 3) {
    const targets = legalAssassinateTargets(G, currentPlayer);
    if (targets.length > 0) {
      targets.sort((a, b) => scoreAssassinateSpace(G, currentPlayer, b) - scoreAssassinateSpace(G, currentPlayer, a));
      return { name: 'assassinateTroop', args: [targets[0]] };
    }
  }
  if (me.power >= 1) {
    const targets = legalDeployTargets(G, currentPlayer);
    if (targets.length > 0) {
      targets.sort((a, b) => scoreDeploySpace(G, currentPlayer, b) - scoreDeploySpace(G, currentPlayer, a));
      return { name: 'deployTroop', args: [targets[0]] };
    }
  }

  // 3c. Recruit: highest-cost affordable card (concentrate influence).
  const affordable: Array<{ idx: number; cost: number }> = [];
  for (let i = 0; i < G.market.row.length; i++) {
    const c = G.market.row[i];
    if (!c) continue;
    const data = lookupCard(c.deck, c.slot);
    if (data && data.cost <= me.influence) affordable.push({ idx: i, cost: data.cost });
  }
  if (affordable.length > 0) {
    affordable.sort((a, b) => b.cost - a.cost);
    return { name: 'recruitFromMarket', args: [affordable[0].idx] };
  }

  // 3d. End turn.
  return { name: 'endTurn', args: [] };
}

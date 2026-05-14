// Minimal random AI for non-human seats.
//
// Decides exactly one move per call given the current state + ctx. Caller is responsible
// for dispatching the move and re-invoking after the state settles. Returns null if the
// AI sees no legal move (which shouldn't happen — endTurn is always legal during a
// regular turn — but the caller should treat null as "stop polling for now").
//
// Deliberately dumb: pick the first hand card, recruit a random affordable market card,
// then end the turn. Replace with something cleverer once handlers are written and we
// can evaluate moves by predicted VP gain.

import type { TyrantsState } from '../game';
import { SITES } from '../data/sites';
import { TROOP_SPACES, sitesSpaces } from '../data/troop-spaces';
import { lookupCard } from '../card-data';
import { hasPresence } from '../engine/map-state';

export type AiMove =
  | { name: 'deployStartingTroop'; args: [string] }
  | { name: 'resolveChoice'; args: [unknown] }
  | { name: 'playCard'; args: [number] }
  | { name: 'recruitFromMarket'; args: [number] }
  | { name: 'deployTroop'; args: [string] }
  | { name: 'assassinateTroop'; args: [string] }
  | { name: 'returnEnemySpy'; args: [string, string] }
  | { name: 'endTurn'; args: [] };

function pickRandom<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

export function decideAiMove(G: TyrantsState, currentPlayer: string): AiMove | null {
  // 1. If there's a pending choice for the AI, resolve it.
  if (G.pendingChoice && G.pendingChoice.playerId === currentPlayer) {
    const pc = G.pendingChoice;
    if (pc.optional && Math.random() < 0.5) return { name: 'resolveChoice', args: [null] };
    switch (pc.kind) {
      case 'select-card-in-hand': {
        const me = G.players[currentPlayer];
        const opts = pc.options as number[] | undefined;
        if (opts && opts.length > 0) return { name: 'resolveChoice', args: [opts[Math.floor(Math.random() * opts.length)]] };
        return { name: 'resolveChoice', args: [me.hand.length > 0 ? 0 : null] };
      }
      case 'select-card-in-discard':
      case 'select-card-in-inner-circle':
      case 'select-played-card': {
        const opts = (pc.options as number[] | undefined) ?? [];
        if (opts.length === 0) return { name: 'resolveChoice', args: [null] };
        return { name: 'resolveChoice', args: [opts[Math.floor(Math.random() * opts.length)]] };
      }
      case 'select-site':
      case 'select-troop-space': {
        const opts = (pc.options as string[] | undefined) ?? [];
        if (opts.length === 0) return { name: 'resolveChoice', args: [null] };
        return { name: 'resolveChoice', args: [opts[Math.floor(Math.random() * opts.length)]] };
      }
      case 'choose-one': {
        const opts = (pc.options as string[] | undefined) ?? [];
        if (opts.length === 0) return { name: 'resolveChoice', args: [null] };
        return { name: 'resolveChoice', args: [Math.floor(Math.random() * opts.length)] };
      }
      case 'select-market-card': {
        const opts = (pc.options as number[] | undefined) ?? [];
        if (opts.length === 0) return { name: 'resolveChoice', args: [null] };
        return { name: 'resolveChoice', args: [opts[Math.floor(Math.random() * opts.length)]] };
      }
      case 'select-player': {
        const opts = (pc.options as string[] | undefined) ?? [];
        if (opts.length === 0) return { name: 'resolveChoice', args: [null] };
        return { name: 'resolveChoice', args: [opts[Math.floor(Math.random() * opts.length)]] };
      }
      default:
        return { name: 'resolveChoice', args: [pc.options?.[0] ?? null] };
    }
  }
  // Don't act if a human's pending choice is in flight.
  if (G.pendingChoice) return null;

  // 2. Setup phase: pick a random empty starting site.
  if (G.setupPhase) {
    const open = SITES.filter(s =>
      s.isStartingSite && s.id in G.siteControl &&
      sitesSpaces(s.id).every(sp => sp.id in G.troops && !G.troops[sp.id])
    );
    const pick = pickRandom(open);
    return pick ? { name: 'deployStartingTroop', args: [pick.id] } : null;
  }

  // 3. Regular turn.
  const me = G.players[currentPlayer];

  // 3a. Play one card from hand.
  if (me.hand.length > 0) {
    return { name: 'playCard', args: [0] };
  }

  // 3b. Spend Power on board actions while it's available.
  if (me.power >= 3) {
    // Prefer return-spy if an enemy spy sits where we have presence (cheap disruption).
    const spyTargets: Array<{ site: string; color: string }> = [];
    for (const s of SITES) {
      if (!hasPresence(G, me.color, { site: s.id })) continue;
      for (const c of G.spies[s.id] ?? []) {
        if (c !== me.color) spyTargets.push({ site: s.id, color: c });
      }
    }
    if (spyTargets.length > 0 && Math.random() < 0.5) {
      const t = pickRandom(spyTargets)!;
      return { name: 'returnEnemySpy', args: [t.site, t.color] };
    }
    // Otherwise try to assassinate an enemy where we have presence.
    const assassTargets: string[] = [];
    for (const t of TROOP_SPACES) {
      const occ = G.troops[t.id];
      if (!occ || occ === me.color) continue;
      const presence = t.parentSite
        ? hasPresence(G, me.color, { site: t.parentSite })
        : hasPresence(G, me.color, { space: t.id });
      if (presence) assassTargets.push(t.id);
    }
    const a = pickRandom(assassTargets);
    if (a) return { name: 'assassinateTroop', args: [a] };
  }
  if (me.power >= 1) {
    // Deploy somewhere we have presence (or anywhere if no map presence).
    const hasAnyMapPresence = SITES.some(s => hasPresence(G, me.color, { site: s.id }));
    const deployTargets: string[] = [];
    for (const t of TROOP_SPACES) {
      if (G.troops[t.id]) continue;
      if (!hasAnyMapPresence) deployTargets.push(t.id);
      else if (t.parentSite && hasPresence(G, me.color, { site: t.parentSite })) deployTargets.push(t.id);
      else if (t.parentRoute && hasPresence(G, me.color, { space: t.id })) deployTargets.push(t.id);
    }
    const d = pickRandom(deployTargets);
    if (d) return { name: 'deployTroop', args: [d] };
  }

  // 3c. Try to recruit a random affordable card.
  const affordable: number[] = [];
  for (let i = 0; i < G.market.row.length; i++) {
    const c = G.market.row[i];
    if (!c) continue;
    const data = lookupCard(c.deck, c.slot);
    if (data && data.cost <= me.influence) affordable.push(i);
  }
  const idx = pickRandom(affordable);
  if (idx !== undefined) return { name: 'recruitFromMarket', args: [idx] };

  // 3d. End turn.
  return { name: 'endTurn', args: [] };
}

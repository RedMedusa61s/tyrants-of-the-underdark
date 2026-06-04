// Final-scoring (rulebook p.14).
//
// At end-of-game each player scores:
//   - The VP value of each site you control
//   - 2 VP for each site under your total control
//   - 1 VP for each troop in your trophy hall
//   - Sum of deckVp over deck + hand + discard
//   - Sum of innerCircleVp over inner circle
//   - VP tokens collected during the game
//   - Plus any per-card final-scoring riders (the big dragons, etc.)

import type { TyrantsState, Color } from '../game';
import { totalTrophies } from '../game';
import { SITES_BY_ID } from '../data/sites';
import { hasTotalControl } from './map-state';
import { lookupCard } from '../card-data';

export interface ScoreBreakdown {
  sites: number;
  /** Per-site contribution to the `sites` subtotal. */
  sitesDetail: Array<{ site: string; vp: number }>;
  totalControl: number;
  /** Sites under your total control (each contributes +2). */
  totalControlDetail: Array<{ site: string }>;
  trophies: number;
  trophiesDetail: Record<string, number>;
  deckVp: number;
  /** Per-card-name aggregation of deck VP (deck + hand + discard). */
  deckVpDetail: Array<{ card: string; count: number; vpEach: number; vp: number }>;
  innerCircleVp: number;
  innerCircleVpDetail: Array<{ card: string; count: number; vpEach: number; vp: number }>;
  vpTokens: number;
  riderBonuses: { source: string; vp: number }[];
  total: number;
}

export function scorePlayer(G: TyrantsState, playerId: string): ScoreBreakdown {
  const p = G.players[playerId];
  const color: Color = p.color;

  // Sites you control: sum each site's VP value.
  let sites = 0;
  let totalControl = 0;
  const sitesDetail: Array<{ site: string; vp: number }> = [];
  const totalControlDetail: Array<{ site: string }> = [];
  for (const [siteId, controller] of Object.entries(G.siteControl)) {
    if (controller !== color) continue;
    const siteName = SITES_BY_ID[siteId]?.name ?? siteId;
    const v = SITES_BY_ID[siteId]?.vp ?? 0;
    sites += v;
    sitesDetail.push({ site: siteName, vp: v });
    if (hasTotalControl(G, color, siteId)) {
      totalControl += 2;
      totalControlDetail.push({ site: siteName });
    }
  }

  const trophies = totalTrophies(p);

  // Aggregate per-card VP for tooltip breakdowns.
  const aggregate = (cards: typeof p.deck, field: 'deckVp' | 'innerCircleVp') => {
    const acc = new Map<string, { count: number; vpEach: number }>();
    let total = 0;
    for (const card of cards) {
      const d = lookupCard(card.deck, card.slot);
      const v = d?.[field] ?? 0;
      total += v;
      const cur = acc.get(card.name) ?? { count: 0, vpEach: v };
      cur.count += 1;
      acc.set(card.name, cur);
    }
    const detail = [...acc.entries()]
      .map(([card, { count, vpEach }]) => ({ card, count, vpEach, vp: count * vpEach }))
      .filter(d => d.vp !== 0)
      .sort((a, b) => b.vp - a.vp);
    return { total, detail };
  };
  const deckBundle = aggregate([...p.deck, ...p.hand, ...p.discard], 'deckVp');
  const deckVp = deckBundle.total;
  const deckVpDetail = deckBundle.detail;
  const innerBundle = aggregate(p.innerCircle, 'innerCircleVp');
  const innerCircleVp = innerBundle.total;
  const innerCircleVpDetail = innerBundle.detail;

  // Per-card final-scoring riders (looked up by effectKey on each card in deck/hand/discard
  // and inner circle — rulebook rider text "at the end of the game" applies wherever the
  // card is, not just inner circle, except where explicitly stated).
  const riderBonuses: { source: string; vp: number }[] = [];
  const allOwned = [...p.deck, ...p.hand, ...p.discard, ...p.innerCircle];
  const ownedNames = new Set(allOwned.map(c => c.name));
  for (const name of ownedNames) {
    const bonus = SCORING_RIDERS[name];
    if (!bonus) continue;
    // Each distinct copy contributes once. For now we count one per owned name; refine
    // if a card text says "per copy."
    const count = allOwned.filter(c => c.name === name).length;
    for (let i = 0; i < count; i++) {
      const vp = bonus(G, playerId);
      if (vp !== 0) riderBonuses.push({ source: name, vp });
    }
  }

  const total = sites + totalControl + trophies + deckVp + innerCircleVp + p.vp
    + riderBonuses.reduce((s, r) => s + r.vp, 0);

  return {
    sites, sitesDetail,
    totalControl, totalControlDetail,
    trophies, trophiesDetail: { ...p.trophyHall },
    deckVp, deckVpDetail,
    innerCircleVp, innerCircleVpDetail,
    vpTokens: p.vp,
    riderBonuses,
    total,
  };
}

/** Per-card END-OF-GAME VP riders, keyed by card name.
 *
 *  EMPTY by design. No card in the game has an end-of-game scoring rider — the
 *  rulebook's Final Scoring lists only the standard categories (site control,
 *  total control, trophies, deck VP, inner-circle VP, VP tokens gained). The
 *  five big Dragons say "Gain X VP …", which the rulebook defines as taking VP
 *  TOKENS IMMEDIATELY when the card resolves (Blue: at end of turn). Those are
 *  granted in the Dragon handlers (engine/handlers/dragons.ts) and counted under
 *  "VP tokens gained during the game" — they are NOT end-of-game riders.
 *
 *  This used to list all five Dragons, which double-counted Red/Green (already
 *  granted in-play) and mistimed Black/White/Blue. The map is kept (rather than
 *  deleted) as a dormant extension point should a future card ever print a true
 *  "at the end of the game, score …" rider. */
const SCORING_RIDERS: Record<string, (G: TyrantsState, playerId: string) => number> = {};

export function scoreAll(G: TyrantsState): Record<string, ScoreBreakdown> {
  const out: Record<string, ScoreBreakdown> = {};
  for (const pid of Object.keys(G.players)) out[pid] = scorePlayer(G, pid);
  return out;
}

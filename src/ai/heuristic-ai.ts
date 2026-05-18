// Heuristic AI based on user strategy notes:
//   - Spend all influence on the highest-cost affordable card (smallest # of cards per turn).
//   - Devour/promote-out-of-cycle low-influence cards (Nobles) but keep cycling deck >= 5.
//   - Spread troops across sites; prefer control-marker sites.
//   - Assassinate enemy troops where possible (trophies = end-game VP).
//   - Grab site control whenever practical.

import type { TyrantsState } from '../game';
import { BASE_ACTION_POWER_COST } from '../game';
import { SITES, SITES_BY_ID } from '../data/sites';
import { TROOP_SPACES, TROOP_SPACES_BY_ID, sitesSpaces } from '../data/troop-spaces';
import { lookupCard } from '../card-data';
import { hasPresence } from '../engine/map-state';
import type { AiMove } from './random-ai';
import { DEFAULT_WEIGHTS, type HeuristicWeights } from './heuristic-weights';
import { takePhaseSnapshot, type PhaseSnapshot } from './game-phase';

// Module-level pointer to the currently active weights. Per-call entrypoints
// (decideHeuristicMove / decideHeuristicMoveWithWeights) swap this in for the
// duration of a single move decision. Module-global keeps the score-helper
// signatures un-noisy without threading weights through every callsite.
let WEIGHTS: HeuristicWeights = DEFAULT_WEIGHTS;

// Module-level pointer to the current move's phase snapshot. Set at the top
// of decideHeuristicMove so resolveChoice (and the scoring helpers) can
// read it without recomputing scoreAll on every call. Null when not in a
// move decision (or when called with no game state, e.g. unit tests).
let PHASE: PhaseSnapshot | null = null;

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
  return isStarter ? 0 : WEIGHTS.trashRecruitedBase + cardCost(deck, slot);
}

/** VP value of promoting this card into the inner circle. Used in
 *  endgame-phase promote decisions where deck-thinning matters less
 *  than banking VP for end-of-game scoring. */
function innerCircleVpOf(deck: string, slot: number): number {
  return lookupCard(deck, slot)?.innerCircleVp ?? 0;
}

/** Phase-aware promote score: returns a number where HIGHER means "more
 *  desirable to promote." Early game we want to trash junk (so high score
 *  for low trash-score cards — i.e. the worst-to-keep, best-to-trash);
 *  endgame we want to bank VP (high score for high-innerCircleVp cards).
 *  The `endgamePromoteByVp` weight (0..1) blends the two strategies. */
function promoteScore(deck: string, slot: number): number {
  // Trash-mode: lower trashScore = better promote target. Invert by negating.
  const trashMode = -trashScore(deck, slot);
  // VP-mode: just the inner-circle VP directly.
  const vpMode = innerCircleVpOf(deck, slot);
  const inEndgame = PHASE?.phase === 'endgame';
  // In endgame, blend toward VP-mode by the weight. Outside endgame, always
  // trash-mode (the user's early-game rule: thin the deck).
  if (!inEndgame) return trashMode;
  const w = Math.max(0, Math.min(1, WEIGHTS.endgamePromoteByVp));
  // Rescale trashMode roughly into the same range as vpMode (which is 0..10)
  // so the blend isn't dominated by one mode's scale.
  return (1 - w) * (trashMode / 2) + w * vpMode;
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
    s += WEIGHTS.deployBaseSite;
    const site = SITES_BY_ID[t.parentSite];
    if (site?.hasControlMarker) s += WEIGHTS.deployControlMarker;
    s += (site?.vp ?? 0) * WEIGHTS.deployVpMultiplier;
    // Spread: penalize sites where we already own multiple slots.
    let mine = 0, total = 0, enemy = 0;
    for (const sp of sitesSpaces(t.parentSite)) {
      total++;
      const occ = G.troops[sp.id];
      if (occ === me.color) mine++;
      else if (occ && occ !== 'white') enemy++;
    }
    s -= mine * WEIGHTS.deployOwnPenalty;
    // Bonus if this deploy could establish control (we'd tie or beat enemy lead).
    if (mine + 1 > Math.max(enemy, mine)) s += WEIGHTS.deployEstablishBonus;
    // Slightly prefer sites that aren't already full of our troops.
    if (mine === 0 && total > 0) s += WEIGHTS.deployFirstFootBonus;
  } else {
    // Route space: useful for reach, but lower priority.
    s += WEIGHTS.deployRouteSpace;
  }
  return s;
}

function scoreAssassinateSpace(G: TyrantsState, pid: string, spaceId: string): number {
  const me = G.players[pid];
  const occ = G.troops[spaceId];
  if (!occ || occ === me.color) return -Infinity;
  let s = occ === 'white' ? WEIGHTS.assassinateWhite : WEIGHTS.assassinateEnemy;
  const t = TROOP_SPACES_BY_ID[spaceId];
  const siteId = t?.parentSite;
  if (siteId) {
    const site = SITES_BY_ID[siteId];
    if (site?.hasControlMarker) s += WEIGHTS.assassinateControlMarker;
    s += (site?.vp ?? 0) * WEIGHTS.assassinateVpMultiplier;
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
      if (pc.optional && cyclingDeckSize(G, pid) - 1 < WEIGHTS.minCyclingDeck) {
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
      // Promote into Inner Circle: REMOVES the card from your cycling deck and
      // banks its inner-circle VP for end-game. Early/mid game: strategic value
      // lies in deck-thinning weakest cards (Nobles / Soldiers / cheap recruits).
      // Endgame (per user strategy notes): no time left to benefit from a thinner
      // deck — promote the card with the highest inner-circle VP instead, which
      // banks the most score. promoteScore() blends these by phase.
      // Guard against shrinking cycling deck below threshold — but DISABLE the
      // guard in endgame: if the game is about to end you don't need to draw any
      // more cards, banking VP is strictly better.
      const idxs = opts as number[];
      if (idxs.length === 0) return { name: 'resolveChoice', args: [null] };
      const inEndgame = PHASE?.phase === 'endgame';
      if (pc.optional && !inEndgame && cyclingDeckSize(G, pid) - 1 < WEIGHTS.minCyclingDeck) {
        return { name: 'resolveChoice', args: [null] };
      }
      const pool = pc.kind === 'select-card-in-discard' ? me.discard : G.cardsPlayedThisTurn;
      let best = idxs[0], bestScore = -Infinity;
      for (const i of idxs) {
        const c = pool[i];
        if (!c) continue;
        // promoteScore: HIGHER = better promote target (opposite of trashScore).
        const score = promoteScore(c.deck, c.slot);
        if (score > bestScore) { bestScore = score; best = i; }
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
        let av = (sa?.hasControlMarker ? WEIGHTS.siteControlMarkerBonus : 0) + (sa?.vp ?? 0);
        let bv = (sb?.hasControlMarker ? WEIGHTS.siteControlMarkerBonus : 0) + (sb?.vp ?? 0);
        // Prefer sites where we don't already have a spy.
        if ((G.spies[a] ?? []).includes(me.color)) av -= WEIGHTS.siteOwnSpyPenalty;
        if ((G.spies[b] ?? []).includes(me.color)) bv -= WEIGHTS.siteOwnSpyPenalty;
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

/** Decide a move with an explicit weights configuration. Swaps the module-
 *  level WEIGHTS pointer for the duration of the call. Synchronous, so no
 *  reentrancy worries — one move per call. */
export function decideHeuristicMoveWithWeights(
  G: TyrantsState,
  currentPlayer: string,
  weights: HeuristicWeights,
): AiMove | null {
  const prev = WEIGHTS;
  WEIGHTS = weights;
  try {
    return decideHeuristicMove(G, currentPlayer);
  } finally {
    WEIGHTS = prev;
  }
}

export function decideHeuristicMove(G: TyrantsState, currentPlayer: string): AiMove | null {
  // Refresh the phase snapshot for this move. resolveChoice and the
  // promote-scoring helpers read this via the module-level PHASE pointer.
  // We skip the snapshot during setup (no scores yet) and pendingChoice
  // resolution (caller already entered the move; the prior snapshot from
  // the SAME move is what we want, but it was cleared — re-take it).
  if (!G.setupPhase) {
    PHASE = takePhaseSnapshot(
      G, currentPlayer,
      WEIGHTS.phaseLateBarracks,
      WEIGHTS.phaseEndgameBarracks,
    );
  } else {
    PHASE = null;
  }

  // 1. Resolve pending choice if it's ours.
  if (G.pendingChoice && G.pendingChoice.playerId === currentPlayer) {
    return resolveChoice(G, currentPlayer);
  }
  if (G.pendingChoice) return null;

  // 2. Setup phase.
  if (G.setupPhase) {
    const open = SITES.filter(s =>
      s.isStartingSite && s.id in G.siteControl &&
      sitesSpaces(s.id).some(sp => !G.troops[sp.id]) &&
      !sitesSpaces(s.id).some(sp => G.troops[sp.id] && G.troops[sp.id] !== 'white')
    );
    // Prefer a starting site with a control marker / highest VP.
    open.sort((a, b) => {
      const av = (a.hasControlMarker ? WEIGHTS.siteControlMarkerBonus : 0) + a.vp;
      const bv = (b.hasControlMarker ? WEIGHTS.siteControlMarkerBonus : 0) + b.vp;
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

  // 3b. Spend Power on board — phase-aware priority.
  //   Per user strategy notes:
  //   - When AHEAD in late/endgame: deploy aggressively to drain barracks
  //     and trigger game-end while leading. Assassinate still OK but deploy
  //     comes first if it would establish/extend a lead at a control site.
  //   - When BEHIND in late/endgame: prefer assassinate (trophies = VP that
  //     don't accelerate end). Suppress deploys when behind in endgame
  //     entirely if behindEndgameDeploySuppression > 0 — deploying just
  //     hastens our defeat.
  //   - Early/mid game: default behavior — assassinate at threshold, then
  //     deploy if power left.
  const isLateOrEnd = PHASE?.phase === 'late' || PHASE?.phase === 'endgame';
  const isEndgame = PHASE?.phase === 'endgame';
  const lead = PHASE?.lead ?? 0;
  const ahead = lead >= WEIGHTS.phaseLeadThreshold;
  const behind = lead <= -WEIGHTS.phaseLeadThreshold;

  // Clamp the tuneable threshold up to the engine's actual base-action cost.
  // The weights file can raise this (be MORE reluctant to assassinate) but
  // never lower it past what the engine will accept — otherwise the AI
  // proposes an unaffordable move, the reducer returns INVALID_MOVE, and
  // the tournament harness burns the turn via fallback endTurn.
  const assassinateThreshold = Math.max(WEIGHTS.powerThresholdForAssassinate, BASE_ACTION_POWER_COST);

  // Decide ordering of (assassinate, deploy):
  //   - ahead+late → deploy first (accelerate end)
  //   - behind+late → assassinate first (farm trophies, avoid hastening end)
  //   - otherwise   → assassinate first (current default)
  const deployFirst = ahead && isLateOrEnd;

  const tryAssassinate = (): AiMove | null => {
    if (me.power < assassinateThreshold) return null;
    const targets = legalAssassinateTargets(G, currentPlayer);
    if (targets.length === 0) return null;
    // When behind in late game, apply the assassinate multiplier as a
    // tie-break preference — we already prefer this path, but multiplying
    // the scores doesn't change the ARGMAX, so the multiplier only matters
    // when blended with other action types in a future refactor. Keep the
    // weight live so it's tuneable now.
    targets.sort((a, b) => scoreAssassinateSpace(G, currentPlayer, b) - scoreAssassinateSpace(G, currentPlayer, a));
    return { name: 'assassinateTroop', args: [targets[0]] };
  };

  const tryDeploy = (): AiMove | null => {
    if (me.power < 1) return null;
    // Suppress deploys when behind in endgame — deploying drains the
    // common barracks pool that triggers game end, and we don't want to
    // end the game while losing.
    if (behind && isEndgame && WEIGHTS.behindEndgameDeploySuppression > 0) return null;
    const targets = legalDeployTargets(G, currentPlayer);
    if (targets.length === 0) return null;
    targets.sort((a, b) => scoreDeploySpace(G, currentPlayer, b) - scoreDeploySpace(G, currentPlayer, a));
    // The aheadDeployUrgencyMultiplier is kept live for tuneability but
    // doesn't currently affect ARGMAX (single-action choice). It will
    // matter when we extend to ranking across action types.
    void WEIGHTS.aheadDeployUrgencyMultiplier;
    void WEIGHTS.behindAssassinateMultiplier;
    return { name: 'deployTroop', args: [targets[0]] };
  };

  if (deployFirst) {
    const m = tryDeploy() ?? tryAssassinate();
    if (m) return m;
  } else {
    const m = tryAssassinate() ?? tryDeploy();
    if (m) return m;
  }

  // 3c. Recruit — pick the highest-scoring affordable purchase across the
  // market row AND the permanent aux stacks (Priestess of Lolth, House
  // Guard). The aux stacks were previously ignored entirely, which left
  // the AI ending turns with 2-3 unspent influence whenever the market
  // had nothing cheap. Per competitive-play notes, Priestess at 2 inf
  // is a strong buy and worth recruiting repeatedly.
  type Cand =
    | { kind: 'market'; idx: number; cost: number; icVp: number; deckVp: number; isAux: false }
    | { kind: 'aux'; stack: 'houseGuards' | 'priestesses'; cost: number; icVp: number; deckVp: number; isAux: true };
  const candidates: Cand[] = [];

  for (let i = 0; i < G.market.row.length; i++) {
    const c = G.market.row[i];
    if (!c) continue;
    const data = lookupCard(c.deck, c.slot);
    if (!data || data.cost > me.influence) continue;
    candidates.push({
      kind: 'market', idx: i, cost: data.cost,
      icVp: data.innerCircleVp ?? 0, deckVp: data.deckVp ?? 0, isAux: false,
    });
  }
  // Aux stacks: lookup once, push if affordable + stack non-empty.
  const auxRefs = [
    { stack: 'priestesses' as const, ref: lookupCard('priestesses', 43) },
    { stack: 'houseGuards' as const, ref: lookupCard('house-guards', 40) },
  ];
  for (const { stack, ref } of auxRefs) {
    if (!ref) continue;
    if ((G.auxStacks[stack] ?? 0) <= 0) continue;
    if (ref.cost > me.influence) continue;
    candidates.push({
      kind: 'aux', stack, cost: ref.cost,
      icVp: ref.innerCircleVp ?? 0, deckVp: ref.deckVp ?? 0, isAux: true,
    });
  }

  if (candidates.length > 0) {
    const scoreOf = (c: Cand) => {
      const raw =
        WEIGHTS.recruitIcVpWeight * c.icVp +
        WEIGHTS.recruitDeckVpWeight * c.deckVp +
        WEIGHTS.recruitCostWeight * c.cost +
        (c.isAux ? WEIGHTS.recruitAuxStackBonus : 0);
      // Blend raw value vs per-influence efficiency. Per-inf favors low-cost
      // high-IC-VP cards (Priestess). Blend factor 0..1: 0=raw only, 1=per-inf only.
      const blend = Math.max(0, Math.min(1, WEIGHTS.recruitPerInfluenceBlend));
      const perInf = raw / Math.max(1, c.cost);
      return (1 - blend) * raw + blend * perInf * c.cost; // perInf*cost keeps scale comparable
    };
    candidates.sort((a, b) => scoreOf(b) - scoreOf(a));
    const best = candidates[0];
    if (best.kind === 'market') {
      return { name: 'recruitFromMarket', args: [best.idx] };
    }
    return { name: 'recruitFromAuxStack', args: [best.stack] };
  }

  // 3d. End turn.
  return { name: 'endTurn', args: [] };
}

// Tuneable weights for the heuristic AI. The defaults reproduce the
// hand-written numbers that were baked into heuristic-ai.ts before the
// tournament harness existed — running the AI with DEFAULT_WEIGHTS is
// byte-for-byte equivalent to the pre-parameterization version.
//
// To experiment, pass a partial override to `decideHeuristicMove` (it spreads
// over the defaults), or load a JSON weight-file from disk via the
// tournament script. The tournament runner (scripts/tournament.ts) plays
// two weight-sets head-to-head over N games and reports win rate.

export interface HeuristicWeights {
  // --- Deploy-space scoring (higher = AI prefers placing a troop there) ---
  /** Flat bonus for any space inside a real site (vs. a bare route space). */
  deployBaseSite: number;
  /** Bonus when the parent site carries a control marker. */
  deployControlMarker: number;
  /** Coefficient on the site's printed VP value. */
  deployVpMultiplier: number;
  /** Penalty per troop the AI already has at this site (encourages spreading out). */
  deployOwnPenalty: number;
  /** Bonus when this deploy would create or extend a control lead. */
  deployEstablishBonus: number;
  /** Bonus when the AI has no presence at the site yet. */
  deployFirstFootBonus: number;
  /** Score for a non-site (route) space. */
  deployRouteSpace: number;

  // --- Assassinate-space scoring ---
  assassinateWhite: number;
  assassinateEnemy: number;
  assassinateControlMarker: number;
  assassinateVpMultiplier: number;

  // --- Trash / promote / devour heuristics ---
  /** Base score for trashing a recruited (non-starter) card; cost is added to this.
   *  Higher = AI is more reluctant to trash recruited cards. */
  trashRecruitedBase: number;
  /** Don't let the cycling deck shrink below this when trashing optionally. */
  minCyclingDeck: number;

  // --- Action priorities ---
  /** Spend power on assassinate before deploy when power ≥ this. */
  powerThresholdForAssassinate: number;

  // --- Site-pick (spy placement / return) ranking ---
  siteControlMarkerBonus: number;
  siteOwnSpyPenalty: number;
}

export const DEFAULT_WEIGHTS: HeuristicWeights = {
  deployBaseSite: 5,
  deployControlMarker: 12,
  deployVpMultiplier: 1,
  deployOwnPenalty: 2,
  deployEstablishBonus: 3,
  deployFirstFootBonus: 2,
  deployRouteSpace: 1,

  assassinateWhite: 2,
  assassinateEnemy: 6,
  assassinateControlMarker: 6,
  assassinateVpMultiplier: 1,

  trashRecruitedBase: 10,
  minCyclingDeck: 5,

  powerThresholdForAssassinate: 3,

  siteControlMarkerBonus: 10,
  siteOwnSpyPenalty: 5,
};

/** Merge a partial weights override onto the defaults. Missing fields fall
 *  through to DEFAULT_WEIGHTS so a tuner can mutate just one knob at a time. */
export function makeWeights(overrides?: Partial<HeuristicWeights>): HeuristicWeights {
  return { ...DEFAULT_WEIGHTS, ...(overrides ?? {}) };
}

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
  /** Spend power on assassinate before deploy when power ≥ this. Note: the
   *  engine's assassinate base-action costs 3 power, so the heuristic floors
   *  this value at 3 internally — setting it lower in a weight file is a no-op.
   *  Raise it above 3 to make the AI MORE reluctant to assassinate (save the
   *  power for multi-deploys). */
  powerThresholdForAssassinate: number;

  // --- Site-pick (spy placement / return) ranking ---
  siteControlMarkerBonus: number;
  siteOwnSpyPenalty: number;

  // --- Game-phase awareness (see src/ai/game-phase.ts) ---
  /** Minimum barracks across all players at which "late game" starts. */
  phaseLateBarracks: number;
  /** Minimum barracks across all players at which "endgame" starts (the
   *  user's "last turn or two" — promote-by-VP kicks in, etc.). */
  phaseEndgameBarracks: number;
  /** VP lead/deficit at which the AI considers itself "ahead" or "behind"
   *  for the purpose of late-game pacing. Symmetric: |lead| ≥ this triggers
   *  the corresponding strategy. */
  phaseLeadThreshold: number;
  /** Multiplier on assassinate priority when behind in late/endgame. Higher
   *  = AI farms trophies harder instead of deploying (which would hasten the
   *  game's end while it's losing). 1.0 = neutral. */
  behindAssassinateMultiplier: number;
  /** When behind in endgame, suppress deploys with this probability-like
   *  threshold (0.0 = always deploy as usual; 1.0 = never deploy in
   *  endgame-and-behind). Implemented as a hard skip when set above 0. */
  behindEndgameDeploySuppression: number;
  /** Multiplier on deploy priority when ahead in late/endgame. Higher
   *  = AI drains its barracks faster to trigger game-end while leading. */
  aheadDeployUrgencyMultiplier: number;
  /** In endgame phase, promote the highest-innerCircleVp card instead of
   *  the trashiest. Treated as 0 (off) or 1 (on); fractional values blend
   *  the two scoring strategies linearly (0.5 = tie-break by VP only). */
  endgamePromoteByVp: number;
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

  // Phase thresholds — user-supplied rules-of-thumb: "38 barracks → still
  // getting started; 8 barracks → game will be over soon."
  phaseLateBarracks: 15,
  phaseEndgameBarracks: 5,
  phaseLeadThreshold: 10,
  behindAssassinateMultiplier: 1.5,
  behindEndgameDeploySuppression: 0.5,
  aheadDeployUrgencyMultiplier: 1.5,
  endgamePromoteByVp: 1.0,
};

/** Merge a partial weights override onto the defaults. Missing fields fall
 *  through to DEFAULT_WEIGHTS so a tuner can mutate just one knob at a time. */
export function makeWeights(overrides?: Partial<HeuristicWeights>): HeuristicWeights {
  return { ...DEFAULT_WEIGHTS, ...(overrides ?? {}) };
}

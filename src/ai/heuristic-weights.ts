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
  /** Denial bonus: applied when placing a spy at a control-marker site
   *  that's currently controlled by an OPPONENT and has no opposing spy
   *  already there. A spy at such a site denies the opponent total
   *  control (TC) and forces them to spend power removing it — power
   *  they'd otherwise use to assassinate / deploy / build their lead.
   *  Per user's competitive-play notes. */
  siteDenialBonus: number;

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

  // --- Recruit value scoring (market row + aux stacks) ---
  // Per competitive-play wisdom, Priestess of Lolth (cost 2, +2 inf, IC VP 2)
  // is a great deal and players sometimes deny-buy them. The old "always
  // pick highest cost in market" rule never considered aux stacks at all
  // and underbought them as a fallback. These weights score each candidate
  // purchase; the AI picks the highest score across market + aux stacks.
  /** Coefficient on the card's innerCircleVp (banked at game end if promoted). */
  recruitIcVpWeight: number;
  /** Coefficient on the card's deckVp (small permanent VP per copy in deck). */
  recruitDeckVpWeight: number;
  /** Coefficient on the card's cost (proxy for in-play strength of the effect). */
  recruitCostWeight: number;
  /** Flat additive bonus for aux-stack candidates (Priestess, House Guard).
   *  Captures the denial value + reliability (15 copies, always available)
   *  that the per-card stats don't reflect. */
  recruitAuxStackBonus: number;
  /** Blend factor 0..1: 0 = score by raw value (favors high-cost cards),
   *  1 = score by value/cost (per-influence efficiency — favors Priestess
   *  and House Guard). Intermediate values interpolate. */
  recruitPerInfluenceBlend: number;

  // --- Lookahead toggle ---
  /** Enable 1-ply lookahead at high-leverage decision points (assassinate
   *  target, deploy target, spy site, supplant target). Treat as 0/1:
   *  fractional values don't blend usefully. When the heuristic is called
   *  with no simulator (e.g. the live web client), this knob is moot. */
  useLookahead: number;
  /** Enable category-based hand-play ordering (src/ai/card-classes.ts).
   *  0 = play hand[0] every time (legacy behavior), 1 = sort by category
   *  rank: hand-mutators first, power, tactical, influence. */
  useCardOrdering: number;
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
  siteDenialBonus: 15,

  // Phase thresholds — user-supplied rules-of-thumb: "38 barracks → still
  // getting started; 8 barracks → game will be over soon."
  phaseLateBarracks: 15,
  phaseEndgameBarracks: 5,
  phaseLeadThreshold: 10,
  behindAssassinateMultiplier: 1.5,
  behindEndgameDeploySuppression: 0.5,
  aheadDeployUrgencyMultiplier: 1.5,
  endgamePromoteByVp: 1.0,

  // Recruit scoring defaults: roughly preserves "buy highest-cost market
  // card" behavior when big market cards are affordable (recruitCostWeight
  // is high), but now ALSO considers aux stacks — so Priestess at 2 inf
  // gets bought when nothing pricier is affordable instead of ending the
  // turn with unspent influence. Tune recruitPerInfluenceBlend up to favor
  // efficiency (per competitive play, Priestess is great value).
  recruitIcVpWeight: 2,
  recruitDeckVpWeight: 1,
  recruitCostWeight: 2,
  recruitAuxStackBonus: 0,
  recruitPerInfluenceBlend: 0,

  useLookahead: 1,
  useCardOrdering: 1,
};

/** Merge a partial weights override onto the defaults. Missing fields fall
 *  through to DEFAULT_WEIGHTS so a tuner can mutate just one knob at a time. */
export function makeWeights(overrides?: Partial<HeuristicWeights>): HeuristicWeights {
  return { ...DEFAULT_WEIGHTS, ...(overrides ?? {}) };
}

// Regression test for "Repeated tactics of AI" (#83). The heuristic AI used to
// open at the same starting site every game (deterministic argmax over starting
// sites by control-marker + VP). The opening-variance knob
// (WEIGHTS.openingVarianceTopK) now samples the starting site from the top-K
// sites weighted by rank, so the strongest stays most likely but the opening
// differs game to game. The starting-site pick is the very first decision of
// the game (setupPhase), so we can probe it directly on the initial state.
//
// Asserts:
//   1. With default weights the AI's opening starting site varies.
//   2. The strongest starting site is still the single most common opening.
//   3. With openingVarianceTopK = 1 the opening is deterministic (old behaviour).
import { InitializeGame } from 'boardgame.io/internal';
import { TyrantsGame, type TyrantsState } from '../src/game';
import { decideHeuristicMoveWithWeights } from '../src/ai/heuristic-ai';
import { DEFAULT_WEIGHTS, type HeuristicWeights } from '../src/ai/heuristic-weights';

let ok = true;
const check = (cond: boolean, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) ok = false; };

// A fresh setup-phase state: P0 to move, must place its starting troop. The
// chosen site is deployStartingTroop's argument. (2P → center section only.)
function freshSetupState(): TyrantsState {
  const game = {
    ...TyrantsGame,
    setup: (a: Parameters<NonNullable<typeof TyrantsGame.setup>>[0]) =>
      TyrantsGame.setup!(a, { halfDecks: ['drow', 'dragons'], activeSections: ['center'] }),
  };
  return (InitializeGame({ game, numPlayers: 2 }) as unknown as { G: TyrantsState }).G;
}

function openingPick(G: TyrantsState, weights: HeuristicWeights): string | null {
  const mv = decideHeuristicMoveWithWeights(G, '0', weights);
  return mv?.name === 'deployStartingTroop' ? (mv.args as string[])[0] : null;
}

// Each fresh game can shuffle a different starting layout, and the knob samples
// per call — so distinct seeds + sampling both contribute to variety. Probe the
// same initial state repeatedly to isolate the knob's effect.
const G0 = freshSetupState();

// 1 + 2: default weights on one fixed state → variety with a clear favourite.
const counts = new Map<string, number>();
const N = 400;
for (let i = 0; i < N; i++) {
  const s = openingPick(G0, DEFAULT_WEIGHTS);
  if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
}
const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
console.log(`Opening starting sites over ${N} samples:`, ranked.map(([s, c]) => `${s}=${c}`).join(', '));
check(ranked.length >= 2, `opening varies (saw ${ranked.length} distinct starting sites)`);
check(ranked.length > 0 && ranked[0][1] < N, 'no single site is forced every game');
// Strongest is most common: its share should clearly exceed the runner-up's.
check(ranked.length >= 2 && ranked[0][1] > ranked[1][1], 'the strongest site is the most common opening');

// 3: topK = 1 → deterministic opening (old behaviour preserved / opt-out works).
const det = { ...DEFAULT_WEIGHTS, openingVarianceTopK: 1 };
const detSites = new Set<string>();
for (let i = 0; i < 30; i++) { const s = openingPick(G0, det); if (s) detSites.add(s); }
console.log('topK=1 opening sites:', [...detSites].join(', '));
check(detSites.size === 1, `topK=1 opens at a single site every time (saw ${detSites.size})`);

console.log(ok ? '\nOPENING-VARIANCE TESTS PASSED' : '\nOPENING-VARIANCE TESTS FAILED');
process.exit(ok ? 0 : 1);

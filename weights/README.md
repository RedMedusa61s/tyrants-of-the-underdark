# Heuristic AI weight files

JSON files in this directory are partial overrides on `DEFAULT_WEIGHTS`
(see `src/ai/heuristic-weights.ts` for the full set + defaults). Any
omitted field falls through to the default, so a weight file can be as
small as a single knob.

## Running a tournament

```
npm run tournament -- --games 100 --a weights/baseline.json --b weights/aggressive.json
npm run tournament -- --games 100 --b weights/aggressive.json     # A defaults to DEFAULT_WEIGHTS
npm run tournament -- --games 200 --num-players 2 --half-decks demons,drow
```

The runner prints per-variant win rate and avg score, the win-rate gap,
and a ±2σ noise floor — if the gap is smaller than the noise floor,
treat the result as a tie.

## Suggested workflow for tuning

1. Save the current defaults as `weights/baseline.json` (empty `{}` works
   — defaults pass through).
2. Make a hypothesis: e.g. "the AI under-values assassinating enemies on
   high-VP non-control sites; raising `assassinateVpMultiplier` from 1 to
   2 should help."
3. Save the tweaked weights as `weights/v2.json` and run a 100–200 game
   tournament against the baseline.
4. If the gap clears the noise floor, promote v2 → baseline and iterate.

The runner is ~1.3 games/sec for 2P and slower for 4P, so a 200-game
2P tournament finishes in ~2.5 minutes.

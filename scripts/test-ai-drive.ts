// Regression gate: the server-side AI must be able to drive a full turn — and a
// full GAME — for every card in every deck, without ever getting wedged.
//
// This is the test that would have caught the aberrations forced-discard crash
// (a cross-player mandatory choice the AI couldn't resolve, which locked online
// vs-AI games at "Red is taking their turn"). It mirrors the framework's
// driveAi loop exactly — viewFor(redacted) → controller.selectAction →
// adapter.tryApplyAction — so anything that wedges here would wedge a live
// online game. It runs both difficulties across every half-deck pair and fails
// (exit 1) on ANY of:
//   - the controller throwing,
//   - an action the engine rejects (the AI can't legally advance),
//   - a game that never terminates (a non-ending loop),
//   - the same actor acting forever without the turn passing.
//
// Usage: npm run test:ai-drive [gamesPerPair]   (default 4)

import { InitializeGame } from 'boardgame.io/internal';
import { TyrantsGame } from '../src/game';
import { tyrantsAdapter } from '../src/adapter/tyrantsAdapter';
import { tyrantsControllers } from '../src/online/aiControllers';

const adapter: any = tyrantsAdapter;

// A normal Tyrants game resolves in ~300–600 moves; anything past this is a
// non-terminating loop, not a long game.
const STEP_CAP = 4000;

interface Failure { kind: string; detail: Record<string, unknown> }

async function runGame(halfDecks: string[], difficulty: string): Promise<Failure | null> {
  const ctrl: any = tyrantsControllers[difficulty];
  const game = { ...TyrantsGame, setup: (a: any) => TyrantsGame.setup!(a, { halfDecks }) };
  let s: any = InitializeGame({ game, numPlayers: 2 });
  let lastActor: string | null = null;
  let sameActorStreak = 0;

  for (let step = 0; step < STEP_CAP; step++) {
    const actor = adapter.currentActor(s);
    if (actor === null) return null; // game over — clean

    sameActorStreak = actor === lastActor ? sameActorStreak + 1 : 0;
    lastActor = actor;
    if (sameActorStreak > 1000) {
      return { kind: 'RUNAWAY-LOOP', detail: { halfDecks, difficulty, actor, pendingChoice: s.G.pendingChoice, log: s.G.log.slice(-6) } };
    }

    let view: any;
    try { view = adapter.viewFor(s, actor); }
    catch (e: any) { return { kind: 'viewFor-threw', detail: { halfDecks, difficulty, err: String(e?.message ?? e), pendingChoice: s.G.pendingChoice } }; }

    const rng = { int: (n: number) => Math.floor(Math.random() * n), float: () => Math.random(), next: () => Math.random() };
    let action: any;
    try { action = await ctrl.selectAction({ state: view, actor, adapter, rng }); }
    catch (e: any) { return { kind: 'selectAction-threw', detail: { halfDecks, difficulty, err: String(e?.message ?? e), pendingChoice: s.G.pendingChoice, log: s.G.log.slice(-6) } }; }

    const r = adapter.tryApplyAction(s, action, actor);
    if (!r.ok) {
      return { kind: 'AI-wedged (engine rejected its move)', detail: { halfDecks, difficulty, action, reason: r.reason, pendingChoice: s.G.pendingChoice, log: s.G.log.slice(-8) } };
    }
    s = r.state;
  }
  return { kind: 'NON-TERMINATING', detail: { halfDecks, difficulty, note: `exceeded ${STEP_CAP} moves without ending`, actor: adapter.currentActor(s), pendingChoice: s.G.pendingChoice, log: s.G.log.slice(-8) } };
}

const DECKS = ['drow', 'dragons', 'elemental', 'demons', 'aberrations', 'undead'];
const PAIRS: string[][] = [];
for (let i = 0; i < DECKS.length; i++) for (let j = i + 1; j < DECKS.length; j++) PAIRS.push([DECKS[i], DECKS[j]]);

(async () => {
  const perPair = Math.max(1, parseInt(process.argv[2] ?? '4', 10) || 4);
  const failures: Failure[] = [];
  let games = 0;

  for (const difficulty of ['standard', 'random']) {
    for (const pair of PAIRS) {
      for (let g = 0; g < perPair; g++) {
        games++;
        const f = await runGame(pair, difficulty);
        if (f) {
          failures.push(f);
          console.log(`FAIL  [${difficulty}] [${pair.join('+')}] game ${g}: ${f.kind}`);
          console.log('      ' + JSON.stringify(f.detail));
          if (failures.length >= 8) { console.log('\n(stopping after 8 failures)'); break; }
        }
      }
      if (failures.length >= 8) break;
    }
    if (failures.length >= 8) break;
  }

  if (failures.length === 0) {
    console.log(`\nPASS  AI-drive: ${games} full games across ${PAIRS.length} deck pairs × 2 difficulties — the AI drove every turn to completion with no wedge.`);
    process.exit(0);
  } else {
    console.log(`\nFAILED  AI-drive: ${failures.length} wedge(s) found — the server-side AI could not complete a turn. This WOULD lock a live online game. Do not ship.`);
    process.exit(1);
  }
})();

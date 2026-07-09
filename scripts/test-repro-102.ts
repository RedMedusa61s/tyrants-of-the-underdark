// Regression guard for issue #102: online ranked-vs-AI game reported "stuck"
// on the AI's FINAL turn (end-game triggered, no score shown).
//
// The fixture is the exact server snapshot stored with the report (fetched via
// the public GET /api/reports triage endpoint): human seat 0 has just ended
// their last turn, seat 1 (the server-driven AI) must take the game's final
// turn. Investigation showed the ENGINE was never at fault — this replays the
// server's driveAi loop verbatim (same deterministic mulberry32 Rng, same
// seedFor(gameId, turn)+i per-step seeds, same tryApplyAction semantics) and
// must reach game over for both shipped difficulties. What it guards:
//
//   - snapshotCodec decode of a REAL production snapshot (with the store's
//     'v1:' version prefix stripped, as the framework does on read);
//   - the AI controllers driving an end-game state to termination;
//   - viewFor/result staying total on the terminal state (a throw there would
//     poison every subsequent fetch of a finished game).
//
// The user-facing wedge itself was a HUNG request freezing the client (no
// request deadline → no error → useGame never resumed polling → the server's
// 0.39.0 stranded-turn self-heal never got a fetch to run in). That fix lives
// in src/online/client.ts (per-attempt abort deadlines in apiJson).
//
//   npx vite-node scripts/test-repro-102.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Rng } from 'digital-boardgame-framework';
import { snapshotCodec } from '../src/online/snapshotCodec';
import { tyrantsAdapter } from '../src/adapter/tyrantsAdapter';
import { tyrantsControllers } from '../src/online/aiControllers';

const GAME_ID = 'q3qyu59bssgkkivw'; // the reported game — part of the drive seed
const SNAP_TURN = 225;              // store turn of the fixture snapshot

const raw = readFileSync(
  join(process.cwd(), 'scripts/fixtures/issue-102-final-turn-snapshot.txt'),
  'utf8',
).trim().replace(/^v\d+:/, '');

// Verbatim from the framework's GameServer.seedFor().
function seedFor(gameId: string, turn: number): number {
  let h = turn + 1;
  for (let i = 0; i < gameId.length; i++) h = (h * 31 + gameId.charCodeAt(i)) >>> 0;
  return h;
}

let failures = 0;
function check(cond: boolean, label: string): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

for (const diff of ['standard', 'random'] as const) {
  let s: any = snapshotCodec().decode(raw);
  check(tyrantsAdapter.currentActor(s) === '1', `[${diff}] fixture decodes with AI seat '1' to move`);

  const ctrl = tyrantsControllers[diff];
  let steps = 0;
  let wedge: string | null = null;
  for (; steps < 1000; steps++) {
    const actor = tyrantsAdapter.currentActor(s);
    if (actor === null) break; // game over
    if (actor !== '1') { wedge = `turn passed to ${actor} before game over`; break; }
    const view = tyrantsAdapter.viewFor(s, actor);
    const rng = new Rng(seedFor(GAME_ID, SNAP_TURN) + steps);
    let action: any;
    try {
      action = await ctrl.selectAction({ state: view, actor, adapter: tyrantsAdapter, rng } as any);
    } catch (e: any) {
      wedge = `selectAction threw at step ${steps}: ${e?.message}`;
      break;
    }
    const r = tyrantsAdapter.tryApplyAction!(s, action, actor);
    if (!r.ok) { wedge = `illegal action at step ${steps}: ${r.reason}`; break; }
    s = r.state;
  }
  check(wedge === null && tyrantsAdapter.currentActor(s) === null,
    `[${diff}] final AI turn drives to game over (${steps} moves)${wedge ? ` — ${wedge}` : ''}`);

  const result = tyrantsAdapter.result?.(s);
  check(!!result?.winners?.length, `[${diff}] terminal state has a result (${JSON.stringify(result)})`);

  // A finished game keeps being fetched by both clients — views must stay total.
  let viewsOk = true;
  for (const seat of ['0', '1']) {
    try { tyrantsAdapter.viewFor(s, seat); } catch { viewsOk = false; }
  }
  check(viewsOk, `[${diff}] viewFor is total on the terminal state for both seats`);

  // And it must survive the server's persist/load cycle intact.
  const rt: any = snapshotCodec().decode(snapshotCodec().encode(s));
  check(tyrantsAdapter.currentActor(rt) === null, `[${diff}] terminal state round-trips through snapshotCodec`);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll issue-102 regression checks passed.');

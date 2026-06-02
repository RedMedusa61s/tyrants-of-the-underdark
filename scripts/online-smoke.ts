// Over-the-wire smoke test for the online multiplayer API. Drives the running
// Vite dev server (npm run dev) via HTTP fetch — the same path the browser
// client uses. Run with: vite-node scripts/online-smoke.ts
//
// Asserts:
//  1. create a 2-player game → two invite links
//  2. each seat fetches and sees ONLY its own hand (viewFor over the wire)
//  3. legal moves play through (setup deploy → regular turns) without divergence
//  4. out-of-turn submit is rejected (403 / "Not your turn")
//  5. a bug report round-trips and appears in /api/reports
//  6. play continues to a finished game (or many turns), gameOver observable

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:5173';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
}

const HIDDEN = '__hidden__';
function handHiddenCount(hand: any[]): number {
  return hand.filter((c) => c && c.deck === HIDDEN).length;
}

async function main() {
  console.log(`[smoke] base = ${BASE}`);

  // 1. create a 2-player game
  const create = await api('POST', '/api/games', { numPlayers: 2 });
  assert(create.status === 200, `create status ${create.status}: ${JSON.stringify(create.data)}`);
  const gameId: string = create.data.gameId;
  const invites: Record<string, string> = create.data.invites;
  assert(gameId, 'gameId present');
  assert(invites['0'] && invites['1'], 'two invite links');
  const tok = {
    '0': new URL(invites['0']).searchParams.get('as')!,
    '1': new URL(invites['1']).searchParams.get('as')!,
  };
  console.log(`[smoke] created game ${gameId}`);

  // 2. each seat fetches and sees only its own hand
  const v0 = await api('GET', `/api/games/${gameId}?as=${tok['0']}`);
  const v1 = await api('GET', `/api/games/${gameId}?as=${tok['1']}`);
  assert(v0.status === 200 && v1.status === 200, 'both fetch ok');
  assert(v0.data.you === '0' && v1.data.you === '1', 'each token authenticates as its own seat');

  const p0from0 = v0.data.view.G.players['0'];
  const p1from0 = v0.data.view.G.players['1'];
  const p0from1 = v1.data.view.G.players['0'];
  const p1from1 = v1.data.view.G.players['1'];

  // Seat 0's own hand is visible to seat 0, hidden to seat 1.
  assert(handHiddenCount(p0from0.hand) === 0, 'seat 0 sees its own hand (not hidden)');
  assert(p0from0.hand.length > 0, 'seat 0 has a non-empty hand');
  assert(handHiddenCount(p0from1.hand) === p0from1.hand.length,
    'seat 1 sees seat 0 hand FULLY hidden');
  assert(handHiddenCount(p1from1.hand) === 0, 'seat 1 sees its own hand');
  assert(handHiddenCount(p1from0.hand) === p1from0.hand.length,
    'seat 0 sees seat 1 hand FULLY hidden');
  // Decks are hidden to everyone (order secret), market deck hidden.
  assert(handHiddenCount(p0from0.deck) === p0from0.deck.length, 'own deck order hidden');
  assert(v0.data.view.G.market.deck.every((c: any) => c.deck === HIDDEN), 'market deck hidden');
  console.log('[smoke] OK viewFor over the wire: hands/decks redacted per seat');

  // 4. out-of-turn rejection — figure out who is NOT the active seat.
  const active: string = v0.data.yourTurn ? '0' : '1';
  const idle: string = active === '0' ? '1' : '0';
  const idleLegal = await api('GET', `/api/games/${gameId}/legal?as=${tok[idle as '0' | '1']}`);
  assert(JSON.stringify(idleLegal.data) === '[]', 'idle seat has no legal actions');
  // Try to submit *something* as the idle seat → 403 Not your turn.
  const oot = await api('POST', `/api/games/${gameId}/submit?as=${tok[idle as '0' | '1']}`,
    { action: { kind: 'endTurn' } });
  assert(oot.status === 403, `out-of-turn submit should be 403, got ${oot.status}: ${JSON.stringify(oot.data)}`);
  console.log('[smoke] OK turn enforcement: out-of-turn submit -> 403');

  // 5. bug report round-trips
  const rep = await api('POST', `/api/games/${gameId}/report?as=${tok['0']}`,
    { message: 'smoke-test report', severity: 'bug' });
  assert(rep.status === 200 && rep.data.reportId, 'report filed');
  const reports = await api('GET', `/api/reports`);
  assert(reports.status === 200 && Array.isArray(reports.data), 'reports list ok');
  assert(reports.data.some((r: any) => r.reportId === rep.data.reportId), 'filed report appears in list');
  console.log('[smoke] OK bug report round-trip');

  // 3 + 6. play legal moves through, alternating seats, until gameOver or a cap.
  // A full Tyrants game is thousands of actions over HTTP+disk, far longer than a
  // smoke test needs. We cap at enough actions to prove sustained, alternating,
  // turn-enforced play over the wire; reaching gameOver is reported if it happens
  // but is not the gate (a full game is exercised by the headless harnesses).
  let turns = 0;
  const MAX = Number(process.env.SMOKE_MAX ?? 80);
  let gameOver = false;
  const actedSeats = new Set<string>();
  while (turns < MAX) {
    // Who acts now? Ask both; whoever has yourTurn=true acts.
    const f0 = await api('GET', `/api/games/${gameId}?as=${tok['0']}`);
    if (f0.data.gameOver) { gameOver = true; break; }
    const actor: '0' | '1' = f0.data.yourTurn ? '0' : '1';
    const legal = await api('GET', `/api/games/${gameId}/legal?as=${tok[actor]}`);
    const acts: any[] = legal.data;
    assert(Array.isArray(acts) && acts.length > 0, `actor ${actor} has legal actions (turn ${turns})`);

    // Prefer ending the turn periodically so the game actually progresses;
    // otherwise pick a non-endTurn action to do stuff, else endTurn.
    const endTurn = acts.find((a) => a.kind === 'endTurn');
    const nonEnd = acts.filter((a) => a.kind !== 'endTurn' && a.kind !== 'deployStartingTroop');
    const startDeploy = acts.find((a) => a.kind === 'deployStartingTroop');
    let pick: any;
    if (startDeploy) pick = startDeploy;
    else if (endTurn && (turns % 3 === 2 || nonEnd.length === 0)) pick = endTurn;
    else pick = nonEnd[0] ?? endTurn ?? acts[0];

    const sub = await api('POST', `/api/games/${gameId}/submit?as=${tok[actor]}`, { action: pick });
    assert(sub.status === 200, `submit ${pick.kind} by ${actor} ok, got ${sub.status}: ${JSON.stringify(sub.data)}`);
    actedSeats.add(actor);
    if (sub.data.gameOver) { gameOver = true; break; }
    turns++;
  }
  console.log(`[smoke] played ${turns} submitted actions; seats acted=${[...actedSeats].sort().join(',')}; gameOver=${gameOver}`);
  assert(turns > 5, 'multiple legal actions played through over the wire');
  assert(actedSeats.has('0') && actedSeats.has('1'), 'BOTH seats acted (turn passed over the wire)');

  console.log('\n[smoke] ALL CHECKS PASSED');
}

main().catch((e) => {
  console.error('\n[smoke] FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});

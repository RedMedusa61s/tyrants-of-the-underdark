// End-to-end test of the in-game chat routes (framework messaging, dbf@0.8.0)
// driven through the same handleApi router the Functions/dev-middleware use,
// backed by FsStore (no cloud needed). Verifies: post returns the refreshed
// list, the seat is stamped from the token (not the client), the other seat
// sees the message, bad tokens are rejected, and empty bodies are 422'd.
import { GameServer, NoopNotifier } from 'digital-boardgame-framework/server';
import { FsStore } from 'digital-boardgame-framework/server/node';
import { tyrantsAdapter, initialBgioState, type BgioState, type TyrantsAction, type PlayerId } from '../src/adapter/tyrantsAdapter';
import { snapshotCodec } from '../src/online/snapshotCodec';
import { handleApi } from '../server/handlers';
import { rmSync } from 'node:fs';

const DIR = './.chat-test-store';
rmSync(DIR, { recursive: true, force: true });
const server = new GameServer<BgioState, TyrantsAction, PlayerId>({
  adapter: tyrantsAdapter,
  codec: snapshotCodec(),
  store: new FsStore(DIR),
  notifier: new NoopNotifier(),
  gameUrl: (id, t) => `x/${id}?as=${t}`,
});

let ok = true;
const check = (label: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) ok = false;
};
const Q = (t: string) => new URLSearchParams({ as: t });
type Msg = { seat: string; body: string; at: string };
const has = (b: unknown, seat: string, body: string) =>
  Array.isArray(b) && (b as Msg[]).some(m => m.seat === seat && m.body === body);

const game = await server.createGame({
  initialState: initialBgioState(2, { activeSections: ['center'] }),
  players: ['0', '1'],
});
const id = game.gameId;
// createGame returns invites as gameUrl(...) OUTPUTS (full URLs); the bare token
// is the `as=` query param (the real client extracts it the same way).
const tokenOf = (invite: string) => new URLSearchParams(invite.split('?')[1] ?? '').get('as') ?? invite;
const t0 = tokenOf(game.invites['0']);
const t1 = tokenOf(game.invites['1']);

// Seat 0 posts; the returned list contains it stamped as seat '0'.
let res = await handleApi(server, 'POST', `/api/games/${id}/chat`, Q(t0), { body: 'hi from seat 0' });
check('POST chat → 200', res.status === 200);
check('post is stamped seat 0 (from token, not client)', has(res.body, '0', 'hi from seat 0'));

// Seat 1 lists and sees seat 0's message.
res = await handleApi(server, 'GET', `/api/games/${id}/chat`, Q(t1), undefined);
check('other seat GET sees the message', res.status === 200 && has(res.body, '0', 'hi from seat 0'));

// Seat 1 posts; stamped as seat '1'.
res = await handleApi(server, 'POST', `/api/games/${id}/chat`, Q(t1), { body: 'hi from seat 1' });
check('post is stamped seat 1', has(res.body, '1', 'hi from seat 1'));

// Auth gate: a bogus token is rejected (not 200).
res = await handleApi(server, 'POST', `/api/games/${id}/chat`, Q('bogus-token'), { body: 'x' });
check('bad token rejected (status !== 200)', res.status !== 200);

// Empty body → 422 (handler guard, before hitting the store).
res = await handleApi(server, 'POST', `/api/games/${id}/chat`, Q(t0), { body: '   ' });
check('empty body → 422', res.status === 422);

rmSync(DIR, { recursive: true, force: true });
console.log(ok ? '\nALL CHAT TESTS PASSED' : '\nCHAT TESTS FAILED');
process.exit(ok ? 0 : 1);

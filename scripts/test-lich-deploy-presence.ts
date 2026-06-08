// Regression test: Lich's "take up to 2 troops from their trophy hall and
// deploy them" uses the PLAIN deploy keyword — so placement is restricted to
// empty spaces where the active player has presence (rulebook p.12). Orcus, by
// contrast, prints "deploy them anywhere on the board" and may place on ANY
// empty space. Both share takeTrophyAndPlace(); the difference is the
// restrictToPresence flag. Reported in-game (#69): "lich is letting me deploy
// on any empty space, but is it supposed to be where i have presence".
import { InitializeGame } from 'boardgame.io/internal';
import { TyrantsGame, type TyrantsState } from '../src/game';
import { takeTrophyAndPlace, spacesWithPresence } from '../src/engine/handler-helpers';
import { TROOP_SPACES } from '../src/data/troop-spaces';

let ok = true;
const check = (label: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) ok = false;
};

// Build a real game state so hasPresence works against actual map data.
function freshGame(): TyrantsState {
  const init = (InitializeGame({ game: TyrantsGame, numPlayers: 2 }) as unknown as { G: TyrantsState }).G;
  const G = structuredClone(init);
  // Give the victim (P2) a white trophy for the Lich/Orcus to take.
  G.players['1'].trophyHall.white = 1;
  return G;
}

// Place ONE active-player (P1) troop on the map so P1 has presence somewhere.
function plantPresence(G: TyrantsState): string {
  const me = G.players['0'].color;
  const anchor = TROOP_SPACES.find(t => t.parentSite && t.id in G.troops && G.troops[t.id] === null)!;
  G.troops[anchor.id] = me;
  return anchor.id;
}

// Drive takeTrophyAndPlace up to the placement prompt and return its options.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function placementOptions(G: TyrantsState, opts: any): string[] {
  const h = takeTrophyAndPlace(opts);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx: any = { G, actorId: '0', card: null, handlerState: null, pendingChoice: null, paused: false };
  h(ctx);                                  // fresh → choose-one (which trophy)
  ctx.pendingChoice.response = 0;          // pick the only trophy
  h(ctx);                                  // step-1 resume → select-troop-space
  if (ctx.pendingChoice?.kind !== 'select-troop-space') return [];
  return ctx.pendingChoice.options as string[];
}

// 1. Lich (restrictToPresence) — options limited to empty presence spaces.
{
  const G = freshGame();
  const anchor = plantPresence(G);
  const me = G.players['0'].color;
  const expected = spacesWithPresence(G, me).filter(id => G.troops[id] === null);
  const got = placementOptions(G, { count: 1, ownerPid: '1', restrictToPresence: true });
  check('Lich: placement options are exactly the empty presence spaces',
    got.length > 0 && got.length === expected.length && got.every(id => expected.includes(id)));
  check('Lich: every option is an empty space where P1 has presence',
    got.every(id => G.troops[id] === null && spacesWithPresence(G, me).includes(id)));
  check('Lich: the anchored (occupied) space is NOT offered', !got.includes(anchor));
}

// 2. Orcus (no restriction) — options include empty spaces with NO presence.
{
  const G = freshGame();
  plantPresence(G);
  const me = G.players['0'].color;
  const presence = new Set(spacesWithPresence(G, me));
  const got = placementOptions(G, { count: 1, ownerPid: '1' });
  const allEmpty = TROOP_SPACES.filter(t => t.id in G.troops && G.troops[t.id] === null).map(t => t.id);
  check('Orcus: placement options are ALL empty spaces (anywhere on the board)',
    got.length === allEmpty.length);
  check('Orcus: options include at least one empty space with NO presence',
    got.some(id => !presence.has(id)));
}

// 3. Restriction strictly narrows the option set (the actual bug).
{
  const G = freshGame();
  plantPresence(G);
  const lich = placementOptions(structuredClone(G), { count: 1, ownerPid: '1', restrictToPresence: true });
  const orcus = placementOptions(structuredClone(G), { count: 1, ownerPid: '1' });
  check('Lich offers strictly fewer spaces than Orcus', lich.length < orcus.length);
  check('Every Lich option is also an Orcus option (subset)', lich.every(id => orcus.includes(id)));
}

// 4. Behavioral: placing via Lich lands the WHITE trophy on a presence space
//    and decrements the victim's trophy hall.
{
  const G = freshGame();
  plantPresence(G);
  const me = G.players['0'].color;
  const h = takeTrophyAndPlace({ count: 1, ownerPid: '1', restrictToPresence: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx: any = { G, actorId: '0', card: null, handlerState: null, pendingChoice: null, paused: false };
  h(ctx);
  ctx.pendingChoice.response = 0;
  h(ctx);
  const target = (ctx.pendingChoice.options as string[])[0];
  ctx.pendingChoice.response = target;
  const done = h(ctx);
  check('Lich: white trophy placed at a presence space', G.troops[target] === 'white');
  check('Lich: target space had P1 presence', spacesWithPresence(G, me).includes(target));
  check('Lich: victim trophy hall decremented', G.players['1'].trophyHall.white === 0);
  check('Lich: effect completes after placing the count', done === true);
}

console.log(ok ? '\nALL LICH-DEPLOY-PRESENCE TESTS PASSED' : '\nTESTS FAILED');
process.exit(ok ? 0 : 1);

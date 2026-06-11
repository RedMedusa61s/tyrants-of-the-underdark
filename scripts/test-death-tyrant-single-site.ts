// Regression test for #77: "death tyrant let me assassinate at 3 different
// sites but should only allow at one site." Death Tyrant's card text reads
// "Assassinate up to 3 troops at a SINGLE site." The generic multi-count
// assassinateChoice recomputed eligible targets across the whole board on every
// kill, so it happily let you spread 3 kills across 3 different sites. The fix
// adds a `sameSite` option that locks every kill after the first to the first
// target's site.
import { InitializeGame } from 'boardgame.io/internal';
import { assassinateChoice, spacesWithPresence } from '../src/engine/handler-helpers';
import { TyrantsGame, type TyrantsState } from '../src/game';
import { TROOP_SPACES } from '../src/data/troop-spaces';

let ok = true;
const check = (label: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) ok = false;
};

// Find two distinct sites that are active on the board: site A with >=3 troop
// spaces (P1 anchor + two enemies), site B with >=2 (P1 anchor + one enemy).
function pickSites(G: TyrantsState): { a: string[]; b: string[] } {
  const bySite = new Map<string, string[]>();
  for (const t of TROOP_SPACES) {
    if (!t.parentSite) continue;          // sites only, not routes
    if (!(t.id in G.troops)) continue;    // active spaces only
    const arr = bySite.get(t.parentSite) ?? [];
    arr.push(t.id);
    bySite.set(t.parentSite, arr);
  }
  let a: string[] | null = null, b: string[] | null = null;
  for (const [, spaces] of bySite) {
    if (!a && spaces.length >= 3) { a = spaces; continue; }
    if (a && !b && spaces.length >= 2) { b = spaces; break; }
  }
  if (!a || !b) throw new Error('could not find two suitable sites');
  return { a, b };
}

function setup(): { G: TyrantsState; a: string[]; b: string[]; enemy: string } {
  const init = (InitializeGame({ game: TyrantsGame as never, numPlayers: 2 }) as unknown as { G: TyrantsState }).G;
  const G = structuredClone(init);
  const me = G.players['0'].color;
  const enemy = G.players['1'].color;
  const { a, b } = pickSites(G);
  // Clear any starting whites on the spaces we use, then plant our scenario.
  for (const id of [...a, ...b]) G.troops[id] = null;
  G.troops[a[0]] = me;      // P1 anchor → presence at site A
  G.troops[a[1]] = enemy;   // two enemy troops at site A
  G.troops[a[2]] = enemy;
  G.troops[b[0]] = me;      // P1 anchor → presence at site B
  G.troops[b[1]] = enemy;   // one enemy troop at site B
  return { G, a, b, enemy };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const freshCtx = (G: TyrantsState): any =>
  ({ G, actorId: '0', card: null, handlerState: null, pendingChoice: null, paused: false });

// --- The fix: sameSite locks kills to the first target's site. ---
{
  const { G, a, b } = setup();
  const me = G.players['0'].color;
  const presence = new Set(spacesWithPresence(G, me));
  check('precondition: P1 has presence at both sites', presence.has(a[0]) && presence.has(b[0]));

  const h = assassinateChoice({ count: 3, sameSite: true });
  const ctx = freshCtx(G);
  h(ctx);   // first prompt
  const firstOptions = ctx.pendingChoice.options as string[];
  check('first prompt offers enemies at BOTH sites', firstOptions.includes(a[1]) && firstOptions.includes(b[1]));

  // Kill an enemy at site A.
  ctx.pendingChoice.response = a[1];
  h(ctx);   // second prompt
  const secondOptions = (ctx.pendingChoice?.options ?? []) as string[];
  check('after first kill, prompt offers ONLY the remaining site-A enemy', secondOptions.includes(a[2]));
  check('after first kill, the site-B enemy is NO LONGER offered', !secondOptions.includes(b[1]));

  // Kill the second site-A enemy → site A exhausted; effect ends (no 3rd prompt
  // crossing to site B) even though one count remains.
  ctx.pendingChoice.response = a[2];
  const done = h(ctx);
  check('effect ends once the single site is exhausted', done === true);
  check('the site-B enemy SURVIVES (never reachable from this card)', G.troops[b[1]] === G.players['1'].color);
  check('both site-A enemies were removed', G.troops[a[1]] === null && G.troops[a[2]] === null);
}

// --- Contrast: WITHOUT sameSite, the second prompt still spans both sites
//     (proving the lock is what changed behavior, not the scenario). ---
{
  const { G, a, b } = setup();
  const h = assassinateChoice({ count: 3 });   // no sameSite
  const ctx = freshCtx(G);
  h(ctx);
  ctx.pendingChoice.response = a[1];
  h(ctx);
  const secondOptions = (ctx.pendingChoice?.options ?? []) as string[];
  check('control (no sameSite): second prompt still offers the site-B enemy', secondOptions.includes(b[1]));
}

console.log(ok ? '\nALL DEATH-TYRANT TESTS PASSED' : '\nTESTS FAILED');
process.exit(ok ? 0 : 1);

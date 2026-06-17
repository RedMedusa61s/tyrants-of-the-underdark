// Regression test for "AI plays in OUT OF PLAY zones" (2P/3P). With the board
// limited to a subset of sections, NO piece — troop, spy, or control marker —
// nor any move target should ever land on a site/space outside the active
// sections. Drives the real reducer + heuristic AI through full games for the
// 2P (center only) and 3P (center + one outer) layouts and asserts after every
// move that the live state never references an out-of-play site/space.
import { CreateGameReducer, InitializeGame } from 'boardgame.io/internal';
import { TyrantsGame, type TyrantsState } from '../src/game';
import { decideHeuristicMove } from '../src/ai/heuristic-ai';
import { decideAiMove } from '../src/ai/random-ai';
import { SITES } from '../src/data/sites';
import { TROOP_SPACES } from '../src/data/troop-spaces';
import { ROUTES } from '../src/data/routes';

type BgState = { G: TyrantsState; ctx: { currentPlayer: string; gameover?: unknown; numPlayers: number } };
type Reducer = (s: BgState, a: unknown) => BgState;
const action = (type: string, args: unknown[], pid: string) =>
  ({ type: 'MAKE_MOVE', payload: { type, args, playerID: pid } });

let ok = true;
const fail = (msg: string) => { console.log('FAIL  ' + msg); ok = false; };

function activeSpaceIds(active: Set<string>): Set<string> {
  // Mirror the engine's isActiveSpace: site spaces are active when their site
  // is; ROUTE spaces are active only when BOTH endpoint sites are active.
  const activeRoutes = new Set(ROUTES.filter(r => active.has(r.a) && active.has(r.b)).map(r => r.id));
  const ids = new Set<string>();
  for (const t of TROOP_SPACES) {
    if (t.parentSite) { if (active.has(t.parentSite)) ids.add(t.id); }
    else if (t.parentRoute) { if (activeRoutes.has(t.parentRoute)) ids.add(t.id); }
  }
  return ids;
}

type Decider = (G: TyrantsState, pid: string) => { name: string; args?: unknown[] } | null;

function runLayout(label: string, numPlayers: number, sections: string[], decide: Decider) {
  const activeSiteIds = new Set(SITES.filter(s => sections.includes(s.section)).map(s => s.id));
  const game = {
    ...TyrantsGame,
    setup: (a: Parameters<NonNullable<typeof TyrantsGame.setup>>[0]) =>
      TyrantsGame.setup!(a, { halfDecks: ['drow', 'dragons'], activeSections: sections as Array<'left'|'center'|'right'> }),
  };
  const reducer = CreateGameReducer({ game }) as unknown as Reducer;
  let state = InitializeGame({ game, numPlayers }) as unknown as BgState;

  const okSpaces = activeSpaceIds(activeSiteIds);
  const checkLeaks = (where: string) => {
    const G = state.G;
    for (const spaceId of Object.keys(G.troops)) {
      if (!okSpaces.has(spaceId)) { fail(`${label}: troop space ${spaceId} is out of play (after ${where})`); return false; }
    }
    for (const siteId of Object.keys(G.spies)) {
      if ((G.spies[siteId] ?? []).length > 0 && !activeSiteIds.has(siteId)) { fail(`${label}: spies at out-of-play site ${siteId} (after ${where})`); return false; }
    }
    for (const siteId of Object.keys(G.siteControl)) {
      if (!activeSiteIds.has(siteId)) { fail(`${label}: siteControl has out-of-play site ${siteId}`); return false; }
    }
    return true;
  };

  if (!checkLeaks('setup')) return;
  let guard = 0;
  while (!state.ctx.gameover && guard++ < 4000) {
    const pid = state.G.pendingChoice?.playerId ?? state.ctx.currentPlayer;
    const mv = decide(state.G, pid);
    const next = mv
      ? reducer(state, action(mv.name, (mv.args as unknown[]) ?? [], pid))
      : reducer(state, action('endTurn', [], pid));
    state = next;
    if (!checkLeaks(mv ? mv.name : 'endTurn')) return;
  }
  console.log(`PASS  ${label}: ${guard} moves, no out-of-play leak (game ${state.ctx.gameover ? 'ended' : 'capped'})`);
}

runLayout('2P center-only (heuristic)', 2, ['center'], decideHeuristicMove);
runLayout('3P center+left (heuristic)', 3, ['center', 'left'], decideHeuristicMove);
// Random AI picks uniformly from the offered options, so it exposes any ungated
// target list a strategy-driven AI would simply never pick.
runLayout('2P center-only (random)', 2, ['center'], decideAiMove);
runLayout('3P center+left (random)', 3, ['center', 'left'], decideAiMove);
runLayout('2P center-only (random, x2)', 2, ['center'], decideAiMove);

console.log(ok ? '\nALL ACTIVE-SECTIONS TESTS PASSED' : '\nACTIVE-SECTIONS TESTS FAILED');
process.exit(ok ? 0 : 1);

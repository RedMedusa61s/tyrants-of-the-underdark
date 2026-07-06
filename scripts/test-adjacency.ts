// Regression test for troop-space adjacency (Gibbering Mouther's "adjacent to
// the deployed troop"). The rulebook (rules p.10, p.22; core-model "Presence")
// defines adjacency at the SPACE level: consecutive route-spaces are adjacent,
// a route's endmost space touches the site at that end, interior route-spaces
// touch no site, and same-site spaces are adjacent. The earlier implementation
// treated a whole route (and both its endpoint sites) as adjacent to any space
// on it — too broad. These cases assert the corrected boundaries; the EXCLUDES
// are exactly what the old logic got wrong. (Bug found by Drew W.)

import { spacesAdjacentTo } from '../src/engine/handler-helpers';
import { ROUTES } from '../src/data/routes';

let ok = true;
const check = (label: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) ok = false;
};

// menz-mantol: menzoberranzan (a) — mantol-derith (b), 3 spaces [0,1,2].
const R = 'menz-mantol';
const route = ROUTES.find(r => r.id === R)!;
if (!route || route.spaces !== 3) throw new Error(`test fixture assumes ${R} has 3 spaces; data changed`);

// A middle route-space is adjacent ONLY to its two neighbours — no site.
{
  const adj = new Set(spacesAdjacentTo(`${R}:1`));
  check('middle route-space → includes both neighbour spaces',
    adj.has(`${R}:0`) && adj.has(`${R}:2`));
  check('middle route-space → excludes BOTH endpoint sites (old bug)',
    ![...adj].some(id => id.startsWith('menzoberranzan:') || id.startsWith('mantol-derith:')));
}

// An endmost route-space touches its own end site, not the far one.
{
  const adj = new Set(spacesAdjacentTo(`${R}:0`)); // touches menzoberranzan (a)
  check('end route-space → includes its neighbour space', adj.has(`${R}:1`));
  check('end route-space → includes its OWN endpoint site',
    [...adj].some(id => id.startsWith('menzoberranzan:')));
  check('end route-space → excludes the FAR endpoint site (old bug)',
    ![...adj].some(id => id.startsWith('mantol-derith:')));
  check('end route-space idx 0 → excludes a nonexistent idx -1', !adj.has(`${R}:-1`));
}

// A site is adjacent only to the ENDMOST space of each connecting route.
{
  const adj = new Set(spacesAdjacentTo('menzoberranzan:0'));
  check('site → includes the endmost space of a connecting route',
    adj.has(`${R}:0`));
  check('site → excludes interior/far spaces of that route (old bug)',
    !adj.has(`${R}:1`) && !adj.has(`${R}:2`));
}

console.log(ok ? '\nALL ADJACENCY TESTS PASSED' : '\nADJACENCY TESTS FAILED');
process.exit(ok ? 0 : 1);

// Verifies that for every route with N≥2 slots, slot 0 is positioned visually
// closer to the route's `a` endpoint than its `b` endpoint, and the last slot
// (sp.length-1) is closer to `b`. A mismatch means the calibrated slot positions
// are in the wrong order for the engine's a→b convention — the rules engine
// will give presence to the wrong end. Outputs a JSON patch suitable to apply
// to assets/slot-positions-auto.json (reverses the slot indices in-place).

import { readFileSync, writeFileSync } from 'node:fs';
import { ROUTES } from '../src/data/routes';
import { SITES_BY_ID } from '../src/data/sites';

interface Pos { x: number; y: number }
const slots: Record<string, Pos> = JSON.parse(readFileSync('assets/slot-positions-auto.json', 'utf8'));

function dist(p: Pos, q: Pos): number {
  const dx = p.x - q.x, dy = p.y - q.y;
  return Math.sqrt(dx * dx + dy * dy);
}

const wrong: Array<{ id: string; a: string; b: string; n: number; reason: string }> = [];
let scanned = 0, skippedNoCoord = 0;

for (const r of ROUTES) {
  if (r.spaces < 2) continue;
  scanned++;
  const a = SITES_BY_ID[r.a];
  const b = SITES_BY_ID[r.b];
  if (!a || !b) { skippedNoCoord++; continue; }
  const positions: Pos[] = [];
  let missing = false;
  for (let i = 0; i < r.spaces; i++) {
    const p = slots[`${r.id}:${i}`];
    if (!p) { missing = true; break; }
    positions.push(p);
  }
  if (missing) { skippedNoCoord++; continue; }

  // For each slot i, compute its progression along a→b as
  // distance-to-a / (distance-to-a + distance-to-b). Should increase monotonically.
  const progression = positions.map(p => {
    const da = dist(p, a), db = dist(p, b);
    return da / (da + db);
  });
  // Detect any inversion in the progression.
  const inversions: string[] = [];
  for (let i = 1; i < progression.length; i++) {
    if (progression[i] < progression[i - 1]) {
      inversions.push(`slot ${i - 1} (a-frac ${progression[i - 1].toFixed(2)}) ≥ slot ${i} (a-frac ${progression[i].toFixed(2)})`);
    }
  }
  if (inversions.length > 0) {
    wrong.push({ id: r.id, a: r.a, b: r.b, n: r.spaces, reason: inversions.join('; ') });
  }
}

console.log(`Scanned ${scanned} routes with ≥ 2 slots (skipped ${skippedNoCoord} for missing data).`);
if (wrong.length === 0) {
  console.log('All route slot orderings: OK.');
  process.exit(0);
}
console.log(`Found ${wrong.length} reversed routes:`);
for (const r of wrong) {
  console.log(`  ✗ ${r.id}  (a=${r.a}, b=${r.b}, ${r.n} slots) — ${r.reason}`);
}

// Apply the fix: re-sort slot indices by their a→b progression. Handles full
// reversals AND partial misorderings (e.g. user clicked the middle slot first).
if (process.argv.includes('--write')) {
  for (const r of wrong) {
    const route = ROUTES.find(rr => rr.id === r.id)!;
    const a = SITES_BY_ID[route.a]!;
    const b = SITES_BY_ID[route.b]!;
    const buf: Pos[] = [];
    for (let i = 0; i < r.n; i++) buf.push(slots[`${r.id}:${i}`]);
    buf.sort((p, q) => {
      const pa = dist(p, a) / (dist(p, a) + dist(p, b));
      const qa = dist(q, a) / (dist(q, a) + dist(q, b));
      return pa - qa;
    });
    for (let i = 0; i < r.n; i++) slots[`${r.id}:${i}`] = buf[i];
  }
  writeFileSync('assets/slot-positions-auto.json', JSON.stringify(slots, null, 2));
  console.log(`\nWrote fixed positions to assets/slot-positions-auto.json (${wrong.length} routes resorted).`);
} else {
  console.log('\n(re-run with --write to apply the fix)');
}

// Route adjacency between sites.
// Each route connects two sites and contains one or more troop spaces in sequence.
// Calibrated against the printed board via the in-app routes editor.

export interface Route {
  id: string;
  a: string; // site id
  b: string; // site id
  spaces: number;
  /** Slot indices that start with a white troop printed on the board. Routes
   *  can have whites at arbitrary indices (not always the first N), so this is
   *  an explicit list rather than a count. */
  whiteSlots?: number[];
}

export const ROUTES: Route[] = [
  { id: 'menz-mantol', a: 'menzoberranzan', b: 'mantol-derith', spaces: 3 },
  { id: 'araumycos-laby', a: 'araumycos', b: 'labyrinth', spaces: 2 },
  { id: 'mantol-blingden', a: 'mantol-derith', b: 'blingdenstone', spaces: 1 },
  { id: 'araumycos-chasm', a: 'araumycos', b: 'chasmleap', spaces: 1 },
  { id: 'jhachalk-buiyran', a: 'jhachalkhyn', b: 'buiyrandyn', spaces: 1 },
  { id: 'jhachalk-grackl', a: 'jhachalkhyn', b: 'gracklstugh', spaces: 1 },
  { id: 'chasm-grackl', a: 'chasmleap', b: 'gracklstugh', spaces: 2 },
  { id: 'eryndlyn-kanaglym', a: 'eryndlyn', b: 'kanaglym', spaces: 2 },
  { id: 'llac-tsen', a: 'llacerellyn', b: 'tsenviilyq', spaces: 1 },
  { id: 'kanaglym-tsen', a: 'kanaglym', b: 'tsenviilyq', spaces: 2 },
  { id: 'gauntlgrym-wormwrithings', a: 'gauntlgrym', b: 'wormwrithings', spaces: 0 },
  { id: 'chchitl-stoneshaft', a: 'chchitl', b: 'stoneshaft', spaces: 1 },
  { id: 'stoneshaft-buiyrandyn', a: 'stoneshaft', b: 'buiyrandyn', spaces: 1 },
  { id: 'stoneshaft-skullport', a: 'stoneshaft', b: 'skullport', spaces: 2 },
  { id: 'chchitl-kanaglym', a: 'chchitl', b: 'kanaglym', spaces: 1 },
  { id: 'kanaglym-skullport', a: 'kanaglym', b: 'skullport', spaces: 1 },
  { id: 'llacerellyn-sszuraassnee', a: 'llacerellyn', b: 'sszuraassnee', spaces: 2 },
  { id: 'sszuraassnee-dekanter', a: 'sszuraassnee', b: 'dekanter', spaces: 1 },
  { id: 'dekanter-phaerlin', a: 'dekanter', b: 'phaerlin', spaces: 2 },
  { id: 'llacerellyn-ched-nasad', a: 'llacerellyn', b: 'ched-nasad', spaces: 2 },
  { id: 'ched-nasad-dekanter', a: 'ched-nasad', b: 'dekanter', spaces: 1 },
  { id: 'ched-nasad-yathchol', a: 'ched-nasad', b: 'yathchol', spaces: 1 },
  { id: 'yathchol-phaerlin', a: 'yathchol', b: 'phaerlin', spaces: 1 },
  { id: 'yathchol-halls-legion', a: 'yathchol', b: 'halls-legion', spaces: 1 },
  { id: 'halls-legion-everfire', a: 'halls-legion', b: 'everfire', spaces: 1 },
  { id: 'chaulssin-phaerlin', a: 'chaulssin', b: 'phaerlin', spaces: 1 },
  { id: 'chaulssin-everfire', a: 'chaulssin', b: 'everfire', spaces: 1 },
  { id: 'everfire-menzoberranzan', a: 'everfire', b: 'menzoberranzan', spaces: 2 },
  { id: 'menzoberranzan-chasmleap', a: 'menzoberranzan', b: 'chasmleap', spaces: 2 },
  { id: 'mantol-derith-gracklstugh', a: 'mantol-derith', b: 'gracklstugh', spaces: 1 },
  { id: 'mantol-derith-wormwrithings', a: 'mantol-derith', b: 'wormwrithings', spaces: 1 },
  { id: 'ched-nasad-halls-legion', a: 'ched-nasad', b: 'halls-legion', spaces: 2 },
  { id: 'llacerellyn-eryndlyn', a: 'llacerellyn', b: 'eryndlyn', spaces: 1 },
  { id: 'ched-nasad-araumycos', a: 'ched-nasad', b: 'araumycos', spaces: 1 },
  { id: 'araumycos-eryndlyn', a: 'araumycos', b: 'eryndlyn', spaces: 1 },
  { id: 'gauntlgrym-jhachalkhyn', a: 'gauntlgrym', b: 'jhachalkhyn', spaces: 1 },
  { id: 'buiyrandyn-labyrinth', a: 'buiyrandyn', b: 'labyrinth', spaces: 1 },
  { id: 'labyrinth-gracklstugh', a: 'labyrinth', b: 'gracklstugh', spaces: 1 },
  { id: 'skullport-labyrinth', a: 'skullport', b: 'labyrinth', spaces: 2 },
  { id: 'chasmleap-everfire', a: 'chasmleap', b: 'everfire', spaces: 1 },
];

// Browser-only: merge user-edited `whiteSlots` from localStorage (set via the
// RouteVerify tab). Runs before TROOP_SPACES is computed, so the initial setup
// places whites on the configured slots. Once we've collected a full table the
// values should be baked back into the ROUTES array above.
if (typeof localStorage !== 'undefined') {
  try {
    const raw = localStorage.getItem('totu.route-overrides');
    if (raw) {
      const overrides = JSON.parse(raw) as Record<string, { whiteSlots?: number[] }>;
      for (const r of ROUTES) {
        const o = overrides[r.id];
        if (o?.whiteSlots && Array.isArray(o.whiteSlots)) r.whiteSlots = o.whiteSlots;
      }
    }
  } catch { /* corrupt overrides — ignore */ }
}

// Adjacency map for quick lookups: siteId -> list of (otherSiteId, route)
export const ADJACENCY: Record<string, { other: string; route: Route }[]> = (() => {
  const m: Record<string, { other: string; route: Route }[]> = {};
  for (const r of ROUTES) {
    (m[r.a] ??= []).push({ other: r.b, route: r });
    (m[r.b] ??= []).push({ other: r.a, route: r });
  }
  return m;
})();

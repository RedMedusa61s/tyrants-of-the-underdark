// Derive deterministic troop-space IDs from site + route data.
//
// Site spaces: `<siteId>:<index>` for index in [0, troopSlots)
// Route spaces: `<routeId>:<index>` for index in [0, spaces) along the route from a → b.

import { SITES, type Site } from './sites';
import { ROUTES, type Route } from './routes';

export type TroopSpaceId = string;

export interface TroopSpace {
  id: TroopSpaceId;
  /** Either a siteId (site space) or a routeId (route space). */
  parentSite?: string;
  parentRoute?: string;
  index: number;
  /** True if a starting-setup white (unaligned) troop occupies this space at the start. */
  startsWithWhite: boolean;
}

const SITE_SPACES: TroopSpace[] = SITES.flatMap((s: Site) =>
  Array.from({ length: s.troopSlots }, (_, i) => ({
    id: `${s.id}:${i}`,
    parentSite: s.id,
    index: i,
    // Per rulebook p.4 step 6, sites have printed white troops. The
    // explicit `whiteSlots: number[]` list (from sites.ts seeds + the
    // whites-tab localStorage overrides) wins when present; otherwise
    // fall back to the "first N slots" shorthand `whitesAtStart`.
    startsWithWhite: s.whiteSlots
      ? s.whiteSlots.includes(i)
      : i < s.whitesAtStart,
  }))
);

const ROUTE_SPACES: TroopSpace[] = ROUTES.flatMap((r: Route) =>
  Array.from({ length: r.spaces }, (_, i) => ({
    id: `${r.id}:${i}`,
    parentRoute: r.id,
    index: i,
    // Per rulebook p.4 step 6, whites are printed on specific slot indices of
    // certain routes. The per-route `whiteSlots` list (in routes.ts +
    // localStorage overrides via the RouteVerify tab) names those indices.
    startsWithWhite: (r.whiteSlots ?? []).includes(i),
  }))
);

export const TROOP_SPACES: TroopSpace[] = [...SITE_SPACES, ...ROUTE_SPACES];
export const TROOP_SPACES_BY_ID: Record<TroopSpaceId, TroopSpace> =
  Object.fromEntries(TROOP_SPACES.map(t => [t.id, t]));

export function sitesSpaces(siteId: string): TroopSpace[] {
  return SITE_SPACES.filter(t => t.parentSite === siteId);
}

export function routeSpaces(routeId: string): TroopSpace[] {
  return ROUTE_SPACES.filter(t => t.parentRoute === routeId);
}

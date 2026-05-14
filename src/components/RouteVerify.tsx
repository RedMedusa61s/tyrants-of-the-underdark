// Route-data verification: lists each route and lets you click each slot to
// toggle whether it starts with a printed white troop. Saved to localStorage
// (`totu.route-overrides`) — the data layer reads this at load time so the
// changes take effect on the next New Game without needing me to bake values
// into routes.ts. The "Copy overrides" button still emits the JSON patch for
// permanent baking.

import { useEffect, useMemo, useState } from 'react';
import { ROUTES } from '../data/routes';
import { SITES, SITES_BY_ID } from '../data/sites';
import { sitesSpaces } from '../data/troop-spaces';
import COMMITTED_SLOT_POSITIONS from '../../assets/slot-positions-auto.json';
import { useCachedImage } from '../image-cache';

const SITE_WHITES_KEY = 'totu.site-whites-overrides';
type SiteOverride = { whiteSlots?: number[] };
type SiteOverrides = Record<string, SiteOverride>;
function loadSiteWhites(): SiteOverrides {
  try { return JSON.parse(localStorage.getItem(SITE_WHITES_KEY) || '{}'); } catch { return {}; }
}

const SLOTS_STORAGE_KEY = 'totu.slot-positions';
type SlotPositions = Record<string, { x: number; y: number }>;
function loadSlotPositions(): SlotPositions {
  let local: SlotPositions = {};
  try { local = JSON.parse(localStorage.getItem(SLOTS_STORAGE_KEY) || '{}'); } catch {}
  return { ...(COMMITTED_SLOT_POSITIONS as SlotPositions), ...local };
}

const STORAGE_KEY = 'totu.route-overrides';
type RouteOverride = { whiteSlots?: number[] };
type AllOverrides = Record<string, RouteOverride>;

function load(): AllOverrides {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

export function RouteVerify() {
  const [overrides, setOverrides] = useState<AllOverrides>(load);
  const [siteOverrides, setSiteOverrides] = useState<SiteOverrides>(loadSiteWhites);
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides)); }, [overrides]);
  useEffect(() => { localStorage.setItem(SITE_WHITES_KEY, JSON.stringify(siteOverrides)); }, [siteOverrides]);

  /** Default whites for a site as a number[] (derives from either explicit
   *  whiteSlots or the `first N slots` shorthand `whitesAtStart`). */
  function defaultSiteWhites(siteId: string): number[] {
    const s = SITES_BY_ID[siteId];
    if (!s) return [];
    if (s.whiteSlots) return s.whiteSlots;
    return Array.from({ length: s.whitesAtStart }, (_, i) => i);
  }

  function toggleSiteSlot(siteId: string, slotIdx: number) {
    const sheet = defaultSiteWhites(siteId);
    setSiteOverrides(prev => {
      const next = { ...prev };
      const cur = { ...(next[siteId] ?? {}) } as SiteOverride;
      const current = cur.whiteSlots ?? sheet;
      const set = new Set(current);
      if (set.has(slotIdx)) set.delete(slotIdx);
      else set.add(slotIdx);
      const arr = [...set].sort((a, b) => a - b);
      if (arr.length === sheet.length && arr.every((v, i) => v === sheet[i])) {
        delete cur.whiteSlots;
      } else {
        cur.whiteSlots = arr;
      }
      if (Object.keys(cur).length === 0) delete next[siteId];
      else next[siteId] = cur;
      return next;
    });
  }

  const routes = useMemo(() => [...ROUTES].sort((a, b) => {
    const an = `${SITES_BY_ID[a.a]?.name} ↔ ${SITES_BY_ID[a.b]?.name}`;
    const bn = `${SITES_BY_ID[b.a]?.name} ↔ ${SITES_BY_ID[b.b]?.name}`;
    return an.localeCompare(bn);
  }), []);

  function effectiveWhites(routeId: string, sheetSlots: number[]): number[] {
    const o = overrides[routeId];
    return o?.whiteSlots ?? sheetSlots;
  }

  function toggleSlot(routeId: string, slotIdx: number, sheetSlots: number[]) {
    setOverrides(prev => {
      const next = { ...prev };
      const cur = { ...(next[routeId] ?? {}) } as RouteOverride;
      const current = cur.whiteSlots ?? sheetSlots;
      const set = new Set(current);
      if (set.has(slotIdx)) set.delete(slotIdx);
      else set.add(slotIdx);
      const arr = [...set].sort((a, b) => a - b);
      // If the array now matches the baked sheet, drop the override.
      if (arr.length === sheetSlots.length && arr.every((v, i) => v === sheetSlots[i])) {
        delete cur.whiteSlots;
      } else {
        cur.whiteSlots = arr;
      }
      if (Object.keys(cur).length === 0) delete next[routeId];
      else next[routeId] = cur;
      return next;
    });
  }

  function copyJson() {
    const payload = { routes: overrides, sites: siteOverrides };
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    alert(`Copied: ${Object.keys(overrides).length} routes + ${Object.keys(siteOverrides).length} sites.`);
  }

  const totalWhites = routes.reduce((sum, r) => sum + effectiveWhites(r.id, r.whiteSlots ?? []).length, 0);

  return (
    <div style={{ padding: 8 }}>
      <div style={{ marginBottom: 12, fontSize: 12, opacity: 0.85 }}>
        Click each slot to toggle whether it starts with a printed white troop.
        Filled white = starts with a white token; empty = starts empty. Changes
        save to localStorage immediately AND apply on the next New Game (no need
        to copy/paste back to the dev unless you want to bake them in
        permanently). {Object.keys(overrides).length} routes edited · {totalWhites} total whites.
      </div>
      <div style={{ marginBottom: 12 }}>
        <button onClick={copyJson} style={{ padding: '4px 12px', marginRight: 8 }}>Copy overrides</button>
        <button onClick={() => { if (confirm('Clear all whites overrides (routes + sites)?')) { setOverrides({}); setSiteOverrides({}); } }}
          style={{ padding: '4px 12px', background: '#5a1f1f', color: '#fdd', border: '1px solid #802626' }}>
          Reset
        </button>
      </div>

      <RouteWhitesMap
        overrides={overrides}
        siteOverrides={siteOverrides}
        defaultSiteWhites={defaultSiteWhites}
        onToggleRoute={(routeId, slotIdx) => {
          const r = ROUTES.find(rr => rr.id === routeId);
          if (!r) return;
          toggleSlot(routeId, slotIdx, r.whiteSlots ?? []);
        }}
        onToggleSite={toggleSiteSlot}
      />

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #3a2055', textAlign: 'left' }}>
            <th style={{ padding: 4 }}>Route</th>
            <th>Slots <span style={{ opacity: 0.5, fontWeight: 'normal' }}>(click to toggle white)</span></th>
          </tr>
        </thead>
        <tbody>
          {routes.map(r => {
            const sheetSlots = r.whiteSlots ?? [];
            const current = effectiveWhites(r.id, sheetSlots);
            const o = overrides[r.id];
            const edited = o?.whiteSlots !== undefined;
            const aName = SITES_BY_ID[r.a]?.name ?? r.a;
            const bName = SITES_BY_ID[r.b]?.name ?? r.b;
            return (
              <tr key={r.id} style={{ borderBottom: '1px solid #1a1228' }}>
                <td style={{ padding: 4 }}>
                  <div>
                    <span style={{ opacity: 0.7, fontSize: 11 }}>{aName}</span>
                    <span style={{ opacity: 0.4, margin: '0 4px' }}>(a)</span>
                    <span style={{ opacity: 0.4 }}>↔</span>
                    <span style={{ opacity: 0.4, margin: '0 4px' }}>(b)</span>
                    <span style={{ opacity: 0.7, fontSize: 11 }}>{bName}</span>
                  </div>
                  <div style={{ fontSize: 10, opacity: 0.5, fontFamily: 'monospace' }}>{r.id}</div>
                </td>
                <td style={{ padding: 4 }}>
                  {r.spaces === 0 && <span style={{ fontSize: 11, opacity: 0.5 }}>(direct adjacency — no slots)</span>}
                  <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    {Array.from({ length: r.spaces }, (_, i) => {
                      const isWhite = current.includes(i);
                      return (
                        <button key={i} onClick={() => toggleSlot(r.id, i, sheetSlots)}
                          title={`slot ${i} — ${i === 0 ? `adjacent to ${aName}` : i === r.spaces - 1 ? `adjacent to ${bName}` : 'mid-route'}`}
                          style={{
                            width: 24, height: 24, borderRadius: '50%', cursor: 'pointer',
                            background: isWhite ? '#d0d0d0' : 'transparent',
                            border: isWhite ? '2px solid #fff' : '1px dashed rgba(255,255,255,0.4)',
                            color: '#000', fontSize: 10, fontWeight: 'bold',
                          }}>
                          {i}
                        </button>
                      );
                    })}
                    {edited && <span style={{ marginLeft: 8, fontSize: 10, color: '#ffcc44' }}>edited</span>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 16, fontSize: 11, opacity: 0.6 }}>
        Reload the page or start a new game for changes to take effect (whites
        are placed only at game setup).
      </div>
    </div>
  );
}

/** Renders the cached board image with every route slot overlaid as a clickable
 *  circle. Slots that start with a white troop render filled white; others are
 *  empty rings. Clicking toggles the slot's white-start status — wired through
 *  to the same `totu.route-overrides` localStorage backing the table view. */
function RouteWhitesMap({
  overrides,
  siteOverrides,
  defaultSiteWhites,
  onToggleRoute,
  onToggleSite,
}: {
  overrides: AllOverrides;
  siteOverrides: SiteOverrides;
  defaultSiteWhites: (siteId: string) => number[];
  onToggleRoute: (routeId: string, slotIdx: number) => void;
  onToggleSite: (siteId: string, slotIdx: number) => void;
}) {
  const boardUrl = useCachedImage('assets/board/map.jpg');
  const [slotPositions] = useState<SlotPositions>(loadSlotPositions);

  // All clickable slots — both route spaces and site spaces.
  type SlotEntry =
    | { kind: 'route'; routeId: string; slot: number; x: number; y: number; isWhite: boolean }
    | { kind: 'site';  siteId: string;  slot: number; x: number; y: number; isWhite: boolean };

  const slots = useMemo(() => {
    const out: SlotEntry[] = [];
    // Route slots
    for (const r of ROUTES) {
      if (r.spaces < 1) continue;
      const o = overrides[r.id];
      const current = o?.whiteSlots ?? r.whiteSlots ?? [];
      for (let i = 0; i < r.spaces; i++) {
        const pos = slotPositions[`${r.id}:${i}`];
        if (!pos) continue;
        out.push({ kind: 'route', routeId: r.id, slot: i, x: pos.x, y: pos.y, isWhite: current.includes(i) });
      }
    }
    // Site slots
    for (const s of SITES) {
      const spaces = sitesSpaces(s.id);
      const oWhites = siteOverrides[s.id]?.whiteSlots ?? defaultSiteWhites(s.id);
      for (const sp of spaces) {
        const pos = slotPositions[sp.id];
        if (!pos) continue;
        out.push({ kind: 'site', siteId: s.id, slot: sp.index, x: pos.x, y: pos.y, isWhite: oWhites.includes(sp.index) });
      }
    }
    return out;
  }, [overrides, siteOverrides, defaultSiteWhites, slotPositions]);

  const totalRouteSlots = ROUTES.reduce((sum, r) => sum + r.spaces, 0);
  const totalSiteSlots = SITES.reduce((sum, s) => sum + s.troopSlots, 0);
  const totalSlots = totalRouteSlots + totalSiteSlots;
  const totalCalibrated = slots.length;

  return (
    <div style={{
      marginBottom: 16, padding: 12,
      background: '#1a1228', border: '2px solid #5a3380', borderRadius: 6,
    }}>
      <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 6, color: '#ffcc44' }}>
        Click every slot on the printed board that should start with a white troop
      </div>
      <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 8 }}>
        Both site slots and route (edge) slots are clickable. Yellow ring =
        empty at game start; filled-white circle = printed white troop.
        Click any ring to toggle. {totalCalibrated} of {totalSlots} slots
        are calibrated and clickable below.
        {totalCalibrated < totalSlots && (
          <span style={{ color: '#ff8888' }}>
            {' '}({totalSlots - totalCalibrated} slots aren't calibrated yet — they're not on the map. Use the slots tab to calibrate them, or the table below this map.)
          </span>
        )}
      </div>
      <div style={{
        position: 'relative', display: 'block', width: '100%',
        background: '#0c0814', borderRadius: 4, overflow: 'hidden',
        userSelect: 'none',
      }}>
        {boardUrl
          ? <img src={boardUrl} alt="board" style={{ width: '100%', display: 'block' }} draggable={false} />
          : <div style={{ width: '100%', aspectRatio: '4646 / 4605', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>loading board image…</div>}
        {slots.map(s => (
          <div key={s.kind === 'route' ? `r:${s.routeId}:${s.slot}` : `s:${s.siteId}:${s.slot}`}
            onClick={() => {
              if (s.kind === 'route') onToggleRoute(s.routeId, s.slot);
              else onToggleSite(s.siteId, s.slot);
            }}
            title={`${s.kind === 'route' ? s.routeId : s.siteId} slot ${s.slot} — ${s.isWhite ? 'WHITE start' : 'empty'} (click to toggle)`}
            style={{
              position: 'absolute',
              left: `${s.x * 100}%`,
              top: `${s.y * 100}%`,
              width: 28, height: 28,
              marginLeft: -14, marginTop: -14,
              borderRadius: '50%',
              background: s.isWhite ? '#f0f0f0' : 'rgba(0,0,0,0.4)',
              border: s.isWhite
                ? '3px solid #fff'
                : '3px solid #ffcc44',
              boxShadow: s.isWhite
                ? '0 2px 6px rgba(0,0,0,0.8), inset 0 0 0 1px #888'
                : '0 0 8px rgba(255, 204, 68, 0.8)',
              cursor: 'pointer',
              zIndex: 5,
            }} />
        ))}
      </div>
    </div>
  );
}

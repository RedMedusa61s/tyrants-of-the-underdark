// Route-data verification: lists each route and lets you click each slot to
// toggle whether it starts with a printed white troop. Saved to localStorage
// (`totu.route-overrides`) — the data layer reads this at load time so the
// changes take effect on the next New Game without needing me to bake values
// into routes.ts. The "Copy overrides" button still emits the JSON patch for
// permanent baking.

import { useEffect, useMemo, useState } from 'react';
import { ROUTES } from '../data/routes';
import { SITES_BY_ID } from '../data/sites';

const STORAGE_KEY = 'totu.route-overrides';
type RouteOverride = { whiteSlots?: number[] };
type AllOverrides = Record<string, RouteOverride>;

function load(): AllOverrides {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

export function RouteVerify() {
  const [overrides, setOverrides] = useState<AllOverrides>(load);
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides)); }, [overrides]);

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
    navigator.clipboard.writeText(JSON.stringify(overrides, null, 2));
    alert(`Copied overrides for ${Object.keys(overrides).length} routes.`);
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
        <button onClick={() => { if (confirm('Clear all route-whites overrides?')) setOverrides({}); }}
          style={{ padding: '4px 12px', background: '#5a1f1f', color: '#fdd', border: '1px solid #802626' }}>
          Reset
        </button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
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

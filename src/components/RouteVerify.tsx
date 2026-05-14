// Route-data verification: lists each route and lets you click each slot to
// toggle whether it starts with a printed white troop. Saved to localStorage
// (`totu.route-overrides`) — the data layer reads this at load time so the
// changes take effect on the next New Game without needing me to bake values
// into routes.ts. The "Copy overrides" button still emits the JSON patch for
// permanent baking.

import { useEffect, useMemo, useState } from 'react';
import { ROUTES } from '../data/routes';
import { SITES_BY_ID } from '../data/sites';
import COMMITTED_SLOT_POSITIONS from '../../assets/slot-positions-auto.json';
import { useCachedImage } from '../image-cache';

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

      <RouteWhitesMap
        overrides={overrides}
        onToggle={(routeId, slotIdx) => {
          const r = ROUTES.find(rr => rr.id === routeId);
          if (!r) return;
          toggleSlot(routeId, slotIdx, r.whiteSlots ?? []);
        }}
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
  onToggle,
}: {
  overrides: AllOverrides;
  onToggle: (routeId: string, slotIdx: number) => void;
}) {
  const boardUrl = useCachedImage('assets/board/map.jpg');
  const [slotPositions] = useState<SlotPositions>(loadSlotPositions);

  // Build the list of every route slot with its (route, idx, x, y, white?).
  const slots = useMemo(() => {
    const out: Array<{ routeId: string; slot: number; x: number; y: number; isWhite: boolean }> = [];
    for (const r of ROUTES) {
      if (r.spaces < 1) continue;
      const o = overrides[r.id];
      const current = o?.whiteSlots ?? r.whiteSlots ?? [];
      for (let i = 0; i < r.spaces; i++) {
        const pos = slotPositions[`${r.id}:${i}`];
        if (!pos) continue;
        out.push({ routeId: r.id, slot: i, x: pos.x, y: pos.y, isWhite: current.includes(i) });
      }
    }
    return out;
  }, [overrides, slotPositions]);

  const totalSlots = ROUTES.reduce((s, r) => s + r.spaces, 0);
  const totalCalibrated = slots.length;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>
        Click each route slot to toggle whether it starts with a printed white
        troop. {totalCalibrated} of {totalSlots} slots have calibrated positions.
        Filled white = starts with a token; empty ring = starts empty.
      </div>
      <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', userSelect: 'none' }}>
        <img src={boardUrl} alt="board" style={{ width: '100%', display: 'block' }} draggable={false} />
        {slots.map(s => (
          <div key={`${s.routeId}:${s.slot}`}
            onClick={() => onToggle(s.routeId, s.slot)}
            title={`${s.routeId} slot ${s.slot} — ${s.isWhite ? 'WHITE start' : 'empty'} (click to toggle)`}
            style={{
              position: 'absolute',
              left: `${s.x * 100}%`,
              top: `${s.y * 100}%`,
              width: 22, height: 22,
              marginLeft: -11, marginTop: -11,
              borderRadius: '50%',
              background: s.isWhite ? '#d0d0d0' : 'transparent',
              border: s.isWhite
                ? '2px solid #fff'
                : '2px solid rgba(255, 204, 68, 0.85)',
              boxShadow: s.isWhite
                ? '0 1px 3px rgba(0,0,0,0.6)'
                : '0 0 6px rgba(255, 204, 68, 0.5)',
              cursor: 'pointer',
              zIndex: 5,
            }} />
        ))}
      </div>
    </div>
  );
}

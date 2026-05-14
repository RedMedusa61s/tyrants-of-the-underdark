// One-time calibration: click each site's troop slots on the board to capture their
// exact positions. The game uses these positions to render player tokens directly on
// the printed slots rather than in an overlay box.

import { useEffect, useMemo, useState } from 'react';
import { SITES, SITES_BY_ID } from '../data/sites';
import { ROUTES } from '../data/routes';
import { sitesSpaces, routeSpaces } from '../data/troop-spaces';
import { useCachedImage } from '../image-cache';

const STORAGE_KEY = 'totu.slot-positions';
type SlotPositions = Record<string, { x: number; y: number }>;

function load(): SlotPositions {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function save(p: SlotPositions) { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); }

export function SlotCalibration() {
  const boardUrl = useCachedImage('assets/board/map.jpg');
  const [positions, setPositions] = useState<SlotPositions>(load);
  const [selectedSite, setSelectedSite] = useState<string | null>(null);

  useEffect(() => { save(positions); }, [positions]);

  // Calibration items: every site, plus every route with spaces > 0.
  type Item = { id: string; label: string; kind: 'site' | 'route'; spaceIds: string[] };
  const items: Item[] = useMemo(() => {
    const siteItems: Item[] = SITES.map(s => ({
      id: s.id, label: s.name, kind: 'site',
      spaceIds: sitesSpaces(s.id).map(sp => sp.id),
    }));
    const routeItems: Item[] = ROUTES
      .filter(r => r.spaces > 0)
      .map(r => {
        const a = SITES.find(s => s.id === r.a)?.name ?? r.a;
        const b = SITES.find(s => s.id === r.b)?.name ?? r.b;
        return { id: r.id, label: `${a} ↔ ${b}`, kind: 'route',
          spaceIds: routeSpaces(r.id).map(sp => sp.id) };
      });
    return [...siteItems.sort((a, b) => a.label.localeCompare(b.label)),
            ...routeItems.sort((a, b) => a.label.localeCompare(b.label))];
  }, []);

  function itemProgress(item: Item) {
    const done = item.spaceIds.filter(id => positions[id]).length;
    return { done, total: item.spaceIds.length };
  }

  function nextUncalibratedSlot(itemId: string): string | null {
    const item = items.find(i => i.id === itemId);
    if (!item) return null;
    for (const id of item.spaceIds) if (!positions[id]) return id;
    return null;
  }

  function handleBoardClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!selectedSite) return;
    const next = nextUncalibratedSlot(selectedSite);
    if (!next) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setPositions(prev => ({ ...prev, [next]: { x, y } }));
  }

  function clearItem(itemId: string) {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    if (!confirm(`Clear calibration for ${item.label}?`)) return;
    setPositions(prev => {
      const next = { ...prev };
      for (const id of item.spaceIds) delete next[id];
      return next;
    });
  }

  function undoLast() {
    if (!selectedSite) return;
    const item = items.find(i => i.id === selectedSite);
    if (!item) return;
    for (let i = item.spaceIds.length - 1; i >= 0; i--) {
      if (positions[item.spaceIds[i]]) {
        setPositions(prev => {
          const next = { ...prev };
          delete next[item.spaceIds[i]];
          return next;
        });
        return;
      }
    }
  }

  function copyJson() {
    navigator.clipboard.writeText(JSON.stringify(positions, null, 2));
    alert(`Copied ${Object.keys(positions).length} slot positions to clipboard.`);
  }

  const totalSlots = items.reduce((s, x) => s + x.spaceIds.length, 0);
  const doneSlots = Object.keys(positions).filter(id => id.includes(':')).length;

  return (
    <div style={{ padding: 8 }}>
      <div style={{ marginBottom: 12, fontSize: 12, opacity: 0.85 }}>
        Pick a site from the list. Then click each slot on the board image in order. The next
        uncalibrated slot for the selected site gets the click. Drag-correct by clearing and
        re-clicking. Progress: <b>{doneSlots}/{totalSlots}</b> slots.
      </div>
      <div style={{ marginBottom: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button onClick={copyJson} style={{ padding: '4px 12px' }}>Copy JSON</button>
        <button onClick={undoLast} disabled={!selectedSite}
          style={{ padding: '4px 12px' }}>Undo last for {selectedSite ?? '(no site)'}</button>
        <button onClick={() => { if (confirm('Clear ALL slot calibrations?')) setPositions({}); }}
          style={{ padding: '4px 12px', background: '#5a1f1f', color: '#fdd', border: '1px solid #802626' }}>
          Reset all
        </button>
        <button
          onClick={() => {
            // Detect routes where slot 0 is positioned closer to site `b` than `a`
            // (relative to slot N-1). Re-sort each such route's slot positions
            // along the a→b axis so logical slot 0 sits visually near `a`.
            const dist = (p: { x: number; y: number }, q: { x: number; y: number }) =>
              Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2);
            const fixed: string[] = [];
            const next = { ...positions };
            for (const r of ROUTES) {
              if (r.spaces < 2) continue;
              const a = SITES_BY_ID[r.a];
              const b = SITES_BY_ID[r.b];
              if (!a || !b) continue;
              const ids = Array.from({ length: r.spaces }, (_, i) => `${r.id}:${i}`);
              const pts = ids.map(id => next[id]);
              if (pts.some(p => !p)) continue;
              const prog = (p: { x: number; y: number }) =>
                dist(p, a) / (dist(p, a) + dist(p, b));
              const monotonic = prog(pts[0]) < prog(pts[pts.length - 1]) &&
                pts.every((_, i) => i === 0 || prog(pts[i - 1]) <= prog(pts[i]));
              if (monotonic) continue;
              // Sort positions by progression along a→b.
              const sorted = pts.slice().sort((p, q) => prog(p) - prog(q));
              for (let i = 0; i < r.spaces; i++) next[ids[i]] = sorted[i];
              fixed.push(r.id);
            }
            if (fixed.length === 0) {
              alert('All route slot orderings are already correct (slot 0 nearest to site `a`).');
            } else {
              setPositions(next);
              alert(`Fixed slot ordering on ${fixed.length} route(s):\n${fixed.join('\n')}`);
            }
          }}
          style={{ padding: '4px 12px', background: '#3a2055', color: '#fff' }}>
          Fix route slot ordering
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: '0 0 280px', maxHeight: '70vh', overflowY: 'auto', background: '#1a1228', padding: 8, borderRadius: 4 }}>
          {(['site', 'route'] as const).map(kind => (
            <div key={kind}>
              <div style={{ fontSize: 10, opacity: 0.6, textTransform: 'uppercase', margin: '6px 4px 2px' }}>
                {kind === 'site' ? 'Sites' : 'Routes'}
              </div>
              {items.filter(i => i.kind === kind).map(item => {
                const { done, total } = itemProgress(item);
                const complete = done === total;
                const active = selectedSite === item.id;
                return (
                  <div key={item.id}
                    onClick={() => setSelectedSite(item.id)}
                    style={{
                      padding: '4px 8px', marginBottom: 2, borderRadius: 3, cursor: 'pointer',
                      background: active ? '#3a2055' : complete ? '#1f3a1f' : 'transparent',
                      border: active ? '1px solid #ffcc44' : '1px solid transparent',
                      fontSize: 12, display: 'flex', justifyContent: 'space-between',
                    }}>
                    <span>{item.label}</span>
                    <span style={{ opacity: 0.7, marginLeft: 8 }}>{done}/{total}</span>
                    {complete && <button onClick={(e) => { e.stopPropagation(); clearItem(item.id); }}
                      style={{ marginLeft: 6, padding: '0 6px', fontSize: 10 }}>×</button>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, position: 'relative' }}>
          {selectedSite && (() => {
            const item = items.find(i => i.id === selectedSite);
            if (!item) return null;
            const next = nextUncalibratedSlot(selectedSite);
            const { done, total } = itemProgress(item);
            return (
              <div style={{ marginBottom: 6, fontSize: 13 }}>
                Calibrating <b>{item.label}</b> ({item.kind}).
                {!next ? ' All slots done — pick another.' :
                  ` Click slot ${done + 1} of ${total} on the board.`}
              </div>
            );
          })()}
          <div style={{ position: 'relative' }}>
            <img src={boardUrl} alt="board"
              onClick={handleBoardClick}
              style={{ width: '100%', display: 'block', cursor: selectedSite ? 'crosshair' : 'default' }} />
            {/* Overlay calibrated dots */}
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} viewBox="0 0 1 1" preserveAspectRatio="none">
              {Object.entries(positions).map(([spaceId, pos]) => {
                const isCurrent = selectedSite && spaceId.startsWith(`${selectedSite}:`);
                return <circle key={spaceId} cx={pos.x} cy={pos.y} r={0.012}
                  fill={isCurrent ? 'rgba(255,204,68,0.85)' : 'rgba(120,220,120,0.6)'}
                  stroke="#fff" strokeWidth={0.001} />;
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

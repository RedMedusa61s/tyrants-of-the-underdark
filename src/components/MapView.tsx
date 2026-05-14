import { useEffect, useState } from 'react';
import { SITES, type Site } from '../data/sites';
import { ROUTES, type Route } from '../data/routes';
import { sitesSpaces } from '../data/troop-spaces';
import type { TyrantsState, Color } from '../game';
import COMMITTED_SLOT_POSITIONS from '../../assets/slot-positions-auto.json';
import { useCachedImage } from '../image-cache';

const COLOR_HEX: Record<Color, string> = {
  // Lifted toward grey so tokens contrast against near-black site boxes.
  black: '#4a4a4a',
  red: '#c2362e',
  orange: '#d97a1d',
  blue: '#2b53b0',
};
// White tokens darkened toward light grey so they stand out on white-bordered site boxes.
const WHITE_TOKEN = '#d0d0d0';

const STORAGE_KEY = 'totu.site-positions';
const SLOTS_STORAGE_KEY = 'totu.slot-positions';

interface PositionOverride {
  [siteId: string]: { x: number; y: number };
}
interface SlotPositions {
  [spaceId: string]: { x: number; y: number };
}

function loadOverrides(): PositionOverride {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function saveOverrides(o: PositionOverride) { localStorage.setItem(STORAGE_KEY, JSON.stringify(o)); }
function loadSlotPositions(): SlotPositions {
  // Committed positions (in-repo file) provide the baseline; localStorage overrides any
  // individual slots the user has re-calibrated locally.
  let local: SlotPositions = {};
  try { local = JSON.parse(localStorage.getItem(SLOTS_STORAGE_KEY) || '{}'); } catch {}
  return { ...(COMMITTED_SLOT_POSITIONS as SlotPositions), ...local };
}

interface MapViewProps {
  calibrate?: boolean;
  /** When true, MapView becomes a route editor: click two sites to toggle an edge between them. */
  editRoutes?: boolean;
  G?: TyrantsState;
  /** Sites the user can click in the current context (e.g. empty starting sites during setup). */
  clickableSites?: Set<string>;
  onSiteClick?: (siteId: string) => void;
  /** Troop spaces the user can click (e.g. for assassinate/deploy/supplant prompts). */
  clickableSpaces?: Set<string>;
  onSpaceClick?: (spaceId: string) => void;
}

const ROUTES_STORAGE_KEY = 'totu.routes';

function loadRouteOverrides(): Route[] | null {
  try {
    const raw = localStorage.getItem(ROUTES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveRouteOverrides(r: Route[]) { localStorage.setItem(ROUTES_STORAGE_KEY, JSON.stringify(r)); }

export function MapView({ calibrate = false, editRoutes = false, G, clickableSites, onSiteClick, clickableSpaces, onSpaceClick }: MapViewProps) {
  const boardUrl = useCachedImage('assets/board/map.jpg');
  const [overrides, setOverrides] = useState<PositionOverride>(loadOverrides);
  const [slotPositions] = useState<SlotPositions>(loadSlotPositions);
  const [dragging, setDragging] = useState<string | null>(null);
  const [routeDraft, setRouteDraft] = useState<Route[]>(() => loadRouteOverrides() ?? ROUTES);
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  const [defaultSpaces, setDefaultSpaces] = useState(1);
  // Rulebook p.5: hide sites/routes outside this game's active sections. Calibrate
  // / editRoutes modes ignore this so all sites stay reachable for setup work.
  const activeSites = (G && !calibrate && !editRoutes)
    ? new Set(G.activeSites)
    : new Set(SITES.map(s => s.id));
  const isSiteActive = (id: string) => activeSites.has(id);
  const isRouteActive = (r: { a: string; b: string }) => activeSites.has(r.a) && activeSites.has(r.b);

  const activeRoutes = (editRoutes ? routeDraft : ROUTES).filter(r => isRouteActive(r));

  const pos = (s: Site) => overrides[s.id] ?? { x: s.x, y: s.y };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const board = document.getElementById('totu-board') as HTMLImageElement | null;
      if (!board) return;
      const rect = board.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      setOverrides(o => ({ ...o, [dragging]: { x, y } }));
    };
    const onUp = () => { setDragging(null); saveOverrides(overrides); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging, overrides]);

  function clickSiteForRouteEdit(siteId: string) {
    if (!pendingFrom) { setPendingFrom(siteId); return; }
    if (pendingFrom === siteId) { setPendingFrom(null); return; }
    const a = pendingFrom, b = siteId;
    const exists = routeDraft.find(r => (r.a === a && r.b === b) || (r.a === b && r.b === a));
    let next: Route[];
    if (exists) {
      next = routeDraft.filter(r => r !== exists);
    } else {
      const id = `${a}-${b}`;
      next = [...routeDraft, { id, a, b, spaces: defaultSpaces }];
    }
    setRouteDraft(next);
    saveRouteOverrides(next);
    setPendingFrom(null);
  }

  function exportRoutes() {
    const lines = routeDraft.map(r =>
      `  { id: '${r.id}', a: '${r.a}', b: '${r.b}', spaces: ${r.spaces} },`
    );
    const out = `// Paste over ROUTES in src/data/routes.ts\nexport const ROUTES: Route[] = [\n${lines.join('\n')}\n];\n`;
    navigator.clipboard.writeText(out);
    alert(`Copied ${routeDraft.length} routes to clipboard.`);
  }

  function exportPositions() {
    const lines = SITES.map(s => {
      const p = pos(s);
      return `  '${s.id}': { x: ${p.x.toFixed(3)}, y: ${p.y.toFixed(3)} },`;
    });
    const out = `// Paste into sites.ts to lock calibrated positions.\n{\n${lines.join('\n')}\n}\n`;
    navigator.clipboard.writeText(out);
    alert('Calibrated positions copied to clipboard.');
  }

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 1200, margin: '0 auto' }}>
      <img id="totu-board" src={boardUrl} alt="game board" style={{ width: '100%', display: 'block', userSelect: 'none' }} draggable={false} />

      {/* Routes overlay — only drawn in editor mode (the printed board already shows them).
          In normal play the route troop spaces along the printed lines are what matter. */}
      {editRoutes && (
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} viewBox="0 0 1 1" preserveAspectRatio="none">
          {activeRoutes.map(r => {
            const a = SITES.find(s => s.id === r.a);
            const b = SITES.find(s => s.id === r.b);
            if (!a || !b) return null;
            const pa = pos(a); const pb = pos(b);
            return <line key={r.id} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
              stroke="rgba(120, 220, 120, 0.9)" strokeWidth={0.005} />;
          })}
        </svg>
      )}

      {/* Route-space troop pips. Use calibrated position if available, else interpolate
          linearly between the two endpoint sites. */}
      {G && !editRoutes && activeRoutes.flatMap(r => {
        const a = SITES.find(s => s.id === r.a);
        const b = SITES.find(s => s.id === r.b);
        if (!a || !b) return [];
        const pa = pos(a), pb = pos(b);
        return Array.from({ length: r.spaces }, (_, i) => {
          const spaceId = `${r.id}:${i}`;
          const calibrated = slotPositions[spaceId];
          let x: number, y: number;
          if (calibrated) {
            x = calibrated.x; y = calibrated.y;
          } else {
            const t = (i + 1) / (r.spaces + 1);
            x = pa.x + (pb.x - pa.x) * t;
            y = pa.y + (pb.y - pa.y) * t;
          }
          const occ = G.troops[spaceId];
          const pickable = clickableSpaces?.has(spaceId);
          const size = pickable ? 26 : 22;
          return (
            <div key={spaceId}
              onClick={() => { if (pickable) onSpaceClick?.(spaceId); }}
              title={spaceId}
              style={{
                position: 'absolute', left: `${x * 100}%`, top: `${y * 100}%`,
                width: size, height: size, marginLeft: -size/2, marginTop: -size/2,
                borderRadius: '50%',
                background: occ === 'white' ? '#ddd' : occ ? COLOR_HEX[occ] : 'rgba(20, 14, 40, 0.7)',
                border: pickable ? '2px solid #ffcc44' : occ ? '1px solid #fff' : '1px solid rgba(255,255,255,0.3)',
                boxShadow: pickable ? '0 0 6px #ffcc44' : undefined,
                cursor: pickable ? 'pointer' : 'default',
                zIndex: 5,
              }} />
          );
        });
      })}

      {/* Calibrate/route-edit mode keeps the labeled site rectangle visible for dragging
          and route picking. Normal play hides it; tokens render directly on calibrated
          slot positions on the printed board. */}
      {(calibrate || editRoutes) && SITES.filter(s => isSiteActive(s.id)).map(s => {
        const p = pos(s);
        const controller = G?.siteControl[s.id] ?? null;
        const borderColor = controller ? COLOR_HEX[controller] : (s.isStartingSite ? '#ffcc44' : 'rgba(196,163,245,0.5)');
        const isRouteEditPending = editRoutes && pendingFrom === s.id;
        return (
          <div
            key={s.id}
            onMouseDown={() => calibrate && setDragging(s.id)}
            onClick={() => { if (editRoutes) clickSiteForRouteEdit(s.id); }}
            style={{
              position: 'absolute',
              left: `${p.x * 100}%`,
              top: `${p.y * 100}%`,
              transform: 'translate(-50%, -50%)',
              padding: '2px 6px',
              fontSize: 11,
              background: isRouteEditPending ? 'rgba(120, 220, 120, 0.95)' : 'rgba(20, 14, 40, 0.85)',
              color: '#fff',
              border: `${controller ? 2 : 1}px solid ${isRouteEditPending ? '#7adc7a' : borderColor}`,
              borderRadius: 4,
              cursor: calibrate ? 'grab' : 'pointer',
              whiteSpace: 'nowrap',
              userSelect: 'none',
              boxShadow: isRouteEditPending ? '0 0 12px rgba(120, 220, 120, 0.7)' : undefined,
            }}
            title={`${s.name} — ${s.vp} VP, ${s.troopSlots} slots`}
          >
            {s.name} <span style={{ opacity: 0.7 }}>({s.vp})</span>
          </div>
        );
      })}

      {/* Site-slot tokens: one per space, positioned exactly on the printed slot.
          Falls back to an offset cluster around the site center if not calibrated. */}
      {!editRoutes && G && SITES.filter(s => isSiteActive(s.id)).flatMap(s => {
        const sitePos = pos(s);
        const controller = G.siteControl[s.id] ?? null;
        return sitesSpaces(s.id).map((sp, i) => {
          const calibrated = slotPositions[sp.id];
          let x: number, y: number;
          if (calibrated) {
            x = calibrated.x; y = calibrated.y;
          } else {
            // Fallback layout below the site label, 3 per row, ~1.5% spacing
            const col = i % 3;
            const row = Math.floor(i / 3);
            x = sitePos.x + (col - 1) * 0.018;
            y = sitePos.y + 0.020 + row * 0.018;
          }
          const occ = G.troops[sp.id];
          const isSpacePickable = clickableSpaces?.has(sp.id);
          // Slot clicks now ONLY satisfy troop-space picks. Site picks have a
          // dedicated overlay below so the user can tell which they're targeting.
          const pickable = isSpacePickable;
          const onClick = () => {
            if (isSpacePickable) onSpaceClick?.(sp.id);
          };
          const size = pickable ? 26 : 22;
          // While a site-pick is active, let clicks fall through non-pickable
          // slots to the site overlay disc underneath. Otherwise the user has
          // to aim outside the slots to hit the ring.
          const passThrough = !!(clickableSites && clickableSites.has(s.id) && !isSpacePickable);
          return (
            <div key={sp.id}
              onClick={onClick}
              title={`${s.name} — slot ${i + 1}${occ ? ` · ${occ}` : ''}${controller ? ` · ctrl ${controller}` : ''}`}
              style={{
                position: 'absolute',
                left: `${x * 100}%`,
                top: `${y * 100}%`,
                width: size, height: size,
                marginLeft: -size/2, marginTop: -size/2,
                borderRadius: '50%',
                background: occ === 'white' ? WHITE_TOKEN
                  : occ ? COLOR_HEX[occ]
                  : 'transparent',
                border: pickable ? '2px solid #ffcc44'
                  : occ === 'black' ? '2px solid #e6e1f2'
                  : occ ? '2px solid #fff'
                  : '1px dashed rgba(255,255,255,0.25)',
                boxShadow: pickable ? '0 0 8px #ffcc44'
                  : occ === 'black' ? '0 0 0 1px #000, 0 1px 4px rgba(255,255,255,0.5)'
                  : occ ? '0 1px 3px rgba(0,0,0,0.6)'
                  : undefined,
                cursor: pickable ? 'pointer' : 'default',
                pointerEvents: passThrough ? 'none' : 'auto',
                zIndex: 10,
              }} />
          );
        });
      })}

      {/* Site-pick overlay: a large translucent ring on each clickable site, rendered
          ONLY while a site-level prompt is active (e.g. "place a spy at which site?",
          "return a spy from which site?"). Distinct from the slot tokens, which only
          satisfy troop-space picks. Prevents the slot/site click conflation that made
          Spellspinner-style supplant chains require two clicks (one for spy-return
          site, one for supplant troop) on the same visual location. */}
      {!editRoutes && G && clickableSites && clickableSites.size > 0 && SITES.filter(s => isSiteActive(s.id)).map(s => {
        if (!clickableSites.has(s.id)) return null;
        const p = pos(s);
        const spaces = sitesSpaces(s.id);
        let cx = p.x, cy = p.y;
        const calibrated = spaces.map(sp => slotPositions[sp.id]).filter(Boolean) as { x: number; y: number }[];
        if (calibrated.length > 0) {
          const centroidX = calibrated.reduce((a, b) => a + b.x, 0) / calibrated.length;
          const centroidY = calibrated.reduce((a, b) => a + b.y, 0) / calibrated.length;
          cx = (p.x + centroidX) / 2;
          cy = (p.y + centroidY) / 2;
        }
        return (
          <div key={`site-pick-${s.id}`}
            onClick={() => onSiteClick?.(s.id)}
            title={`Pick site: ${s.name}`}
            style={{
              position: 'absolute',
              left: `${cx * 100}%`,
              top: `${cy * 100}%`,
              width: 88, height: 88,
              marginLeft: -44, marginTop: -44,
              borderRadius: '50%',
              border: '3px dashed #ffcc44',
              background: 'rgba(255, 204, 68, 0.12)',
              boxShadow: '0 0 16px rgba(255, 204, 68, 0.6)',
              cursor: 'pointer',
              zIndex: 9,
              animation: 'tot-site-pulse 1.4s ease-in-out infinite',
            }} />
        );
      })}
      <style>{`
        @keyframes tot-site-pulse {
          0%, 100% { box-shadow: 0 0 16px rgba(255, 204, 68, 0.6); }
          50%      { box-shadow: 0 0 24px rgba(255, 204, 68, 0.95); }
        }
      `}</style>

      {/* Spies and held control markers: render between the site label and the slot
          row, centered on the site's printed art. We use the midpoint of the site
          label position and the slot centroid, which lands on the round-image center
          for control-marker sites and just below the label for rectangular ones. */}
      {!editRoutes && G && SITES.filter(s => isSiteActive(s.id)).map(s => {
        const p = pos(s);
        const spies = G.spies[s.id] ?? [];
        const marker = G.controlMarkers[s.id];
        const markerHolder = marker?.holder ?? null;
        if (spies.length === 0 && !markerHolder) return null;
        // Slot centroid (calibrated slots) or fall back to label position.
        const spaces = sitesSpaces(s.id);
        let centroidX = p.x, centroidY = p.y;
        const calibrated = spaces.map(sp => slotPositions[sp.id]).filter(Boolean) as { x: number; y: number }[];
        if (calibrated.length > 0) {
          centroidX = calibrated.reduce((a, b) => a + b.x, 0) / calibrated.length;
          centroidY = calibrated.reduce((a, b) => a + b.y, 0) / calibrated.length;
        }
        const cx = (p.x + centroidX) / 2;
        const cy = (p.y + centroidY) / 2;
        return (
          <div key={`s${s.id}`}
            title={`${s.name}${spies.length ? ` · spies: ${spies.join(',')}` : ''}${markerHolder ? ` · marker: ${markerHolder}` : ''}`}
            style={{
              position: 'absolute',
              left: `${cx * 100}%`,
              top: `${cy * 100}%`,
              transform: 'translate(-50%, -50%)',
              display: 'flex', gap: 2,
              zIndex: 11, pointerEvents: 'none',
            }}>
            {markerHolder && <span style={{
              width: 20, height: 20, borderRadius: '50%',
              background: COLOR_HEX[markerHolder], border: '2px solid #c4a3f5',
              boxShadow: marker?.side === 'total-control'
                ? '0 0 8px #ffcc44, inset 0 0 0 2px #ffcc44'
                : '0 1px 3px rgba(0,0,0,0.6)',
            }} />}
            {spies.map((sp, i) => (
              <span key={i} title={`spy: ${sp}`} style={{
                width: 24, height: 24, background: COLOR_HEX[sp],
                border: '2px solid #fff',
                boxShadow: '0 1px 4px rgba(0,0,0,0.7)',
              }} />
            ))}
          </div>
        );
      })}

      {calibrate && (
        <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.7)', padding: 8, borderRadius: 4 }}>
          <div style={{ fontSize: 11, marginBottom: 4 }}>Drag markers. Saved to localStorage.</div>
          <button onClick={exportPositions} style={{ fontSize: 11, padding: '4px 8px' }}>Copy positions to clipboard</button>
          <button onClick={() => { localStorage.removeItem(STORAGE_KEY); setOverrides({}); }} style={{ fontSize: 11, padding: '4px 8px', marginLeft: 4 }}>Reset</button>
        </div>
      )}
      {editRoutes && (
        <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.8)', padding: 8, borderRadius: 4, maxWidth: 280 }}>
          <div style={{ fontSize: 11, marginBottom: 6 }}>
            Click two sites to add/remove an edge between them.
            {pendingFrom && <div style={{ marginTop: 4, color: '#7adc7a' }}>From: {SITES.find(s => s.id === pendingFrom)?.name}</div>}
          </div>
          <div style={{ fontSize: 11, marginBottom: 6 }}>
            Default spaces on new routes:
            <input type="number" min={1} max={4} value={defaultSpaces}
              onChange={e => setDefaultSpaces(Math.max(1, Math.min(4, +e.target.value || 1)))}
              style={{ width: 40, marginLeft: 4 }} />
          </div>
          <div style={{ fontSize: 11, marginBottom: 6, opacity: 0.7 }}>
            {routeDraft.length} routes (was {ROUTES.length}).
          </div>
          <button onClick={exportRoutes} style={{ fontSize: 11, padding: '4px 8px' }}>Copy routes to clipboard</button>
          <button
            onClick={() => {
              if (!confirm(`Discard all ${routeDraft.length} route edits and reload from source file? This cannot be undone.`)) return;
              localStorage.removeItem(ROUTES_STORAGE_KEY);
              setRouteDraft(ROUTES);
              setPendingFrom(null);
            }}
            style={{ fontSize: 11, padding: '4px 8px', marginLeft: 4, background: '#5a1f1f', color: '#fdd', border: '1px solid #802626' }}
            title="Wipes all in-progress route edits"
          >
            Reset to file
          </button>
          <details style={{ marginTop: 8, fontSize: 10 }}>
            <summary>Per-route space counts</summary>
            <div style={{ maxHeight: 200, overflow: 'auto', marginTop: 4 }}>
              {routeDraft.map((r, i) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: 1 }}>
                  <span style={{ flex: 1, fontSize: 10 }}>{r.a} ↔ {r.b}</span>
                  <input type="number" min={1} max={4} value={r.spaces}
                    onChange={e => {
                      const next = [...routeDraft];
                      next[i] = { ...r, spaces: Math.max(1, Math.min(4, +e.target.value || 1)) };
                      setRouteDraft(next); saveRouteOverrides(next);
                    }}
                    style={{ width: 36, fontSize: 10 }} />
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

// Per-site control-marker position calibration. The board image has 7 sites
// with printed control-marker spots; the rendered marker token should sit
// directly on the printed spot. This tool lets you click the marker location
// for each site once and save the offset. Falls back to (site + 0.025y) when
// no override exists.

import { useState } from 'react';
import { SITES } from '../data/sites';
import { useCachedImage } from '../image-cache';
import BAKED from '../../assets/marker-positions.json';

const STORAGE_KEY = 'totu.marker-positions';
export type MarkerPositions = Record<string, { x: number; y: number }>;

export function loadMarkerPositions(): MarkerPositions {
  // Baked file wins for first-load defaults; localStorage overrides per-user.
  let local: MarkerPositions = {};
  try { local = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { /* ignore */ }
  return { ...(BAKED as MarkerPositions), ...local };
}

function save(p: MarkerPositions) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

// The seven sites that have printed control markers.
const MARKER_SITES = SITES.filter(s => s.hasControlMarker);

// (Markers are rendered procedurally now — no per-site image files. The
// preview below draws a plain gold ring so the user can still see where
// they've placed each marker on the board.)

export function MarkerCalibration() {
  const boardUrl = useCachedImage('assets/board/map.jpg');
  const [positions, setPositions] = useState<MarkerPositions>(loadMarkerPositions);
  const [selectedSite, setSelectedSite] = useState<string>(MARKER_SITES[0]?.id ?? '');

  function setPos(siteId: string, x: number, y: number) {
    const next = { ...positions, [siteId]: { x, y } };
    setPositions(next);
    save(next);
  }

  function clearPos(siteId: string) {
    const next = { ...positions };
    delete next[siteId];
    setPositions(next);
    save(next);
  }

  function clickBoard(e: React.MouseEvent<HTMLImageElement>) {
    if (!selectedSite) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setPos(selectedSite, x, y);
    // Auto-advance to the next uncalibrated site so you can rip through all 7.
    const remaining = MARKER_SITES.filter(s => !positions[s.id] && s.id !== selectedSite);
    if (remaining.length > 0) setSelectedSite(remaining[0].id);
  }

  function exportJson() {
    navigator.clipboard.writeText(JSON.stringify(positions, null, 2));
    alert('Copied to clipboard. Paste over assets/marker-positions.json.');
  }

  return (
    <div>
      <div style={{ marginBottom: 12, padding: 10, background: '#2a1840', border: '1px solid #5a3380', borderRadius: 4 }}>
        <div style={{ marginBottom: 8, fontSize: 13 }}>
          Pick a site below, then click its printed control-marker spot on the board.
          The selection auto-advances to the next uncalibrated site.
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {MARKER_SITES.map(s => {
            const calibrated = !!positions[s.id];
            return (
              <button key={s.id} onClick={() => setSelectedSite(s.id)}
                style={{
                  padding: '4px 10px', cursor: 'pointer', borderRadius: 4,
                  background: selectedSite === s.id ? '#5a3380' : (calibrated ? '#2a4830' : '#1a1228'),
                  color: '#e6e1f2', border: '1px solid #3a2055',
                }}>
                {s.name} {calibrated ? '✓' : ''}
              </button>
            );
          })}
          <span style={{ flex: 1 }} />
          <button onClick={() => selectedSite && clearPos(selectedSite)}
            disabled={!positions[selectedSite]}
            style={{ padding: '4px 10px', background: '#1a1228', color: '#e6e1f2', border: '1px solid #3a2055', borderRadius: 4, cursor: positions[selectedSite] ? 'pointer' : 'default', opacity: positions[selectedSite] ? 1 : 0.4 }}>
            Clear selected
          </button>
          <button onClick={exportJson}
            style={{ padding: '4px 10px', background: '#5a3380', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
            Export JSON
          </button>
        </div>
      </div>

      <div style={{ position: 'relative', width: '100%', maxWidth: 1200 }}>
        <img src={boardUrl} alt="board" onClick={clickBoard}
          style={{ width: '100%', display: 'block', cursor: 'crosshair', userSelect: 'none' }}
          draggable={false} />
        {/* Preview every calibrated marker so you can see the result without
            switching tabs. The currently-selected site gets a gold ring. */}
        {MARKER_SITES.map(s => {
          const p = positions[s.id];
          if (!p) return null;
          const isSelected = selectedSite === s.id;
          return (
            <div key={s.id} style={{
              position: 'absolute',
              left: `${p.x * 100}%`, top: `${p.y * 100}%`,
              transform: 'translate(-50%, -50%)',
              width: 110, height: 110, borderRadius: '50%',
              border: isSelected ? '4px solid #ffcc44' : '2px solid rgba(255,204,68,0.55)',
              background: 'rgba(36, 22, 56, 0.65)',
              boxShadow: isSelected ? '0 0 14px #ffcc44' : '0 2px 5px rgba(0,0,0,0.65)',
              pointerEvents: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#e6e1f2', fontSize: 11, fontWeight: 600,
            }}>{s.name.split(' ')[0]}</div>
          );
        })}
      </div>
    </div>
  );
}

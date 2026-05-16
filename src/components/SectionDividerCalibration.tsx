// Capture the two wavy dashed lines that separate left|center and center|right
// on the printed board. Click along the line top-to-bottom to drop points;
// they're saved to localStorage and used by MapView to mask inactive sections
// in 2P / 3P games. Export pastes a JSON blob into the clipboard that you can
// commit to assets/section-dividers.json.

import { useState } from 'react';
import { useCachedImage } from '../image-cache';
import BAKED from '../../assets/section-dividers.json';
import { SITES } from '../data/sites';
import SLOT_POSITIONS from '../../assets/slot-positions-auto.json';

type Point = { x: number; y: number };
export interface SectionDividers {
  leftCenter: Point[];
  centerRight: Point[];
}

const STORAGE_KEY = 'totu.section-dividers';

export function loadSectionDividers(): SectionDividers {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* fallthrough */ }
  return BAKED as SectionDividers;
}

function save(d: SectionDividers) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
}

export function SectionDividerCalibration() {
  const boardUrl = useCachedImage('assets/board/map.jpg');
  const [dividers, setDividers] = useState<SectionDividers>(loadSectionDividers);
  const [editing, setEditing] = useState<'leftCenter' | 'centerRight'>('leftCenter');

  function addPoint(e: React.MouseEvent<HTMLImageElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const next = { ...dividers, [editing]: [...dividers[editing], { x, y }] };
    setDividers(next);
    save(next);
  }

  function undo() {
    const arr = dividers[editing];
    if (arr.length === 0) return;
    const next = { ...dividers, [editing]: arr.slice(0, -1) };
    setDividers(next);
    save(next);
  }

  function clear() {
    const next = { ...dividers, [editing]: [] };
    setDividers(next);
    save(next);
  }

  function exportJson() {
    const json = JSON.stringify(dividers, null, 2);
    navigator.clipboard.writeText(json);
    alert('Copied to clipboard. Paste over assets/section-dividers.json.');
  }

  const points = dividers[editing];

  return (
    <div>
      <div style={{ marginBottom: 12, padding: 10, background: '#2a1840', border: '1px solid #5a3380', borderRadius: 4 }}>
        <div style={{ marginBottom: 8, fontSize: 13 }}>
          Click along the <b>{editing === 'leftCenter' ? 'left|center' : 'center|right'}</b> dashed
          line, top to bottom. Points are saved as you click.
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => setEditing('leftCenter')}
            style={{ padding: '4px 10px', background: editing === 'leftCenter' ? '#5a3380' : '#1a1228', color: '#e6e1f2', border: '1px solid #3a2055', borderRadius: 4, cursor: 'pointer' }}>
            left | center ({dividers.leftCenter.length})
          </button>
          <button onClick={() => setEditing('centerRight')}
            style={{ padding: '4px 10px', background: editing === 'centerRight' ? '#5a3380' : '#1a1228', color: '#e6e1f2', border: '1px solid #3a2055', borderRadius: 4, cursor: 'pointer' }}>
            center | right ({dividers.centerRight.length})
          </button>
          <span style={{ flex: 1 }} />
          <button onClick={undo} disabled={points.length === 0}
            style={{ padding: '4px 10px', background: '#1a1228', color: '#e6e1f2', border: '1px solid #3a2055', borderRadius: 4, cursor: points.length ? 'pointer' : 'default', opacity: points.length ? 1 : 0.4 }}>
            Undo last
          </button>
          <button onClick={clear} disabled={points.length === 0}
            style={{ padding: '4px 10px', background: '#1a1228', color: '#e6e1f2', border: '1px solid #3a2055', borderRadius: 4, cursor: points.length ? 'pointer' : 'default', opacity: points.length ? 1 : 0.4 }}>
            Clear this line
          </button>
          <button onClick={exportJson}
            style={{ padding: '4px 10px', background: '#5a3380', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
            Export JSON
          </button>
        </div>
      </div>

      {/* Legend for the section-colored dots overlaid on the board. */}
      <div style={{ marginBottom: 8, fontSize: 12, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ opacity: 0.7 }}>Section colors:</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: SECTION_COLOR.left }} /> left
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: SECTION_COLOR.center }} /> center
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: SECTION_COLOR.right }} /> right
        </span>
        <span style={{ opacity: 0.6, marginLeft: 8, fontSize: 11 }}>
          Sites colored by their declared section; slots colored by which section their position
          falls into per the dividers. A dot in a colored zone that doesn't match the surrounding
          zone means the divider line passes on the wrong side of that point.
        </span>
      </div>

      <div style={{ position: 'relative', width: '100%', maxWidth: 1200 }}>
        <img src={boardUrl} alt="board" onClick={addPoint}
          style={{ width: '100%', display: 'block', cursor: 'crosshair', userSelect: 'none' }}
          draggable={false} />
        {/* Render both polylines so the user can see context of the other line. */}
        <svg viewBox="0 0 1 1" preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          {(['leftCenter', 'centerRight'] as const).map(key => {
            const pts = dividers[key];
            if (pts.length < 1) return null;
            const stroke = key === editing ? '#ffcc44' : 'rgba(196,163,245,0.6)';
            const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
            return (
              <g key={key}>
                <path d={path} stroke={stroke} strokeWidth={0.003} fill="none" />
                {pts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={0.005} fill={stroke} />
                ))}
              </g>
            );
          })}
          {/* Section-colored dots — one per site (declared section) and one
              per calibrated slot (position-derived section). A site whose
              dot sits in the visual zone of a different color signals a
              section/position mismatch; a slot whose dot sits in a zone
              that doesn't match its colour signals a divider polyline
              that needs nudging. */}
          {SITES.map(s => (
            <circle key={`site-${s.id}`} cx={s.x} cy={s.y} r={0.008}
              fill={SECTION_COLOR[s.section]}
              stroke="rgba(0,0,0,0.6)" strokeWidth={0.001}>
              <title>{`${s.name} — declared ${s.section}`}</title>
            </circle>
          ))}
          {Object.entries(SLOT_POSITIONS as Record<string, { x: number; y: number }>).map(([id, p]) => {
            const sec = classifyByDividers(p.x, p.y, dividers);
            return (
              <circle key={`slot-${id}`} cx={p.x} cy={p.y} r={0.004}
                fill={SECTION_COLOR[sec]}
                opacity={0.85}>
                <title>{`${id} — by position: ${sec}`}</title>
              </circle>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/** Color per section. Cyan/yellow/magenta picked to be (a) mutually
 *  distinguishable, (b) high-contrast on the dark printed board, and
 *  (c) not colliding with the player-colors (black/red/orange/blue). */
const SECTION_COLOR: Record<'left' | 'center' | 'right', string> = {
  left:   '#3ee8a8', // cool green
  center: '#ffcc44', // gold
  right:  '#ff5e9c', // magenta
};

/** Read the divider polylines and report which section (x, y) falls into.
 *  Same algorithm the MapView dimmer uses — mirrored here so the divider
 *  tab's audit dots agree with what gameplay actually does. */
function classifyByDividers(
  x: number, y: number,
  dividers: SectionDividers,
): 'left' | 'center' | 'right' {
  const xOnLine = (line: { x: number; y: number }[]): number | null => {
    if (line.length === 0) return null;
    const sorted = [...line].sort((a, b) => a.y - b.y);
    if (y <= sorted[0].y) return sorted[0].x;
    if (y >= sorted[sorted.length - 1].y) return sorted[sorted.length - 1].x;
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1];
      if (y >= a.y && y <= b.y) return a.x + (b.x - a.x) * ((y - a.y) / (b.y - a.y));
    }
    return sorted[sorted.length - 1].x;
  };
  const lc = xOnLine(dividers.leftCenter);
  const cr = xOnLine(dividers.centerRight);
  if (lc != null && x < lc) return 'left';
  if (cr != null && x > cr) return 'right';
  return 'center';
}

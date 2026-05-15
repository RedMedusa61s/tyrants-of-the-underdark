// Capture the two wavy dashed lines that separate left|center and center|right
// on the printed board. Click along the line top-to-bottom to drop points;
// they're saved to localStorage and used by MapView to mask inactive sections
// in 2P / 3P games. Export pastes a JSON blob into the clipboard that you can
// commit to assets/section-dividers.json.

import { useState } from 'react';
import { useCachedImage } from '../image-cache';
import BAKED from '../../assets/section-dividers.json';

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
        </svg>
      </div>
    </div>
  );
}

// Site-data verification grid. Lets you eyeball each site against the printed board
// and override VP / slot count / starting whites. Saves to localStorage; Copy emits
// a JSON patch keyed by site id.

import { useEffect, useMemo, useState } from 'react';
import { SITES } from '../data/sites';
import { useCachedImage } from '../image-cache';

const STORAGE_KEY = 'totu.site-overrides';
type SiteOverride = { vp?: number; troopSlots?: number; whitesAtStart?: number };
type AllOverrides = Record<string, SiteOverride>;

type FieldKey = 'vp' | 'troopSlots' | 'whitesAtStart';

function load(): AllOverrides {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

export function SiteVerify() {
  const boardUrl = useCachedImage('assets/board/map.jpg');
  const [overrides, setOverrides] = useState<AllOverrides>(load);
  const [editing, setEditing] = useState<{ id: string; field: FieldKey } | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides)); }, [overrides]);

  const sites = useMemo(() => [...SITES].sort((a, b) => a.name.localeCompare(b.name)), []);

  function commit() {
    if (!editing) return;
    const n = parseInt(draft);
    if (Number.isFinite(n) && n >= 0 && n <= 12) {
      setOverrides(prev => {
        const next = { ...prev };
        const cur = { ...(next[editing.id] ?? {}) } as SiteOverride;
        cur[editing.field] = n;
        next[editing.id] = cur;
        return next;
      });
    }
    setEditing(null);
    setDraft('');
  }

  function copyJson() {
    navigator.clipboard.writeText(JSON.stringify(overrides, null, 2));
    alert(`Copied overrides for ${Object.keys(overrides).length} sites.`);
  }

  const chip = (id: string, field: FieldKey, label: string, sheetValue: number, overrideValue: number | undefined) => {
    const isEdit = editing?.id === id && editing.field === field;
    const overridden = overrideValue !== undefined;
    return (
      <div
        onClick={() => { setEditing({ id, field }); setDraft(String(overrideValue ?? sheetValue)); }}
        title={`${field}: file=${sheetValue}${overridden ? ` override=${overrideValue}` : ''}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          background: overridden ? '#ffcc44' : '#2a1840',
          color: overridden ? '#000' : '#e6e1f2',
          padding: '1px 6px', borderRadius: 3, fontSize: 11,
          cursor: 'pointer', minWidth: 44,
          boxShadow: overridden ? '0 0 6px rgba(255,204,68,0.7)' : undefined,
        }}>
        <span style={{ opacity: 0.7 }}>{label}</span>
        {isEdit ? (
          <input autoFocus type="number" value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(null); setDraft(''); } }}
            style={{ width: 28, fontSize: 11, fontWeight: 'bold', textAlign: 'center', border: 'none', background: 'rgba(255,255,255,0.2)', color: 'inherit' }} />
        ) : <b>{overrideValue ?? sheetValue}</b>}
      </div>
    );
  };

  return (
    <div style={{ padding: 8 }}>
      <div style={{ marginBottom: 12, fontSize: 12, opacity: 0.8 }}>
        Three chips per site: <b>VP</b> (end-of-game site value), <b>slots</b> (troop spaces), <b>whites</b> (× marks).
        Click any chip to edit. Yellow = overridden. {Object.keys(overrides).length} sites have edits.
      </div>
      <div style={{ marginBottom: 12 }}>
        <button onClick={copyJson} style={{ padding: '4px 12px', marginRight: 8 }}>Copy overrides</button>
        <button onClick={() => { if (confirm('Clear all overrides?')) setOverrides({}); }}
          style={{ padding: '4px 12px', background: '#5a1f1f', color: '#fdd', border: '1px solid #802626' }}>Reset</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6, marginBottom: 16 }}>
        {sites.map(s => {
          const o = overrides[s.id] ?? {};
          return (
            <div key={s.id} style={{ background: '#1a1228', padding: '6px 10px', borderRadius: 4 }}>
              <div style={{ fontSize: 12, marginBottom: 4 }}>
                {s.name}
                {s.hasControlMarker && <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.6 }}>· marker</span>}
                {s.isStartingSite && <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.6 }}>· start</span>}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {chip(s.id, 'vp', 'VP', s.vp, o.vp)}
                {chip(s.id, 'troopSlots', 'slots', s.troopSlots, o.troopSlots)}
                {chip(s.id, 'whitesAtStart', 'whites', s.whitesAtStart, o.whitesAtStart)}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Board image (for reference):</div>
        <img src={boardUrl} alt="game board" style={{ width: '100%', maxWidth: 1100, display: 'block' }} />
      </div>
    </div>
  );
}

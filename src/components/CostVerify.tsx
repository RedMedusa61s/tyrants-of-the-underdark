// Visual verification grid for card-data fields. Lets you eyeball each card and
// override cost / deckVp / innerCircleVp / aspect by clicking the corresponding badge.
// Saves to localStorage; "Copy overrides" emits a JSON patch keyed by card name.

import { useEffect, useMemo, useState } from 'react';
import { allCards } from '../card-data';

const STORAGE_KEY = 'totu.field-overrides';
type FieldOverrides = { cost?: number; deckVp?: number; innerCircleVp?: number; aspect?: string };
type AllOverrides = Record<string, FieldOverrides>;

const ASPECTS = ['Ambition', 'Conquest', 'Malice', 'Guile', 'Obedience'];
const IN_SCOPE = new Set(['drow', 'dragons', 'elemental', 'demons', 'house-guards', 'priestesses']);

function load(): AllOverrides {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

type FieldKey = 'cost' | 'deckVp' | 'innerCircleVp';

export function CostVerify() {
  const [overrides, setOverrides] = useState<AllOverrides>(load);
  const [editing, setEditing] = useState<{ name: string; field: FieldKey } | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides)); }, [overrides]);

  const cards = useMemo(() => {
    const seen = new Map<string, { name: string; deck: string; cost: number; deckVp: number; innerCircleVp: number; aspect: string; image: string }>();
    for (const c of allCards()) {
      if (!IN_SCOPE.has(c.deck)) continue;
      if (seen.has(c.name)) continue;
      seen.set(c.name, {
        name: c.name, deck: c.deck, cost: c.cost, deckVp: c.deckVp, innerCircleVp: c.innerCircleVp,
        aspect: c.aspect, image: c.image,
      });
    }
    return [...seen.values()].sort((a, b) => a.deck.localeCompare(b.deck) || a.name.localeCompare(b.name));
  }, []);

  function setField(name: string, field: keyof FieldOverrides, value: number | string | undefined) {
    setOverrides(prev => {
      const next = { ...prev };
      const cur = { ...(next[name] ?? {}) } as FieldOverrides;
      if (value === undefined || value === '' || (typeof value === 'number' && Number.isNaN(value))) {
        delete cur[field];
      } else {
        (cur[field] as number | string) = value;
      }
      if (Object.keys(cur).length === 0) delete next[name];
      else next[name] = cur;
      return next;
    });
  }

  function commitDraft() {
    if (!editing) return;
    const n = parseInt(draft);
    if (Number.isFinite(n) && n >= -2 && n <= 20) setField(editing.name, editing.field, n);
    setEditing(null);
    setDraft('');
  }

  function cycleAspect(name: string, current: string) {
    const idx = ASPECTS.indexOf(current);
    const next = ASPECTS[(idx + 1) % ASPECTS.length];
    setField(name, 'aspect', next === ASPECTS[idx] ? undefined : next);
  }

  function copyJson() {
    navigator.clipboard.writeText(JSON.stringify(overrides, null, 2));
    alert(`Copied overrides for ${Object.keys(overrides).length} cards.`);
  }

  const fieldChip = (name: string, field: FieldKey, label: string, sheetValue: number, overrideValue: number | undefined) => {
    const isEdit = editing?.name === name && editing.field === field;
    const overridden = overrideValue !== undefined;
    return (
      <div
        onClick={() => { setEditing({ name, field }); setDraft(String(overrideValue ?? sheetValue)); }}
        title={`${field}: sheet=${sheetValue}${overridden ? ` override=${overrideValue}` : ''}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          background: overridden ? '#ffcc44' : '#2a1840',
          color: overridden ? '#000' : '#e6e1f2',
          padding: '1px 5px', borderRadius: 3, fontSize: 10,
          cursor: 'pointer', minWidth: 36,
          boxShadow: overridden ? '0 0 6px rgba(255,204,68,0.7)' : undefined,
        }}
      >
        <span style={{ opacity: 0.7 }}>{label}</span>
        {isEdit ? (
          <input autoFocus type="number" value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={e => { if (e.key === 'Enter') commitDraft(); if (e.key === 'Escape') { setEditing(null); setDraft(''); } }}
            style={{ width: 28, fontSize: 11, fontWeight: 'bold', textAlign: 'center', border: 'none', background: 'rgba(255,255,255,0.2)', color: 'inherit' }} />
        ) : <b>{overrideValue ?? sheetValue}</b>}
      </div>
    );
  };

  return (
    <div style={{ padding: 8 }}>
      <div style={{ marginBottom: 12, fontSize: 12, opacity: 0.8 }}>
        Compare the chips under each card to the printed values on the card image.
        Click any chip to edit · click the aspect chip to cycle through aspects.
        Yellow = overridden. {Object.keys(overrides).length} cards have edits.
      </div>
      <div style={{ marginBottom: 12 }}>
        <button onClick={copyJson} style={{ padding: '4px 12px', marginRight: 8 }}>Copy overrides</button>
        <button onClick={() => { if (confirm('Clear all overrides?')) setOverrides({}); }}
          style={{ padding: '4px 12px', background: '#5a1f1f', color: '#fdd', border: '1px solid #802626' }}>Reset</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        {cards.map(c => {
          const o = overrides[c.name] ?? {};
          const aspect = o.aspect ?? c.aspect;
          const aspectOverridden = o.aspect !== undefined;
          return (
            <div key={c.name} style={{ background: '#1a1228', borderRadius: 4, padding: 4 }}>
              <img src={'/' + c.image.replace(/^assets\//, '')} alt={c.name}
                style={{ width: '100%', display: 'block', borderRadius: 4 }} />
              <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85 }}>{c.name}</div>
              <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {fieldChip(c.name, 'cost', 'cost', c.cost, o.cost)}
                {fieldChip(c.name, 'deckVp', 'dVP', c.deckVp, o.deckVp)}
                {fieldChip(c.name, 'innerCircleVp', 'iVP', c.innerCircleVp, o.innerCircleVp)}
                <div
                  onClick={() => cycleAspect(c.name, aspect)}
                  title={`aspect: sheet=${c.aspect}${aspectOverridden ? ` override=${aspect}` : ''}. Click to cycle.`}
                  style={{
                    fontSize: 10, padding: '1px 5px', borderRadius: 3, cursor: 'pointer',
                    background: aspectOverridden ? '#ffcc44' : '#2a1840',
                    color: aspectOverridden ? '#000' : '#c4a3f5',
                    boxShadow: aspectOverridden ? '0 0 6px rgba(255,204,68,0.7)' : undefined,
                  }}>
                  {aspect}
                </div>
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}

// Manual card-image → card-name calibration UI.
//
// Loads sheet rows from raw-card-data.csv and the perceptual-dedup groups from
// dedup-groups.json. Shows each deck's slot images in a grid. Click an image to assign
// it a name from the dropdown; assigning one slot in a dedup group propagates to the
// whole group.
//
// Output: assets/card-name-map.json shape — { "deck::slot": "card name" }.
// Persisted to localStorage during editing; user clicks Export to copy a final JSON blob.

import { useEffect, useMemo, useState } from 'react';
import manifest from '../../assets/cards.json';
import { useCachedImage } from '../image-cache';

/** See CardTextVerify.tsx for the rationale — dev tabs need to go through
 *  the IndexedDB sheet-slice cache to load images in production. */
function CachedCardImg({ path, alt, style }: { path: string; alt: string; style: React.CSSProperties }) {
  const url = useCachedImage(path);
  return <img src={url} alt={alt} style={style} />;
}
import dedupRaw from '../../assets/dedup-groups.json';
import sheetCsv from '../../assets/raw-card-data.csv?raw';

interface SheetRow {
  count: number;
  name: string;
  set: string;     // normalized: drow | dragons | elemental | demons | core | aberrations | undead
}

const STORAGE_KEY = 'totu.card-name-map';

// Cards that live in the sheet's Drow tab but are actually always-available / starter
// pseudo-cards. Split them out into a "core" set during normalization.
const CORE_CARDS = new Set(['soldier', 'noble', 'insane outcast', 'priestess of lolth', 'house guard']);

// Cards the sheet filed under the wrong set (usually thematic name vs mechanical deck).
// Kobold has a Drow-flavored name but lives in the Dragons half-deck (cultist/wyrmspeaker theme).
const SET_OVERRIDES: Record<string, string> = {
  'kobold': 'dragons',
};

function normalizeSet(raw: string, name: string): string {
  const nameKey = name.toLowerCase();
  if (CORE_CARDS.has(nameKey)) return 'core';
  if (SET_OVERRIDES[nameKey]) return SET_OVERRIDES[nameKey];
  const lower = raw.toLowerCase();
  if (lower === 'fungus') return 'demons';        // mislabel in sheet
  if (lower === 'dragon') return 'dragons';
  if (lower === 'elementals') return 'elemental';
  return lower;
}

function parseCsv(s: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"' && s[i+1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c !== '\r') cell += c;
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

interface DedupGroup { slots: number[] }
const DEDUP: Record<string, DedupGroup[]> = dedupRaw as Record<string, DedupGroup[]>;

function slotToGroupIndex(deck: string): Map<number, number> {
  const m = new Map<number, number>();
  const groups = DEDUP[deck] ?? [];
  for (let gi = 0; gi < groups.length; gi++) {
    for (const slot of groups[gi].slots) m.set(slot, gi);
  }
  return m;
}

export function CardCalibration() {
  const [nameMap, setNameMap] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
  });
  const [activeDeck, setActiveDeck] = useState<string>('drow');

  // Parse sheet once.
  const sheetByDeck = useMemo(() => {
    const rows = parseCsv(sheetCsv);
    const out: Record<string, SheetRow[]> = {};
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = r[1]?.trim();
      if (!name) continue;
      const set = normalizeSet(r[5] || '', name);
      (out[set] ??= []).push({ count: parseInt(r[0]) || 1, name, set });
    }
    return out;
  }, []);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(nameMap)); }, [nameMap]);

  const DECKS = ['drow', 'dragons', 'elemental', 'demons', 'aberrations', 'undead', 'core'];
  const slots = manifest.cards.filter(c => c.deck === activeDeck).sort((a, b) => a.slot - b.slot);
  const groupIdx = slotToGroupIndex(activeDeck);
  const sheetNames = (sheetByDeck[activeDeck] ?? []).map(r => r.name);

  // Names currently assigned in this deck (so we can shade them in the dropdown).
  const assignedNames = new Set(Object.entries(nameMap)
    .filter(([k]) => k.startsWith(activeDeck + '::'))
    .map(([, v]) => v));

  function assign(slot: number, name: string) {
    const gi = groupIdx.get(slot);
    setNameMap(prev => {
      const next = { ...prev };
      const keysToUpdate = (DEDUP[activeDeck]?.[gi ?? -1]?.slots ?? [slot]);
      for (const s of keysToUpdate) {
        if (name === '') delete next[`${activeDeck}::${s}`];
        else next[`${activeDeck}::${s}`] = name;
      }
      return next;
    });
  }

  function exportMap() {
    const blob = JSON.stringify(nameMap, null, 2);
    navigator.clipboard.writeText(blob);
    alert(`Copied ${Object.keys(nameMap).length} mappings to clipboard. Paste into assets/card-name-map.json.`);
  }

  function downloadMap() {
    const blob = new Blob([JSON.stringify(nameMap, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'card-name-map.json';
    a.click();
  }

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        {DECKS.map(d => {
          const all = manifest.cards.filter(c => c.deck === d).length;
          const done = Object.keys(nameMap).filter(k => k.startsWith(d + '::')).length;
          return (
            <button key={d} onClick={() => setActiveDeck(d)}
              style={{
                padding: '4px 12px',
                background: activeDeck === d ? '#3a2055' : 'transparent',
                color: '#e6e1f2',
                border: '1px solid #3a2055',
                borderRadius: 4,
                cursor: 'pointer',
              }}>
              {d} ({done}/{all})
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <button onClick={exportMap} style={{ padding: '4px 12px' }}>Copy JSON</button>
        <button onClick={downloadMap} style={{ padding: '4px 12px' }}>Download</button>
        <button onClick={() => { if (confirm(`Clear all ${activeDeck} assignments?`)) {
          setNameMap(prev => {
            const next: Record<string, string> = {};
            for (const [k, v] of Object.entries(prev)) if (!k.startsWith(activeDeck + '::')) next[k] = v;
            return next;
          });
        }}}>Clear {activeDeck}</button>
      </div>

      <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 8 }}>
        Click an image's dropdown to assign a card name. Assigning one slot in a perceptually-grouped set
        propagates to all duplicates in that group. Saved to localStorage as you go.
        {DEDUP[activeDeck] && ` Auto-detected groups: ${DEDUP[activeDeck].length} (deck has ${slots.length} slots).`}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
        {slots.map(c => {
          const key = `${activeDeck}::${c.slot}`;
          const current = nameMap[key] ?? '';
          const gi = groupIdx.get(c.slot);
          const groupSize = gi != null ? DEDUP[activeDeck][gi].slots.length : 1;
          return (
            <div key={c.slot} style={{ background: '#1a1228', borderRadius: 4, padding: 4 }}>
              <CachedCardImg path={c.image} alt={`slot ${c.slot}`}
                style={{ width: '100%', display: 'block', borderRadius: 4 }} />
              <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>
                slot {c.slot}{groupSize > 1 ? ` · group×${groupSize}` : ''}
              </div>
              <select value={current} onChange={e => assign(c.slot, e.target.value)}
                style={{ width: '100%', marginTop: 2, fontSize: 11, background: current ? '#2d1d44' : '#0c0814', color: '#e6e1f2' }}>
                <option value="">— select —</option>
                {sheetNames.map(n => (
                  <option key={n} value={n} style={{ color: assignedNames.has(n) && n !== current ? '#888' : undefined }}>
                    {n}{assignedNames.has(n) && n !== current ? ' (used)' : ''}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Card-text verification grid. Shows each unique card with an editable text area
// containing my current understanding of its effect (derived from the parsed
// `benefits`). User can correct each one; corrections persist in localStorage and
// can be exported via "Copy overrides" as a JSON patch keyed by card name.
//
// Other fields (name, cost, deckVP, innerCircleVP) intentionally omitted — covered
// by the existing CostVerify tab.

import { useEffect, useMemo, useState } from 'react';
import { allCards } from '../card-data';
import { useCachedImage } from '../image-cache';

/** Card image rendered through the IndexedDB sheet-slice cache. The dev
 *  tabs previously used a plain `<img src="/cards/foo.jpg">` which only
 *  worked in `vite dev` (where publicDir serves at root); in production
 *  with the GH-Pages base path the URL resolved to a 404 and the images
 *  disappeared. Going through useCachedImage matches how the main Card
 *  component renders, so the dev tabs work in every deploy mode. */
function CachedCardImg({ path, alt, style }: { path: string; alt: string; style: React.CSSProperties }) {
  const url = useCachedImage(path);
  return <img src={url} alt={alt} style={style} />;
}

const STORAGE_KEY = 'totu.card-text-overrides';
type Overrides = Record<string, string>;
const IN_SCOPE = new Set(['drow', 'dragons', 'elemental', 'demons', 'house-guards', 'priestesses']);

function load(): Overrides {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

export function CardTextVerify() {
  const [overrides, setOverrides] = useState<Overrides>(load);
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides)); }, [overrides]);

  const cards = useMemo(() => {
    const seen = new Map<string, { name: string; deck: string; benefits: string[]; effectKey: string; image: string }>();
    for (const c of allCards()) {
      if (!IN_SCOPE.has(c.deck)) continue;
      if (seen.has(c.name)) continue;
      seen.set(c.name, {
        name: c.name, deck: c.deck, benefits: c.benefits ?? [], effectKey: c.effectKey, image: c.image,
      });
    }
    return [...seen.values()].sort((a, b) => a.deck.localeCompare(b.deck) || a.name.localeCompare(b.name));
  }, []);

  function defaultText(benefits: string[]): string {
    return benefits.join('\n');
  }

  function setText(name: string, value: string, original: string) {
    setOverrides(prev => {
      const next = { ...prev };
      // Treat blank or unchanged-from-original as "no override."
      if (value.trim() === '' || value === original) delete next[name];
      else next[name] = value;
      return next;
    });
  }

  function copyJson() {
    navigator.clipboard.writeText(JSON.stringify(overrides, null, 2));
    alert(`Copied card-text overrides for ${Object.keys(overrides).length} cards.`);
  }

  return (
    <div style={{ padding: 8 }}>
      <div style={{ marginBottom: 12, fontSize: 12, opacity: 0.8 }}>
        Each card shows my current understanding of its effect (parsed from the source sheet).
        Edit the textarea to correct it. Yellow border = edited.
        {' '}{Object.keys(overrides).length} cards have edits.
        {' '}Shown: effect text only — name, cost, and VP values live on the <b>costs</b> tab.
      </div>
      <div style={{ marginBottom: 12 }}>
        <button onClick={copyJson} style={{ padding: '4px 12px', marginRight: 8 }}>Copy overrides</button>
        <button onClick={() => { if (confirm('Clear all card-text overrides?')) setOverrides({}); }}
          style={{ padding: '4px 12px', background: '#5a1f1f', color: '#fdd', border: '1px solid #802626' }}>
          Reset
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {cards.map(c => {
          const original = defaultText(c.benefits);
          const current = overrides[c.name] ?? original;
          const edited = overrides[c.name] !== undefined;
          return (
            <div key={c.name} style={{
              background: '#1a1228', borderRadius: 4, padding: 6,
              border: edited ? '2px solid #ffcc44' : '2px solid transparent',
            }}>
              <CachedCardImg path={c.image} alt={c.name}
                style={{ width: '100%', display: 'block', borderRadius: 4 }} />
              <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85, display: 'flex', justifyContent: 'space-between' }}>
                <span>{c.name}</span>
                <span style={{ opacity: 0.5, fontFamily: 'monospace' }}>{c.effectKey}</span>
              </div>
              <textarea
                value={current}
                onChange={e => setText(c.name, e.target.value, original)}
                rows={4}
                spellCheck={false}
                style={{
                  marginTop: 4, width: '100%', boxSizing: 'border-box',
                  padding: 4, fontSize: 11, fontFamily: 'inherit',
                  background: '#0c0814', color: '#e6e1f2',
                  border: '1px solid #3a2055', borderRadius: 3, resize: 'vertical',
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

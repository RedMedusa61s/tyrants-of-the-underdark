// Renders a log/summary line as text, wrapping any recognised card name in a
// hover chip that shows the actual card (image, with name + effect text as a
// fallback). Drew W.'s request: card titles in the log are easy to read but
// hard to remember the effects of, and discard piles often empty out before you
// can inspect them — so let players hover a title to see the card itself.
//
// The basic cards (Noble, Soldier, House Guard, Priestess of Lolth) are
// excluded: everyone knows them and they appear constantly, so chips for them
// would just be noise (also Drew's request).

import { useState } from 'react';
import { allCards } from '../card-data';
import { useCachedImage } from '../image-cache';
import { isNoImagesMode } from '../App';

const BASIC_NAMES = new Set(['Noble', 'Soldier', 'House Guard', 'Priestess of Lolth']);

interface NamedCard { image: string; benefits: string[]; cost: number }

// Build once at module load: card name → display meta. First occurrence wins
// (the same card can appear in several half-decks; the art is identical).
const NAMED: Map<string, NamedCard> = (() => {
  const m = new Map<string, NamedCard>();
  for (const c of allCards()) {
    if (!c.name || BASIC_NAMES.has(c.name) || m.has(c.name)) continue;
    m.set(c.name, { image: c.image, benefits: c.benefits ?? [], cost: c.cost });
  }
  return m;
})();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Longest first so multi-word names match before any shorter name nested inside.
const NAMES_SORTED = [...NAMED.keys()].sort((a, b) => b.length - a.length);
const NAME_RE = NAMES_SORTED.length
  ? new RegExp('(' + NAMES_SORTED.map(escapeRe).join('|') + ')', 'g')
  : null;

/** The hover popup contents — loads the card image on demand (only mounted
 *  while hovered), falling back to name + effect text. */
function CardPreview({ name }: { name: string }) {
  const meta = NAMED.get(name)!;
  const url = useCachedImage(meta.image, 0);
  const showImg = !isNoImagesMode() && !!url;
  return (
    <div style={{
      background: '#0c0814', border: '1px solid #5a3380', borderRadius: 8,
      padding: showImg ? 4 : 10, boxShadow: '0 8px 30px rgba(0,0,0,0.7)',
      width: showImg ? 240 : 220,
    }}>
      {showImg ? (
        <img src={url} alt={name} style={{ width: '100%', display: 'block', borderRadius: 5 }} />
      ) : (
        <div style={{ fontSize: 12, color: '#e6e1f2' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{name}</div>
          {meta.benefits.length > 0
            ? <div style={{ opacity: 0.85 }}>{meta.benefits.join(' · ')}</div>
            : <div style={{ opacity: 0.5 }}>(no special effect)</div>}
        </div>
      )}
    </div>
  );
}

function CardChip({ name }: { name: string }) {
  // Fixed-position popup anchored to the chip's rect, so it escapes the
  // overflow:auto on the log panel / summary modal (which would clip an
  // absolutely-positioned child). Clamped to stay on screen.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const onEnter = (e: React.MouseEvent<HTMLSpanElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const width = 244;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    // Prefer above the chip; if no room, drop below.
    const top = r.top > 320 ? r.top - 8 : r.bottom + 8;
    setPos({ left, top });
  };
  return (
    <span
      onMouseEnter={onEnter}
      onMouseLeave={() => setPos(null)}
      style={{ color: '#cdb6ff', textDecoration: 'underline dotted', cursor: 'help' }}>
      {name}
      {pos && (
        <span style={{
          position: 'fixed', left: pos.left, top: pos.top, zIndex: 3000,
          transform: pos.top < 320 ? undefined : 'translateY(-100%)',
          pointerEvents: 'none',
        }}>
          <CardPreview name={name} />
        </span>
      )}
    </span>
  );
}

/** Render a log line with card-name chips. Falls back to plain text if no
 *  card names are present (the common case for resource/score lines). */
export function CardLogText({ line }: { line: string }) {
  if (!NAME_RE) return <>{line}</>;
  NAME_RE.lastIndex = 0;
  const parts: Array<string | { name: string }> = [];
  let last = 0;
  for (let m = NAME_RE.exec(line); m; m = NAME_RE.exec(line)) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    parts.push({ name: m[0] });
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  if (parts.length === 1 && typeof parts[0] === 'string') return <>{line}</>;
  return (
    <>
      {parts.map((p, i) => typeof p === 'string'
        ? <span key={i}>{p}</span>
        : <CardChip key={i} name={p.name} />)}
    </>
  );
}

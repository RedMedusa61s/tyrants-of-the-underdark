// Text-only card rendering. Used when image fetching is unavailable or
// disabled — either because no-images mode is on, the user skipped the
// first-run import, or an image's remote source 404s and the cache can't
// fall back to anything.
//
// Same aspect ratio (~ 2.5 × 3.5) and on-hover scale as the image-backed
// Card, so layouts don't shift when toggling modes.

import type { CardRef } from '../game';
import { lookupCard } from '../card-data';

const ASPECT_HEX: Record<string, string> = {
  Ambition:  '#5a3380',  // purple
  Conquest:  '#a04030',  // red
  Malice:    '#1a1a1a',  // black
  Guile:     '#2f7d6a',  // teal
  Obedience: '#5a5560',  // grey-violet
};

export function PlaceholderCard({ card, hover }: { card: CardRef; hover: boolean }) {
  const data = lookupCard(card.deck, card.slot);
  const aspect = data?.aspect ?? '—';
  const aspectColor = ASPECT_HEX[aspect] ?? '#3a2055';

  return (
    <div style={{
      width: '100%', aspectRatio: '120/168',
      borderRadius: 8, padding: 8, boxSizing: 'border-box',
      background: `linear-gradient(160deg, ${aspectColor}, #1a1228 70%)`,
      border: '1px solid rgba(255,255,255,0.15)',
      boxShadow: hover ? '0 8px 32px rgba(0,0,0,0.8)' : '0 2px 8px rgba(0,0,0,0.5)',
      transform: hover ? 'scale(2.5)' : 'scale(1)',
      transformOrigin: 'center center',
      transition: 'transform 120ms ease-out, box-shadow 120ms ease-out',
      zIndex: hover ? 1000 : 1,
      position: 'relative',
      pointerEvents: 'none',
      display: 'flex', flexDirection: 'column',
      color: '#e6e1f2', fontFamily: 'inherit',
    }}>
      {/* Header: name + cost */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 'bold', lineHeight: 1.1, flex: 1, textShadow: '0 1px 2px #000' }}>
          {card.name}
        </div>
        {data && (
          <div style={{
            minWidth: 18, height: 18, borderRadius: '50%',
            background: '#ffcc44', color: '#000',
            fontSize: 10, fontWeight: 'bold',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 4px',
          }} title={`cost: ${data.cost} Influence`}>
            {data.cost}
          </div>
        )}
      </div>

      {/* Aspect chip */}
      {data && (
        <div style={{
          marginTop: 4,
          alignSelf: 'flex-start',
          fontSize: 9, padding: '1px 5px', borderRadius: 8,
          background: 'rgba(255,255,255,0.15)',
          textTransform: 'uppercase', letterSpacing: 0.5,
        }}>
          {aspect}
        </div>
      )}

      {/* Effect text — parsed benefits, one per line */}
      <div style={{
        marginTop: 6, flex: 1,
        fontSize: 9, lineHeight: 1.25, opacity: 0.92,
        overflow: 'hidden',
      }}>
        {data && data.benefits.length > 0
          ? data.benefits.map((b, i) => <div key={i}>• {b}</div>)
          : <div style={{ opacity: 0.5 }}>(no effect text)</div>}
      </div>

      {/* Footer: VP values */}
      {data && (
        <div style={{
          marginTop: 4, display: 'flex', justifyContent: 'space-between',
          fontSize: 9, opacity: 0.75, gap: 6,
        }}>
          <span title={`Deck VP: ${data.deckVp}`}>dVP: {data.deckVp}</span>
          <span title={`Inner Circle VP: ${data.innerCircleVp}`}>iVP: {data.innerCircleVp}</span>
        </div>
      )}
    </div>
  );
}

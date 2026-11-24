import { HOUSES_BY_ID } from '../houses/house-data';
import type { HouseId } from '../houses/types';

interface HouseInfoModalProps {
  houseId: HouseId;
  /** e.g. "Your" or "P2's" — used as "{playerLabel} House: {name}". */
  playerLabel: string;
  onClose: () => void;
}

/** Popup showing a player's house name, motto, and full ability list — the
 *  in-game equivalent of the Lobby's house preview (HouseSelect.tsx), reachable
 *  by clicking a player's house name in the Scoreboard. Lets you check any
 *  player's house (not just your own, which the House Bar already shows). */
export function HouseInfoModal({ houseId, playerLabel, onClose }: HouseInfoModalProps) {
  const house = HOUSES_BY_ID[houseId];
  if (!house) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        width: '100vw', height: '100dvh', background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 20,
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#1a1030', border: '1px solid #3a2055', borderRadius: 8,
          padding: 20, minWidth: 280, maxWidth: '90vw', maxHeight: '85vh', overflow: 'auto',
          boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
        }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{playerLabel} House: {house.name}</h2>
          <button onClick={onClose}
            style={{ padding: '4px 12px', background: '#3a2055', color: '#e6e1f2', border: '1px solid #5a3380', borderRadius: 4, cursor: 'pointer' }}>
            Close
          </button>
        </div>
        {house.motto && (
          <div style={{ fontStyle: 'italic', opacity: 0.75, marginBottom: 12, fontSize: 13 }}>
            "{house.motto}"
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {house.abilities.map(a => (
            <div key={a.key} style={{ fontSize: 13 }}>
              <span style={{
                display: 'inline-block', marginRight: 6, padding: '1px 6px', borderRadius: 3,
                fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5,
                background: a.kind === 'passive' ? '#33224d' : '#3a2a55',
                color: a.kind === 'passive' ? '#b69cff' : '#ffcc88',
              }}>
                {a.kind === 'passive' ? 'Passive' : a.frequency ? `Once/${a.frequency}` : 'Action'}
              </span>
              <strong>{a.name}</strong>
              <div style={{ opacity: 0.75, marginTop: 2 }}>{a.text}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { HOUSES } from '../houses/house-data';
import type { HouseId } from '../houses/types';

export type HousePick = HouseId | 'random';

interface HouseSelectProps {
  enabled: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  pick: HousePick;
  onPick: (pick: HousePick) => void;
}

/** Lobby control: turn the Drow House system on/off, pick a house (or leave
 *  it to random assignment), and preview the chosen house's abilities.
 *  AI opponents always get a random house whenever this is enabled — there's
 *  no per-seat picker yet, matching this dialog's existing scope (it only
 *  configures the human's own seat directly). */
export function HouseSelect({ enabled, onToggleEnabled, pick, onPick }: HouseSelectProps) {
  const chosen = pick !== 'random' ? HOUSES.find(h => h.id === pick) : undefined;

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <label style={{ opacity: 0.85 }}>Drow Houses</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => onToggleEnabled(false)}
            style={{
              padding: '4px 12px', cursor: 'pointer', borderRadius: 4, fontSize: 12,
              background: !enabled ? '#5a3380' : '#2a1840',
              color: '#e6e1f2', border: '1px solid #3a2055',
            }}>Off</button>
          <button onClick={() => onToggleEnabled(true)}
            style={{
              padding: '4px 12px', cursor: 'pointer', borderRadius: 4, fontSize: 12,
              background: enabled ? '#5a3380' : '#2a1840',
              color: '#e6e1f2', border: '1px solid #3a2055',
            }}>On</button>
        </div>
      </div>

      {enabled && (
        <>
          <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 8 }}>
            Each house adds a couple of extra passive/active abilities on top of the base game.
            Opponents are always randomly assigned a house.
          </div>
          <select
            value={pick}
            onChange={e => onPick(e.target.value as HousePick)}
            style={{
              width: '100%', padding: '6px 10px', borderRadius: 4, fontSize: 13,
              background: '#2a1840', color: '#e6e1f2', border: '1px solid #3a2055',
              marginBottom: 8,
            }}>
            <option value="random">🎲 Random house</option>
            {HOUSES.map(h => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>

          {chosen && (
            <div style={{ padding: 10, background: '#1a1228', border: '1px solid #3a2055', borderRadius: 4 }}>
              <div style={{ fontWeight: 'bold', marginBottom: 6 }}>{chosen.name}</div>
              {chosen.abilities.map(a => (
                <div key={a.key} style={{ marginBottom: 6, fontSize: 12 }}>
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
          )}
        </>
      )}
    </div>
  );
}

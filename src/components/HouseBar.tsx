import type { TyrantsState } from '../game';
import { HOUSES_BY_ID } from '../houses/house-data';
import { HouseRegistry } from '../houses/registry';

interface HouseBarProps {
  G: TyrantsState;
  /** The seat this bar is showing/acting for (the local human's seat). */
  pid: string;
  /** Whether it's currently this seat's turn (buttons disable otherwise). */
  myTurn: boolean;
  moves: Record<string, (...args: unknown[]) => void>;
}

/** Toolbar of the acting player's house abilities — a passive-ability strip
 *  plus action buttons, styled to sit alongside the existing action bar.
 *  Renders nothing when houses are off / this player has no house. */
export function HouseBar({ G, pid, myTurn, moves }: HouseBarProps) {
  const player = G.players[pid];
  const houseId = player?.house;
  if (!houseId) return null;
  const house = HOUSES_BY_ID[houseId];
  if (!house) return null;

  const canAct = myTurn && !G.pendingChoice;

  return (
    <div style={{
      marginTop: 12, padding: '8px 12px', background: '#241638',
      border: '1px solid #3a2055', borderRadius: 4,
      display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'center',
    }}>
      <span style={{ fontSize: 12, opacity: 0.65, marginRight: 4 }}>House {house.name}:</span>
      {house.abilities.map(ability => {
        if (ability.kind === 'passive' || ability.endOfTurn) {
          const used = ability.endOfTurn && player.houseState.usedThisTurn[ability.key];
          return (
            <span
              key={ability.key}
              title={`${ability.text}${ability.endOfTurn ? (used ? ' — already offered this turn.' : ' — offered automatically when you end your turn.') : ''}`}
              style={{
                padding: '4px 10px', borderRadius: 4, fontSize: 12,
                background: '#2a1840', color: '#b69cff', border: '1px dashed #5a3380',
                cursor: 'help', opacity: ability.endOfTurn && used ? 0.55 : 1,
              }}>
              {ability.name}{ability.endOfTurn ? ' (end of turn)' : ''}
            </span>
          );
        }

        const used = ability.frequency === 'turn' ? player.houseState.usedThisTurn[ability.key]
          : ability.frequency === 'game' ? player.houseState.usedThisGame[ability.key]
          : false;
        const impl = HouseRegistry.getAction(houseId, ability.key);
        const conditionOk = !impl?.available || impl.available(G, pid);
        const enabled = canAct && !used && conditionOk;
        const freqTag = ability.frequency === 'turn' ? ' (once/turn)'
          : ability.frequency === 'game' ? ' (once/game)' : '';

        return (
          <button
            key={ability.key}
            disabled={!enabled}
            title={`${ability.text}${used ? ' — already used.' : !conditionOk ? ' — not usable right now.' : ''}`}
            onClick={() => moves.houseAction(ability.key)}
            style={{
              padding: '6px 12px', borderRadius: 4, fontSize: 12,
              background: enabled ? '#5a3380' : '#2a1840',
              color: enabled ? '#fff' : '#776',
              border: '1px solid #3a2055',
              cursor: enabled ? 'pointer' : 'not-allowed',
              opacity: enabled ? 1 : 0.55,
            }}>
            {ability.name}{freqTag}{used ? ' ✓' : ''}
          </button>
        );
      })}
      {player.houseState.data.reservedMarketCard != null && (
        <button
          disabled={!canAct}
          title="Recruit the market card reserved for you (Web of Debts), at 1 less Influence."
          onClick={() => moves.recruitReservedCard()}
          style={{
            padding: '6px 12px', borderRadius: 4, fontSize: 12,
            background: canAct ? '#5a3380' : '#2a1840',
            color: canAct ? '#fff' : '#776',
            border: '1px solid #3a2055',
            cursor: canAct ? 'pointer' : 'not-allowed',
            opacity: canAct ? 1 : 0.55,
          }}>
          Recruit reserved card
        </button>
      )}
    </div>
  );
}

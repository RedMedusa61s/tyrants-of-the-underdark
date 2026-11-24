// Picks a house ability (or the reserved-card recruit) for an AI seat to
// fire, if one is currently both eligible AND worth doing. Shared by
// ai/random-ai.ts and ai/heuristic-ai.ts so house-ability priority logic
// lives in exactly one place.
//
// Deliberately simple: return the FIRST useful ability (house-data.ts's own
// ability order), rather than scoring every option. The pendingChoice
// prompts most abilities surface (select-troop-space, select-card-in-hand,
// choose-one, select-market-card, select-player) are the SAME generic kinds
// card effects use, so each AI's existing resolveChoice logic already
// answers them sensibly (assassinate/deploy scoring, trashScore-based
// discards, etc.) with zero extra work here.
//
// Both call sites invoke this once per decision tick, at the very top of the
// regular-turn branch (before playing cards / spending power / recruiting).
// Since the AI is re-invoked every tick against the LATEST state, this alone
// is enough to interleave house actions correctly through the turn — no
// separate "early" vs "late" phase is needed:
//   - Hand-costing abilities (Silken Snare, Forbidden Knowledge, Shadow
//     Investment) require hand.length >= 2 below, so they stop being
//     proposed once hand thins out from normal card-play — never starving
//     the "always play your hand" strategy of its last card.
//   - Resource-costing abilities (Unstable Ritual, Psionic Storm, Shrewd
//     Bargains) naturally only become available once Power/Influence has
//     accumulated from playing cards earlier in the same turn.

import type { TyrantsState } from '../game';
import type { AiMove } from './random-ai';
import { HouseHooks } from '../houses/hooks';
import { RESERVED_MARKET_CARD_KEY } from '../houses/types';
import { lookupCard } from '../card-data';
import { playerHasOwnSpy } from '../engine/handler-helpers';

/** Extra "would this currently do anything?" gates for abilities whose
 *  engine-side `available` predicate doesn't fully capture emptiness, or
 *  that need a resource-affordability check the predicate deliberately
 *  leaves to the caller (deploy/discard/devour costs paid inside the
 *  handler itself). Purely an AI-side optimization to avoid wasting a whole
 *  decision tick on a no-op the engine would otherwise skip silently — none
 *  of this affects correctness (every ability already fizzles gracefully on
 *  its own if run with no legal target). Keyed by "houseId::abilityKey" to
 *  match houses/registry.ts's internal key shape. */
function looksUseful(G: TyrantsState, pid: string, houseId: string, key: string): boolean {
  const me = G.players[pid];
  switch (`${houseId}::${key}`) {
    case 'hunett::death-from-the-shadows':
      return playerHasOwnSpy(G, pid);
    case 'agrach-dyrr::lich-matrons-claim':
      return Object.values(me.trophyHall).some(n => n > 0)
        && Object.keys(G.players).some(p => p !== pid && (G.players[p].trophyHall[me.color] ?? 0) > 0);
    case 'oblodra::precognitive-glimpse':
      return me.deck.length > 0;
    case 'oblodra::psionic-storm':
      return me.power >= 2 && G.market.row.some(c => c != null);
    case 'do-urden::silken-snare':
    case 'xorlarrin::forbidden-knowledge':
    case 'mizzrym::shadow-investment':
      // Keep at least one card in hand to actually play — these trade a
      // hand card for a smaller bonus, so only worth it with a spare.
      return me.hand.length >= 2;
    case 'xorlarrin::unstable-ritual':
      return me.power >= 1;
    case 'mizzrym::shrewd-bargains':
      return me.power >= 2 || me.influence >= 2;
    default:
      return true;
  }
}

export function pickHouseAction(G: TyrantsState, pid: string): AiMove | null {
  const houseId = G.players[pid]?.house;
  if (!houseId) return null;
  const me = G.players[pid];

  // The reserved-card recruit (Nasadra's Web of Debts) isn't in
  // eligibleActionKeys (it's not an 'action' ability — it's a separate
  // move), so check it directly here.
  const reserved = me.houseState.data[RESERVED_MARKET_CARD_KEY] as { deck: string; slot: number } | undefined;
  if (reserved) {
    const data = lookupCard(reserved.deck, reserved.slot);
    const cost = Math.max(0, (data?.cost ?? 999) - 1);
    if (me.influence >= cost) return { name: 'recruitReservedCard', args: [] };
  }

  for (const key of HouseHooks.eligibleActionKeys(G, pid)) {
    if (!looksUseful(G, pid, houseId, key)) continue;
    return { name: 'houseAction', args: [key] };
  }
  return null;
}

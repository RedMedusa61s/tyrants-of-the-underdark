// Map a card to its effectKey for handler dispatch.
// Now sourced from card-data.json (built from the calibrated name-map).

import type { CardRef } from '../game';
import { lookupCard } from '../card-data';

export function effectKeyFor(card: CardRef): string {
  const data = lookupCard(card.deck, card.slot);
  return data?.effectKey ?? '';
}

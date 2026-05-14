// Runtime accessor for the card-data table built by scripts/build-card-data.mjs.

import data from '../assets/card-data.json';

export interface CardData {
  deck: string;
  slot: number;
  name: string;
  image: string;
  cost: number;
  deckVp: number;
  innerCircleVp: number;
  aspect: string;
  type: string;
  rarity: number;
  benefits: string[];
  effectKey: string;
}

const TABLE = data as unknown as Record<string, CardData>;

export function lookupCard(deck: string, slot: number): CardData | undefined {
  return TABLE[`${deck}::${slot}`];
}

export function lookup(key: string): CardData | undefined {
  return TABLE[key];
}

export function allCards(): CardData[] {
  return Object.values(TABLE);
}

export function cardsInDeck(deck: string): CardData[] {
  return allCards().filter(c => c.deck === deck);
}

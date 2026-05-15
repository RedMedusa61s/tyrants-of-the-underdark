// Mechanics façade — every zone/score mutation routes through here so logging,
// game-over checks, and (future) site-control recomputation all stay in one place.
//
// Inherited convention from Impulse/Innovation: handlers and moves never touch piles,
// resource pools, or scores directly. They call Mechanics.

import type { TyrantsState, CardRef } from '../game';

function p(G: TyrantsState, playerId: string) {
  const player = G.players[playerId];
  if (!player) throw new Error(`Unknown player ${playerId}`);
  return player;
}

export const Mechanics = {
  log(G: TyrantsState, line: string) {
    G.log.push(line);
  },

  gainPower(G: TyrantsState, playerId: string, n: number) {
    p(G, playerId).power += n;
    if (n !== 0) Mechanics.log(G, `P${Number(playerId) + 1} +${n} Power`);
  },
  gainInfluence(G: TyrantsState, playerId: string, n: number) {
    p(G, playerId).influence += n;
    if (n !== 0) Mechanics.log(G, `P${Number(playerId) + 1} +${n} Influence`);
  },
  expendPower(G: TyrantsState, playerId: string, n: number): boolean {
    const pl = p(G, playerId);
    if (pl.power < n) return false;
    pl.power -= n;
    return true;
  },
  expendInfluence(G: TyrantsState, playerId: string, n: number): boolean {
    const pl = p(G, playerId);
    if (pl.influence < n) return false;
    pl.influence -= n;
    return true;
  },

  gainVpTokens(G: TyrantsState, playerId: string, n: number) {
    p(G, playerId).vp += n;
    Mechanics.log(G, `P${Number(playerId) + 1} +${n} VP`);
  },

  draw(G: TyrantsState, playerId: string, n: number, random?: { Number(): number }) {
    const pl = p(G, playerId);
    const rng = random ? () => random.Number() : () => Math.random();
    for (let i = 0; i < n; i++) {
      if (pl.deck.length === 0) {
        if (pl.discard.length === 0) return;
        // Deterministic reshuffle via the seeded boardgame.io RNG when passed
        // through. Callers in move handlers should pass ctx.random. Fenwick-
        // free Fisher-Yates on a copy so we don't mutate discard mid-loop.
        const deck = pl.discard.slice();
        for (let k = deck.length - 1; k > 0; k--) {
          const j = Math.floor(rng() * (k + 1));
          [deck[k], deck[j]] = [deck[j], deck[k]];
        }
        pl.deck = deck;
        pl.discard = [];
      }
      const c = pl.deck.shift();
      if (c) pl.hand.push(c);
    }
  },

  discardCard(G: TyrantsState, playerId: string, card: CardRef) {
    const pl = p(G, playerId);
    const idx = pl.hand.findIndex(c => c.deck === card.deck && c.slot === card.slot);
    if (idx < 0) throw new Error(`Card ${card.name} not in hand`);
    pl.hand.splice(idx, 1);
    pl.discard.push(card);
  },

  promote(G: TyrantsState, playerId: string, card: CardRef) {
    const pl = p(G, playerId);
    // Insane Outcast self-eject: if would be promoted, return to supply instead.
    if (card.deck === 'insane-outcasts') {
      Mechanics.log(G, `P${Number(playerId) + 1} cannot promote ${card.name} (returns to supply)`);
      // (No supply tracking yet; just drop the card.)
      return;
    }
    pl.innerCircle.push(card);
    Mechanics.log(G, `P${Number(playerId) + 1} promoted ${card.name}`);
  },

  devour(G: TyrantsState, card: CardRef) {
    // Insane Outcast self-eject: if would be devoured, return to supply instead.
    if (card.deck === 'insane-outcasts') {
      Mechanics.log(G, `${card.name} cannot be devoured (returns to supply)`);
      return;
    }
    Mechanics.log(G, `${card.name} devoured`);
    // (No devoured pile tracking yet — card just leaves play.)
  },

  recruitFromMarket(G: TyrantsState, playerId: string, marketIndex: number): boolean {
    const card = G.market.row[marketIndex];
    if (!card) return false;
    p(G, playerId).discard.push(card);
    G.market.row[marketIndex] = G.market.deck.shift() ?? null;
    Mechanics.log(G, `P${Number(playerId) + 1} recruited ${card.name}`);
    return true;
  },

  // -- map mutations come once we wire occupancy into TyrantsState --
  // deployTroop, assassinateTroop, moveTroop, placeSpy, returnTroop, returnSpy,
  // supplant, recomputeSiteControl
};

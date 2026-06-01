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

  /** Mark that hidden information just became visible (a card drawn, the
   *  market refilled, the top of a deck looked at). This is a one-way door
   *  for the within-turn undo: it wipes the undo stack so the player can't
   *  rewind back across the reveal and re-draw into different cards. */
  markInfoRevealed(G: TyrantsState) {
    if (G.undoStack && G.undoStack.length > 0) G.undoStack = [];
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
        // Reshuffle + draw exposes hidden card order — close the undo door.
        Mechanics.markInfoRevealed(G);
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
      if (c) {
        // A card moving from the (face-down) deck into hand is new information.
        Mechanics.markInfoRevealed(G);
        pl.hand.push(c);
      }
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
    // NOTE: this used to defensively splice `cardsPlayedThisTurn` by the
    // first entry matching deck+slot. That was wrong for any promote whose
    // source ISN'T the play area (Matron Mother / Necromancer promote-from-
    // discard, promote-from-hand, promote-top-of-deck): with duplicate
    // cards (Nobles, Soldiers, House Guards) it evicted a *different* same-
    // type card the player actually played this turn, so the end-of-turn
    // "promote a card played this turn" prompt could no longer target it
    // (#59). Removal from the played list is now the caller's job — the EOT
    // path splices by exact index, and promoteSelf removes its own entry.
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
    // Track the devoured card so cards that interact with the pile (Ghost
    // — "treat the top of devoured as if in market") can reference it.
    // turn.onBegin backfills the field on legacy saves.
    if (!G.devouredPile) G.devouredPile = [];
    G.devouredPile.push(card);
  },

  recruitFromMarket(G: TyrantsState, playerId: string, marketIndex: number): boolean {
    const card = G.market.row[marketIndex];
    if (!card) return false;
    p(G, playerId).discard.push(card);
    const refill = G.market.deck.shift() ?? null;
    // Refilling the row from the face-down market deck reveals a new card to
    // everyone — recruiting from the market is therefore not undoable.
    if (refill) Mechanics.markInfoRevealed(G);
    G.market.row[marketIndex] = refill;
    Mechanics.log(G, `P${Number(playerId) + 1} recruited ${card.name}`);
    return true;
  },

  /** Recruit from a permanent aux stack (House Guards or Priestesses). The
   *  stack must have a card remaining; the resource cost is checked + spent
   *  by the caller (the move handler in game.ts). Returns false if the
   *  stack is empty. */
  recruitFromAuxStack(
    G: TyrantsState, playerId: string,
    stack: 'houseGuards' | 'priestesses',
    card: { deck: string; slot: number; name: string; image: string },
  ): boolean {
    if (G.auxStacks[stack] <= 0) return false;
    p(G, playerId).discard.push(card);
    G.auxStacks[stack] -= 1;
    Mechanics.log(G, `P${Number(playerId) + 1} recruited ${card.name} (${G.auxStacks[stack]} left in stack)`);
    return true;
  },

  // -- map mutations come once we wire occupancy into TyrantsState --
  // deployTroop, assassinateTroop, moveTroop, placeSpy, returnTroop, returnSpy,
  // supplant, recomputeSiteControl
};

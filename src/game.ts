import type { Game } from 'boardgame.io';
import { INVALID_MOVE } from 'boardgame.io/core';
import './engine/handlers'; // register handlers
import { CardRegistry } from './engine/registry';
import { Mechanics } from './engine/mechanics';
import { lookupCard, cardsInDeck } from './card-data';
import type { EffectContext, PendingChoice } from './engine/types';
import { SITES } from './data/sites';
import { TROOP_SPACES, sitesSpaces } from './data/troop-spaces';
import { ROUTES } from './data/routes';
import { deployTroop, assassinateTroop, hasPresence, returnSpy, hasTotalControl } from './engine/map-state';

export type Color = 'black' | 'red' | 'orange' | 'blue';

export interface CardRef {
  deck: string;
  slot: number;
  name: string;
  image: string;
}

export interface PlayerData {
  color: Color;
  deck: CardRef[];
  hand: CardRef[];
  discard: CardRef[];
  innerCircle: CardRef[];
  /** Per-color count of captured tokens. Orcus moves specific colored tokens out,
   *  so we keep the source color around (we don't aggregate non-white into one
   *  "enemy" bucket). Black Dragon's scoring rider reads `.white`. */
  trophyHall: Record<Color | 'white', number>;
  /** Troops remaining in your barracks (start 40, rulebook p.2). When 0, deploys give 1 VP. */
  barracksLeft: number;
  power: number;
  influence: number;
  vp: number;
}

export function totalTrophies(p: PlayerData): number {
  return Object.values(p.trophyHall).reduce((s, n) => s + n, 0);
}

/** Sum of all non-white (i.e. opponent-color) trophies. */
export function enemyTrophies(p: PlayerData): number {
  let s = 0;
  for (const [c, n] of Object.entries(p.trophyHall)) if (c !== 'white') s += n;
  return s;
}

/** Increment the trophy hall slot for `color` (or 'white'). */
export function addTrophy(p: PlayerData, color: Color | 'white'): void {
  p.trophyHall[color] = (p.trophyHall[color] ?? 0) + 1;
}

export interface ControlMarker {
  siteId: string;
  /** Color currently holding the marker, or null if on the board. */
  holder: Color | null;
  /** Side facing up: 'control' (basic) or 'total-control' (when player has total control). */
  side: 'control' | 'total-control';
  /** VP per turn for the 'control' side. Per-marker values vary on the printed markers; we
   *  use a default of 1 until per-site values are loaded. */
  controlVp: number;
  /** VP per turn for the 'total-control' side. Default 2; refine when we have real values. */
  totalControlVp: number;
}

export interface TyrantsState {
  market: {
    deck: CardRef[];
    row: (CardRef | null)[];
  };
  players: Record<string, PlayerData>;
  log: string[];
  /** Set while an effect is awaiting a player/AI choice. */
  pendingChoice: (PendingChoice & { playerId: string; cardKey: string }) | null;
  /** Opaque per-card state preserved across resumptions of the same effect. */
  pausedHandlerState: unknown;

  // -- Map state --
  /** What occupies each troop space. null = empty. */
  troops: Record<string, Color | 'white' | null>;
  /** Spies present at each site (by player color). */
  spies: Record<string, Color[]>;
  /** Current controller of each site (recomputed by Mechanics on mutation). */
  siteControl: Record<string, Color | null>;
  /** Site-control markers (rulebook p.11). */
  controlMarkers: Record<string, ControlMarker>;

  /** True while players are picking their starting-site deploys (rulebook p.4 step 11). */
  setupPhase: boolean;

  /** Per-turn tally of card aspects played by the current player. Reset each turn.
   *  Used by the Focus keyword to detect "another card of this aspect this turn." */
  turnAspectsPlayed: Record<string, number>;

  /** Cards played by the current player this turn (in order). Reset each turn.
   *  Used by end-of-turn promote-a-played-card effects. */
  cardsPlayedThisTurn: CardRef[];

  /** Log index marker for the start of the current turn. */
  turnLogStart: number;
  /** Captured per-turn log slices. Each entry is one completed turn. */
  turnLogs: Array<{ turn: number; playerId: string; color: Color; lines: string[] }>;
  /** Per-turn-start state snapshots (codec strings). One per turn since game start.
   *  Use loadState to rewind to any of these. */
  snapshots: Array<{ turn: number; playerId: string; color: Color; codec: string }>;

  /** Queue of end-of-turn "promote another card played this turn" effects. Each entry
   *  is the card that triggered the promotion (so the picker can exclude it from the
   *  eligible list). Drained during the endTurn prompt loop. */
  pendingEotPromotions: CardRef[];

  /** Turn number at which the end-game trigger fired (deploy-last-troop or market empty).
   *  The game ends at the end of the round containing this turn (rulebook p.14). */
  endGameTriggeredAtTurn: number | null;

  /** Set by deployStartingTroop before it calls events.endTurn(); read+cleared in onEnd
   *  to skip the regular turn-end cleanup (discard hand, redraw, site-VP gain). */
  _endingSetupTurn?: boolean;

  /** Player ID (as a string seat index) chosen at setup to act first. Drives
   *  turn.order.first; the human is always seated at "0" but doesn't necessarily
   *  go first. */
  firstPlayerId: string;

  /** Site IDs that are part of THIS game (rulebook p.5 player-count rules:
   *  2P uses only the center section, 3P uses center + one outer, 4P uses
   *  all three). Sites outside this set never appear in troops/siteControl
   *  /controlMarkers and should be hidden from the map render. */
  activeSites: string[];

  /** Which sections are in play this game ('left' | 'center' | 'right'). */
  activeSections: string[];
}

const COLORS: Color[] = ['black', 'red', 'orange', 'blue'];
const HAND_SIZE = 5;

function toCardRef(deck: string, slot: number): CardRef {
  const c = lookupCard(deck, slot);
  if (!c) throw new Error(`Unknown card ${deck}::${slot}`);
  return { deck, slot, name: c.name, image: c.image };
}

// Two of four half-decks make the market for a game (rulebook "first game" suggests Drow + Dragons).
// Each unique card in a half-deck appears in the market deck equal to its rarity.
function buildMarketDeck(rng: () => number, halfDecks: string[] = ['drow', 'dragons']): CardRef[] {
  const deck: CardRef[] = [];
  for (const half of halfDecks) {
    for (const c of cardsInDeck(half)) {
      for (let i = 0; i < c.rarity; i++) deck.push(toCardRef(half, c.slot));
    }
  }
  return shuffle(deck, rng);
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function startingDeck(): CardRef[] {
  // 7 Nobles + 3 Soldiers, per rulebook p.4.
  const starter = cardsInDeck('starter-1');
  const noble = starter.find(c => /noble/i.test(c.name));
  const soldier = starter.find(c => /soldier/i.test(c.name));
  if (!noble || !soldier) throw new Error('Starter deck missing Noble or Soldier');
  const nobleRef = toCardRef(noble.deck, noble.slot);
  const soldierRef = toCardRef(soldier.deck, soldier.slot);
  return [...Array(7).fill(nobleRef), ...Array(3).fill(soldierRef)];
}

/** Encode the game state to a base64 JSON codec string, excluding the snapshots
 *  field itself to keep the payload small and prevent recursion. */
function encodeSnapshot(G: TyrantsState): string {
  const snapshots = G.snapshots; // peel off
  (G as { snapshots?: unknown }).snapshots = undefined;
  // Also peel turnLogs to keep snapshots small; they can be regenerated by replay.
  const turnLogs = G.turnLogs;
  (G as { turnLogs?: unknown }).turnLogs = undefined;
  let result: string;
  try {
    const json = JSON.stringify(G);
    // btoa needs ASCII; encode UTF-8 first.
    result = btoa(unescape(encodeURIComponent(json)));
  } finally {
    G.snapshots = snapshots;
    G.turnLogs = turnLogs;
  }
  return result;
}

/** Decode a codec string back into a partial state object. Caller is responsible
 *  for assigning fields onto G under Immer. */
function decodeSnapshot(codec: string): Partial<TyrantsState> {
  const json = decodeURIComponent(escape(atob(codec.trim())));
  return JSON.parse(json) as Partial<TyrantsState>;
}

/** Trigger end-of-game when any player empties their barracks OR the market deck runs out. */
function checkEndGameTriggers(G: TyrantsState, ctx: { turn: number }) {
  if (G.endGameTriggeredAtTurn !== null) return;
  if (G.market.deck.length === 0 || Object.values(G.players).some(p => p.barracksLeft <= 0)) {
    G.endGameTriggeredAtTurn = ctx.turn;
    Mechanics.log(G, `End-of-game triggered (turn ${ctx.turn}). Round will finish.`);
  }
}

export const TyrantsGame: Game<TyrantsState> = {
  name: 'tyrants-of-the-underdark',

  // The game ends after the round containing the trigger turn finishes (rulebook p.14).
  // We compute the last turn number of that round and bail when ctx.turn exceeds it.
  endIf: ({ G, ctx }) => {
    if (G.endGameTriggeredAtTurn === null) return undefined;
    const N = ctx.numPlayers;
    const triggerRound = Math.floor((G.endGameTriggeredAtTurn - 1) / N);
    const lastTurnOfTriggerRound = (triggerRound + 1) * N;
    if (ctx.turn > lastTurnOfTriggerRound) {
      // scoreAll is imported lazily to avoid circular import
      return { ended: true };
    }
    return undefined;
  },

  setup: ({ ctx, random }, setupData?: { halfDecks?: string[]; activeSections?: Array<'left'|'center'|'right'> }) => {
    const rng = () => random!.Number();
    const halfDecks = setupData?.halfDecks?.length === 2 ? setupData.halfDecks : ['drow', 'dragons'];
    // Rulebook p.5: limit the board to the sections in play. 2P = center only,
    // 3P = center + one outer, 4P = all three. Headless sim default = all
    // three so existing tests/training corpus stays comparable.
    const activeSections: Set<string> = new Set(
      setupData?.activeSections && setupData.activeSections.length > 0
        ? setupData.activeSections
        : ['left', 'center', 'right']
    );
    const activeSiteSet = new Set(
      SITES.filter(s => activeSections.has(s.section)).map(s => s.id)
    );
    const activeRouteSet = new Set(
      ROUTES.filter(r => activeSiteSet.has(r.a) && activeSiteSet.has(r.b)).map(r => r.id)
    );
    const isActiveSpace = (ts: typeof TROOP_SPACES[number]): boolean => {
      if (ts.parentSite) return activeSiteSet.has(ts.parentSite);
      if (ts.parentRoute) return activeRouteSet.has(ts.parentRoute);
      return false;
    };
    const players: Record<string, PlayerData> = {};
    for (let i = 0; i < ctx.numPlayers; i++) {
      const deck = shuffle(startingDeck(), rng);
      const hand = deck.splice(0, HAND_SIZE);
      players[String(i)] = {
        color: COLORS[i],
        deck,
        hand,
        discard: [],
        innerCircle: [],
        trophyHall: { black: 0, red: 0, orange: 0, blue: 0, white: 0 },
        barracksLeft: 40,
        power: 0,
        influence: 0,
        vp: 0,
      };
    }
    const marketDeck = buildMarketDeck(rng, halfDecks);
    const row = marketDeck.splice(0, 6).map(c => c as CardRef | null);
    while (row.length < 6) row.push(null);

    // Initial map state. Only spaces in active sections get an entry — sites
    // and routes outside the player-count's allowed sections are absent from
    // G.troops entirely, so they never appear as valid targets for moves or
    // card effects.
    const troops: Record<string, Color | 'white' | null> = {};
    for (const ts of TROOP_SPACES) {
      if (!isActiveSpace(ts)) continue;
      troops[ts.id] = ts.startsWithWhite ? 'white' : null;
    }

    const controlMarkers: Record<string, ControlMarker> = {};
    for (const s of SITES) {
      if (!activeSiteSet.has(s.id)) continue;
      if (s.hasControlMarker) controlMarkers[s.id] = {
        siteId: s.id, holder: null, side: 'control',
        controlVp: 1, totalControlVp: 2,  // placeholder defaults; refine with per-marker values
      };
    }

    // Randomly choose who acts first. Re-log it so the player can see who
    // got the start in their game.
    const firstSeat = Math.floor(rng() * ctx.numPlayers);
    const startLog = `Game started. P${firstSeat + 1} (${COLORS[firstSeat]}) goes first.`;

    return {
      firstPlayerId: String(firstSeat),
      market: { deck: marketDeck, row },
      players,
      log: [startLog],
      pendingChoice: null,
      pausedHandlerState: null,
      troops,
      spies: {},
      siteControl: Object.fromEntries(SITES.filter(s => activeSiteSet.has(s.id)).map(s => [s.id, null])),
      activeSites: [...activeSiteSet],
      activeSections: [...activeSections],
      controlMarkers,
      setupPhase: true,
      turnAspectsPlayed: {},
      cardsPlayedThisTurn: [],
      pendingEotPromotions: [],
      turnLogStart: 0,
      turnLogs: [],
      snapshots: [],
      endGameTriggeredAtTurn: null,
    };
  },

  turn: {
    minMoves: 0,
    maxMoves: 50,
    // Randomize who acts first. The seat order beyond that is the default
    // sequential cycle (0 → 1 → ... → N-1 → 0). G.firstPlayerId is picked once
    // in setup and persists through the game.
    order: {
      first: ({ G, ctx }) => {
        const n = ctx.numPlayers;
        const idx = Number(G.firstPlayerId ?? '0');
        return Number.isFinite(idx) && idx >= 0 && idx < n ? idx : 0;
      },
      next: ({ ctx }) => (ctx.playOrderPos + 1) % ctx.numPlayers,
    },
    onBegin: ({ G, ctx }) => {
      // Mark where this turn's log lines begin so onEnd can slice them out.
      G.turnLogStart = G.log.length;
      G.log.push(`Turn: P${Number(ctx.currentPlayer) + 1} (${G.players[ctx.currentPlayer].color})`);
      G.cardsPlayedThisTurn = [];
      G.pendingEotPromotions = [];
      // Capture a snapshot of the game state at turn start (excluding the snapshots
      // field itself to prevent recursive bloat). loadState can rewind here.
      G.snapshots.push({
        turn: ctx.turn,
        playerId: ctx.currentPlayer,
        color: G.players[ctx.currentPlayer].color,
        codec: encodeSnapshot(G),
      });
    },
    onEnd: ({ G, ctx }) => {
      // Capture this turn's log slice for the per-turn summary modal. We do this for
      // every turn (including setup deploys) so the human can review what happened.
      const lines = G.log.slice(G.turnLogStart);
      G.turnLogs.push({
        turn: ctx.turn,
        playerId: ctx.currentPlayer,
        color: G.players[ctx.currentPlayer].color,
        lines,
      });

      // Setup deploys end the "turn" purely to advance the seat. They don't trigger the
      // rulebook's end-of-turn step — no hand discard, no redraw, no site-VP.
      if (G._endingSetupTurn) {
        G._endingSetupTurn = false;
        return;
      }
      const p = G.players[ctx.currentPlayer];
      // Rulebook p.11 end-of-turn step 1: CLAIM the control marker at any site
      // you control (if you don't already hold it). Once claimed, you keep it
      // even if you lose control later; only another player claiming it at the
      // end of THEIR turn moves it. This is why we don't update marker.holder
      // in recomputeSiteControl.
      const claimed: string[] = [];
      for (const m of Object.values(G.controlMarkers)) {
        if (G.siteControl[m.siteId] === p.color && m.holder !== p.color) {
          m.holder = p.color;
          claimed.push(m.siteId);
        }
      }
      if (claimed.length > 0) {
        Mechanics.log(G, `P${Number(ctx.currentPlayer) + 1} claimed control marker(s): ${claimed.join(', ')}`);
      }
      // Rulebook p.8 end-of-turn step 2: gain VP for site-control markers you hold.
      // Each marker flips to its total-control side if you currently have total control
      // of the site; otherwise its control side. Then add the appropriate VP.
      let siteVp = 0;
      const siteVpBreakdown: string[] = [];
      for (const m of Object.values(G.controlMarkers)) {
        if (m.holder !== p.color) continue;
        const tc = hasTotalControl(G, p.color, m.siteId);
        m.side = tc ? 'total-control' : 'control';
        const gained = tc ? m.totalControlVp : m.controlVp;
        siteVp += gained;
        siteVpBreakdown.push(`${m.siteId}${tc ? ' (TC)' : ''}: +${gained}`);
      }
      if (siteVp > 0) {
        p.vp += siteVp;
        Mechanics.log(G, `P${Number(ctx.currentPlayer) + 1} end-of-turn +${siteVp} VP from sites — ${siteVpBreakdown.join(', ')}`);
      }

      p.discard.push(...p.hand);
      p.hand = [];
      p.power = 0;
      p.influence = 0;
      G.turnAspectsPlayed = {};
      // Refill hand
      for (let i = 0; i < HAND_SIZE; i++) {
        if (p.deck.length === 0) {
          p.deck = shuffle(p.discard, () => Math.random()); // TODO: use ctx random; scaffold only
          p.discard = [];
        }
        if (p.deck.length === 0) break;
        p.hand.push(p.deck.shift()!);
      }
    },
  },

  moves: {
    deployStartingTroop: ({ G, ctx, events }, siteId: string) => {
      if (!G.setupPhase) return INVALID_MOVE;
      const pid = ctx.currentPlayer;
      const site = SITES.find(s => s.id === siteId);
      if (!site || !site.isStartingSite) return INVALID_MOVE;
      const space = sitesSpaces(siteId).find(sp => !G.troops[sp.id]);
      if (!space) return INVALID_MOVE;
      const player = G.players[pid];
      const color = player.color;
      if (!deployTroop(G, color, space.id)) return INVALID_MOVE;
      player.barracksLeft -= 1;
      Mechanics.log(G, `P${Number(pid) + 1} deployed starting troop at ${site.name}`);

      // Setup complete once everyone has placed one troop.
      const placed = Object.values(G.troops).filter(t => t && t !== 'white').length;
      if (placed >= ctx.numPlayers) {
        G.setupPhase = false;
        Mechanics.log(G, 'Setup complete — game begins.');
      }
      // Flag this turn-end as part of setup so onEnd skips its regular cleanup
      // (no hand-discard, no end-of-turn VP gain).
      G._endingSetupTurn = true;
      events.endTurn();
    },

    playCard: ({ G, ctx }, handIndex: number) => {
      if (G.setupPhase) return INVALID_MOVE;
      if (G.pendingChoice) return INVALID_MOVE;
      const pid = ctx.currentPlayer;
      const p = G.players[pid];
      const card = p.hand[handIndex];
      if (!card) return INVALID_MOVE;

      p.hand.splice(handIndex, 1);
      G.log.push(`P${Number(pid) + 1} played ${card.name}`);

      // Reset the per-card deploy trace; Gibbering Mouther etc. read this to find
      // every space they deployed to during resolution.
      (G as unknown as { _recentDeploySpaces?: string[] })._recentDeploySpaces = [];

      const cardData = lookupCard(card.deck, card.slot);
      // Tally the aspect BEFORE the handler runs so handlers can read the count for Focus.
      if (cardData?.aspect) {
        const key = cardData.aspect.toLowerCase();
        G.turnAspectsPlayed[key] = (G.turnAspectsPlayed[key] ?? 0) + 1;
      }
      const effectKey = cardData?.effectKey ?? '';
      const handler = effectKey ? CardRegistry.get(effectKey) : undefined;

      if (!handler) {
        // No handler yet — drop the card to discard with no effect.
        p.discard.push(card);
        return;
      }

      const ctx2: EffectContext = {
        card,
        actorId: pid,
        G,
        pendingChoice: null,
        paused: false,
        handlerState: null,
      };
      const done = handler(ctx2);
      if (!done && ctx2.pendingChoice) {
        G.pendingChoice = { ...ctx2.pendingChoice, playerId: pid, cardKey: `${card.deck}::${card.slot}` };
        G.pausedHandlerState = ctx2.handlerState;
        p.discard.push(card);
        G.cardsPlayedThisTurn.push(card);
        return;
      }

      // Effect completed. Honor self-eject for Insane Outcast.
      const returnedToSupply = (ctx2.handlerState as { returnedToSupply?: boolean } | null)?.returnedToSupply;
      if (!returnedToSupply) {
        p.discard.push(card);
        G.cardsPlayedThisTurn.push(card);
      }
    },

    resolveChoice: ({ G, ctx, events }, response: unknown) => {
      if (!G.pendingChoice) return INVALID_MOVE;
      const pc = G.pendingChoice;

      // Special handling for the end-of-turn promote-played-card loop. Not tied to a card
      // handler — we promote directly and re-issue the prompt if more remain.
      if (pc.cardKey === '__eot__') {
        const idx = response as number | null;
        G.pendingChoice = null;
        if (idx != null) {
          const playerId = pc.playerId;
          const card = G.cardsPlayedThisTurn[idx];
          if (card) {
            const di = G.players[playerId].discard.findIndex(
              c => c.deck === card.deck && c.slot === card.slot
            );
            if (di >= 0) G.players[playerId].discard.splice(di, 1);
            Mechanics.promote(G, playerId, card);
            G.cardsPlayedThisTurn.splice(idx, 1);
          }
        }
        // Consume the trigger we were responding to.
        G.pendingEotPromotions.shift();
        // Skip any subsequent triggers that have no other cards to promote.
        while (G.pendingEotPromotions.length > 0) {
          const t = G.pendingEotPromotions[0];
          const eli = G.cardsPlayedThisTurn.filter(c => !(c.deck === t.deck && c.slot === t.slot));
          if (eli.length > 0) break;
          G.pendingEotPromotions.shift();
        }
        if (G.pendingEotPromotions.length > 0) {
          const t = G.pendingEotPromotions[0];
          const eligible = G.cardsPlayedThisTurn
            .map((c, i) => ({ c, i }))
            .filter(({ c }) => !(c.deck === t.deck && c.slot === t.slot))
            .map(({ i }) => i);
          G.pendingChoice = {
            kind: 'select-played-card',
            prompt: `End of turn — promote another card played this turn (triggered by ${t.name}; ${G.pendingEotPromotions.length} remaining).`,
            options: eligible,
            optional: true,
            playerId: pc.playerId,
            cardKey: '__eot__',
          };
          return;
        }
        events.endTurn();
        return;
      }

      // Look up the card by cardKey from the player's discard (we stashed it there).
      const p = G.players[pc.playerId];
      const cardIdx = p.discard.findIndex(c => `${c.deck}::${c.slot}` === pc.cardKey);
      const card = p.discard[cardIdx];
      if (!card) { G.pendingChoice = null; return; }

      const data = lookupCard(card.deck, card.slot);
      const handler = data ? CardRegistry.get(data.effectKey) : undefined;
      if (!handler) { G.pendingChoice = null; return; }

      const ctx2: EffectContext = {
        card, actorId: pc.playerId, G,
        pendingChoice: { ...pc, response },
        paused: true,
        handlerState: G.pausedHandlerState,
      };
      const done = handler(ctx2);
      if (!done) {
        G.pendingChoice = ctx2.pendingChoice ? { ...ctx2.pendingChoice, playerId: pc.playerId, cardKey: pc.cardKey } : null;
        G.pausedHandlerState = ctx2.handlerState;
        return;
      }

      G.pendingChoice = null;
      G.pausedHandlerState = null;
      const returnedToSupply = (ctx2.handlerState as { returnedToSupply?: boolean } | null)?.returnedToSupply;
      if (returnedToSupply) {
        p.discard.splice(cardIdx, 1);
        // Also remove from cardsPlayedThisTurn so end-of-turn promote prompts
        // don't list a card that has left play entirely.
        const playedIdx = G.cardsPlayedThisTurn.findIndex(
          c => c.deck === card.deck && c.slot === card.slot
        );
        if (playedIdx >= 0) G.cardsPlayedThisTurn.splice(playedIdx, 1);
      }
      // suppress unused-var noise
      void ctx;
    },

    recruitFromMarket: ({ G, ctx }, marketIndex: number) => {
      if (G.setupPhase) return INVALID_MOVE;
      if (G.pendingChoice) return INVALID_MOVE;
      const pid = ctx.currentPlayer;
      const card = G.market.row[marketIndex];
      if (!card) return INVALID_MOVE;
      const data = lookupCard(card.deck, card.slot);
      const cost = data?.cost ?? 999;
      if (!Mechanics.expendInfluence(G, pid, cost)) return INVALID_MOVE;
      if (!Mechanics.recruitFromMarket(G, pid, marketIndex)) {
        Mechanics.gainInfluence(G, pid, cost);
        return INVALID_MOVE;
      }
      checkEndGameTriggers(G, ctx);
    },

    deployTroop: ({ G, ctx }, spaceId: string) => {
      if (G.setupPhase) return INVALID_MOVE;
      if (G.pendingChoice) return INVALID_MOVE;
      const pid = ctx.currentPlayer;
      const p = G.players[pid];
      const color = p.color;
      const hasMapPresence = SITES.some(s => hasPresence(G, color, { site: s.id }));
      const targetSpace = TROOP_SPACES.find(t => t.id === spaceId);
      if (!targetSpace) return INVALID_MOVE;
      const targetSite = targetSpace.parentSite;
      const presenceOk = !hasMapPresence || (targetSite ? hasPresence(G, color, { site: targetSite }) : hasPresence(G, color, { space: spaceId }));
      if (!presenceOk) return INVALID_MOVE;

      if (!Mechanics.expendPower(G, pid, 1)) return INVALID_MOVE;
      // Rulebook p.12: if barracks is empty, deploy converts to +1 VP.
      if (p.barracksLeft <= 0) {
        Mechanics.gainVpTokens(G, pid, 1);
        Mechanics.log(G, `P${Number(pid) + 1} barracks empty — deploy converted to +1 VP`);
        return;
      }
      if (!deployTroop(G, color, spaceId)) {
        Mechanics.gainPower(G, pid, 1);
        return INVALID_MOVE;
      }
      p.barracksLeft -= 1;
      Mechanics.log(G, `P${Number(pid) + 1} deployed at ${spaceId} (barracks: ${p.barracksLeft})`);
      checkEndGameTriggers(G, ctx);
    },

    assassinateTroop: ({ G, ctx }, spaceId: string) => {
      if (G.setupPhase) return INVALID_MOVE;
      if (G.pendingChoice) return INVALID_MOVE;
      const pid = ctx.currentPlayer;
      const p = G.players[pid];
      const color = p.color;
      const target = TROOP_SPACES.find(t => t.id === spaceId);
      if (!target) return INVALID_MOVE;
      const enemy = G.troops[spaceId];
      if (!enemy || enemy === color) return INVALID_MOVE;
      const presenceOk = hasPresence(G, color, { site: target.parentSite, space: target.parentRoute ? spaceId : undefined });
      if (!presenceOk) return INVALID_MOVE;

      if (!Mechanics.expendPower(G, pid, 3)) return INVALID_MOVE;
      const killed = assassinateTroop(G, spaceId);
      if (killed === 'white') p.trophyHall.white += 1;
      else if (killed) p.trophyHall[killed] = (p.trophyHall[killed] ?? 0) + 1;
      Mechanics.log(G, `P${Number(pid) + 1} assassinated ${killed} at ${spaceId}`);
    },

    returnEnemySpy: ({ G, ctx }, siteId: string, targetColor: Color) => {
      if (G.setupPhase) return INVALID_MOVE;
      if (G.pendingChoice) return INVALID_MOVE;
      const pid = ctx.currentPlayer;
      const p = G.players[pid];
      if (p.color === targetColor) return INVALID_MOVE;
      if (!hasPresence(G, p.color, { site: siteId })) return INVALID_MOVE;
      if (!(G.spies[siteId] ?? []).includes(targetColor)) return INVALID_MOVE;
      if (!Mechanics.expendPower(G, pid, 3)) return INVALID_MOVE;
      returnSpy(G, targetColor, siteId);
      Mechanics.log(G, `P${Number(pid) + 1} returned ${targetColor} spy from ${siteId}`);
    },

    /** Rewind to a previously captured snapshot. The codec string is whatever the
     *  Game Log tab's "Copy codec" produced. We restore every field except
     *  `snapshots` and `turnLogs` so the history list remains visible. */
    loadState: ({ G }, codec: string) => {
      let parsed: Partial<TyrantsState>;
      try {
        parsed = decodeSnapshot(codec);
      } catch {
        return INVALID_MOVE;
      }
      const keep = { snapshots: G.snapshots, turnLogs: G.turnLogs };
      // Clear out the current state, then assign decoded.
      for (const key of Object.keys(G)) {
        if (key === 'snapshots' || key === 'turnLogs') continue;
        delete (G as unknown as Record<string, unknown>)[key];
      }
      for (const [key, value] of Object.entries(parsed)) {
        if (key === 'snapshots' || key === 'turnLogs') continue;
        (G as unknown as Record<string, unknown>)[key] = value;
      }
      G.snapshots = keep.snapshots;
      G.turnLogs = keep.turnLogs;
      G.log.push('[state loaded from codec]');
    },

    endTurn: ({ G, ctx, events }) => {
      if (G.setupPhase) return INVALID_MOVE;
      if (G.pendingChoice) return INVALID_MOVE;
      // If end-of-turn promotions are queued, surface a picker over cards played this turn
      // before actually ending the turn. resolveChoice handles the special '__eot__' kind.
      if (G.pendingEotPromotions.length > 0) {
        const trigger = G.pendingEotPromotions[0];
        const eligible = G.cardsPlayedThisTurn
          .map((c, i) => ({ c, i }))
          .filter(({ c }) => !(c.deck === trigger.deck && c.slot === trigger.slot))
          .map(({ i }) => i);
        if (eligible.length === 0) {
          // No other card to promote — drop this trigger and try the next or finish.
          G.pendingEotPromotions.shift();
          // Recurse via a fresh endTurn cycle: just try again right away.
          // (No infinite loop risk — queue strictly shrinks each iteration.)
          while (G.pendingEotPromotions.length > 0) {
            const t = G.pendingEotPromotions[0];
            const eli = G.cardsPlayedThisTurn.filter(c => !(c.deck === t.deck && c.slot === t.slot));
            if (eli.length > 0) break;
            G.pendingEotPromotions.shift();
          }
          if (G.pendingEotPromotions.length === 0) { events.endTurn(); return; }
        }
        const trigger2 = G.pendingEotPromotions[0];
        const eligible2 = G.cardsPlayedThisTurn
          .map((c, i) => ({ c, i }))
          .filter(({ c }) => !(c.deck === trigger2.deck && c.slot === trigger2.slot))
          .map(({ i }) => i);
        G.pendingChoice = {
          kind: 'select-played-card',
          prompt: `End of turn — promote another card played this turn (triggered by ${trigger2.name}; ${G.pendingEotPromotions.length} remaining).`,
          options: eligible2,
          optional: true,
          playerId: ctx.currentPlayer,
          cardKey: '__eot__',
        };
        return;
      }
      events.endTurn();
    },
  },
};

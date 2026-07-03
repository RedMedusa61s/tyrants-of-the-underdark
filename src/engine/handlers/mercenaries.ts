import { grant, sequence, registerAll, chooseOne, times,
         assassinateChoice, deployChoice, supplantChoice,
         moveEnemyTroopChoice, returnOwnSpyChoice,
         placeSpyAtChosenSite, returnEnemyTroopChoice,
         playerHasOwnSpy, playerCanAssassinate, 
         takeTrophyAndPlace, ensureSpiesLeftInitialized} from '../handler-helpers';
import { Mechanics } from '../mechanics';
import type { EffectContext, EffectHandler, PendingChoice } from '../types';
import { sitesSpaces, TROOP_SPACES } from '../../data/troop-spaces';
import { ROUTES } from '../../data/routes';
import { SITES } from '../../data/sites';
import { assassinateTroop, moveTroop, hasPresence,
         placeSpy, returnSpy, hasTotalControl,
         siteOf, recomputeSiteControl } from '../map-state';
import { CardRegistry } from '../registry';
import type { Color, CardRef } from '../../game';
import { lookupCard } from '../../card-data';


// ===========================================================================
// Mercenaries Registry Table
// ===========================================================================

registerAll({
  // --- Slots 1, 2, 3, 4: Goblinoid Ambushers (Cost 2) ---
  // "Choose one: +1 Influence OR Steal 1 VP OR Bribe -> +3 Power"
  'goblinoid-ambushers': chooseOne(
                           { label: '+1 Influence',       handler: grant({ influence: 1 }) },
                           { label: 'Steal 1 VP',          handler: stealVpChoice({ count: 1 }) },
                           { label: 'Bribe -> +3 Power',  handler: bribeCost(grant({ power: 3 })) }),

  // --- Slots 5, 6: Hobgoblin Warlord (Cost 5) ---
  // "+3 Influence. Bribe -> For the rest of your turn, you can expend 2 Power to assassinate a troop."
  // Approximated as a direct bonus choice effect action when paid.
  // TODO: Fix bribe so that it reduces assassination cost until eot.
  'hobgoblin-warlord':   sequence(
                           grant({ influence: 3 }),
                           bribeCost(reduceAssassinateCostToTwo)
                          ),

  // --- Slots 7, 8, 9: Dragonborn Hireling (Cost 4) ---
  // "Assassinate a troop. Then, if you have 3 or more player troops in your trophy hall, gain 1 VP."
  'dragonborn-hireling': sequence(
                           assassinateChoice({ count: 1 }),
                           (ctx => {
                             const me = ctx.G.players[ctx.actorId];
                             let playerTrophies = 0;
                             for (const [color, count] of Object.entries(me.trophyHall)) {
                               if (color !== 'white') playerTrophies += count;
                             }
                             if (playerTrophies >= 3) {
                               me.vp += 1;
                               Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} +1 VP from Dragonborn Hireling (3+ player trophies)`);
                             }
                             return true;
                           })),

  // --- Slot 10: Artemis Entreri (Cost 8) ---
  // "Assassinate 3 troops at a single site. Then, if that site is empty, gain 1 VP."
  'artemis-entreri':     sequence(
                           assassinateChoice({ count: 3, sameSite: true }),
                           (ctx => {
                             const siteId = (ctx.G as unknown as { _lastPlacedSpySite?: string })._lastPlacedSpySite; 
                             if (siteId) {
                               const hasTroops = sitesSpaces(siteId).some(sp => ctx.G.troops[sp.id] !== null);
                               if (!hasTroops) {
                                 ctx.G.players[ctx.actorId].vp += 1;
                                 Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} +1 VP from Artemis Entreri (Site ${siteId} cleared)`);
                               }
                             }
                             return true;
                           })),

  // --- Slots 11, 12: Goblin Swarm (Cost 1) ---
  // "Deploy a troop. Bribe -> Deploy 2 troops."
  'goblin-swarm':        sequence(
                           deployChoice({ count: 1 }),
                           bribeCost(deployChoice({ count: 2 }))),

  // --- Slots 13, 14, 15: Bugbear (Cost 4) ---
  // "Deploy a troop. Assassinate a white troop. Gain 1 VP."
  'bugbear':             sequence(
                           deployChoice({ count: 1 }),
                           assassinateChoice({ count: 1, whiteOnly: true }),
                           ctx => { ctx.G.players[ctx.actorId].vp += 1; return true; }),

  // --- Slots 16, 17: Security Guard (Cost 4) ---
  // "Deploy 2 troops, then steal 1 VP from each opponent with a troop adjacent to at least 1 of them."
  'security-guard':      securityGuardHandler,

  // --- Slots 18, 19: Bregan D'aerthe Agents (Cost 5) ---
  // "Choose 3 times: Take a white troop from any trophy hall and deploy it OR Bribe -> Supplant a white troop."
  'bregan-daerthe-agents': times(3, chooseOne(
                             { label: 'Take white trophy and deploy',   handler: takeTrophyAndPlace({ count: 1, whiteOnly: true, restrictToPresence: true })},
                             { label: 'Bribe -> Supplant a white troop', handler: bribeCost(supplantChoice({ whiteOnly: true })) })),

  // --- Slot 20: Nihiloor (Cost 7) ---
  // "Deploy 3 troops. Bribe -> Move the deployed troops. Assassinate a white troop adjacent to each one."
  'nihiloor':            nihiloorHandler,

  // --- Slots 21, 22, 23: Goblin Thief (Cost 3) ---
  // "Place a spy, then steal 1 VP from an opponent with at least a troop at that spy's site."
  'goblin-thief':        sequence(
                           placeSpyAtChosenSite(),
                           ctx => {
                             const siteId = (ctx.G as unknown as { _lastPlacedSpySite?: string })._lastPlacedSpySite;
                             if (!siteId) return true;
                             
                             const occupants = new Set<string>();
                             for (const sp of sitesSpaces(siteId)) {
                               const color = ctx.G.troops[sp.id];
                               if (color && color !== 'white' && color !== ctx.G.players[ctx.actorId].color) {
                                 const opponentPid = Object.keys(ctx.G.players).find(id => ctx.G.players[id].color === color);
                                 if (opponentPid) occupants.add(opponentPid);
                               }
                             }
                             
                             if (occupants.size > 0) {
                               return stealVpChoice({ count: 1, targetPid: [...occupants][0] })(ctx);
                             }
                             return true;
                           }),

  // --- Slots 24, 25, 26: Bazaar Trader (Cost 5) ---
  // "Choose one: Discard a card -> Gain 1 VP and draw a card OR Bribe -> Place a spy and draw 2 cards OR Return one of your spies -> Steal 3 VP."
  'bazaar-trader':       chooseOne(
                           { label: 'Discard -> Gain 1 VP and draw',
                             handler: ctx => {
                               if (!ctx.pendingChoice) {
                                 ctx.pendingChoice = { kind: 'select-card-in-hand', prompt: 'Bazaar Trader: Discard a card to gain 1 VP and draw 1.', optional: false } as PendingChoice;
                                 ctx.paused = true; return false;
                               }
                               const idx = ctx.pendingChoice.response as number | null;
                               ctx.pendingChoice = null; ctx.paused = false;
                               if (idx != null) {
                                 const card = ctx.G.players[ctx.actorId].hand[idx];
                                 if (!Mechanics.trySylgarReact(ctx.G, ctx.actorId, card)) {
                                  ctx.G.players[ctx.actorId].hand.splice(idx, 1);
                                  ctx.G.players[ctx.actorId].discard.push(card);
                                 }
                                 ctx.G.players[ctx.actorId].vp += 1;
                                 Mechanics.draw(ctx.G, ctx.actorId, 1, ctx.random);
                               }
                               return true;
                             },
                             // Gated check: only available if actor has cards to discard
                             available: (G, a) => G.players[a].hand.length > 0
                           },
                           { label: 'Bribe -> Place spy and draw 2', handler: bribeCost(sequence(placeSpyAtChosenSite(), grant({ draw: 2 }))) },
                           { label: 'Return spy -> Steal 3 VP',      handler: sequence(returnOwnSpyChoice(), stealVpChoice({ count: 3 })), available: playerHasOwnSpy }),

  // --- Slots 27, 28: Bregan D'aerthe Spy (Cost 3) ---
  // "Choose one: Place a spy OR Return one of your spies -> Steal that spy's site control marker."
  // * Implemented
  // TODO: Check
  'bregan-daerthe-spy':  chooseOne(
                           { label: 'Place a spy', handler: placeSpyAtChosenSite() },
                           { label: 'Return a spy -> Claim site control marker',
                             handler: stealControlMarkerChoice(),
                             available: playerHasOwnSpy
                           }),

  // --- Slot 29: Nar'l Xibrindas (Cost 4) ---
  // "Choose one: Place a spy OR Return one of your spies -> Choose a card in the discard pile of an opponent at that site. Swap this card with it."
  'narl-xibrindas':      chooseOne(
                           { label: 'Place a spy', handler: placeSpyAtChosenSite() },
                           { label: 'Return a spy -> Swap with opponent discard card',
                             handler: sequence(
                               returnOwnSpyChoice(),
                               ctx => {
                                 const siteId = (ctx.G as unknown as { _lastReturnedSpySite?: string })._lastReturnedSpySite;
                                 if (!siteId) return true;
                                 
                                 const opponentsAtSite = new Set<string>();
                                 for (const sp of sitesSpaces(siteId)) {
                                   const color = ctx.G.troops[sp.id];
                                   if (color && color !== 'white' && color !== ctx.G.players[ctx.actorId].color) {
                                     const pid = Object.keys(ctx.G.players).find(id => ctx.G.players[id].color === color);
                                     if (pid && ctx.G.players[pid].discard.length > 0) opponentsAtSite.add(pid);
                                   }
                                 }
                                 
                                 if (opponentsAtSite.size === 0) return true;

                                 if (!ctx.pendingChoice) {
                                   ctx.pendingChoice = {
                                     kind: 'select-player',
                                     prompt: 'Nar\'l Xibrindas: Choose an opponent at the site to swap discard cards with:',
                                     options: [...opponentsAtSite],
                                   } as PendingChoice;
                                   ctx.paused = true; return false;
                                 }

                                 const targetPid = ctx.pendingChoice.response as string | null;
                                 ctx.pendingChoice = null; ctx.paused = false;
                                 
                                 if (targetPid && ctx.G.players[targetPid].discard.length > 0) {
                                  const oppCard = ctx.G.players[targetPid].discard.pop()!;
                                  const myCard = ctx.G.players[ctx.actorId].discard.pop()!;
                                  ctx.G.players[ctx.actorId].discard.push(oppCard);
                                  ctx.G.players[targetPid].discard.push(myCard);
                                  Mechanics.log(ctx.G, `Nar'l Xibrindas swapped cards between P${Number(ctx.actorId) + 1} and P${Number(targetPid) + 1} discard piles.`);
                                 }
                                 return true;
                               }
                             ),
                             available: playerHasOwnSpy
                           }),

  // --- Slot 30: Jarlaxle (Cost 6) ---
  // "Look at an opponent's hand. Bribe -> Copy that card's effect." (Simplified approximation)
  // * Implemented
  // TODO: Check
  'jarlaxle':            jarlaxleHandler,

  // --- Slots 31, 32, 33: Xanathar Smuggler (Cost 1) ---
  // "+1 Influence. Bribe -> At end of turn, promote another card played this turn."
  'xanathar-smuggler':   sequence(
                           grant({ influence: 1 }),
                           bribeCost(ctx => { ctx.G.pendingEotPromotions.push({ ...ctx.card, optional: true }); return true; })),

  // --- Slots 34, 35: Xanathar Surveillance (Cost 6) ---
  // "Draw 3 cards, then discard 2 of them. Bribe -> Promote one of the discarded cards."
  // * Implemented
  // TODO: Check
  'xanathar-surveillance': xanatharSurveillanceHandler,

  // --- Slots 36, 37: Shady Merchant (Cost 5) ---
  // "Return another player's troop and move a spy. Bribe -> Put another card played this turn on top of an opponent's deck."
  // TODO: Check
  'shady-merchant':      sequence(
                           returnEnemyTroopChoice(),
                           moveSpyChoice(),
                           bribeCost(grant({ influence: 2 }))),

  // --- Slot 38: Sylgar (Cost 1) ---
  // "If this is devoured, promoted or discarded by a card, put it back where it was and gain 1 VP."
  // * Implemented
  // TODO: Check
  'sylgar':              grant({ influence: 0 }), // Had to put something here.

  // --- Slot 39: Ahmaergo (Cost 5) ---
  // "Choose 2 times: Move one of your troops and gain 1 Power OR Bribe -> Swap 2 troops anywhere on the board."
  // * Implemented
  // TODO: Check
  'ahmaergo':            times(2, chooseOne(
                           { label: 'Move own troop and gain +1 Power', handler: sequence(grant({ power: 1 })) },
                           { label: 'Bribe -> Swap 2 troops anywhere',   handler: bribeCost(swapAnyTwoTroopsChoice()) })),

  // --- Slot 40: Xanathar Zushaxx (Cost 7) ---
  // "+4 Influence. For the rest of your turn, each time you recruit a card, steal 1 VP."
  // TODO: fix steal on recruit
  'xanathar-zushaxx':    sequence(
                           grant({ influence: 4 }),
                           stealVpChoice({ count: 1 })),
});

// ===========================================================================
// Core Mechanic Primitives: Steal & Bribe
// ===========================================================================

/**
 * Steal 1 VP from an eligible player (must have >= 1 VP) and add it to your pool.
 * If targetPid is omitted, surfaces a prompt for the actor to choose a victim.
 */
export function stealVpChoice(opts?: { count?: number; targetPid?: string }): EffectHandler {
  const count = opts?.count ?? 1;
  return (ctx: EffectContext) => {
    let state = (ctx.handlerState as { remaining: number; targetPid?: string } | null) ?? { remaining: count, targetPid: opts?.targetPid };
    const G = ctx.G;

    // Helper: Enumerate all opponents who actually have VP tokens to steal
    const getEligibleVictims = () => {
      return Object.keys(G.players).filter(pid => pid !== ctx.actorId && G.players[pid].vp >= 1);
    };

    if (ctx.pendingChoice) {
      const selectedPid = ctx.pendingChoice.response as string | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      if (!selectedPid) { ctx.handlerState = null; return true; }
      state = { remaining: state.remaining, targetPid: selectedPid };
    }

    if (state.remaining <= 0) { ctx.handlerState = null; return true; }

    // If no target is pre-locked, find eligible victims
    const victims = state.targetPid ? [state.targetPid] : getEligibleVictims();
    if (victims.length === 0) {
      Mechanics.log(G, `(Steal VP: No opponents have VP tokens to steal — skipped)`);
      ctx.handlerState = null;
      return true;
    }

    // Multi-victim branch: ask the actor to choose who to steal from
    if (victims.length > 1) {
      ctx.pendingChoice = {
        kind: 'select-player',
        prompt: `Steal 1 VP (${state.remaining} left) — Choose an opponent to take from:`,
        options: victims,
        optional: false,
      } as PendingChoice;
      ctx.paused = true;
      ctx.handlerState = state;
      return false;
    }

    // Execute the steal transaction against the isolated single target
    const targetId = victims[0];
    const targetPlayer = G.players[targetId];
    const actorPlayer = G.players[ctx.actorId];

    if (targetPlayer.vp >= 1) {
      targetPlayer.vp -= 1;
      actorPlayer.vp += 1;
      Mechanics.log(G, `P${Number(ctx.actorId) + 1} stole 1 VP from P${Number(targetId) + 1}`);
    }

    state = { remaining: state.remaining - 1, targetPid: opts?.targetPid };
    ctx.handlerState = state;
    return state.remaining <= 0;
  };
}

/**
 * Bribe gating wrapper: Optional action offering the player a choice to pay 
 * 1 VP to an opponent to unlock a powerful downstream follow-up effect handler.
 */
export function bribeCost(thenEffect: EffectHandler): EffectHandler {
  return (ctx: EffectContext) => {
    interface BribeState { paid?: boolean; childState?: unknown }
    let state = (ctx.handlerState as BribeState | null) ?? {};
    const G = ctx.G;

    if (!state.paid) {
      if (!ctx.pendingChoice) {
        const actorPlayer = G.players[ctx.actorId];
        // If you don't even have 1 VP to offer, the Bribe option is legally unavailable
        if (actorPlayer.vp < 1) {
          ctx.handlerState = null;
          return true;
        }

        const opponents = Object.keys(G.players).filter(pid => pid !== ctx.actorId);
        ctx.pendingChoice = {
          kind: 'choose-one',
          prompt: `Pay a Bribe? (Give 1 of your VPs to an opponent to unlock the bonus effect)`,
          options: [...opponents.map(pid => `Bribe P${Number(pid) + 1} (Give 1 VP)`), 'Decline Bribe'],
        } as PendingChoice;
        ctx.paused = true;
        return false;
      }

      const idx = ctx.pendingChoice.response as number | null;
      ctx.pendingChoice = null;
      ctx.paused = false;

      const opponents = Object.keys(G.players).filter(pid => pid !== ctx.actorId);
      if (idx == null || idx === opponents.length) {
        // Player chose 'Decline Bribe' or dismissed prompt
        ctx.handlerState = null;
        return true;
      }

      // Execute the Bribe payout transaction
      const targetId = opponents[idx];
      G.players[ctx.actorId].vp -= 1;
      G.players[targetId].vp += 1;
      Mechanics.log(G, `P${Number(ctx.actorId) + 1} paid a Bribe of 1 VP to P${Number(targetId) + 1}`);
      state = { paid: true, childState: null };
    }

    // Run the follow-up gated effect pass
    const childCtx = { ...ctx, pendingChoice: ctx.pendingChoice, handlerState: state.childState, paused: ctx.paused };
    const done = thenEffect(childCtx);
    if (!done) {
      ctx.pendingChoice = childCtx.pendingChoice;
      ctx.paused = true;
      ctx.handlerState = { paid: true, childState: childCtx.handlerState };
      return false;
    }

    ctx.handlerState = null;
    return true;
  };
}

/**
 * Reduces the base power cost of assassinating troops to 2 for the rest of the turn.
 */
export function reduceAssassinateCostToTwo(ctx: EffectContext): boolean {
  ctx.G.assassinateCostOverride = 2;
  Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} reduced their assassinate cost to 2 Power for the rest of the turn`);
  return true;
};

interface MoveOwnState { remaining: number; from: string | null }

/**
 * Move `count` of your own color troops.
 * Player can only pick a troop from a space where they have Presence.
 * Destination can be any empty space on the board.
 */
export function moveOwnTroopChoice(opts?: { count?: number; optional?: boolean }): EffectHandler {
  const count = opts?.count ?? 1;
  return (ctx: EffectContext) => {
    let state = (ctx.handlerState as MoveOwnState | null) ?? { remaining: count, from: null };
    const G = ctx.G;
    const me = G.players[ctx.actorId];
    const myColor = me.color;

    // 1. Process any pending response from a previous prompt session
    if (ctx.pendingChoice) {
      const picked = ctx.pendingChoice.response as string | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      
      if (state.from === null) {
        // Source selection step completed
        if (!picked) { ctx.handlerState = null; return true; }
        state = { remaining: state.remaining, from: picked };
      } else {
        // Destination selection step completed
        if (picked && moveTroop(G, state.from, picked)) {
          Mechanics.log(G, `P${Number(ctx.actorId) + 1} moved their own troop ${state.from} ↔ ${picked}`);
        }
        state = { remaining: state.remaining - 1, from: null };
      }
    }

    // 2. Evaluate remaining tasks
    if (state.remaining <= 0) { ctx.handlerState = null; return true; }

    if (state.from === null) {
      // Find spaces where you have a troop AND presence (presence check covers adjacent requirements)
      const eligible = TROOP_SPACES.filter(t => {
        if (!(t.id in G.troops)) return false;
        const occ = G.troops[t.id];
        if (occ !== myColor) return false;
        
        // Presence verification matches moveEnemyTroopChoice parameters
        if (t.parentSite) return hasPresence(G, myColor, { site: t.parentSite });
        if (t.parentRoute) return hasPresence(G, myColor, { space: t.id });
        return false;
      }).map(t => t.id);

      if (eligible.length === 0) {
        Mechanics.log(G, '(move own troop: you have no valid troops under presence conditions — skipped)');
        ctx.handlerState = null;
        return true;
      }

      ctx.pendingChoice = {
        kind: 'select-troop-space',
        prompt: `Move one of your troops — pick a source space (${state.remaining} left).`,
        options: eligible,
        optional: opts?.optional,
      } as PendingChoice;
    } else {
      // Destination lookup bounds: any empty active board slot anywhere on the board
      const empty = TROOP_SPACES.filter(t => t.id in G.troops && G.troops[t.id] === null).map(t => t.id);
      if (empty.length === 0) { ctx.handlerState = null; return true; }

      ctx.pendingChoice = {
        kind: 'select-troop-space',
        prompt: `Move your troop to which empty space?`,
        options: empty,
        optional: opts?.optional,
      } as PendingChoice;
    }

    ctx.paused = true;
    ctx.handlerState = state;
    return false;
  };
}

interface MoveSpyState {
  remaining: number;
  fromSite: string | null;
  spyColor: Color | null;
}

/**
 * Move a spy of any color from one site to another.
 * Three-phase pick: 
 * 1. Pick the origin site containing a spy.
 * 2. If multiple spies are there, pick which player's spy to move.
 * 3. Pick the destination site.
 */
export function moveSpyChoice(opts?: { count?: number; optional?: boolean }): EffectHandler {
  const count = opts?.count ?? 1;
  
  return ctx => {
    let state = (ctx.handlerState as MoveSpyState | null) ?? { remaining: count, fromSite: null, spyColor: null };

    // 1. Process any pending response from the previous prompt.
    if (ctx.pendingChoice) {
      const picked = ctx.pendingChoice.response;
      ctx.pendingChoice = null;
      ctx.paused = false;

      if (state.fromSite === null) {
        // Phase 1 Response: Was the "pick origin site" prompt.
        if (!picked) { ctx.handlerState = null; return true; }
        const siteId = picked as string;
        const spiesHere = ctx.G.spies[siteId] ?? [];
        
        // If there's only 1 spy, we can auto-select its color and skip Phase 2
        if (spiesHere.length === 1) {
          state = { ...state, fromSite: siteId, spyColor: spiesHere[0] };
        } else {
          state = { ...state, fromSite: siteId };
        }
      } else if (state.spyColor === null) {
        // Phase 2 Response: Was the "pick player/color" disambiguation prompt.
        if (!picked) { ctx.handlerState = null; return true; }
        const targetPid = picked as string;
        state = { ...state, spyColor: ctx.G.players[targetPid].color };
      } else {
        // Phase 3 Response: Was the "pick destination" prompt.
        if (picked) {
          const toSite = picked as string;
          // Return the spy, and if successful, attempt to place it at the new site
          if (returnSpy(ctx.G, state.spyColor, state.fromSite)) {
            if (placeSpy(ctx.G, state.spyColor, toSite)) {
              Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} moved ${state.spyColor} spy from ${state.fromSite} to ${toSite}`);
            } else {
              // Rollback if placement fails (e.g., they already have a spy at the destination)
              placeSpy(ctx.G, state.spyColor, state.fromSite);
            }
          }
        }
        state = { remaining: state.remaining - 1, fromSite: null, spyColor: null };
      }
    }

    // 2. Decide what to do next based on the state machine
    if (state.remaining <= 0) { ctx.handlerState = null; return true; }

    if (state.fromSite === null) {
      // Prompt 1: Pick starting site
      const eligible = SITES.filter(s => (ctx.G.spies[s.id] ?? []).length > 0).map(s => s.id);
      if (eligible.length === 0) {
        Mechanics.log(ctx.G, '(move spy: no spies on the board — skipped)');
        ctx.handlerState = null;
        return true;
      }
      ctx.pendingChoice = {
        kind: 'select-site',
        prompt: `Move a spy — pick the starting site (${state.remaining} left).`,
        options: eligible,
        optional: opts?.optional,
      } as PendingChoice;
    } else if (state.spyColor === null) {
      // Prompt 2: Disambiguate which spy to move (uses the existing player-picker UI)
      const spiesHere = ctx.G.spies[state.fromSite] ?? [];
      const options = Object.keys(ctx.G.players).filter(pid => spiesHere.includes(ctx.G.players[pid].color));
      
      ctx.pendingChoice = {
        kind: 'select-player',
        prompt: `Which spy do you want to move from ${state.fromSite}?`,
        options: options,
        optional: opts?.optional,
      } as PendingChoice;
    } else {
      // Prompt 3: Pick destination site
      // Rulebook: You cannot place a spy where you already have one
      const eligibleTo = SITES.filter(s => !(ctx.G.spies[s.id] ?? []).includes(state.spyColor!)).map(s => s.id);
      
      if (eligibleTo.length === 0) {
        Mechanics.log(ctx.G, `(move spy: no valid destination sites for ${state.spyColor} spy — skipped)`);
        ctx.handlerState = null;
        return true;
      }
      ctx.pendingChoice = {
        kind: 'select-site',
        prompt: `Move the ${state.spyColor} spy to which site?`,
        options: eligibleTo,
        optional: opts?.optional,
      } as PendingChoice;
    }
    
    ctx.paused = true;
    ctx.handlerState = state;
    return false;
  };
}

/**
 * Swap any 2 troops on the board.
 */
export function swapAnyTwoTroopsChoice(opts?: { optional?: boolean }): EffectHandler {
  return ctx => {
    interface SwapState { firstSpace: string | null }
    let state = (ctx.handlerState as SwapState | null) ?? { firstSpace: null };
    const G = ctx.G;

    // 1. Process response from a prompt
    if (ctx.pendingChoice) {
      const picked = ctx.pendingChoice.response as string | null;
      ctx.pendingChoice = null;
      ctx.paused = false;

      if (state.firstSpace === null) {
        // First selection complete
        if (!picked) { ctx.handlerState = null; return true; }
        state = { firstSpace: picked };
      } else {
        // Second selection complete
        if (picked) {
          const first = state.firstSpace;
          const second = picked;
          
          // Swap the troops
          const t1 = G.troops[first];
          const t2 = G.troops[second];
          G.troops[first] = t2;
          G.troops[second] = t1;

          // Recompute control for the affected sites
          const affected = new Set<string>();
          const s1 = siteOf(first); if (s1) affected.add(s1);
          const s2 = siteOf(second); if (s2) affected.add(s2);
          if (affected.size > 0) recomputeSiteControl(G, [...affected]);

          Mechanics.log(G, `P${Number(ctx.actorId) + 1} swapped the ${t1} troop at ${first} with the ${t2} troop at ${second}`);
        }
        ctx.handlerState = null;
        return true;
      }
    }

    // 2. Setup prompts
    if (state.firstSpace === null) {
      // Find all occupied spaces
      const eligible = TROOP_SPACES.filter(t => t.id in G.troops && G.troops[t.id] !== null).map(t => t.id);
      if (eligible.length < 2) {
        Mechanics.log(G, '(swap: not enough troops on board — skipped)');
        ctx.handlerState = null;
        return true;
      }
      ctx.pendingChoice = {
        kind: 'select-troop-space',
        prompt: 'Swap 2 troops — pick the first troop.',
        options: eligible,
        optional: opts?.optional,
      } as PendingChoice;
    } else {
      // Find all occupied spaces EXCEPT the one already picked
      const eligible = TROOP_SPACES.filter(t => t.id in G.troops && G.troops[t.id] !== null && t.id !== state.firstSpace).map(t => t.id);
      ctx.pendingChoice = {
        kind: 'select-troop-space',
        prompt: `Swap the ${G.troops[state.firstSpace]} troop with which other troop?`,
        options: eligible,
        optional: opts?.optional,
      } as PendingChoice;
    }

    ctx.paused = true;
    ctx.handlerState = state;
    return false;
  };
}

// ===========================================================================
// Custom Advanced Card Actions (Multi-stage evaluation)
// ===========================================================================

/**
 * Security Guard: Deploy 2 troops, then check adjacencies. Steals 1 VP from
 * EACH opponent who controls a troop adjacent to at least 1 of those deployments.
 */
export function securityGuardHandler(ctx: EffectContext): boolean {
  interface SGState { phase: 'deploy' | 'steal'; sub?: unknown; victims: string[] }
  let state = (ctx.handlerState as SGState | null) ?? { phase: 'deploy', sub: null, victims: [] };
  const G = ctx.G;

  if (state.phase === 'deploy') {
    const Gx = G as unknown as { _recentDeploySpaces?: string[] };
    Gx._recentDeploySpaces = [];

    const deployHandler = deployChoice({ count: 2 });
    const childCtx = { ...ctx, handlerState: state.sub ?? null, pendingChoice: ctx.pendingChoice, paused: ctx.paused };
    const done = deployHandler(childCtx);
    
    ctx.pendingChoice = childCtx.pendingChoice;
    ctx.paused = childCtx.paused;

    if (!done) {
      ctx.handlerState = { phase: 'deploy', sub: childCtx.handlerState, victims: [] };
      return false;
    }

    // Deployments completed — calculate adjacent opponent targets geometrically
    const deploys = Gx._recentDeploySpaces ?? [];
    const victimPids = new Set<string>();
    const myColor = G.players[ctx.actorId].color;

    // Helper closure to lookup adjacencies matching Gibbering Mouther parameters
    const getAdjacentSpaces = (spaceId: string) => {
      const s = TROOP_SPACES.find(t => t.id === spaceId);
      if (!s) return [];
      const out = new Set<string>();
      if (s.parentSite) {
        for (const t of TROOP_SPACES) if (t.parentSite === s.parentSite && t.id !== spaceId) out.add(t.id);
        for (const r of ROUTES) {
          if (r.a === s.parentSite || r.b === s.parentSite) {
            for (let i = 0; i < r.spaces; i++) out.add(`${r.id}:${i}`);
          }
        }
      } else if (s.parentRoute) {
        const r = ROUTES.find((rr: { id: any; }) => rr.id === s.parentRoute)!;
        for (let i = 0; i < r.spaces; i++) if (i !== s.index) out.add(`${r.id}:${i}`);
        for (const endpoint of [r.a, r.b]) {
          for (const t of TROOP_SPACES) if (t.parentSite === endpoint) out.add(t.id);
        }
      }
      return [...out];
    };

    for (const spaceId of deploys) {
      for (const adjSpace of getAdjacentSpaces(spaceId)) {
        const occColor = G.troops[adjSpace];
        if (occColor && occColor !== 'white' && occColor !== myColor) {
          const opponentPid = Object.keys(G.players).find(id => G.players[id].color === occColor);
          if (opponentPid && G.players[opponentPid].vp >= 1) {
            victimPids.add(opponentPid);
          }
        }
      }
    }

    state = { phase: 'steal', victims: [...victimPids], sub: null };
  }

  if (state.phase === 'steal') {
    while (state.victims.length > 0) {
      const nextVictim = state.victims[0];
      const stealHandler = stealVpChoice({ count: 1, targetPid: nextVictim });
      const childCtx = { ...ctx, handlerState: state.sub ?? null, pendingChoice: ctx.pendingChoice, paused: ctx.paused };
      const done = stealHandler(childCtx);

      ctx.pendingChoice = childCtx.pendingChoice;
      ctx.paused = childCtx.paused;

      if (!done) {
        ctx.handlerState = { phase: 'steal', victims: state.victims, sub: childCtx.handlerState };
        return false;
      }

      state.victims.shift();
      state.sub = null;
    }
  }

  ctx.handlerState = null;
  return true;
};

/**
 * Nihiloor: Deploy 3 troops. Then Bribe -> Move the deployed troops.
 * Finally, assassinate a white troop adjacent to each deployed troop position.
 */
export function nihiloorHandler(ctx: EffectContext): boolean {
  interface NState { phase: 'deploy' | 'bribe' | 'assassinate'; sub?: unknown; trackedDeplays: string[] }
  let state = (ctx.handlerState as NState | null) ?? { phase: 'deploy', sub: null, trackedDeplays: [] };
  const G = ctx.G;

  if (state.phase === 'deploy') {
    const Gx = G as unknown as { _recentDeploySpaces?: string[]; _playFizzledNoFood?: boolean };
    Gx._recentDeploySpaces = [];

    // --- PROTECT FROM PLAY-ALL BASIC AUTO-RUNS ---
    // If there are no empty deployment zones, force an engine-safe fizzle marker flag
    // to prevent the card from being automatically burned via "Play all basic"
    //const myColor = G.players[ctx.actorId].color;
    const emptyZoneCount = TROOP_SPACES.filter(t => t.id in G.troops && G.troops[t.id] === null).length;
    if (emptyZoneCount === 0 && !ctx.pendingChoice) {
      Gx._playFizzledNoFood = true;
      ctx.handlerState = null;
      Mechanics.log(G, `(Nihiloor: No empty board spaces available — skipped)`);
      return true;
    }

    const deployHandler = deployChoice({ count: 3 });
    const childCtx = { ...ctx, handlerState: state.sub ?? null, pendingChoice: ctx.pendingChoice, paused: ctx.paused };
    const done = deployHandler(childCtx);
    
    ctx.pendingChoice = childCtx.pendingChoice;
    ctx.paused = childCtx.paused;

    if (!done) {
      // FIX: Store the child context's specific handlerState without cloning parent onto itself
      ctx.handlerState = { phase: 'deploy', trackedDeplays: [], sub: childCtx.handlerState };
      return false;
    }
    state = { phase: 'bribe', trackedDeplays: Gx._recentDeploySpaces ?? [], sub: null };
  }

  if (state.phase === 'bribe') {
    const bribeAction = bribeCost(moveOwnTroopChoice({ count: state.trackedDeplays.length, optional: true }));
    const childCtx = { ...ctx, handlerState: state.sub ?? null, pendingChoice: ctx.pendingChoice, paused: ctx.paused };
    const done = bribeAction(childCtx);
    
    ctx.pendingChoice = childCtx.pendingChoice;
    ctx.paused = childCtx.paused;

    if (!done) {
      ctx.handlerState = { phase: 'bribe', trackedDeplays: state.trackedDeplays, sub: childCtx.handlerState };
      return false;
    }
    state = { phase: 'assassinate', trackedDeplays: state.trackedDeplays, sub: null };
  }

  if (state.phase === 'assassinate') {
    const getAdjacentWhiteTroops = (spaces: string[]) => {
      const targets = new Set<string>();
      const getAdjacencies = (id: string) => {
        const s = TROOP_SPACES.find(t => t.id === id);
        if (!s) return [];
        const out = new Set<string>();
        
        // Horizontal board space grid geometry calculation matching securityGuardHandler
        if (s.parentSite) {
          for (const t of TROOP_SPACES) if (t.parentSite === s.parentSite && t.id !== id) out.add(t.id);
        }
        return [...out];
      };
      for (const id of spaces) {
        for (const adj of getAdjacencies(id)) {
          if (G.troops[adj] === 'white') targets.add(adj);
        }
      }
      return [...targets];
    };

    const eligibleWhites = getAdjacentWhiteTroops(state.trackedDeplays);
    if (eligibleWhites.length === 0) {
      Mechanics.log(G, `(Nihiloor: No adjacent white troops available — skipped)`);
      ctx.handlerState = null;
      return true;
    }

    if (!ctx.pendingChoice) {
      ctx.pendingChoice = {
        kind: 'select-troop-space',
        prompt: 'Nihiloor: Assassinate a white troop adjacent to your deployments.',
        options: eligibleWhites,
        optional: true,
      } as PendingChoice;
      ctx.paused = true;
      ctx.handlerState = state;
      return false;
    }

    const spaceId = ctx.pendingChoice.response as string | null;
    ctx.pendingChoice = null;
    ctx.paused = false;

    if (spaceId && G.troops[spaceId] === 'white') {
      assassinateTroop(G, spaceId);
      G.players[ctx.actorId].trophyHall.white += 1;
      Mechanics.log(G, `P${Number(ctx.actorId) + 1} assassinated white troop at ${spaceId} via Nihiloor`);
    }
  }

  ctx.handlerState = null;
  return true;
};


/**
 * Xanathar Surveillance: 
 * Draw 3 cards, then discard 2 of them. Bribe -> Promote one of the discarded cards.
 */
export function xanatharSurveillanceHandler(ctx: EffectContext): boolean {
  interface XSState {
    phase: 'draw' | 'discard1' | 'discard2' | 'bribe';
    drawnRefs: { deck: string; slot: number }[];
    discardedRefs: { deck: string; slot: number }[];
    sub?: unknown;
  }
  
  let state = (ctx.handlerState as XSState | null) ?? { phase: 'draw', drawnRefs: [], discardedRefs: [] };
  const G = ctx.G;
  const me = G.players[ctx.actorId];

  // --- 1. Draw 3 Cards ---
  if (state.phase === 'draw') {
    const oldSize = me.hand.length;
    Mechanics.draw(G, ctx.actorId, 3, ctx.random);
    const newSize = me.hand.length;
    
    // Track the exact newly drawn cards based on hand size change
    const newlyDrawn = me.hand.slice(oldSize, newSize).map(c => ({ deck: c.deck, slot: c.slot }));
    
    // Failsafe: Nothing drawn (deck and discard both empty)
    if (newlyDrawn.length === 0) {
      ctx.handlerState = null;
      return true; 
    }

    state = { phase: 'discard1', drawnRefs: newlyDrawn, discardedRefs: [] };
  }

  // --- 2. Discard 2 of the drawn cards ---
  if (state.phase === 'discard1' || state.phase === 'discard2') {
    if (!ctx.pendingChoice) {
      const eligibleIndices: number[] = [];
      for (let i = 0; i < me.hand.length; i++) {
        const c = me.hand[i];
        if (state.drawnRefs.some(ref => ref.deck === c.deck && ref.slot === c.slot)) {
          eligibleIndices.push(i);
        }
      }

      // If we don't have enough cards to discard, skip to the bribe step
      if (eligibleIndices.length === 0) {
        state = { ...state, phase: 'bribe' };
      } else {
        ctx.pendingChoice = {
          kind: 'select-card-in-hand',
          prompt: `Xanathar Surveillance: Choose the ${state.phase === 'discard1' ? 'first' : 'second'} drawn card to discard.`,
          options: eligibleIndices,
          optional: false
        } as PendingChoice;
        ctx.paused = true;
        ctx.handlerState = state;
        return false;
      }
    } else {
      const idx = ctx.pendingChoice.response as number | null;
      ctx.pendingChoice = null;
      ctx.paused = false;

      if (idx != null && idx >= 0 && idx < me.hand.length) {
        const card = me.hand[idx];
        if (!Mechanics.trySylgarReact(ctx.G, ctx.actorId, card)) {
          me.hand.splice(idx, 1);
          me.discard.push(card);
          Mechanics.log(G, `P${Number(ctx.actorId) + 1} discarded ${card.name} via Xanathar Surveillance`);
        }

        // Migrate the ref from 'drawn' track to 'discarded' track
        const newDrawnRefs = state.drawnRefs.filter(ref => !(ref.deck === card.deck && ref.slot === card.slot));
        const newDiscardedRefs = [...state.discardedRefs, { deck: card.deck, slot: card.slot }];

        state = {
          phase: state.phase === 'discard1' ? 'discard2' : 'bribe',
          drawnRefs: newDrawnRefs,
          discardedRefs: newDiscardedRefs
        };
      } else {
        // Fallback for invalid response
        state = { ...state, phase: state.phase === 'discard1' ? 'discard2' : 'bribe' };
      }
    }
  }

  // --- 3. Bribe -> Promote one of the discarded cards ---
  if (state.phase === 'bribe') {
    if (state.discardedRefs.length === 0) {
      ctx.handlerState = null;
      return true; // No cards to promote
    }

    const promoteHandler = bribeCost((childCtx) => {
      if (!childCtx.pendingChoice) {
        const eligibleIndices: number[] = [];
        const actorPlayer = childCtx.G.players[childCtx.actorId];
        
        // Find the indices in the discard pile for our specific discarded cards
        for (let i = 0; i < actorPlayer.discard.length; i++) {
          const c = actorPlayer.discard[i];
          if (state.discardedRefs.some(ref => ref.deck === c.deck && ref.slot === c.slot)) {
            eligibleIndices.push(i);
          }
        }

        if (eligibleIndices.length === 0) return true;

        childCtx.pendingChoice = {
          kind: 'select-card-in-discard',
          prompt: 'Xanathar Surveillance (Bribe): Promote one of the discarded cards.',
          options: eligibleIndices,
          optional: false
        } as PendingChoice;
        childCtx.paused = true;
        return false;
      }

      const idx = childCtx.pendingChoice.response as number | null;
      childCtx.pendingChoice = null;
      childCtx.paused = false;

      if (idx != null) {
        const actorPlayer = childCtx.G.players[childCtx.actorId];
        const card = actorPlayer.discard[idx];
        if (card) {
          actorPlayer.discard.splice(idx, 1);
          Mechanics.promote(childCtx.G, childCtx.actorId, card);
        }
      }

      return true;
    });

    const bribeCtx = { ...ctx, handlerState: state.sub ?? null, pendingChoice: ctx.pendingChoice, paused: ctx.paused };
    const done = promoteHandler(bribeCtx);

    ctx.pendingChoice = bribeCtx.pendingChoice;
    ctx.paused = bribeCtx.paused;

    if (!done) {
      ctx.handlerState = { ...state, sub: bribeCtx.handlerState };
      return false;
    }

    ctx.handlerState = null;
    return true;
  }

  ctx.handlerState = null;
  return true;
};

/**
 * Bregan D'aerthe Spy (Second Choice): Return a spy to steal a control marker.
 * Takes the marker until the start of the actor's next turn. Analyzes the site 
 * after spy removal to conditionally award Total Control benefits if the 
 * underlying true controller achieved Total Control.
 */
export function stealControlMarkerChoice(): EffectHandler {
  return ctx => {
    const me = ctx.G.players[ctx.actorId];
    const myColor = me.color;

    // Phase 1: Prompt the player to select which of their spies to return
    if (!ctx.pendingChoice) {
      ensureSpiesLeftInitialized(ctx.G, myColor);
      const eligible = SITES
        .filter(s => (ctx.G.spies[s.id] ?? []).includes(myColor))
        .map(s => s.id);

      if (eligible.length === 0) {
        Mechanics.log(ctx.G, "(Bregan D'aerthe Spy: no spies to return — skipped)");
        return true;
      }

      ctx.pendingChoice = {
        kind: 'select-site',
        prompt: 'Return a spy to steal that site\'s control marker.',
        options: eligible,
        optional: false,
      } as PendingChoice;
      ctx.paused = true;
      return false;
    }

    // Phase 2: Resolve the choice and execute the theft
    const siteId = ctx.pendingChoice.response as string | null;
    ctx.pendingChoice = null;
    ctx.paused = false;

    if (!siteId) return true;

    // We use returnSpy which subsequently triggers recomputeSiteControl.
    // This allows us to instantly check the "true" state of the board minus our spy.
    if (returnSpy(ctx.G, myColor, siteId)) {
      me.spiesLeft += 1;
      Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} returned spy from ${siteId}`);

      const marker = ctx.G.controlMarkers[siteId];
      if (marker) {
        // Determine who the true controller is now that the spy is removed
        const realController = ctx.G.siteControl[siteId];

        // Check if the true controller now has Total Control (minus our spy)
        const tc = realController ? hasTotalControl(ctx.G, realController, siteId) : false;

        // Steal the marker
        marker.holder = myColor;

        // Stash the state of this theft directly onto G for the engine to track.
        // Note: You will need to add `stolenMarkers: any[]` to your TyrantsState interface.
        if (!(ctx.G as any).stolenMarkers) {
          (ctx.G as any).stolenMarkers = [];
        }
        
        (ctx.G as any).stolenMarkers.push({
          siteId,
          thief: myColor,
          originalController: realController,
          hasTotalControl: tc,
          expiresAtTurnStartOf: myColor // Used by turn.onBegin to return the marker
        });

        // Grant the immediate benefits to the thief
        const inf = tc ? marker.totalControlInfluence : marker.controlInfluence;
        const vp = tc ? marker.totalControlVp : marker.controlVp;

        if (inf > 0) me.influence += inf;
        if (vp > 0) me.vp += vp;

        // Add to standard once-per-turn ledgers to prevent double-dipping
        ctx.G.markerInfluenceGrantedThisTurn.push(siteId);
        if (tc) {
          ctx.G.markerTcGrantedThisTurn.push(siteId);
        }

        // Output final logs
        Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} stole the control marker at ${siteId} until their next turn${tc ? ' (Total Control benefits)' : ''}`);
        
        const logParts: string[] = [];
        if (inf > 0) logParts.push(`+${inf} influence`);
        if (vp > 0) logParts.push(`+${vp} VP`);
        if (logParts.length > 0) {
          ctx.G.log.push(`P${Number(ctx.actorId) + 1} ${logParts.join(', ')} from stolen ${siteId} control marker`);
        }
      }
    }
    return true;
  };
}

/**
 * Jarlaxle:  Look at an opponent's hand and choose a card. They play it, but you
 * decide how. Bribe -> copy that card's effect.
 * You tell the opponent how they must play the card, but they are the ones benefitting
 * from the card's effect, not you. You choose where they deploy troops, who they assassinate, etc.
 * If the card creates influence or power for the opponent, using them is out of the
 * card's effect, so they vanish at the end of your turn.
 * If the card interacts with the hand (devour, promote, focus) you can also choose since you saw their hand before.
 * If the card promotes another card played this turn, nothing happens since the opponent
 * has no other cards played during your turn.
 * Finally, if you choose to bribe, you copy the card's effect, but this time for yourself.
 */
export function jarlaxleHandler(ctx: EffectContext): boolean {
  interface S {
    phase: 'pick-target' | 'pick-card' | 'play-for-opponent' | 'bribe';
    targetPid?: string;
    pickedRef?: CardRef;
    childState?: unknown;
    oppInitialStats?: { power: number; influence: number };
  }
  
  let state = (ctx.handlerState as S | null) ?? { phase: 'pick-target' };
  const G = ctx.G;
  const me = ctx.actorId;

  // 1. CHOOSE OPPONENT
  if (state.phase === 'pick-target') {
    if (!ctx.pendingChoice) {
      const opponents = Object.keys(G.players).filter(id => id !== me && G.players[id].hand.length > 0);
      if (opponents.length === 0) {
        Mechanics.log(G, "(Jarlaxle: no opponents with cards in hand — skipped)");
        ctx.handlerState = null;
        return true;
      }
      ctx.pendingChoice = {
        kind: 'select-player',
        prompt: "Jarlaxle: Choose an opponent to look at their hand.",
        options: opponents,
        optional: false,
      } as PendingChoice;
      ctx.paused = true;
      ctx.handlerState = state;
      return false;
    }
    const targetPid = ctx.pendingChoice.response as string | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    if (!targetPid) { ctx.handlerState = null; return true; }
    state = { phase: 'pick-card', targetPid };
    ctx.handlerState = state;
  }

  // 2. LOOK AT OPPONENT'S HAND & CHOOSE CARD
  if (state.phase === 'pick-card') {
    if (!ctx.pendingChoice) {
      ctx.pendingChoice = {
        kind: 'select-card-in-hand',
        prompt: `Jarlaxle: Choose a card from P${Number(state.targetPid) + 1}'s hand for them to play.`,
        options: G.players[state.targetPid!].hand.map((_, i) => i),
        optional: false,
        playerId: me,
        actorId: state.targetPid, 
      } as PendingChoice;
      ctx.paused = true;
      ctx.handlerState = state;
      return false;
    }
    const idx = ctx.pendingChoice.response as number | null;
    ctx.pendingChoice = null;
    ctx.paused = false;
    if (idx == null) { ctx.handlerState = null; return true; }
    
    const opp = G.players[state.targetPid!];
    const pickedRef = opp.hand[idx];
    if (!pickedRef) { ctx.handlerState = null; return true; }

    opp.hand.splice(idx, 1);
    opp.discard.push(pickedRef);
    Mechanics.log(G, `P${Number(state.targetPid!) + 1} played ${pickedRef.name} (forced by P${Number(me) + 1})`);

    const oppInitialStats = { power: opp.power, influence: opp.influence };

    state = { phase: 'play-for-opponent', targetPid: state.targetPid, pickedRef, oppInitialStats, childState: null };
    ctx.handlerState = state;
  }

  // 3. EXECUTE FOR OPPONENT (WITH ACTOR INTERCEPTING CHOICES)
  if (state.phase === 'play-for-opponent') {
    const data = lookupCard(state.pickedRef!.deck, state.pickedRef!.slot);
    const handler = data ? CardRegistry.get(data.effectKey) : undefined;
    
    if (handler) {
      const childCtx: EffectContext = {
        ...ctx,
        card: state.pickedRef!,
        actorId: state.targetPid!, 
        pendingChoice: ctx.pendingChoice,
        handlerState: state.childState ?? null,
        paused: ctx.paused,
      };
      
      const done = handler(childCtx);
      if (!done) {
        ctx.pendingChoice = childCtx.pendingChoice ? {
          ...childCtx.pendingChoice,
          playerId: me, 
          actorId: state.targetPid!, 
        } : null;
        ctx.paused = childCtx.paused;
        ctx.handlerState = { ...state, childState: childCtx.handlerState };
        return false;
      }
    } else {
      Mechanics.log(G, `(${state.pickedRef!.name}: no handler — played as no-op)`);
    }

    const opp = G.players[state.targetPid!];
    opp.power = state.oppInitialStats!.power;
    opp.influence = state.oppInitialStats!.influence;

    ctx.pendingChoice = null;
    ctx.paused = false;

    state = { phase: 'bribe', pickedRef: state.pickedRef, childState: null };
    ctx.handlerState = state;
  }

  // 4. OPTIONAL BRIBE TO COPY EFFECT
  if (state.phase === 'bribe') {
    const data = lookupCard(state.pickedRef!.deck, state.pickedRef!.slot);
    const handler = data ? CardRegistry.get(data.effectKey) : undefined;
    
    if (!handler) {
      ctx.handlerState = null;
      return true;
    }

    const bribeHandler = bribeCost(handler);
    
    const childCtx: EffectContext = {
      ...ctx,
      card: state.pickedRef!,
      actorId: me, 
      pendingChoice: ctx.pendingChoice,
      handlerState: state.childState ?? null,
      paused: ctx.paused,
    };

    const done = bribeHandler(childCtx);
    if (!done) {
      ctx.pendingChoice = childCtx.pendingChoice;
      ctx.paused = childCtx.paused;
      ctx.handlerState = { ...state, childState: childCtx.handlerState };
      return false;
    }
    
    ctx.handlerState = null;
    return true;
  }

  ctx.handlerState = null;
  return true;
}
import { grant, sequence, registerAll, chooseOne, times,
         assassinateChoice, deployChoice, supplantChoice,
         returnOwnSpyChoice, placeSpyAtChosenSite,
         returnEnemyTroopChoice, playerHasOwnSpy,
         takeTrophyAndPlace, ensureSpiesLeftInitialized,
         flagEotPromote, spacesAdjacentTo} from '../handler-helpers';
import { Mechanics } from '../mechanics';
import type { EffectContext, EffectHandler, PendingChoice } from '../types';
import { sitesSpaces, TROOP_SPACES } from '../../data/troop-spaces';
// import { ROUTES } from '../../data/routes';
import { SITES } from '../../data/sites';
import { assassinateTroop, moveTroop,
         placeSpy, returnSpy, hasTotalControl,
         siteOf, recomputeSiteControl } from '../map-state';
import { CardRegistry } from '../registry';
import type { Color, CardRef, TyrantsState} from '../../game';
import { lookupCard } from '../../card-data';


// ===========================================================================
// Mercenaries Registry Table
// ===========================================================================

registerAll({
  // --- Slots 1, 2, 3, 4: Goblinoid Ambushers (Cost 2) ---
  // "Choose one: +1 Influence OR Steal 1 VP OR Bribe -> +3 Power"
  'goblinoid-ambushers': chooseOne(
                           { label: '+1 Power', handler: grant({ power: 1 }) },
                           { label: 'Steal 1 VP',         
                            handler: stealVpChoice({ count: 1 }),
                            available: anyOpponentHasVp},
                           { label: 'Bribe -> +3 Power',
                            handler: bribeCost(grant({ power: 3 })),
                            available: playerHasVp}
                          ),

  // --- Slots 5, 6: Hobgoblin Warlord (Cost 5) ---
  // "+3 Power. Bribe -> For the rest of your turn, you can expend 2 Power to assassinate a troop."
  // Approximated as a direct bonus choice effect action when paid.
  // * Implemented. Seems good.
  'hobgoblin-warlord':   sequence(
                           grant({ power: 3 }),
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
  // * Implemented. Seems good.
  'artemis-entreri':     sequence(
                           // Clear any stale space tracking before we start
                           (ctx => {
                             (ctx.G as unknown as { _lastAssassinatedSpace?: string })._lastAssassinatedSpace = undefined;
                             return true;
                           }),
                           assassinateChoice({ count: 3, sameSite: true }),
                           (ctx => {
                             const spaceId = (ctx.G as unknown as { _lastAssassinatedSpace?: string })._lastAssassinatedSpace; 
                             if (spaceId) {
                               const siteId = TROOP_SPACES.find(t => t.id === spaceId)?.parentSite;
                               if (siteId) {
                                 const hasTroops = sitesSpaces(siteId).some(sp => ctx.G.troops[sp.id] !== null);
                                 if (!hasTroops) {
                                   ctx.G.players[ctx.actorId].vp += 1;
                                   Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} +1 VP from Artemis Entreri (Site ${siteId} cleared)`);
                                 }
                               }
                             }
                             return true;
                           })),

  // --- Slots 11, 12: Goblin Swarm (Cost 1) ---
  // "Deploy a troop. Bribe -> Deploy 2 troops."
  'goblin-swarm':        sequence(
                           deployChoice({ count: 1 }),
                           bribeCost(deployChoice({ count: 2 }))
                          ),

  // --- Slots 13, 14, 15: Bugbear (Cost 4) ---
  // "Deploy a troop. Assassinate a white troop. Gain 1 VP."
  'bugbear':             sequence(
                           deployChoice({ count: 1 }),
                           assassinateChoice({ count: 1, whiteOnly: true }),
                           ctx => { ctx.G.players[ctx.actorId].vp += 1; return true; }
                          ),

  // --- Slots 16, 17: Security Guard (Cost 4) ---
  // "Deploy 2 troops, then steal 1 VP from each opponent with a troop adjacent to at least 1 of them."
  // * Implemented. Seems good.
  'security-guard':      sequence(
                           deployChoice({ count: 2 }),
                           stealVpFromOpponentsAdjacentToLastDeploy()
                          ),

  // --- Slots 18, 19: Bregan D'aerthe Agents (Cost 5) ---
  // "Choose 3 times: Take a white troop from any trophy hall and deploy it OR Bribe -> Supplant a white troop."
  // * Implemented. Seems good.
  'bregan-daerthe-agents': times(3, chooseOne(
                             { label: 'Take a white trophy from any hall and place it',
                             handler: takeTrophyAndPlace({ count: 1, whiteOnly: true, optional: false, restrictToPresence: true }),
                             available: (G) => {
                               // Any player's trophy hall (including the actor's own).
                               for (const p of Object.values(G.players)) {
                                 if ((p.trophyHall.white ?? 0) > 0) return true;
                               }
                               return false;
                             }},
                             { label: 'Bribe -> Supplant a white troop',
                              handler: bribeCost(supplantChoice({ whiteOnly: true })),
                              available: playerHasVp }
                            )),

  // --- Slot 20: Nihiloor (Cost 7) ---
  // "Deploy 3 troops. Bribe -> Move the deployed troops. Assassinate a white troop adjacent to each one."
  // * Implemented. Seems good.
  'nihiloor':            sequence(
                           deployChoice({ count: 3 }),
                           bribeCost(moveOwnTroopChoice({ restrictToRecentDeploys: true })),
                           assassinateWhiteAdjacentToRecentDeploys()
                         ),

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
                           { label: 'Bribe -> Place spy and draw 2',
                            handler: bribeCost(sequence(placeSpyAtChosenSite(), grant({ draw: 2 }))),
                            available: playerHasVp },
                           { label: 'Return spy -> Steal 3 VP',
                            handler: sequence(returnOwnSpyChoice(), stealVpChoice({ count: 3 })),
                            available: (G, actorId) => playerHasOwnSpy(G, actorId) && anyOpponentHasVp(G, actorId) }
                          ),

  // --- Slots 27, 28: Bregan D'aerthe Spy (Cost 3) ---
  // "Choose one: Place a spy OR Return one of your spies -> Steal that spy's site control marker."
  // * Implemented
  // TODO: Check
  'bregan-daerthe-spy':  chooseOne(
                           { label: 'Place a spy', handler: placeSpyAtChosenSite() },
                           { label: 'Return a spy -> Claim site control marker',
                             handler: stealControlMarkerChoice(),
                             available: playerHasOwnSpy }
                          ),

  // --- Slot 29: Nar'l Xibrindas (Cost 4) ---
  // "Choose one: Place a spy OR Return one of your spies -> Choose a card in the discard pile of an opponent at that site. Swap this card with it."
  'narl-xibrindas':      chooseOne(
                           { label: 'Place a spy', handler: placeSpyAtChosenSite() },
                           { label: 'Return a spy -> Swap with opponent discard card',
                             handler: sequence(
                               returnOwnSpyChoice(),
                               narlXibrindasSwapHandler()
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
                           bribeCost(flagEotPromote())
                          ),

  // --- Slots 34, 35: Xanathar Surveillance (Cost 6) ---
  // "Draw 3 cards, then discard 2 of them. Bribe -> Promote one of the discarded cards."
  // * Implemented. Seems good.
  'xanathar-surveillance': xanatharSurveillanceHandler,

  // --- Slots 36, 37: Shady Merchant (Cost 5) ---
  // "Return another player's troop and move a spy. Bribe -> Put another card played this turn on top of an opponent's deck."
  // * Implemented. Seems good.
  'shady-merchant':      sequence(
                           returnEnemyTroopChoice(),
                           moveSpyChoice(),
                           bribeCost(recyclePlayedCardToDeckChoice())
                          ),

  // --- Slot 38: Sylgar (Cost 1) ---
  // "If this is devoured, promoted or discarded by a card, put it back where it was and gain 1 VP."
  // Checks are implemented in game.ts and App, when promoting or discarding
  // * Implemented. Seems good.
  'sylgar':              fizzleAndDoNothing,

  // --- Slot 39: Ahmaergo (Cost 5) ---
  // "Choose 2 times: Move one of your troops and gain 1 Infulence OR Bribe -> Swap 2 troops anywhere on the board."
  // * Implemented
  // TODO: Check
  'ahmaergo':            times(2, chooseOne(
                           { label: 'Move own troop and gain +1 Influence',
                            handler: sequence(moveOwnTroopChoice(), grant({ influence: 1 })) },
                           { label: 'Bribe -> Swap 2 troops anywhere',
                            handler: bribeCost(swapAnyTwoTroopsChoice()),
                            available: playerHasVp }
                          )),

  // --- Slot 40: Xanathar Zushaxx (Cost 7) ---
  // "+4 Influence. For the rest of your turn, each time you recruit a card, steal 1 VP."
  // * Implemented. Seems good.
  'xanathar-zushaxx':    sequence(
                           grant({ influence: 4 }),
                           ctx => {
                             const Gx = ctx.G as unknown as { _xanatharZushaxxActive?: boolean };
                             Gx._xanatharZushaxxActive = true;
                             Mechanics.log(ctx.G, `Xanathar Zushaxx active: stealing 1 VP on each recruit for the rest of the turn.`);
                             return true;
                           }),
});

// ===========================================================================
// Core Mechanic Primitives: Steal & Bribe
// ===========================================================================

/**
 * Steal `count` VP from an eligible player (must have >= 1 VP) and add it to your pool.
 * If the target has less VP than `count`, all their remaining VP is stolen.
 * If targetPid is omitted, surfaces a prompt for the actor to choose a victim.
 */
export function stealVpChoice(opts?: { count?: number; targetPid?: string }): EffectHandler {
  const count = opts?.count ?? 1;
  return ctx => {
    const G = ctx.G;

    // Helper: Enumerate all opponents who actually have VP tokens to steal
    const getEligibleVictims = () => {
      return Object.keys(G.players).filter(pid => pid !== ctx.actorId && G.players[pid].vp >= 1);
    };

    let targetId = opts?.targetPid;

    // 1. Process any pending response from a previous prompt session
    if (ctx.pendingChoice) {
      const selectedPid = ctx.pendingChoice.response as string | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      if (!selectedPid) { ctx.handlerState = null; return true; }
      targetId = selectedPid;
    }

    // 2. If no target is pre-locked or selected, find eligible victims
    if (!targetId) {
      const victims = getEligibleVictims();
      if (victims.length === 0) {
        Mechanics.log(G, `(Steal VP: No opponents have VP tokens to steal — skipped)`);
        ctx.handlerState = null;
        return true;
      }

      // Multi-victim branch: ask the actor to choose who to steal from
      if (victims.length > 1) {
        ctx.pendingChoice = {
          kind: 'select-player',
          prompt: `Steal ${count > 1 ? `up to ${count}` : '1'} VP — Choose an opponent to take from:`,
          options: victims,
          optional: false,
        } as PendingChoice;
        ctx.paused = true;
        return false; // Suspend and wait for player choice
      }

      // Only 1 eligible victim, auto-select them
      targetId = victims[0];
    }

    // 3. Execute the steal transaction
    const targetPlayer = G.players[targetId];
    const actorPlayer = G.players[ctx.actorId];

    if (targetPlayer && targetPlayer.vp >= 1) {
      const stealAmount = Math.min(targetPlayer.vp, count);
      targetPlayer.vp -= stealAmount;
      actorPlayer.vp += stealAmount;
      Mechanics.log(G, `P${Number(ctx.actorId) + 1} stole ${stealAmount} VP from P${Number(targetId) + 1}`);
    }

    ctx.handlerState = null;
    return true;
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

/** * True when the player has at least 1 VP token available to spend.
 * Useful for gating options that require paying VP (e.g., Bribes).
 */
export function playerHasVp(G: TyrantsState, actorId: string): boolean {
  return G.players[actorId].vp >= 1;
}

/**
 * True when at least one opponent has 1 or more VP tokens.
 * Useful for gating options like Steal VP.
 */
export function anyOpponentHasVp(G: TyrantsState, actorId: string): boolean {
  for (const pid of Object.keys(G.players)) {
    if (pid !== actorId && G.players[pid].vp >= 1) {
      return true;
    }
  }
  return false;
}

/**
 * Reduces the base power cost of assassinating troops to 2 for the rest of the turn.
 */
export function reduceAssassinateCostToTwo(ctx: EffectContext): boolean {
  ctx.G.assassinateCostOverride = 2;
  Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} reduced their assassinate cost to 2 Power for the rest of the turn`);
  return true;
};

/**
 * Move `count` of your own color troops.
 * Player can only pick a troop from a space where they have Presence.
 * Destination can be any empty space on the board.
 */
interface MoveOwnState { 
  remaining: number; 
  from: string | null;
  movableDeploys?: string[];
}

export function moveOwnTroopChoice(opts?: { count?: number; optional?: boolean; restrictToRecentDeploys?: boolean }): EffectHandler {
  const baseCount = opts?.count ?? 1;
  return ctx => {
    const G = ctx.G;
    const Gx = G as unknown as { _recentDeploySpaces?: string[] };
    const deploys = Gx._recentDeploySpaces ?? [];
    
    // Dynamically cap count to the number of recent deploys if restricted
    const count = opts?.restrictToRecentDeploys ? deploys.length : baseCount;

    let state = (ctx.handlerState as MoveOwnState | null) ?? { 
      remaining: count, 
      from: null,
      // Initialize the local pool of troops that haven't been moved yet
      ...(opts?.restrictToRecentDeploys ? { movableDeploys: [...deploys] } : {})
    };
    
    const me = G.players[ctx.actorId];
    const myColor = me.color;

    if (ctx.pendingChoice) {
      const picked = ctx.pendingChoice.response as string | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      
      if (state.from === null) {
        if (!picked) { ctx.handlerState = null; return true; }
        state = { ...state, from: picked };
      } else {
        if (picked && moveTroop(G, state.from, picked)) {
          Mechanics.log(G, `P${Number(ctx.actorId) + 1} moved their own troop ${state.from} ↔ ${picked}`);
          
          if (opts?.restrictToRecentDeploys) {
            // 1. Update the global tracking array so the assassinate step knows the new location
            const idx = deploys.indexOf(state.from);
            if (idx !== -1) deploys[idx] = picked;
            
            // 2. Remove this troop from the local movable pool so it can't be moved again
            if (state.movableDeploys) {
              const movIdx = state.movableDeploys.indexOf(state.from);
              if (movIdx !== -1) state.movableDeploys.splice(movIdx, 1);
            }
          }
        }
        state = { ...state, remaining: state.remaining - 1, from: null };
      }
    }

    if (state.remaining <= 0) { ctx.handlerState = null; return true; }

    if (state.from === null) {
      const eligible = TROOP_SPACES.filter(t => {
        if (!(t.id in G.troops)) return false;
        
        // As long as it is your troop, you can select it to move.
        const occ = G.troops[t.id];
        if (occ !== myColor) return false;
        
        // Restrict to recently deployed troops THAT HAVEN'T BEEN MOVED YET
        if (opts?.restrictToRecentDeploys && !state.movableDeploys?.includes(t.id)) {
          return false;
        }
        
        return true;
      }).map(t => t.id);

      if (eligible.length === 0) {
        Mechanics.log(G, '(move own troop: you have no valid troops under required conditions — skipped)');
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

/**
 * Move a spy of any color from one site to another.
 * Three-phase pick: 
 * 1. Pick the origin site containing a spy.
 * 2. If multiple spies are there, pick which player's spy to move.
 * 3. Pick the destination site.
 */
interface MoveSpyState {
  remaining: number;
  fromSite: string | null;
  spyColor: Color | null;
}

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
 * An EffectHandler that allows the active player to choose a card they played 
 * this turn, then choose any player, and place that card on top of their deck.
 */
export function recyclePlayedCardToDeckChoice(): EffectHandler {
  return ctx => {
    interface RecycleCardState {
      phase: 'pick-played-card' | 'pick-target-player';
      pickedCardIdx?: number;
      pickedCardRef?: CardRef;
    }

    let state = (ctx.handlerState as RecycleCardState | null) ?? { phase: 'pick-played-card' };

    // --- Phase 1: Pick a card played this turn ---
    if (state.phase === 'pick-played-card') {
      if (!ctx.pendingChoice) {
        // Enumerate all indices of cards played this turn.
        // We exclude the current card itself from being picked to match standard design patterns.
        const eligibleCardIndices: number[] = [];
        for (let i = 0; i < ctx.G.cardsPlayedThisTurn.length; i++) {
          const c = ctx.G.cardsPlayedThisTurn[i];
          if (c.deck === ctx.card.deck && c.slot === ctx.card.slot) continue;
          eligibleCardIndices.push(i);
        }

        if (eligibleCardIndices.length === 0) {
          Mechanics.log(ctx.G, `(${ctx.card.name}: No other cards have been played this turn — skipped)`);
          ctx.handlerState = null;
          return true;
        }

        ctx.pendingChoice = {
          kind: 'select-played-card',
          prompt: `${ctx.card.name}: Choose a card you played this turn to place on a deck.`,
          options: eligibleCardIndices,
          optional: false,
        } as PendingChoice;
        ctx.paused = true;
        ctx.handlerState = state;
        return false;
      }

      // Resume from picking the card played this turn
      const cardIdx = ctx.pendingChoice.response as number | null;
      ctx.pendingChoice = null;
      ctx.paused = false;

      if (cardIdx === null || cardIdx < 0 || cardIdx >= ctx.G.cardsPlayedThisTurn.length) {
        ctx.handlerState = null;
        return true;
      }

      const pickedCardRef = ctx.G.cardsPlayedThisTurn[cardIdx];
      state = { phase: 'pick-target-player', pickedCardIdx: cardIdx, pickedCardRef };
      ctx.handlerState = state;
      // Fall through immediately to Phase 2 to set up the player choice prompt
    }

    // --- Phase 2: Pick the target player's deck (Excluding Active Player) ---
    if (state.phase === 'pick-target-player' && state.pickedCardRef) {
      if (!ctx.pendingChoice) {
        // Gather all player IDs and filter out ctx.actorId (the active player)
        const opponentPlayerIds = Object.keys(ctx.G.players).filter(
          id => id !== ctx.actorId
        );

        if (opponentPlayerIds.length === 0) {
          Mechanics.log(ctx.G, `(${ctx.card.name}: No opponents available to target — skipped)`);
          ctx.handlerState = null;
          return true;
        }

        ctx.pendingChoice = {
          kind: 'select-player',
          prompt: `Place ${state.pickedCardRef.name} on top of which opponent's deck?`,
          options: opponentPlayerIds,
          optional: false,
        } as PendingChoice;
        ctx.paused = true;
        ctx.handlerState = state;
        return false;
      }

      // Process target player selection response
      const targetPlayerId = ctx.pendingChoice.response as string | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      ctx.handlerState = null;

      if (targetPlayerId && state.pickedCardIdx !== undefined) {
        const targetPlayer = ctx.G.players[targetPlayerId];
        const pickedCard = state.pickedCardRef;
        const pid = ctx.actorId;
        const p = ctx.G.players[pid];
        
        if (targetPlayer) {
          // 1. Remove from the played list by exact index so duplicate card definitions don't collide
          ctx.G.cardsPlayedThisTurn.splice(state.pickedCardIdx, 1);
          p.cardsPlayed.splice(state.pickedCardIdx, 1);

          // 2. Remove from the player's discard pile
          // Because game.ts adds copies to the discard pile on the fly as they are played,
          // we look for it and slice it out so it doesn't leave behind a ghost duplicate.
          const discardIdx = ctx.G.players[pid].discard.findIndex(
            c => c.deck === pickedCard.deck && c.slot === pickedCard.slot
          );
          if (discardIdx >= 0) {
            ctx.G.players[pid].discard.splice(discardIdx, 1);
          }

          // 3. Close the undo boundary
          // Moving a card to a draw deck manipulates hidden card configurations.
          // Mechanics.markInfoRevealed(ctx.G);

          // 4. Place it on top of the target player's deck pile
          targetPlayer.deck.unshift(pickedCard);

          Mechanics.log(
            ctx.G, 
            `P${Number(pid) + 1} placed played card ${pickedCard.name} on top of P${Number(targetPlayerId) + 1}'s deck.`
          );
        }
      }
      return true;
    }

    ctx.handlerState = null;
    return true;
  };
};

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

/**
 * Checks for any opponent troops adjacent to the most recently deployed troop(s) and steals 1 VP from each eligible opponent.
 * Used by Security Guard.
 */
export function stealVpFromOpponentsAdjacentToLastDeploy(): EffectHandler {
  return ctx => {
    const Gx = ctx.G as unknown as { _lastDeploySpace?: string; _recentDeploySpaces?: string[] };
    
    const deploys = (Gx._recentDeploySpaces && Gx._recentDeploySpaces.length > 0)
      ? Gx._recentDeploySpaces
      : (Gx._lastDeploySpace ? [Gx._lastDeploySpace] : []);
      
    if (deploys.length === 0) return true;
    
    const myColor = ctx.G.players[ctx.actorId].color;
    const opponentColors = new Set<string>();
    
    // Find all enemy colors adjacent to any of the deployed troops
    for (const deploySpace of deploys) {
      for (const sp of spacesAdjacentTo(deploySpace)) {
        const occ = ctx.G.troops[sp];
        if (occ && occ !== 'white' && occ !== myColor) {
          opponentColors.add(occ);
        }
      }
    }
    
    // Map troop colors back to player IDs, ensuring they actually have VP to steal
    const victimIds: string[] = [];
    for (const pid of Object.keys(ctx.G.players)) {
      if (pid === ctx.actorId) continue;
      if (opponentColors.has(ctx.G.players[pid].color) && ctx.G.players[pid].vp >= 1) {
        victimIds.push(pid);
      }
    }
    
    if (victimIds.length === 0) {
      Mechanics.log(ctx.G, '(no eligible opponent has a troop adjacent to a deployed troop — no VP stolen)');
      return true;
    }

    // Automatically steal 1 VP from EACH eligible adjacent opponent
    for (const pid of victimIds) {
      ctx.G.players[pid].vp -= 1;
      ctx.G.players[ctx.actorId].vp += 1;
      Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} stole 1 VP from P${Number(pid) + 1} (adjacent to deploy)`);
    }
    
    return true;
  };
}

/**
 * Checks for any white troops adjacent to the most recently deployed/moved troop(s) and assassinate them.
 * Used by Nihiloor.
 */
export function assassinateWhiteAdjacentToRecentDeploys(): EffectHandler {
  return ctx => {
    const Gx = ctx.G as unknown as { _recentDeploySpaces?: string[] };
    const deploys = Gx._recentDeploySpaces ?? [];
    if (deploys.length === 0) return true;

    // Track which of the deployed troops we are currently evaluating
    interface NihiloorState { currentDeployIdx: number }
    let state = (ctx.handlerState as NihiloorState | null) ?? { currentDeployIdx: 0 };

    if (ctx.pendingChoice) {
      const picked = ctx.pendingChoice.response as string | null;
      ctx.pendingChoice = null;
      ctx.paused = false;

      if (picked) {
        const killed = assassinateTroop(ctx.G, picked);
        if (killed === 'white') {
          ctx.G.players[ctx.actorId].trophyHall.white += 1;
          Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} assassinated white troop at ${picked}`);
        }
      }

      // We've processed the assassination for this deployment, move to the next one
      state = { currentDeployIdx: state.currentDeployIdx + 1 };
    }

    // Loop through the deployments sequentially until we find one with valid targets
    while (state.currentDeployIdx < deploys.length) {
      const currentDeploySpace = deploys[state.currentDeployIdx];
      const targets = new Set<string>();

      for (const adj of spacesAdjacentTo(currentDeploySpace)) {
        if (ctx.G.troops[adj] === 'white') targets.add(adj);
      }

      // If this specific deployment has no adjacent white troops, just skip to the next one
      if (targets.size === 0) {
        state.currentDeployIdx++;
        continue;
      }

      // We found valid targets for the current deployment. Prompt the player to pick one.
      ctx.pendingChoice = {
        kind: 'select-troop-space',
        prompt: `Nihiloor: Assassinate a white troop adjacent to deployment ${state.currentDeployIdx + 1} of ${deploys.length}.`,
        options: [...targets],
        optional: false, // Mandatory per card text
        highlightSpaces: [currentDeploySpace],
      } as PendingChoice;
      
      ctx.paused = true;
      ctx.handlerState = state;
      return false;
    }

    // If we exit the loop, all deployments have been successfully evaluated
    ctx.handlerState = null;
    return true;
  };
}

/**
 * A handler that grants nothing, opens no prompts, and explicitly flags 
 * itself so the "Play all basic" AI/UI routine will skip over it.
 */
export function fizzleAndDoNothing(ctx: EffectContext): boolean {
  // Flag the state so the "Play all basic" dry-run explicitly skips this card
  (ctx.G as unknown as { _playFizzledNoFood?: boolean })._playFizzledNoFood = true;
  
  // Return true to indicate the handler is complete and has no pending prompts
  return true;
}

// ===========================================================================
// Custom Advanced Card Actions (Multi-stage evaluation)
// ===========================================================================

/**
 * Xanathar Surveillance: 
 * Draw 3 cards, then discard 2 of them. Bribe -> Promote one of the discarded cards.
 */
export function xanatharSurveillanceHandler(ctx: EffectContext): boolean {
interface XSState {
    phase: 'draw' | 'discard' | 'bribe';
    remainingDiscards: number;
    drawnRefs: { deck: string; slot: number }[];
    discardedIndices: number[]; // Track exact positions in the discard pile
    sub?: unknown;
  }
  
  let state = (ctx.handlerState as XSState | null) ?? { 
    phase: 'draw', 
    remainingDiscards: 2, 
    drawnRefs: [], 
    discardedIndices: [] 
  };
  
  const G = ctx.G;
  const me = G.players[ctx.actorId];

  while (true) {
    // --- 1. Draw 3 Cards ---
    if (state.phase === 'draw') {
      const oldSize = me.hand.length;
      Mechanics.draw(G, ctx.actorId, 3, ctx.random);
      const newSize = me.hand.length;
      
      const newlyDrawn = me.hand.slice(oldSize, newSize).map(c => ({ deck: c.deck, slot: c.slot }));
      
      if (newlyDrawn.length === 0) {
        ctx.handlerState = null;
        return true; 
      }

      state = { 
        phase: 'discard', 
        remainingDiscards: Math.min(2, newlyDrawn.length), 
        drawnRefs: newlyDrawn, 
        discardedIndices: [] 
      };
      continue;
    }

    // --- 2. Discard 2 of the drawn cards ---
    if (state.phase === 'discard') {
      if (state.remainingDiscards <= 0) {
        state = { ...state, phase: 'bribe' };
        continue;
      }

      if (!ctx.pendingChoice) {
        const eligibleIndices: number[] = [];
        const unmatchedRefs = [...state.drawnRefs];
        
        // Strictly match to ensure we only offer exactly as many cards as we drew,
        // preventing double-matches if the player already had identical cards in hand.
        for (let i = 0; i < me.hand.length; i++) {
          const c = me.hand[i];
          const matchIdx = unmatchedRefs.findIndex(ref => ref.deck === c.deck && ref.slot === c.slot);
          if (matchIdx !== -1) {
            eligibleIndices.push(i);
            unmatchedRefs.splice(matchIdx, 1);
          }
        }

        if (eligibleIndices.length === 0) {
          state = { ...state, phase: 'bribe' };
          continue;
        }

        ctx.pendingChoice = {
          kind: 'select-card-in-hand',
          prompt: `Xanathar Surveillance: Choose a drawn card to discard (${state.remainingDiscards} left).`,
          options: eligibleIndices,
          optional: false
        } as PendingChoice;
        ctx.paused = true;
        ctx.handlerState = state;
        return false; 
      }

      const idx = ctx.pendingChoice.response as number | null;
      ctx.pendingChoice = null;
      ctx.paused = false;

      if (idx != null && idx >= 0 && idx < me.hand.length) {
        const card = me.hand[idx];
        me.hand.splice(idx, 1);
        
        // Push to discard and instantly record its exact index
        me.discard.push(card);
        const discardIdx = me.discard.length - 1; 
        
        Mechanics.log(G, `P${Number(ctx.actorId) + 1} discarded ${card.name} via Xanathar Surveillance`);

        const newDrawnRefs = [...state.drawnRefs];
        const refIdx = newDrawnRefs.findIndex(ref => ref.deck === card.deck && ref.slot === card.slot);
        if (refIdx !== -1) newDrawnRefs.splice(refIdx, 1);

        state = {
          ...state,
          remainingDiscards: state.remainingDiscards - 1,
          drawnRefs: newDrawnRefs,
          discardedIndices: [...state.discardedIndices, discardIdx] // Save the exact index
        };
      } else {
        // Fallback for invalid response
        state = { ...state, remainingDiscards: state.remainingDiscards - 1 };
      }
      continue;
    }

    // --- 3. Bribe -> Promote one of the discarded cards ---
    if (state.phase === 'bribe') {
      if (state.discardedIndices.length === 0) {
        ctx.handlerState = null;
        return true;
      }

      const promoteHandler = bribeCost((childCtx) => {
        if (!childCtx.pendingChoice) {
          childCtx.pendingChoice = {
            kind: 'select-card-in-discard',
            prompt: 'Xanathar Surveillance (Bribe): Promote one of the discarded cards.',
            options: state.discardedIndices, // Feed the exact 2 indices directly to the prompt
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

      if (!done) {
        ctx.pendingChoice = bribeCtx.pendingChoice;
        ctx.paused = bribeCtx.paused;
        ctx.handlerState = { ...state, sub: bribeCtx.handlerState };
        return false; 
      }

      ctx.handlerState = null;
      return true;
    }
  }
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
        // if (tc) {
        //   ctx.G.markerTcGrantedThisTurn.push(siteId);
        // }

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
 * Nar'l Xibrindas (second choice): Choose an opponent with a troop at the
 * site where the returned spy was, then choose a specific card in that
 * opponent's discard pile and swap it with Nar'l Xibrindas itself.
 *
 * Nar'l Xibrindas is already sitting in the actor's discard pile by the time
 * this runs — game.ts pushes the played card to discard on the handler's
 * very first suspend (see playCard), which already happened for the
 * enclosing chooseOne/returnOwnSpyChoice prompts. We locate it by identity
 * (deck+slot) rather than assuming it's on top, since that's not guaranteed.
 */
interface NarlSwapState {
  phase: 'pick-opponent' | 'pick-card';
  targetPid?: string;
}

export function narlXibrindasSwapHandler(): EffectHandler {
  return ctx => {
    let state = (ctx.handlerState as NarlSwapState | null) ?? { phase: 'pick-opponent' };

    if (state.phase === 'pick-opponent') {
      const siteId = (ctx.G as unknown as { _lastReturnedSpySite?: string })._lastReturnedSpySite;
      if (!siteId) { ctx.handlerState = null; return true; }

      if (!ctx.pendingChoice) {
        const opponentsAtSite = new Set<string>();
        for (const sp of sitesSpaces(siteId)) {
          const color = ctx.G.troops[sp.id];
          if (color && color !== 'white' && color !== ctx.G.players[ctx.actorId].color) {
            const pid = Object.keys(ctx.G.players).find(id => ctx.G.players[id].color === color);
            if (pid && ctx.G.players[pid].discard.length > 0) opponentsAtSite.add(pid);
          }
        }
        if (opponentsAtSite.size === 0) { ctx.handlerState = null; return true; }

        ctx.pendingChoice = {
          kind: 'select-player',
          prompt: 'Nar\'l Xibrindas: Choose an opponent at the site to swap discard cards with:',
          options: [...opponentsAtSite],
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

    if (state.phase === 'pick-card' && state.targetPid) {
      const targetPid = state.targetPid;
      const targetDiscard = ctx.G.players[targetPid]?.discard ?? [];

      if (!ctx.pendingChoice) {
        if (targetDiscard.length === 0) { ctx.handlerState = null; return true; }
        ctx.pendingChoice = {
          kind: 'select-card-in-discard',
          prompt: `Nar'l Xibrindas: Choose a card from P${Number(targetPid) + 1}'s discard pile to swap for.`,
          options: targetDiscard.map((_, i) => i),
          optional: false,
          discardOwnerId: targetPid,
        } as PendingChoice;
        ctx.paused = true;
        ctx.handlerState = state;
        return false;
      }

      const idx = ctx.pendingChoice.response as number | null;
      ctx.pendingChoice = null;
      ctx.paused = false;
      ctx.handlerState = null;

      const oppDiscard = ctx.G.players[targetPid].discard;
      const oppCard = idx != null ? oppDiscard[idx] : undefined;
      if (oppCard) {
        const myDiscard = ctx.G.players[ctx.actorId].discard;
        const myCardIdx = myDiscard.findIndex(c => c.deck === ctx.card.deck && c.slot === ctx.card.slot);
        if (myCardIdx >= 0) {
          const myCard = myDiscard.splice(myCardIdx, 1)[0];
          oppDiscard.splice(idx!, 1);
          myDiscard.push(oppCard);
          oppDiscard.push(myCard);
          Mechanics.log(ctx.G, `Nar'l Xibrindas swapped for ${oppCard.name} in P${Number(targetPid) + 1}'s discard pile.`);
        }
      }
      return true;
    }

    ctx.handlerState = null;
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
        // `actorId` gets forced back to the Jarlaxle player by the
        // resolveChoice dispatcher on every resume (it always tracks whose
        // handlerState is suspended, not whose pile is being browsed) — so
        // it can't carry "whose hand to show". customHandTarget survives
        // that override and is what the UI actually keys off of.
        customHandTarget: state.targetPid,
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

    // bribeCost only invokes its wrapped effect once the bribe is actually
    // paid (declined/unaffordable bribes never reach it), so tucking a log
    // step in front of `handler` logs the copy exactly once, exactly when
    // the copy actually happens.
    const pickedName = state.pickedRef!.name;
    const bribeHandler = bribeCost(sequence(
      (logCtx: EffectContext) => {
        Mechanics.log(logCtx.G, `P${Number(me) + 1} bribed to copy ${pickedName}'s effect (Jarlaxle).`);
        return true;
      },
      handler
    ));

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


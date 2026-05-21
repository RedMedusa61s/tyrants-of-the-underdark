// Undead half-deck handlers (expansion).
//
// Theme: devour-this-card mechanics — sacrifice the card being played for
// a triggered effect. Self-devour uses devourSelfThen / optionalDevour
// SelfThen helpers in handler-helpers.ts. Some cards also manipulate
// trophies and the devoured pile (treat devoured cards as market, steal
// trophies for re-deploy, etc.).
//
// Card text source: assets/raw-card-data.csv + Kelsam reference card.
// Several effects are partial or stubbed; iterate as we go.

import { grant, flagEotPromote, placeSpyAtChosenSite, sequence, registerAll, times,
         assassinateChoice, deployChoice, supplantChoice, chooseOne,
         returnOwnSpyChoice, returnEnemyTroopOrSpyChoice,
         devourFromHandCost, optionalDevourSelfThen, devourSelfThen,
         marketDevourReplaceWithSelf, takeTrophyAndPlace,
         recruitFromMarketFiltered,
         conditionalGrant, promoteFromDiscardChoice,
         assassinateAtLastPlacedSpySite,
         playerHasOwnSpy, playerCanAssassinate } from '../handler-helpers';
import { TROOP_SPACES } from '../../data/troop-spaces';
import { totalTrophies } from '../../game';

registerAll({
  // Cost 2 — Vampire Spawn: +1 money + return another player's troop/spy
  'vampire-spawn':       sequence(grant({ influence: 1 }), returnEnemyTroopOrSpyChoice()),
  // Cost 2 — Skeletal Horde: deploy 2; optional devour-self → deploy 3
  'skeletal-horde':      sequence(
                           deployChoice({ count: 2 }),
                           optionalDevourSelfThen(deployChoice({ count: 3 }),
                                                  'Devour Skeletal Horde for 3 more deploys?')),
  // Cost 2 — Cultist of Myrkul: chooseOne(+2 money, devour-self → eot promote x2)
  'cultist-of-myrkul':   chooseOne(
                           { label: '+2 Influence', handler: grant({ influence: 2 }) },
                           { label: 'Devour this card → EoT promote x2',
                             handler: devourSelfThen(flagEotPromote({ count: 2 })) }),
  // Cost 2 — Carrion Crawler: +3 power + replace a market card with self
  //   (the card-being-played enters the market in place of a devoured one)
  'carrion-crawler':     sequence(grant({ power: 3 }), marketDevourReplaceWithSelf()),
  // Cost 2 — Wraith: spy; optional devour-self → assassinate at the spy site
  'wraith':              sequence(
                           placeSpyAtChosenSite(),
                           optionalDevourSelfThen(assassinateAtLastPlacedSpySite(),
                                                  'Devour Wraith to assassinate at the spy site?')),

  // Cost 3 — Wight: chooseOne(+2 power, devour-from-hand → supplant)
  'wight':               chooseOne(
                           { label: '+2 Power', handler: grant({ power: 2 }) },
                           { label: 'Devour a hand card → supplant a troop',
                             handler: devourFromHandCost(supplantChoice()) }),
  // Cost 3 — Ghost: chooseOne(place spy, return spy → recover top devoured)
  //   "Treat top of devoured as if in market" — we don't currently track a
  //   devoured pile. Approximate: return-spy → +1 power +1 money as a
  //   placeholder consolation. TODO when devoured-pile tracking exists.
  'ghost':               chooseOne(
                           { label: 'Place a spy', handler: placeSpyAtChosenSite() },
                           { label: 'Return a spy → +1 P +1 I (devoured-pile recovery TBD)',
                             handler: sequence(returnOwnSpyChoice(), grant({ power: 1, influence: 1 })),
                             available: playerHasOwnSpy }),
  // Cost 3 — Flesh Golem: +2 power; optional devour-self → assassinate
  'flesh-golem':         sequence(
                           grant({ power: 2 }),
                           optionalDevourSelfThen(assassinateChoice(),
                                                  'Devour Flesh Golem to assassinate?',
                                                  )),
  // Cost 3 — Ravenous Zombies: +1 power + assassinate a white troop
  'ravenous-zombies':    sequence(grant({ power: 1 }), assassinateChoice({ whiteOnly: true })),
  // Cost 3 — Minotaur Skeleton: chooseOne(deploy 3, devour-self → assassinate up to 3 whites at one site)
  //   "At one site" restriction approximated as 3 white assassinates.
  'minotaur-skeleton':   chooseOne(
                           { label: 'Deploy 3 troops', handler: deployChoice({ count: 3 }) },
                           { label: 'Devour this → assassinate up to 3 white troops at one site',
                             handler: devourSelfThen(times(3, assassinateChoice({ whiteOnly: true }))) }),

  // Cost 4 — Banshee: spy + "if there is another spy there, +3 attack."
  //   "Another spy" = any spy other than the one we just placed (incl.
  //   our own from an earlier turn, per a literal read of the printed
  //   text). Check spies count at the last-placed site after our placement;
  //   length > 1 means at least one was already there.
  'banshee':             sequence(
                           placeSpyAtChosenSite(),
                           (ctx => {
                             const siteId = (ctx.G as unknown as { _lastPlacedSpySite?: string })._lastPlacedSpySite;
                             if (!siteId) return true;
                             const spies = ctx.G.spies[siteId] ?? [];
                             if (spies.length > 1) {
                               ctx.G.players[ctx.actorId].power += 3;
                               ctx.G.log.push(`P${Number(ctx.actorId) + 1} +3 Power from Banshee (another spy at ${siteId})`);
                             }
                             return true;
                           })),
  // Cost 4 — Ogre Zombie: supplant a white troop anywhere
  'ogre-zombie':         supplantChoice({ whiteOnly: true, anywhere: true }),
  // Cost 4 — Revenant: assassinate 2 troops; if you have 8+ trophies,
  //   self-promote (move this card to inner circle). Self-promote = the
  //   played Revenant goes to inner circle instead of discard.
  'revenant':            (ctx => {
                           const me = ctx.G.players[ctx.actorId];
                           // First: pop the two assassinates as a sequence.
                           // We need to be re-entry-safe across the
                           // pendingChoice pause. Delegate to a composed
                           // handler and add the self-promote bonus at the
                           // end via handlerState.
                           // For simplicity here we use a synchronous
                           // approximation: queue 2 assassinates, then on
                           // completion, if trophies >= 8 push self into
                           // inner circle.
                           interface S { step: number; sub?: unknown }
                           const state = (ctx.handlerState as S | null) ?? { step: 0 };
                           // Step 0..1: run the 2 assassinates via times().
                           if (state.step < 2) {
                             const handler = assassinateChoice();
                             const sub: { handlerState: unknown; pendingChoice: import('../types').PendingChoice | null; paused: boolean | undefined } = {
                               handlerState: state.sub ?? null,
                               pendingChoice: ctx.pendingChoice ?? null,
                               paused: ctx.paused,
                             };
                             const childCtx = { ...ctx, ...sub } as typeof ctx;
                             const done = handler(childCtx);
                             ctx.pendingChoice = childCtx.pendingChoice;
                             ctx.paused = childCtx.paused;
                             if (!done) {
                               ctx.handlerState = { step: state.step, sub: childCtx.handlerState };
                               return false;
                             }
                             ctx.handlerState = { step: state.step + 1, sub: null };
                             if (state.step + 1 < 2) return false;
                           }
                           // After both assassinates: check trophies and
                           // optionally self-promote.
                           if (totalTrophies(me) >= 8) {
                             ctx.G.log.push(`P${Number(ctx.actorId) + 1} promoted Revenant (8+ trophies)`);
                             me.innerCircle.push({ ...ctx.card });
                             ctx.handlerState = { returnedToSupply: true };
                             return true;
                           }
                           ctx.handlerState = null;
                           return true;
                         }),

  // Cost 5 — Conjurer: chooseOne(place spy, return spy → recruit up to 2
  //   cards of cost ≤3). Uses recruitFromMarketFiltered twice with
  //   maxCost=3, optional declines.
  'conjurer':            chooseOne(
                           { label: 'Place a spy', handler: placeSpyAtChosenSite() },
                           { label: 'Return a spy → free-recruit up to 2 cards (cost ≤3)',
                             handler: sequence(
                               returnOwnSpyChoice(),
                               recruitFromMarketFiltered({ maxCost: 3 }),
                               recruitFromMarketFiltered({ maxCost: 3 }),
                             ),
                             available: playerHasOwnSpy }),
  // Cost 5 — Necromancer: chooseOne(+3 money, promote-from-discard OR
  //   promote-this OR promote-from-hand). Promote-from-discard is the
  //   most directly useful (we have a helper for it).
  'necromancer':         chooseOne(
                           { label: '+3 Influence', handler: grant({ influence: 3 }) },
                           { label: 'Promote a card from discard', handler: promoteFromDiscardChoice({ optional: true }) }),

  // Cost 6 — Death Knight: supplant a troop + 1 VP per 5 player trophies
  'death-knight':        sequence(
                           supplantChoice(),
                           (ctx => {
                             const me = ctx.G.players[ctx.actorId];
                             // "Player trophies" = colored trophies (not white).
                             let coloredTrophies = 0;
                             for (const [color, n] of Object.entries(me.trophyHall)) {
                               if (color === 'white') continue;
                               coloredTrophies += n;
                             }
                             const vp = Math.floor(coloredTrophies / 5);
                             if (vp > 0) {
                               me.vp += vp;
                               ctx.G.log.push(`P${Number(ctx.actorId) + 1} +${vp} VP from Death Knight (${coloredTrophies} player trophies)`);
                             }
                             return true;
                           })),
  // Cost 6 — Mummy Lord: choose twice: assassinate a white troop, OR
  //   take a white trophy from another player and place it. We surface
  //   the choice menu twice (the player can do either action, or both,
  //   or both-the-same).
  'mummy-lord':          times(2, chooseOne(
                           { label: 'Assassinate a white troop', handler: assassinateChoice({ whiteOnly: true }) },
                           { label: 'Take a trophy and place it', handler: takeTrophyAndPlace({ count: 1 }) })),
  // Cost 6 — High Priest of Myrkul: return another player's troop or spy
  //   + eot promote (Undead aspect filter — but Undead aspect varies on
  //   cards in this deck so we leave unrestricted for now).
  'high-priest-of-myrkul': sequence(returnEnemyTroopOrSpyChoice(), flagEotPromote()),

  // Cost 7 — Vampire: chooseOne(supplant a troop, promote a card from
  //   discard then +1 VP per 3 promoted cards in inner circle).
  'vampire':             chooseOne(
                           { label: 'Supplant a troop', handler: supplantChoice() },
                           { label: 'Promote from discard + VP-per-3-promoted',
                             handler: sequence(
                               promoteFromDiscardChoice({ optional: false }),
                               (ctx => {
                                 const me = ctx.G.players[ctx.actorId];
                                 const vp = Math.floor(me.innerCircle.length / 3);
                                 if (vp > 0) {
                                   me.vp += vp;
                                   ctx.G.log.push(`P${Number(ctx.actorId) + 1} +${vp} VP from Vampire (${me.innerCircle.length} promoted)`);
                                 }
                                 return true;
                               })) }),
  // Cost 7 — Lich: place a spy. If another player has a troop at that
  //   site, take 2 trophies from their hall and deploy them (as their
  //   original colors). Reuses takeTrophyAndPlace for the second half.
  //   The card text says "from THEIR trophy hall" (specifically the
  //   player with a troop at the spy site); our approximation lets
  //   the player pick any trophy from any opponent — strategically
  //   close in 2P, slightly more permissive in 3P/4P.
  'lich':                sequence(
                           placeSpyAtChosenSite(),
                           (ctx => {
                             const G = ctx.G;
                             const siteId = (G as unknown as { _lastPlacedSpySite?: string })._lastPlacedSpySite;
                             if (!siteId) return true;
                             const me = G.players[ctx.actorId];
                             // Any opponent with a troop at the spy site?
                             let opponentPresent = false;
                             for (const sp of TROOP_SPACES.filter(t => t.parentSite === siteId)) {
                               const occ = G.troops[sp.id];
                               if (occ && occ !== me.color && occ !== 'white') {
                                 opponentPresent = true;
                                 break;
                               }
                               void me; // keep TS happy when only the test runs
                             }
                             if (!opponentPresent) return true;
                             // Trigger the trophy-take-and-place flow inline.
                             return takeTrophyAndPlace({ count: 2 })(ctx);
                           })),
});

// Suppress unused-import noise.
void playerCanAssassinate;
void conditionalGrant;

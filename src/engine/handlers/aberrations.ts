// Aberrations half-deck handlers (expansion).
//
// Theme: forcing opponents to discard from hand, plus aboleth/ulitharid
// market-manipulation. Most card effects compose from existing helpers,
// with the new discard-from-opponent primitives in handler-helpers.ts.
//
// Card text source: assets/raw-card-data.csv + the Kelsam reference card
// in docs/. Some printed effects are partially implemented to start
// (TODO comments mark the gaps); iterate as we go.

import { grant, flagEotPromote, placeSpyAtChosenSite, sequence, registerAll, times,
         assassinateChoice, assassinateAtLastReturnedSpySite, deployChoice, chooseOne,
         returnOwnSpyChoice, returnEnemyTroopOrSpyChoice,
         eachOpponentDiscardsIfMinHand, chooseOpponentToDiscard,
         eachOpponentAtLastSpySiteDiscardsIfMinHand,
         forcePlayerOfColorToDiscardIfMinHand,
         registerOnForcedDiscard, playForeignCard,
         playerHasOwnSpy, playerCanAssassinate,
         playerCanReturnEnemyTroop, playerCanReturnEnemySpy } from '../handler-helpers';
import { Mechanics } from '../mechanics';
import { assassinateTroop, hasPresence } from '../map-state';
import { TROOP_SPACES } from '../../data/troop-spaces';
import { SITES } from '../../data/sites';
import { totalTrophies, type Color } from '../../game';

registerAll({
  // Cost 1 — Grimlock: deploy 2 troops; "if your opponent causes you to
  //   discard this, draw 2" — the reactive part isn't yet implemented
  //   (no engine hook for cards-discarded-by-other-player). Deploy fires.
  'grimlock':           deployChoice({ count: 2 }),

  // Cost 2 — Cranium Rats: deploy 2 + choose opponent with MORE THAN 3 cards
  //   (i.e. 4+) to discard. Cards read "more than 3 cards" — a player at
  //   exactly 3 keeps their hand.
  'cranium-rats':       sequence(deployChoice({ count: 2 }), chooseOpponentToDiscard(4)),
  // Cost 2 — Cloaker: spy / return spy to assassinate at that site
  'cloaker':            chooseOne(
                          { label: 'Place a spy', handler: placeSpyAtChosenSite() },
                          { label: 'Return a spy → assassinate at that site',
                            // assassinate is bound to the site of the returned spy,
                            // not "any space where you have presence" — otherwise
                            // returning your only spy at a site makes the site
                            // unreachable (#39).
                            handler: sequence(returnOwnSpyChoice(), assassinateAtLastReturnedSpySite()),
                            available: playerHasOwnSpy }),

  // Cost 3 — Chuul: spy + each opponent there with more than 3 cards (4+) discards
  'chuul':              sequence(placeSpyAtChosenSite(), eachOpponentAtLastSpySiteDiscardsIfMinHand(4)),
  // Cost 3 — Nothic: spy / return spy → draw + each-opponent-3+-discards
  'nothic':             chooseOne(
                          { label: 'Place a spy', handler: placeSpyAtChosenSite() },
                          { label: 'Return a spy → draw + each opp with 4+ cards discards',
                            handler: sequence(returnOwnSpyChoice(), grant({ draw: 1 }), eachOpponentDiscardsIfMinHand(4)),
                            available: playerHasOwnSpy }),
  // Cost 3 — Mindwitness: assassinate; the killed troop's OWNER discards
  //   a card if they have MORE THAN 3 cards (4+). Hand-rolled to capture
  //   the killed troop's color BEFORE the assassinate clears the slot.
  'mindwitness':        (ctx => {
                          const me = ctx.G.players[ctx.actorId];
                          // Phase 1: pick the assassinate target.
                          if (!ctx.pendingChoice) {
                            // Eligible: any space where you have presence
                            // occupied by an enemy/white troop. The earlier
                            // implementation skipped the presence check and
                            // let Mindwitness assassinate anywhere on the
                            // map — reported as #49. "Assassinate a troop"
                            // on a card inherits the rulebook constraint
                            // (p.13) unless the text says "anywhere."
                            const eligible: string[] = [];
                            for (const t of TROOP_SPACES) {
                              const occ = ctx.G.troops[t.id];
                              if (!occ || occ === me.color) continue;
                              const hasPres = t.parentSite
                                ? hasPresence(ctx.G, me.color, { site: t.parentSite })
                                : t.parentRoute
                                  ? hasPresence(ctx.G, me.color, { space: t.id })
                                  : false;
                              if (!hasPres) continue;
                              eligible.push(t.id);
                            }
                            if (eligible.length === 0) {
                              Mechanics.log(ctx.G, '(Mindwitness: no enemy/white targets — skipped)');
                              return true;
                            }
                            ctx.pendingChoice = {
                              kind: 'select-troop-space',
                              prompt: 'Mindwitness: assassinate a troop.',
                              options: eligible,
                              optional: true,
                            };
                            ctx.paused = true;
                            return false;
                          }
                          const spaceId = ctx.pendingChoice.response as string | null;
                          ctx.pendingChoice = null;
                          ctx.paused = false;
                          if (!spaceId) return true;
                          const killedColor = ctx.G.troops[spaceId];
                          if (!killedColor || killedColor === me.color) return true;
                          // Do the assassinate via map-state helper.
                          const killed = assassinateTroop(ctx.G, spaceId);
                          if (killed === 'white') me.trophyHall.white += 1;
                          else if (killed) me.trophyHall[killed] = (me.trophyHall[killed] ?? 0) + 1;
                          Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} assassinated ${killed} at ${spaceId}`);
                          // Force the owner of the killed color to discard.
                          if (killedColor !== 'white') {
                            const forceFn = forcePlayerOfColorToDiscardIfMinHand(killedColor as Color, ctx.actorId, 4);
                            forceFn(ctx);
                          }
                          return true;
                        }),
  // Cost 3 — Gauth: chooseOne(+2 money OR draw + force opponent with 4+ cards to discard)
  'gauth':              chooseOne(
                          { label: '+2 Influence', handler: grant({ influence: 2 }) },
                          { label: 'Draw a card, choose opp (4+ cards) to discard',
                            handler: sequence(grant({ draw: 1 }), chooseOpponentToDiscard(4)) }),
  // Cost 3 — Ambassador: eot promote + "if discarded by opponent, may
  //   promote it" — reactive part isn't implemented. Eot promote works.
  'ambassador':         flagEotPromote(),

  // Cost 4 — Intellect Devourer: 3 money OR return up to 2 troops/spies.
  //   The return-option is gated by `available`: if there are no enemy
  //   troops you have presence over AND no enemy spies at a site you have
  //   presence over, only the +3 Influence path is offered.
  //   (Reported via problem-report #35.)
  'intellect-devourer': chooseOne(
                          { label: '+3 Influence', handler: grant({ influence: 3 }) },
                          { label: 'Return up to 2 troops/spies',
                            handler: times(2, returnEnemyTroopOrSpyChoice()),
                            available: (G, actorId) => playerCanReturnEnemyTroop(G, actorId) || playerCanReturnEnemySpy(G, actorId) }),
  // Cost 4 — Umber Hulk: deploy 3 + reactive (if-discarded). Deploy fires;
  //   reactive deferred.
  'umber-hulk':         deployChoice({ count: 3 }),
  // Cost 4 — Spectator: +2 power +1 money
  'spectator':          grant({ power: 2, influence: 1 }),

  // Cost 5 — Quaggoth: assassinate a white troop for each site you control.
  //   Counts sites I control (per G.siteControl) and times the
  //   white-only assassinate by that.
  'quaggoth':           (ctx => {
                          const me = ctx.G.players[ctx.actorId];
                          let n = 0;
                          for (const site of SITES) {
                            if (ctx.G.siteControl[site.id] === me.color) n++;
                          }
                          if (n === 0) return true;
                          // Use a single multi-count assassinateChoice rather than
                          // times(n, single-shot) so the "(N left)" prompt counts
                          // down 3→2→1 instead of always showing "1 left" (#38).
                          return assassinateChoice({ count: n, whiteOnly: true })(ctx);
                        }),
  // Cost 5 — Beholder: assassinate a troop + 1 power per 3 trophies
  'beholder':           sequence(
                          assassinateChoice(),
                          (ctx => {
                            const me = ctx.G.players[ctx.actorId];
                            const n = Math.floor(totalTrophies(me) / 3);
                            if (n > 0) {
                              me.power += n;
                              ctx.G.log.push(`P${Number(ctx.actorId) + 1} +${n} Power from Beholder (${totalTrophies(me)} trophies)`);
                            }
                            return true;
                          })),
  // Cost 5 — Puppeteer: +2 money + eot promote
  'puppeteer':          sequence(grant({ influence: 2 }), flagEotPromote()),
  // Cost 5 — Brainwashed Slave: spy / return-spy → +2 power +2 money
  'brainwashed-slave':  chooseOne(
                          { label: 'Place a spy', handler: placeSpyAtChosenSite() },
                          { label: 'Return a spy → +2 Power +2 Influence',
                            handler: sequence(returnOwnSpyChoice(), grant({ power: 2, influence: 2 })),
                            available: playerHasOwnSpy }),

  // Cost 6 — Aboleth: chooseOne(place 2 spies, draw N where N = spies on board)
  //   The "draw per spy" half is a one-shot grant computed at play time.
  'aboleth':            chooseOne(
                          { label: 'Place 2 spies', handler: sequence(placeSpyAtChosenSite(), placeSpyAtChosenSite()) },
                          { label: 'Draw a card for each spy you have on the board',
                            available: (G, a) => {
                              const myColor = G.players[a].color;
                              for (const arr of Object.values(G.spies)) {
                                if (arr.includes(myColor)) return true;
                              }
                              return false;
                            },
                            handler: (ctx => {
                              const me = ctx.G.players[ctx.actorId];
                              let n = 0;
                              for (const arr of Object.values(ctx.G.spies)) {
                                if (arr.includes(me.color)) n++;
                              }
                              if (n <= 0) return true;
                              return grant({ draw: n })(ctx);
                            }) }),

  // Cost 7 — Neogi: deploy 4 + eot each-opp-discard (here we just discard
  //   immediately rather than queueing for end of turn; outcome is the
  //   same since no card-play happens between deploy and end-of-turn).
  'neogi':              sequence(deployChoice({ count: 4 }), eachOpponentDiscardsIfMinHand(4)),
  // Cost 7 — Death Tyrant: assassinate up to 3 troops at a single site +1
  //   money each. Approximate as 3 normal assassinates (the "at single
  //   site" restriction is a strategic narrowing; engine-wise the player
  //   can still pick targets independently). Money-per-kill TODO.
  'death-tyrant':       assassinateChoice({ count: 3, sameSite: true }),

  // Cost 7 — Elder Brain: promote your top card + play a card from
  //   inner-circle as if it were in hand (it stays in inner circle).
  'elder-brain':        sequence(
                          (ctx => {
                            const me = ctx.G.players[ctx.actorId];
                            if (me.deck.length === 0) return true;
                            const top = me.deck.shift()!;
                            // Reveals the top of your deck — bars within-turn undo.
                            Mechanics.markInfoRevealed(ctx.G);
                            me.innerCircle.push(top);
                            ctx.G.log.push(`P${Number(ctx.actorId) + 1} promoted ${top.name} from top of deck`);
                            return true;
                          }),
                          playForeignCard({
                            source: 'inner-circle',
                            cleanup: 'leave-in-place',
                            promptLabel: 'Elder Brain: play a card from your inner circle (stays there)',
                          })),
  // Cost 6 — Ulitharid: play a card in the market that costs 4 or less,
  //   then devour it.
  'ulitharid':          playForeignCard({
                          source: 'market',
                          maxCost: 4,
                          cleanup: 'devour-from-market',
                          promptLabel: 'Ulitharid: play a market card (cost ≤4) then devour it',
                        }),
});

// ---------- Reactive-on-forced-discard registrations ----------
//
// These fire when an OPPONENT's effect causes one of YOUR cards to be
// pushed from hand to discard. Owner-pid is in scope; offender-pid is the
// actor who triggered the discard.

// Grimlock — "if your opponent causes you to discard this, draw 2"
registerOnForcedDiscard('grimlock', (G, ownerPid) => {
  Mechanics.draw(G, ownerPid, 2);
  Mechanics.log(G, `P${Number(ownerPid) + 1} drew 2 (Grimlock reactive)`);
});

// Umber Hulk — "if an opponent causes you to discard this, they discard a card"
registerOnForcedDiscard('umber-hulk', (G, _ownerPid, offenderPid) => {
  const off = G.players[offenderPid];
  if (!off || off.hand.length === 0) return;
  const idx = off.hand.length - 1;
  const card = off.hand[idx];
  off.hand.splice(idx, 1);
  off.discard.push(card);
  Mechanics.log(G, `P${Number(offenderPid) + 1} discarded ${card.name} (Umber Hulk reactive)`);
  // Don't recursively fire reactives from Umber Hulk's discard — would be
  // a one-step chain in practice but skip for simplicity.
});

// Ambassador — "if you discard this, you may promote it"
registerOnForcedDiscard('ambassador', (G, ownerPid) => {
  const p = G.players[ownerPid];
  // Pop the just-pushed Ambassador and move to inner-circle. Auto-yes
  // (the option is strictly better than leaving it in discard since IC
  // VP is permanent and the card stays out of the cycling deck).
  const card = p.discard.pop();
  if (!card) return;
  p.innerCircle.push(card);
  Mechanics.log(G, `P${Number(ownerPid) + 1} promoted Ambassador from discard (reactive)`);
});

// Suppress unused-import warning if any helper isn't yet referenced.
void playerCanAssassinate;

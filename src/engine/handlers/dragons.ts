// Dragons half-deck handlers.

import { grant, flagEotPromote, placeSpyAtChosenSite, sequence, registerAll,
         assassinateChoice, deployChoice, supplantChoice, chooseOne,
         returnOwnSpyChoice, moveEnemyTroopChoice, conditionalGrant,
         ifAnotherPlayerTroopAtLastPlacedSpySite, devourMarketChoice,
         supplantAtLastPlacedSpySite, supplantAtLastReturnedSpySite,
         returnEnemyTroopOrSpyChoice, playerHasOwnSpy, playerCanAssassinate } from '../handler-helpers';
import { totalTrophies } from '../../game';
import type { EffectHandler } from '../types';
import { Mechanics } from '../mechanics';

/** Per Green Dragon's option-2 in-play text: +1 VP per site control marker
 *  the player currently holds. */
const grantVpPerControlMarkerHeld: EffectHandler = ctx => {
  const me = ctx.G.players[ctx.actorId];
  let n = 0;
  for (const m of Object.values(ctx.G.controlMarkers)) if (m.holder === me.color) n++;
  if (n > 0) {
    me.vp += n;
    Mechanics.log(ctx.G, `P${Number(ctx.actorId) + 1} +${n} VP from Green Dragon (control markers held)`);
  } else {
    Mechanics.log(ctx.G, `(Green Dragon: no control markers held — +0 VP)`);
  }
  return true;
};

registerAll({
  'red-wyrmling':         grant({ power: 2, influence: 2 }),
  'severin-silrajin':     grant({ power: 5 }),
  'rather-modar':         sequence(grant({ draw: 2 }), placeSpyAtChosenSite()),
  'wyrmspeaker':          sequence(grant({ influence: 1 }), flagEotPromote()),

  'enchanter-of-thay':    chooseOne(
                            { label: 'Place a spy', handler: placeSpyAtChosenSite() },
                            { label: 'Return a spy → +4 Power', handler: sequence(returnOwnSpyChoice(), grant({ power: 4 })), available: playerHasOwnSpy }),
  'green-wyrmling':       sequence(placeSpyAtChosenSite(), ifAnotherPlayerTroopAtLastPlacedSpySite(grant({ influence: 2 }))),
  'watcher-of-thay':      chooseOne(
                            { label: 'Place a spy', handler: placeSpyAtChosenSite() },
                            { label: 'Return a spy → +3 Influence', handler: sequence(returnOwnSpyChoice(), grant({ influence: 3 })), available: playerHasOwnSpy }),

  'blue-wyrmling':        sequence(grant({ influence: 3 }), returnEnemyTroopOrSpyChoice()),
  'cleric-of-laogzed':    sequence(flagEotPromote(), moveEnemyTroopChoice()),

  'cult-fanatic':         sequence(grant({ influence: 2 }), devourMarketChoice()),
  'dragon-cultist':       chooseOne(
                            { label: '+2 Power', handler: grant({ power: 2 }) },
                            { label: '+2 Influence', handler: grant({ influence: 2 }) }),

  'black-wyrmling':       sequence(grant({ influence: 1 }), assassinateChoice({ whiteOnly: true })),
  'kobold':               chooseOne(
                            { label: 'Deploy a troop', handler: deployChoice({ count: 1 }) },
                            { label: 'Assassinate a white troop', handler: assassinateChoice({ whiteOnly: true }),
                              available: (G, a) => playerCanAssassinate(G, a, { whiteOnly: true }) }),
  'white-wyrmling':       sequence(deployChoice({ count: 2 }), devourMarketChoice()),
  'dragonclaw':           sequence(
                            assassinateChoice(),
                            conditionalGrant(
                              (G, pid) => totalTrophies(G.players[pid]) >= 5,
                              grant({ power: 2 }),
                              '5+ trophies in trophy hall')),

  // Big dragons — in-play effect resolved here; final-scoring riders run automatically
  // from engine/scoring.ts (Black/Blue/Green/Red/White Dragon lookups).
  'black-dragon':         supplantChoice({ whiteOnly: true, anywhere: true }),
  'blue-dragon':          flagEotPromote({ count: 2 }),
  'green-dragon':         chooseOne(
                            { label: 'Place a spy + supplant a troop at that site', handler: sequence(placeSpyAtChosenSite(), supplantAtLastPlacedSpySite()) },
                            { label: 'Return a spy + supplant a troop at that site + 1 VP per control marker held', handler: sequence(returnOwnSpyChoice(), supplantAtLastReturnedSpySite(), grantVpPerControlMarkerHeld), available: playerHasOwnSpy }),
  'red-dragon':           sequence(supplantChoice(), returnOwnSpyChoice({ optional: true })),
  'white-dragon':         deployChoice({ count: 3 }),
});

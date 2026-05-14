// Dragons half-deck handlers.

import { grant, flagEotPromote, placeSpyAtChosenSite, sequence, registerAll, times,
         assassinateChoice, deployChoice, supplantChoice, chooseOne,
         returnOwnSpyChoice, moveEnemyTroopChoice, conditionalGrant,
         ifEnemyTroopAtLastPlacedSpySite, devourMarketChoice,
         supplantAtLastPlacedSpySite, supplantAtLastReturnedSpySite,
         returnEnemyTroopOrSpyChoice, playerHasOwnSpy } from '../handler-helpers';
import { totalTrophies } from '../../game';

registerAll({
  'red-wyrmling':         grant({ power: 2, influence: 2 }),
  'severin-silrajin':     grant({ power: 5 }),
  'rather-modar':         sequence(grant({ draw: 2 }), times(2, placeSpyAtChosenSite())),
  'wyrmspeaker':          sequence(grant({ influence: 1 }), flagEotPromote()),

  'enchanter-of-thay':    chooseOne(
                            { label: 'Place a spy', handler: placeSpyAtChosenSite() },
                            { label: 'Return a spy → +4 Power', handler: sequence(returnOwnSpyChoice(), grant({ power: 4 })), available: playerHasOwnSpy }),
  'green-wyrmling':       sequence(placeSpyAtChosenSite(), ifEnemyTroopAtLastPlacedSpySite(grant({ influence: 2 }))),
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
                            { label: 'Assassinate a white troop', handler: assassinateChoice({ whiteOnly: true }) }),
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
                            { label: 'Return a spy + supplant a troop at that site', handler: sequence(returnOwnSpyChoice(), supplantAtLastReturnedSpySite()), available: playerHasOwnSpy }),
  'red-dragon':           sequence(supplantChoice(), returnOwnSpyChoice({ optional: true })),
  'white-dragon':         deployChoice({ count: 3 }),
});

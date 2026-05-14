// Elemental half-deck handlers.
//
// Focus keyword is the major shared mechanic here — defer to a future pass that
// reads the per-turn aspect tally before applying the bonus effect.

import { grant, flagEotPromote, placeSpyAtChosenSite, sequence, registerAll,
         assassinateChoice, deployChoice, supplantChoice, chooseOne,
         returnOwnSpyChoice, focus, recruitFromMarketFiltered,
         returnOwnTroopOrSpyChoice, assassinateAtLastPlacedSpySite,
         playerHasOwnSpy } from '../handler-helpers';

registerAll({
  'aerisi-kalinoth':      sequence(grant({ power: 1 }), placeSpyAtChosenSite(), recruitFromMarketFiltered({ aspect: 'Guile', maxCost: 4 })),
  'air-elemental-myrmidon': sequence(placeSpyAtChosenSite(), flagEotPromote()),
  'fire-elemental-myrmidon': sequence(grant({ power: 2 }), flagEotPromote()),
  'water-elemental-myrmidon': sequence(assassinateChoice({ whiteOnly: true }), flagEotPromote()),
  'earth-elemental-myrmidon': sequence(grant({ influence: 2 }), flagEotPromote()),
  'imix':                 sequence(grant({ power: 4 }), focus('Malice', grant({ power: 2 }))),
  'ogremoch':             sequence(grant({ influence: 2 }), flagEotPromote(), focus('Ambition', flagEotPromote())),

  'black-earth-cultist':  sequence(flagEotPromote(), focus('Ambition', grant({ influence: 2 }))),
  'crushing-wave-cultist':sequence(assassinateChoice({ whiteOnly: true }), focus('Conquest', deployChoice({ count: 2 }))),
  'eternal-flame-cultist':sequence(assassinateChoice(), focus('Malice', grant({ power: 2 }))),
  'howling-hatred-cultist': sequence(
                            chooseOne(
                              { label: 'Place a spy', handler: placeSpyAtChosenSite() },
                              { label: 'Return a spy → +3 Influence', handler: sequence(returnOwnSpyChoice(), grant({ influence: 3 })), available: playerHasOwnSpy }),
                            focus('Guile', grant({ power: 1 }))),

  'air-elemental':        sequence(
                            chooseOne(
                              { label: 'Place a spy', handler: placeSpyAtChosenSite() },
                              { label: 'Return a spy → deploy 3 troops', handler: sequence(returnOwnSpyChoice(), deployChoice({ count: 3 })), available: playerHasOwnSpy }),
                            focus('Guile', grant({ draw: 1 }))),
  'earth-elemental':      sequence(grant({ influence: 1 }), returnOwnTroopOrSpyChoice(), focus('Guile', grant({ draw: 1 }))),
  'fire-elemental':       sequence(
                            chooseOne(
                              { label: '+2 Power', handler: grant({ power: 2 }) },
                              { label: '+2 Influence', handler: grant({ influence: 2 }) }),
                            focus('Malice', grant({ draw: 1 }))),
  'water-elemental':      sequence(deployChoice({ count: 2 }), focus('Conquest', grant({ draw: 1 }))),

  'gar-shatterkeel':      sequence(deployChoice({ count: 3 }), recruitFromMarketFiltered({ aspect: 'Conquest', maxCost: 4 })),
  'marlos-urnrayle':      sequence(grant({ influence: 1 }), flagEotPromote(), recruitFromMarketFiltered({ aspect: 'Ambition', maxCost: 4 })),
  'olhydra':              sequence(supplantChoice({ whiteOnly: true, anywhere: true }), focus('Conquest', deployChoice({ count: 2 }))),
  'vanifer':              sequence(assassinateChoice(), recruitFromMarketFiltered({ aspect: 'Malice', maxCost: 4 })),
  'yan-c-bin':            sequence(placeSpyAtChosenSite(), assassinateAtLastPlacedSpySite(), focus('Guile', placeSpyAtChosenSite())),
});

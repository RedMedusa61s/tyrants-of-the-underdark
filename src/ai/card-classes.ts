// Per-card classification for hand-play ordering. Used by the heuristic AI
// to decide which card in hand to play NEXT, given multiple legal choices.
//
// Categories (lower rank = play earlier):
//
//   1. 'hand'     — mutates the hand visibly: devour-from-hand cost cards
//                   (Marilith, Glabrezu, Mind Flayer, Balor, Demogorgon,
//                   Succubus, Orcus), draw-effect cards (Rather Modar),
//                   and Insane Outcast's discard-to-supply. Play FIRST so
//                   the rest of the hand has maximum flexibility for the
//                   prompts these surface.
//
//   2. 'power'    — pure +power grants and mixed P+I grants. Stockpile
//                   power BEFORE the tactical phase that spends it.
//
//   2. 'other'    — meta effects (end-of-turn promote queues, market /
//                   deck manipulation that doesn't affect THIS turn's
//                   tactical decisions). Bucketed with 'power' since the
//                   timing isn't sensitive.
//
//   3. 'tactical' — anything that touches the board: place / return spy,
//                   supplant, assassinate-via-effect, deploy-via-effect,
//                   move-troop, return-enemy. THE order-sensitive zone.
//                   Per user's notes: this is where careful sequencing
//                   matters (Master of Melee before Advance Scout, etc.).
//
//   4. 'influence' — pure +influence grants. Lock in influence total AFTER
//                    tactical actions are done, BEFORE the recruit step
//                    (which is handled separately, not via card play).
//
// Notes on edge cases:
//   - Mixed-resource cards (Red Wyrmling: +2P +2I) categorize as 'power'
//     since power is needed by the tactical phase that follows.
//   - chooseOne cards classify by the WORST-case option, conservatively —
//     e.g. Blackguard (+2P OR assassinate) is 'tactical' because if the AI
//     picks assassinate, ordering matters.
//   - Cards with devour-from-hand COST gate the rest of their effect on
//     paying — classify as 'hand' regardless of the gated effect's flavor.
//   - Cards with "give outcast to opponent" effects don't mutate OUR hand,
//     so they classify by their resource grant, not as 'hand'.

import { lookupCard } from '../card-data';
import type { CardRef } from '../game';

export type CardCategory = 'hand' | 'power' | 'tactical' | 'influence' | 'other';

const RANK: Record<CardCategory, number> = {
  hand: 1,
  power: 2,
  other: 2,        // bucket with power; timing isn't sensitive
  tactical: 3,
  influence: 4,
};

export function categoryRank(cat: CardCategory): number {
  return RANK[cat];
}

/** Hand-coded classification by effectKey. Built from src/engine/handlers/*.ts.
 *  Any effectKey not in this table falls back to 'other' (mid-priority). */
const TABLE: Record<string, CardCategory> = {
  // ---- Starter / aux-stack cards ----
  'noble':                'influence',
  'soldier':              'power',
  'house-guard':          'power',
  'priestess-of-lolth':   'influence',
  'insane-outcast':       'hand',

  // ---- Drow half-deck ----
  'spy-master':                 'tactical',
  'bounty-hunter':              'power',
  'mercenary-squad':            'tactical',
  'matron-mother':              'other',       // deck-to-discard + promote
  'advocate':                   'influence',   // chooseOne +2I or promote
  'drow-negotiator':            'influence',   // eot + conditional +3I
  'chosen-of-lolth':            'tactical',
  'council-member':             'tactical',
  'infiltrator':                'tactical',
  'information-broker':         'tactical',    // spy or return+draw
  'masters-of-sorcere':         'tactical',
  'spellspinner':               'tactical',
  'advance-scout':              'tactical',    // presence-required supplant
  'blackguard':                 'tactical',    // chooseOne +2P or assassinate
  'deathblade':                 'tactical',
  'doppelganger':               'tactical',
  'inquisitor':                 'tactical',
  'master-of-melee-magthere':   'tactical',
  'weaponmaster':               'tactical',
  'underdark-ranger':           'tactical',

  // ---- Dragons half-deck ----
  'red-wyrmling':       'power',       // +2P +2I, mixed → bias power
  'severin-silrajin':   'power',       // +5P
  'rather-modar':       'hand',        // draw 2 + 2 spies; draw dominates
  'wyrmspeaker':        'influence',
  'enchanter-of-thay':  'tactical',
  'green-wyrmling':     'tactical',
  'watcher-of-thay':    'tactical',
  'blue-wyrmling':      'tactical',
  'cleric-of-laogzed':  'tactical',
  'cult-fanatic':       'tactical',    // +2I + devour market
  'dragon-cultist':     'power',       // chooseOne +2P or +2I → mixed, bias power
  'black-wyrmling':     'tactical',
  'kobold':             'tactical',
  'white-wyrmling':     'tactical',
  'dragonclaw':         'tactical',
  'black-dragon':       'tactical',
  'blue-dragon':        'other',       // eot promote x2
  'green-dragon':       'tactical',
  'red-dragon':         'tactical',
  'white-dragon':       'tactical',

  // ---- Demons half-deck ----
  // give-outcast-to-opponent doesn't mutate OUR hand, so classify by grant.
  'myconid-adult':      'influence',
  'myconid-sovereign':  'other',       // eot + give outcast
  'ghoul':              'power',       // +2P + give outcast each
  'nalfeshnee':         'influence',   // +3I + promote top of deck
  'hezrou':             'tactical',    // move enemy + promote top
  // devour-from-hand cost gates all of these — play while hand is full.
  'marilith':           'hand',
  'glabrezu':           'hand',
  'mind-flayer':        'hand',
  'balor':              'hand',
  'demogorgon':         'hand',
  'orcus':              'hand',
  'succubus':           'hand',
  // gibbering-mouther: deploy + give outcast adjacent → tactical
  'gibbering-mouther':  'tactical',
  'jackalwere':         'tactical',
  'derro':              'tactical',
  'ettin':              'tactical',
  'grazzt':             'tactical',
  'night-hag':          'tactical',
  'vrock':              'tactical',
  // zuggtmoy: devour FROM INNER CIRCLE (not hand) + 3I + eot promote x2
  // → not a hand mutator. Bias influence.
  'zuggtmoy':           'influence',

  // ---- Elemental half-deck ----
  // Focus triggers are commutative (per-aspect chain tally); don't bump category.
  'aerisi-kalinoth':         'tactical',   // spy + auto-recruit
  'air-elemental-myrmidon':  'tactical',
  'fire-elemental-myrmidon': 'power',
  'water-elemental-myrmidon':'tactical',
  'earth-elemental-myrmidon':'influence',
  'imix':                    'power',
  'ogremoch':                'influence',
  'black-earth-cultist':     'influence',  // eot + focus(+2I)
  'crushing-wave-cultist':   'tactical',
  'eternal-flame-cultist':   'tactical',
  'howling-hatred-cultist':  'tactical',
  'air-elemental':           'tactical',
  'earth-elemental':         'tactical',   // includes return-own-troop-or-spy
  'fire-elemental':          'power',      // chooseOne +2P/+2I → mixed, bias power
  'water-elemental':         'tactical',
  'gar-shatterkeel':         'tactical',
  'marlos-urnrayle':         'tactical',   // +1I + eot + auto-recruit
  'olhydra':                 'tactical',
  'vanifer':                 'tactical',
  'yan-c-bin':               'tactical',
};

export function categoryOf(effectKey: string): CardCategory {
  return TABLE[effectKey] ?? 'other';
}

/** Convenience: category for a CardRef. */
export function categoryOfCard(card: CardRef): CardCategory {
  const data = lookupCard(card.deck, card.slot);
  return data ? categoryOf(data.effectKey) : 'other';
}

// Static house data — names + printed rules text + ability shape. No game
// logic lives here (that's houses/handlers/*.ts); this file is safe to
// import from UI code (Lobby picker, House Bar) without pulling in
// Mechanics / the engine. Mirrors card-data.ts's role for cards.
//
// ICON-AMOUNT ASSUMPTIONS: a few printed abilities show a single unlabeled
// resource icon with no explicit number (the source scan doesn't disambiguate
// icon counts precisely). Where ambiguous, the text below states the assumed
// value (defaulting to this game's usual "one icon = 1 unit" convention,
// e.g. Noble/Soldier). Each handler in houses/handlers/ implements exactly
// the amount stated here — if you have the physical cards, correct both
// together.

import type { HouseId } from './types';

export interface HouseAbilityData {
  /** Unique within the house (e.g. 'silken-snare'). Used as the `houseAction`
   *  move argument and as the pendingChoice cardKey suffix. */
  key: string;
  name: string;
  /** Rules text shown in the House Bar / Lobby preview. */
  text: string;
  kind: 'passive' | 'action';
  /** Only meaningful for 'action' abilities. Omit for unlimited-use actions. */
  frequency?: 'turn' | 'game';
  /** Only meaningful for 'action' abilities. True = this ability isn't a
   *  player-clicked button; instead it's automatically offered (as a
   *  pendingChoice, same as the end-of-turn "promote a played card"
   *  prompts) when the player tries to end their turn, once per turn.
   *  See game.ts's `endTurn` move / `tryHouseEndOfTurnAbility`. */
  endOfTurn?: boolean;
}

export interface HouseData {
  id: HouseId;
  name: string;
  /** Flavor line printed on the house card, shown in the House Bar / Lobby
   *  preview / House info popup. */
  motto?: string;
  abilities: HouseAbilityData[];
}

export const HOUSES: HouseData[] = [
  {
    id: 'do-urden',
    name: "Do'Urden",
    motto: 'Only fools rush. The wise prepare.',
    abilities: [
      {
        key: 'silken-snare',
        name: 'Silken Snare',
        text: 'Once per turn: Set aside 1 card from your hand face down. At the start of your next turn, reveal that card and return it to your hand.',
        kind: 'action',
        frequency: 'turn',
      },
      {
        key: 'venomous-precision',
        name: 'Venomous Precision',
        text: 'When you play the card returned with Silken Snare, gain +1 Power if it was a Malice or a Conquest card, or +1 Influence if it was a Guile or an Ambition card.',
        kind: 'passive',
      },
    ],
  },
  {
    id: 'fey-branche',
    name: 'Fey-Branche',
    motto: 'The city watches — and Lolth remembers who honors her most loudly.',
    abilities: [
      {
        key: 'ceremonial-elevation',
        name: 'Ceremonial Elevation',
        text: 'Whenever you recruit a card that costs 6 or more Influence, gain 1 Victory Point.',
        kind: 'passive',
      },
      {
        key: 'ritual-exhibition',
        name: 'Ritual Exhibition',
        text: 'During your turn: Look at the top card of the Market Deck. You may recruit that card.',
        kind: 'action',
        frequency: 'turn',
      },
    ],
  },
  {
    id: 'agrach-dyrr',
    name: 'Agrach Dyrr',
    motto: 'Death is not an ending. It is an opportunity.',
    abilities: [
      {
        key: 'tunnel-patrols',
        name: 'Tunnel Patrols',
        text: 'Once at the end of your turn: you may move one of your troops to an adjacent tunnel or site (troop spot). Offered automatically when you end your turn.',
        kind: 'action',
        endOfTurn: true,
      },
      {
        key: 'lich-matrons-claim',
        name: "The Lich-Matron's Claim",
        text: "Once per turn: Remove 1 troop from your Trophy Hall to return one of your troops from an opponent's Trophy Hall to your barracks. You may immediately deploy it for free.",
        kind: 'action',
        frequency: 'turn',
      },
    ],
  },
  {
    id: 'nasadra',
    name: 'Nasadra',
    motto: 'Ched Nasad stands because we will it so.',
    abilities: [
      {
        key: 'first-house-privilege',
        name: "The First House's Privilege",
        text: 'At the start of the game, deploy 3 troops to your starting site instead of 1, and draw 1 additional card for your first turn.',
        kind: 'passive',
      },
      {
        key: 'web-of-debts',
        name: 'Web of Debts',
        text: "Remove a card from the market row and place it face up in front of you. That card is reserved for you and may only be recruited by you — when you recruit it, it costs 1 less Influence. You can't use Web of Debts while you have a reserved card.",
        kind: 'action',
        frequency: 'turn',
      },
    ],
  },
  {
    id: 'baenre',
    name: 'Baenre',
    motto: 'Power is not seized. It is acknowledged.',
    abilities: [
      {
        key: 'lolths-favor',
        name: "Lolth's Favor",
        text: 'At the start of your turn, if you control 4 or more sites, gain 1 Power.',
        kind: 'passive',
      },
      {
        key: 'absolute-rule',
        name: 'Absolute Rule',
        text: 'Once per game, when you have total control of a site with a control marker: Promote up to 3 cards from your played cards and/or discard pile for free.',
        kind: 'action',
        frequency: 'game',
      },
    ],
  },
  {
    id: 'barrison-delarmgo',
    name: "Barrison Del'Armgo",
    motto: 'A city taken is a city held.',
    abilities: [
      {
        key: 'conquest-doctrine',
        name: 'Conquest Doctrine',
        text: 'Once per turn: When you gain total control of a site, you may deploy 1 troop.',
        kind: 'action',
        frequency: 'turn',
      },
      {
        key: 'security-sweep',
        name: 'Security Sweep',
        text: 'Your "Return an enemy spy" base action costs 2 Power instead of 3.',
        kind: 'passive',
      },
    ],
  },
  {
    id: 'faen-tlabbar',
    name: 'Faen Tlabbar',
    motto: 'A whispered secret can rule where armies fail.',
    abilities: [
      {
        key: 'eyes-everywhere',
        name: 'Eyes Everywhere',
        text: 'Once per game, when you gain control of a site with a control marker: Place 1 spy.',
        kind: 'action',
        frequency: 'game',
      },
      {
        key: 'deep-cover',
        name: 'Deep Cover',
        text: 'Your spies count as troops for presence and control.',
        kind: 'passive',
      },
      {
        key: 'web-of-informants',
        name: 'Web of Informants',
        text: 'Once per turn: if you have 3 spies in play, gain 1 Influence; if you have 5 spies, gain 1 Power and 1 Influence instead.',
        kind: 'passive',
      },
    ],
  },
  {
    id: 'xorlarrin',
    name: 'Xorlarrin',
    motto: "Progress demands sacrifice — preferably someone else's.",
    abilities: [
      {
        key: 'forbidden-knowledge',
        name: 'Forbidden Knowledge',
        text: 'Once per turn: If you have total control of a site with a control marker, you may devour a card from your hand to gain 2 Power.',
        kind: 'action',
        frequency: 'turn',
      },
      {
        key: 'unstable-ritual',
        name: 'Unstable Ritual',
        text: 'Once per turn: Pay 1 Power to draw 1 card, then discard 1 card.',
        kind: 'action',
        frequency: 'turn',
      },
    ],
  },
  {
    id: 'hunett',
    name: "Hun'ett",
    motto: 'Every death buys another favor.',
    abilities: [
      {
        key: 'death-from-the-shadows',
        name: 'Death from the Shadows',
        text: "Return one of your spies to assassinate a troop at that site. (Printed text also lets a would-be white-troop assassination redirect to another player's troop there — not modeled; any troop at the site, white or otherwise, is a legal target here.)",
        kind: 'action',
      },
      {
        key: 'paid-in-blood',
        name: 'Paid in Blood',
        text: 'Once per turn, when you assassinate a troop: gain 1 Power.',
        kind: 'passive',
      },
    ],
  },
  {
    id: 'mizzrym',
    name: 'Mizzrym',
    motto: 'Everything has a price — we simply decide when it is paid.',
    abilities: [
      {
        key: 'shrewd-bargains',
        name: 'Shrewd Bargains',
        text: 'Once per turn, choose one: pay 2 Power to gain 2 Influence, or pay 2 Influence to gain 2 Power.',
        kind: 'action',
        frequency: 'turn',
      },
      {
        key: 'shadow-investment',
        name: 'Shadow Investment',
        text: "Once per turn, if you control a site with a control marker: Discard a card to place 1 Victory Point token on a card in the market row. If that card leaves the market row during another player's turn, gain all VP on it.",
        kind: 'action',
        frequency: 'turn',
      },
    ],
  },
  {
    id: 'oblodra',
    name: 'Oblodra',
    motto: 'Your thoughts were never truly yours.',
    abilities: [
      {
        key: 'precognitive-glimpse',
        name: 'Precognitive Glimpse',
        text: 'Once per turn: Look at the top card of your deck. Put it back, discard it, or put it on the bottom of your deck.',
        kind: 'action',
        frequency: 'turn',
      },
      {
        key: 'psionic-storm',
        name: 'Psionic Storm',
        text: 'Once per turn: Pay 2 Power to shuffle all cards in the market row into the market deck, then refill the market row.',
        kind: 'action',
        frequency: 'turn',
      },
    ],
  },
  {
    id: 'melarn',
    name: 'Melarn',
    motto: 'Devotion is the foundation of power.',
    abilities: [
      {
        key: 'established-shrines',
        name: 'Established Shrines',
        text: "On your first turn, you may deploy 1 troop to an empty starting site for free. (Printed as \"empty black site\" — the starting sites are what's meant; any starting site with no troops on it yet qualifies.)",
        kind: 'action',
        frequency: 'turn',
      },
      {
        key: 'exalted-priesthood',
        name: 'Exalted Priesthood',
        text: 'If you have at least 4 cards in your Inner Circle, your Priestess of Lolth cards provide +1 Power in addition to their normal effect.',
        kind: 'passive',
      },
      {
        key: 'rite-of-ascension',
        name: 'Rite of Ascension',
        text: 'Once per turn, if you have total control of a site with a control marker and fewer than 4 cards in your Inner Circle: Promote 1 card you played this turn.',
        kind: 'action',
        frequency: 'turn',
      },
    ],
  },
];

export const HOUSES_BY_ID: Record<HouseId, HouseData> = Object.fromEntries(
  HOUSES.map(h => [h.id, h])
) as Record<HouseId, HouseData>;

export function houseAbility(houseId: HouseId, key: string): HouseAbilityData | undefined {
  return HOUSES_BY_ID[houseId]?.abilities.find(a => a.key === key);
}

// Pre-flight target checks for cards that can completely whiff.
//
// Some cards have a mandatory primary effect that requires specific board
// state to do anything — playing Advance Scout when no white troops sit
// at a site you have presence at just burns the card. The engine logs a
// `(supplant: no eligible targets — skipped)` line and the card goes to
// discard with no effect. The UI uses these predicates to surface a
// confirmation BEFORE the player commits, so they can hold the card
// for a later turn instead. (Cards with ChooseOne fallbacks or pure
// resource grants never whiff and aren't checked here.)
//
// The predicates intentionally mirror the eligibility filters inside
// handler-helpers.ts (supplantChoice / assassinateChoice). If those
// filters change shape, update here too — keep them in lockstep.

import type { TyrantsState, Color } from '../game';
import { TROOP_SPACES } from '../data/troop-spaces';
import { spacesWithPresence } from './handler-helpers';

interface SupplantOpts { whiteOnly?: boolean; anywhere?: boolean }
interface AssassinateOpts { whiteOnly?: boolean }

function legalSupplantTargets(G: TyrantsState, color: Color, opts: SupplantOpts): string[] {
  const source = opts.anywhere
    ? TROOP_SPACES.map(t => t.id).filter(id => id in G.troops)
    : spacesWithPresence(G, color);
  return source.filter(id => {
    const occ = G.troops[id];
    return occ && occ !== color && (!opts.whiteOnly || occ === 'white');
  });
}

function legalAssassinateTargets(G: TyrantsState, color: Color, opts: AssassinateOpts): string[] {
  return spacesWithPresence(G, color).filter(id => {
    const occ = G.troops[id];
    return occ && occ !== color && (!opts.whiteOnly || occ === 'white');
  });
}

/** Returns null if the card has no whiff risk (always does something
 *  meaningful given current state), otherwise a short reason string the
 *  UI can show to the player. */
export function cardWhiffReason(G: TyrantsState, pid: string, effectKey: string): string | null {
  const me = G.players[pid];
  if (!me) return null;
  const color = me.color;
  switch (effectKey) {
    // Pure presence-required supplants.
    case 'advance-scout':
      if (legalSupplantTargets(G, color, { whiteOnly: true }).length === 0) {
        return 'no white troops at sites where you have presence';
      }
      return null;
    case 'doppelganger':
      if (legalSupplantTargets(G, color, {}).length === 0) {
        return 'no enemy/white troops at sites where you have presence';
      }
      return null;

    // Pure assassinate cards (no resource fallback).
    case 'deathblade':
      if (legalAssassinateTargets(G, color, {}).length === 0) {
        return 'no enemy/white troops you can reach';
      }
      return null;
    case 'underdark-ranger':
      if (legalAssassinateTargets(G, color, { whiteOnly: true }).length === 0) {
        return 'no white troops you can reach';
      }
      return null;

    // Pure white-assassinate elemental cards.
    case 'water-elemental-myrmidon':
    case 'crushing-wave-cultist':
      if (legalAssassinateTargets(G, color, { whiteOnly: true }).length === 0) {
        return 'no white troops you can reach';
      }
      return null;
    case 'eternal-flame-cultist':
      if (legalAssassinateTargets(G, color, {}).length === 0) {
        return 'no enemy/white troops you can reach';
      }
      return null;

    // Other cards we don't currently check (chooseOne cards always have a
    // fallback option; pure resource grants always work; deploy effects
    // almost always work because barracks have stock; place-spy almost
    // always works because there's always an in-play site without your
    // spy unless you've been very active).
    default:
      return null;
  }
}

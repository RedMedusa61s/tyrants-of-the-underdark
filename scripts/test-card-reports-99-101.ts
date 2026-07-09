// Investigation harness for in-game reports #99 (Aboleth), #100 (Fire Elemental
// focus), #101 (Dragonclaw). Drives each card's handler directly to confirm
// whether the printed effect resolves correctly.
import { InitializeGame } from 'boardgame.io/internal';
import '../src/engine/handlers'; // register handlers
import { CardRegistry } from '../src/engine/registry';
import { placeSpy } from '../src/engine/map-state';
import { TyrantsGame, type TyrantsState } from '../src/game';

let ok = true;
const check = (label: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) ok = false;
};

function fresh(): TyrantsState {
  const init = (InitializeGame({ game: TyrantsGame as never, numPlayers: 4 }) as unknown as { G: TyrantsState }).G;
  return structuredClone(init);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctxFor = (G: TyrantsState): any =>
  ({ G, actorId: '0', card: { deck: 'x', slot: 0 }, handlerState: null, pendingChoice: null, paused: false });

// Pick N distinct site ids to plant spies on.
function someSites(G: TyrantsState, n: number): string[] {
  return Object.keys(G.siteControl).slice(0, n);
}

// ---------- #99 Aboleth: draw one card per spy on board ----------
{
  const G = fresh();
  const me = G.players['0'];
  const color = me.color;
  const sites = someSites(G, 3);
  for (const s of sites) placeSpy(G, color, s);
  // stock the deck so draws have cards
  me.deck = Array.from({ length: 10 }, () => ({ deck: 'starter-1', slot: 44, name: 'Soldier', image: '' }));
  const handStart = me.hand.length;

  const h = CardRegistry.get('aboleth')!;
  const ctx = ctxFor(G);
  h(ctx); // presents chooseOne prompt
  const opts = ctx.pendingChoice.options as string[];
  const drawIdx = opts.findIndex(o => /draw/i.test(o));
  check('#99 Aboleth offers the "draw per spy" option', drawIdx >= 0);
  ctx.pendingChoice.response = drawIdx;
  h(ctx); // resolves draw
  const drawn = me.hand.length - handStart;
  check(`#99 Aboleth with 3 spies draws 3 cards (drew ${drawn})`, drawn === 3);
}

// ---------- #101 Dragonclaw: +2 power with 5+ player (colored) trophies ----------
{
  const G = fresh();
  const me = G.players['0'];
  me.trophyHall = { black: 3, red: 2, orange: 0, blue: 0, white: 4 }; // 5 colored, 4 white
  const powerStart = me.power;
  const h = CardRegistry.get('dragonclaw')!;
  const ctx = ctxFor(G);
  // Dragonclaw = sequence(assassinate, +2power-if-5-colored). Resolve assassinate
  // by declining/exhausting: drive until no pendingChoice or it completes.
  let guard = 0;
  let done = h(ctx);
  while (!done && ctx.pendingChoice && guard++ < 20) {
    ctx.pendingChoice.response = null; // decline assassinate target
    done = h(ctx);
  }
  const gained = me.power - powerStart;
  check(`#101 Dragonclaw with 5 colored trophies grants +2 power (gained ${gained})`, gained === 2);
}
// Control: 4 colored trophies → no bonus
{
  const G = fresh();
  const me = G.players['0'];
  me.trophyHall = { black: 2, red: 2, orange: 0, blue: 0, white: 10 }; // 4 colored, 10 white
  const powerStart = me.power;
  const h = CardRegistry.get('dragonclaw')!;
  const ctx = ctxFor(G);
  let guard = 0;
  let done = h(ctx);
  while (!done && ctx.pendingChoice && guard++ < 20) { ctx.pendingChoice.response = null; done = h(ctx); }
  const gained = me.power - powerStart;
  check(`#101 control: 4 colored + 10 white trophies grants NO power (gained ${gained})`, gained === 0);
}

// ---------- #100 Fire Elemental: Malice focus draws via chain ----------
{
  const G = fresh();
  const me = G.players['0'];
  me.deck = Array.from({ length: 10 }, () => ({ deck: 'starter-1', slot: 44, name: 'Soldier', image: '' }));
  // In real play, moves.play tallies the CURRENT card's aspect before the
  // handler runs. So "one prior Malice card + Fire Elemental itself" = 2.
  G.turnAspectsPlayed = { malice: 2 };
  const handStart = me.hand.length;
  const powerStart = me.power;

  const h = CardRegistry.get('fire-elemental')!;
  const ctx = ctxFor(G);
  h(ctx); // chooseOne prompt (+2 power / +2 influence)
  const opts = ctx.pendingChoice.options as string[];
  const powIdx = opts.findIndex(o => /power/i.test(o));
  ctx.pendingChoice.response = powIdx;
  let guard = 0;
  let done = h(ctx);
  while (!done && guard++ < 20) {
    // any follow-up prompt (focus reveal) — accept if present
    if (ctx.pendingChoice) ctx.pendingChoice.response = (ctx.pendingChoice.options as unknown[])?.[0] ?? null;
    done = h(ctx);
  }
  const drawn = me.hand.length - handStart;
  check(`#100 Fire Elemental +2 power applied (gained ${me.power - powerStart})`, me.power - powerStart === 2);
  check(`#100 Fire Elemental Malice focus (chain) draws 1 card (drew ${drawn})`, drawn === 1);
}

// ---------- #100c Fire Elemental: focus via REVEAL from hand ----------
{
  const G = fresh();
  const me = G.players['0'];
  me.deck = Array.from({ length: 10 }, () => ({ deck: 'starter-1', slot: 44, name: 'Soldier', image: '' }));
  // Only Fire Elemental is Malice this turn (count 1, no chain), BUT a Malice
  // card sits in hand — the reveal path should offer it and draw on reveal.
  G.turnAspectsPlayed = { malice: 1 };
  me.hand = [{ deck: 'aberrations', slot: 18, name: 'Spectator', image: '' }]; // Malice
  const handStart = me.hand.length;

  const h = CardRegistry.get('fire-elemental')!;
  const ctx = ctxFor(G);
  h(ctx);
  let opts = ctx.pendingChoice.options as string[];
  ctx.pendingChoice.response = opts.findIndex(o => /power/i.test(o));
  let guard = 0;
  let done = h(ctx);
  let sawRevealPrompt = false;
  while (!done && guard++ < 20) {
    if (ctx.pendingChoice && ctx.pendingChoice.kind === 'select-card-in-hand') {
      sawRevealPrompt = true;
      ctx.pendingChoice.response = (ctx.pendingChoice.options as number[])[0]; // reveal the Malice card
    } else if (ctx.pendingChoice) {
      ctx.pendingChoice.response = null;
    }
    done = h(ctx);
  }
  const drawn = me.hand.length - handStart;
  check('#100c Fire Elemental offers reveal-from-hand prompt', sawRevealPrompt);
  check(`#100c revealing a Malice card draws 1 (drew ${drawn})`, drawn === 1);
}

// ---------- #100b Fire Elemental: NO focus when no other Malice card ----------
{
  const G = fresh();
  const me = G.players['0'];
  me.deck = Array.from({ length: 10 }, () => ({ deck: 'starter-1', slot: 44, name: 'Soldier', image: '' }));
  // Only Fire Elemental itself is Malice this turn; no Malice card in hand.
  G.turnAspectsPlayed = { malice: 1 };
  me.hand = [{ deck: 'starter-1', slot: 42, name: 'Noble', image: '' }]; // Obedience, not Malice
  const handStart = me.hand.length;
  const h = CardRegistry.get('fire-elemental')!;
  const ctx = ctxFor(G);
  h(ctx);
  const opts = ctx.pendingChoice.options as string[];
  ctx.pendingChoice.response = opts.findIndex(o => /power/i.test(o));
  let guard = 0; let done = h(ctx);
  while (!done && guard++ < 20) { if (ctx.pendingChoice) ctx.pendingChoice.response = null; done = h(ctx); }
  const drawn = me.hand.length - handStart;
  check(`#100b no other Malice card + none in hand → no draw (drew ${drawn})`, drawn === 0);
}

console.log(ok ? '\nALL CARD-REPORT TESTS PASSED' : '\nSOME TESTS FAILED');
process.exit(ok ? 0 : 1);

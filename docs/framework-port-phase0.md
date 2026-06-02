# Framework Port — Phase 0 Survey

Read-only survey of *Tyrants of the Underdark* against the Digital Boardgame
Framework's `GameAdapter` contract. No code was changed. This documents what the
integration will require and flags the structural obstacles to resolve before
Phase 1.

**Headline:** This is **not** a clean drop-in like Star Wars Rebellion. The game
is built on **boardgame.io** — the exact runtime dependency the framework was
created to avoid — and its engine **mutates state in place** (Immer-backed
proxies). The good news: RNG is already seeded/deterministic, the State is plain
serializable data, and the action vocabulary is small and well-bounded. The work
is real but mechanical; the risks are known and addressable.

## 1. Tech stack & layout

TypeScript + Vite + React 19 (`package.json:25-41`). Build is
`tsc --noEmit && vite build`. Notably depends on **`boardgame.io ^0.50.2`**
(`package.json:30`) — this is the framework's one forbidden runtime dep
(project CLAUDE.md "Don't" list; framework `decisions.md`). It also pulls in
`sharp`, `tesseract.js`, `html2canvas` for the asset/OCR tooling (build-time
only, not gameplay).

`src/` top level (`README.md:97-111`, confirmed by file listing):
- `ai/` — random + heuristic + lookahead decision-makers, tournament runner
- `components/` — React UI (MapView, dialogs, calibration tabs)
- `data/` — sites, routes, troop-spaces (static board data)
- `engine/` — card-effect handlers, `map-state`, `mechanics`, `registry`,
  `scoring`, `types`
- `game.ts` — the **boardgame.io `Game` definition** (state, moves, turn machine)
- `App.tsx` — top-level shell + the AI driver loop

`worker/` is a single Cloudflare Worker for bug-report/game-log relay (see §5).

Scripts: `dev`, `build`, `preview`, plus headless harnesses (`sim`,
`tournament`, `tune`, `replay-divergence`, `recruit-divergence`) — these already
run the engine outside React, which is encouraging for adapter testability.

## 2. GameState shape

Central type: **`TyrantsState`** in `src/game.ts:103-221`. It is **plain,
JSON-serializable data** — no class instances, no `Map`/`Set`, no functions:
- `market: { deck: CardRef[]; row: (CardRef|null)[] }`, `auxStacks` counters
- `players: Record<string, PlayerData>` — each `PlayerData` (`game.ts:30-49`)
  holds `deck/hand/discard/innerCircle` arrays of `CardRef`, plus `trophyHall`
  (`Record<Color|'white', number>`), `barracksLeft`, `spiesLeft`, `power`,
  `influence`, `vp`
- Map state: `troops`, `spies`, `siteControl`, `controlMarkers` — all plain
  `Record<>` objects (`game.ts:124-132`)
- Bookkeeping: `pendingChoice`, `pausedHandlerState: unknown`, per-turn tallies,
  `log: string[]`, `snapshots`, `turnLogs`, `undoStack`, `devouredPile`, etc.

`CardRef` is `{ deck, slot, name, image }` (`game.ts:23-28`) — fully serializable.
The codebase already round-trips the whole state through base64-JSON
(`encodeSnapshot`/`decodeSnapshot`, `game.ts:311-339`), which is direct proof it
is `jsonCodec`-compatible. **Good fit for `jsonCodec` with no class rehydration.**

One nuance: `pausedHandlerState: unknown` (`game.ts:122`) is opaque per-card
suspend state. It is serialized today (it's a field on the encoded state), so it
survives the codec — but the adapter must ensure handlers only ever stash plain
data there. Worth a spot-check in Phase 1.

## 3. Engine entry points — PURE vs MUTATE

**This is the central obstacle.** Player actions are boardgame.io **moves** in
`game.ts:607-1036`: `deployStartingTroop`, `playCard`, `resolveChoice`,
`recruitFromMarket`, `recruitFromAuxStack`, `deployTroop`, `assassinateTroop`,
`returnEnemySpy`, `loadState`, `undo`, `endTurn`. Each move receives
`{ G, ctx, events, random }` and **mutates `G` in place** under boardgame.io's
Immer proxy (e.g. `p.hand.splice(...)` `game.ts:647`; `G.log.push(...)`;
`G.pendingChoice = {...}` `game.ts:680`). Card-effect handlers do the same —
`EffectContext.G` is documented as "handlers mutate this directly under
boardgame.io's Immer-backed proxy" (`engine/types.ts:53`).

The framework requires `applyAction(state, action, actor): State` to be **pure
and deterministic** (`adapter-spec.md:9-13`). The engine is neither in shape:
- It relies on Immer to turn mutation into a new immutable state.
- It relies on `events.endTurn()` and `ctx.currentPlayer` from boardgame.io's
  turn machine — not plain return values.

**Implication:** the adapter seam must `structuredClone(state)` on entry, then
run the mutation against the clone, then advance the turn machine logic by hand,
then return the clone. Either we (a) keep boardgame.io's reducer and drive it
through the adapter (the `App.tsx` AI lookahead already does exactly this — it
builds the reducer and calls it on cloned states, `App.tsx:561-585`), or (b)
extract the move bodies + turn machine into a framework-free pure `apply()`. (a)
is faster to stand up; (b) is the clean long-term answer and what the framework
wants (no boardgame.io runtime dep). This is the **largest single decision for
Phase 1.**

## 4. RNG / shuffling — the #1 risk (mostly already handled)

Encouraging finding: the deckbuilder randomness is **already seeded and
deterministic** via boardgame.io's `random` plugin, not ad-hoc `Math.random()`:
- Setup shuffles via `rng = () => random!.Number()` (`game.ts:390`), used for
  starting decks (`game.ts:413`), market deck (`game.ts:429`), and first-player
  pick (`game.ts:460`).
- End-of-turn hand reshuffle uses the seeded RNG:
  `shuffle(p.discard, random ? () => random.Number() : () => Math.random())`
  (`game.ts:594`) — the `Math.random()` is a *fallback* only "if random is
  unavailable (very old saves replayed outside a bgio context)".
- Handlers thread it too: `mechanics.ts:56` and `handler-helpers.ts:1059` both
  use `ctx.random ? () => ctx.random!.Number() : () => Math.random()`.

So the engine already treats RNG as plumbed-through-state-equivalent (bgio holds
the seed/`randomState` in its internal ctx). **The risk is that the framework
holds no equivalent of bgio's `random` plugin.** When we leave boardgame.io, the
seed currently living in bgio's `ctx._random` has no home in `TyrantsState`. We
must add a seeded `Rng` (the framework ships `src/core/Rng`) **into `TyrantsState`
itself**, seed it in `initialState`, and advance+re-store it on every shuffle so
replays reproduce. Every call site listed above must be repointed at the
in-state `Rng`.

**Residual hazards — non-deterministic `Math.random()` that must NOT reach the
authoritative engine path:**
- `App.tsx:1517` — half-deck pool shuffle for *new-game setup UI* (acceptable if
  it only seeds game creation, but it makes setup non-reproducible; move into
  seeded setup).
- `ai/random-ai.ts` (many, e.g. `:32,:39,:111`) and `ai/heuristic-ai.ts:100` —
  AI uses raw `Math.random()`. Fine **locally**, but online the AI must run
  server-side or be removed from the authoritative seat (see §8). AI randomness
  doesn't need to be in `applyAction`, but if a bot drives a seat its move
  *choice* doesn't have to be deterministic — only the engine's *resolution* of
  that move does.

The project clearly cares about this: it ships `replay-divergence` and
`recruit-divergence` harnesses (`package.json:18-19`) precisely to catch RNG
divergence. Those become the regression net for the Rng-in-state migration.

## 5. The `worker/` directory

`worker/src/index.ts` is a **bug-report + game-log relay** Cloudflare Worker
(`index.ts:1-13`). Three routes: `POST /problem-report` (opens a GitHub Issue),
`POST /game-log` (SHA-deduped commit of a finished game to a public `logs/` dir),
`POST /report-status` (polls GitHub for "fix note" comments to show users). The
GitHub PAT lives only in Worker secrets. **There is no game-state persistence, no
multiplayer, and no AI in the worker** — it is a stateless GitHub proxy.

**Coexistence:** the framework's server (createGame / fetch / submit / legal /
report routes, `integration-guide.md:94-104`) is *additive* and does not collide
with these three paths. They can live as separate route prefixes (or separate
Workers/Pages Functions). One overlap worth noting: the framework has its *own*
`report` transport + public `/api/reports` admin endpoints; Tyrants already has a
GitHub-Issues report flow. We should decide whether online games route bug
reports through the framework's store (snapshot-attached) or keep the existing
GitHub relay. No conflict, just a duplication to reconcile. **Known framework
caveat:** the server barrel imports `node:fs` via `FsStore` and dies in Workers;
import the Supabase store via subpath (project CLAUDE.md "Known issue").

## 6. Hidden information → `viewFor`

The local build has **no `playerView`** — it's hotseat, so the UI sees the entire
`TyrantsState` (the human at `HUMAN_SEAT='0'`, `App.tsx:37`). For online play we
must add `viewFor`. The hidden categories are **symmetric** (each player hides the
same kinds of things from everyone else):
- **Opponent hand** (`PlayerData.hand`) — secret.
- **Every player's draw deck order** (`PlayerData.deck`) — secret, including your
  own (you don't know your next draw). Redact order/contents but the count is
  public.
- **Market deck order** (`market.deck`) — face-down; count public, the face-up
  `market.row` is public.
- **`pausedHandlerState`** and a `pendingChoice`'s private options may leak the
  above (e.g. a "look at top card" effect) — redact for non-owners.

Public to all: the map (`troops`, `spies`, `siteControl`, `controlMarkers`),
discard piles, inner circles, trophy halls, power/influence/VP, the log.
`discard` and `innerCircle` are *open information* in this game — do not redact
them. Use the framework's sentinel-CardRef pattern (`decisions.md:75-82`) so the
UI can render face-down backs. This is materially **simpler than Rebellion's
~30-line asymmetric redaction** (`framework-fit-notes.md:55-74`).

## 7. Player count & turn structure

2–4 players (`README.md:6`; `setup` iterates `ctx.numPlayers`, `game.ts:412`).
Strictly **one-actor-at-a-time**: bgio turn machine cycles seats sequentially
(`turn.order.next = (playOrderPos+1) % numPlayers`, `game.ts:506`), first player
randomized once (`game.ts:500-505`). There are **no simultaneous phases**. The
only cross-player wrinkle is a *forced* prompt: one player's card can target
another player with a `pendingChoice` whose `playerId` ≠ current player (handled
via `pendingChoice.playerId`/`actorId`, `engine/types.ts:36-41`; AI driver honors
it at `App.tsx:549-552`). That is still resolved synchronously within the active
player's turn — it is **not** free-for-all. **Verdict: `currentActor` suffices;
`canAct` is NOT needed.** But the forced-opponent-prompt case means
`currentActor` must sometimes return the *prompted* player, not the seat whose
turn it is — i.e. `currentActor(state) = pendingChoice?.playerId ?? activeSeat`.
Confirm this maps cleanly in Phase 1; it is the one subtlety.

## 8. Existing AI / opponent logic

Yes — there is a full local AI that **drives non-human seats by mutating shared
state**. The driver lives in `App.tsx:541-599`: a `useEffect` that, when it's an
AI seat's turn (`isAiTurn`, `App.tsx:499`), calls `decideAiMove`/heuristic and
dispatches the move into the same client. AIs: `ai/random-ai.ts`,
`ai/heuristic-ai.ts`, `ai/lookahead.ts`. This is the classic hotseat
"play-both-sides" pattern the framework warns about
(`integration-guide.md:249-267`, `framework-fit-notes.md:249-267`): online, **a
client must only drive its own seat.** In a later phase this driver must be gated
behind an `isOnline` flag (off for online human-vs-human), and if we want
vs-AI online the AI must run **server-side** on the authoritative state (the
framework's noted gap, `framework-fit-notes.md:269-292`). For Phase 1 (human
multiplayer only) the simplest correct move is: gate the driver off online.

## 9. THE KEY DELIVERABLE — the `Action` type

The bgio moves *are* the action vocabulary, and it is small and mostly
enumerable. Mapping each move (`game.ts:607-1036`):

| Move | Params | Enumerable? |
|---|---|---|
| `deployStartingTroop(siteId)` | one of the open starting sites | Yes — small set |
| `playCard(handIndex)` | index into hand | Yes — `hand.length` options |
| `recruitFromMarket(marketIndex)` | 0–5 row slot | Yes |
| `recruitFromAuxStack('houseGuards'\|'priestesses')` | 2 options | Yes |
| `deployTroop(spaceId)` | a troop space with presence | Yes — bounded by board |
| `assassinateTroop(spaceId)` | enemy-occupied space w/ presence | Yes |
| `returnEnemySpy(siteId, targetColor)` | site + color | Yes — small product |
| `resolveChoice(response)` | **free-form, depends on `pendingChoice.kind`** | **No — see below** |
| `endTurn()` | none | Yes (always legal mid-turn) |
| `undo()` / `loadState(codec)` | client/UI concern, see §10 | exclude from online |

The only non-trivially-enumerable action is **`resolveChoice(response)`**: its
payload depends on the current `pendingChoice.kind` (11 kinds,
`engine/types.ts:11-22`) and `pendingChoice.options`. But crucially the engine
**already publishes the legal `options`** on the pending choice — so legal
`resolveChoice` actions ARE enumerable from `options` (the AI does exactly this,
`random-ai.ts:40-77`). So `legalActions` can faithfully enumerate everything,
*including* choices, by reading `pendingChoice.options`.

**`tryApplyAction` recommendation:** even though the space is enumerable, the
engine validates every move with `INVALID_MOVE` guards already (e.g. presence
checks `game.ts:877`, influence checks `game.ts:826`). Wiring `tryApplyAction`
to "run the move, treat `INVALID_MOVE` as `ok:false`" is cheap and makes the
engine the authority — the recommended gate (`adapter-spec.md:71-91`). I'd
implement both: `legalActions` for the UI/AI, `tryApplyAction` for the submit
gate, mirroring the Rebellion resolution (`framework-fit-notes.md:139-164`).

No move carries a *combinatorial* parameter (no "assign N troops across regions
in one submit" — each deploy is its own single-space action), so **no
sub-choice decomposition is needed.** This is simpler than Rebellion's
`activateSystem` move orders.

## 10. Undo

Within-turn undo is a real engine feature (`undo` move, `game.ts:966-997`; the
`undoStack` field `game.ts:172-178`). It is a **client/engine concern, not a
snapshot concern**: `undoStack` holds codec snapshots captured *before* each
undoable action this turn, popped one at a time. It is deliberately wiped when an
action reveals hidden info (draw/refill/peek) — "undo freely until you learn
something new" (`game.ts:172-177`). The framework snapshots at **turn
boundaries** (`integration-guide.md:166`), which is exactly bgio's
`turn.onBegin` snapshot (`game.ts:548-554`) — so they align.

**Online interaction:** mid-turn undo is purely local — it never crosses the
network, since the player hasn't ended their turn (and `useGame` pauses polling
during your turn, `framework-fit-notes.md:204-224`). It can stay as-is for the
local seat. **But `undoStack` is part of `TyrantsState`** and will be serialized
into the authoritative snapshot — it should be **peeled before persisting** (it's
already peeled from nested codecs, `game.ts:316-320`) and, importantly,
**redacted in `viewFor`** because it contains full pre-action states that could
leak hidden info to other players. `loadState(codec)` is a dev/debug rewind move
and should be **disabled online** (it lets a client replace authoritative state
wholesale).

---

## Risks & open questions

1. **boardgame.io coupling (HIGH).** The engine is a bgio `Game` with mutate-in-
   place moves, a bgio turn machine, `events.endTurn()`, and the bgio `random`
   plugin. The adapter must either drive the bgio reducer on cloned states
   (fast; keeps the forbidden dep) or extract a framework-free pure engine
   (clean; more work). **Decide this first in Phase 1.** The framework's intent
   (no bgio runtime dep) argues for extraction; the `App.tsx:561-585` lookahead
   shows driving the reducer is feasible as an interim.

2. **RNG home after leaving bgio (HIGH but bounded).** bgio currently owns the
   seed. We must add the framework `Rng` into `TyrantsState`, seed it in setup,
   and repoint all shuffle sites (`game.ts:390,429,594`; `mechanics.ts:56`;
   `handler-helpers.ts:1059`). The `replay-divergence` harness is the safety net.

3. **`applyAction` purity.** Requires `structuredClone` at the seam (or Immer
   `produce`) since moves mutate. Verify `pausedHandlerState` only ever holds
   plain data so it survives the codec.

4. **`viewFor` scope (LOW — symmetric, simple).** Redact: every player's `deck`
   order, opponents' `hand`, `market.deck` order, `undoStack`, and any
   peek-style `pendingChoice.options`/`pausedHandlerState` for non-owners. Leave
   discard/innerCircle/map/scores public.

5. **`currentActor` and forced opponent prompts.** Must return
   `pendingChoice.playerId` when a cross-player prompt is live, else the active
   seat. Confirm.

6. **Local AI driver must be gated off online** (`App.tsx:541-599`); server-side
   AI is a later, optional phase.

7. **Worker reconciliation (LOW).** Existing relay coexists; decide whether to
   keep the GitHub-Issues report path or adopt the framework's report store.
   Mind the `FsStore`/`node:fs` Workers gotcha — use the Supabase store subpath.

8. **`schemaVersion`.** Set it to `1` on the *first* online deploy
   (`adapter-spec.md:129-143`); the State shape is still actively churning
   (legacy-save backfills all over `turn.onBegin`).

## Proposed `Action` type (sketch)

```ts
type Color = 'black' | 'red' | 'orange' | 'blue';

export type TyrantsAction =
  | { kind: 'deployStartingTroop'; siteId: string }
  | { kind: 'playCard'; handIndex: number }
  | { kind: 'recruitFromMarket'; marketIndex: number }
  | { kind: 'recruitFromAuxStack'; stack: 'houseGuards' | 'priestesses' }
  | { kind: 'deployTroop'; spaceId: string }
  | { kind: 'assassinateTroop'; spaceId: string }
  | { kind: 'returnEnemySpy'; siteId: string; targetColor: Color }
  | { kind: 'resolveChoice'; response: unknown }  // shape per pendingChoice.kind
  | { kind: 'endTurn' };
// Excluded online: 'undo' (local-only) and 'loadState' (dev rewind).
```

`PlayerId` = the seat-index string `'0'..'3'` (matches `Object.keys(G.players)`).

## Readiness verdict

**Not a clean fit like Rebellion — but a tractable one, with two structural
obstacles, both solvable.**

- ✅ State is plain serializable data → `jsonCodec` works; already round-tripped.
- ✅ RNG is already seeded/deterministic in the engine; just needs a new home
  (in-state `Rng`) once bgio is removed, with an existing divergence harness.
- ✅ Action vocabulary is small, bounded, and (including choices) enumerable;
  no combinatorial decomposition needed; `tryApplyAction` is cheap to add.
- ✅ Turn structure is plain one-actor-at-a-time; `currentActor` only, no
  `canAct`. Hidden info is symmetric and simpler than Rebellion.
- ⚠️ **Obstacle 1: boardgame.io.** The forbidden runtime dep is load-bearing
  (turn machine, reducer, random plugin, Immer). The adapter must wrap or the
  engine must be extracted. This is the single biggest Phase-1 decision.
- ⚠️ **Obstacle 2: mutate-in-place engine.** Requires a clone at the adapter
  seam and hand-rolling the turn advance that `events.endTurn()` does today.

Neither obstacle is fatal; both are well-understood. Recommended Phase-1
sequencing: (1) decide bgio-wrap vs extract; (2) move the seed into `TyrantsState`
as a framework `Rng` and prove replay parity with `replay-divergence`; (3) write
the adapter (`applyAction` via clone, `legalActions`+`tryApplyAction`,
`currentActor`, `viewFor`); (4) gate the local AI driver behind `isOnline`.

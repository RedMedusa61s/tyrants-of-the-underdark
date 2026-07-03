# PR #88 review — game-rules judgment calls for you to decide

`file:line` references are against the working tree after commit `95cbd8b`
(Parts A+B). Helper references point at the `export function` line; the changed
default is a few lines inside.

## Decisions (resolved)

- **C.1 — KEEP the flip (no change).** Mandatory-by-default is rules-correct
  (Tyrants: resolve a card's abilities if able, unless it says "may"). Evidence:
  of 91 affected effect entries in card-data, **0** say "may"/"optional" — all
  imperative; the only calls left optional are three genuine "up to N" effects
  (Council Member, the Undead free-recruit option, the Aberration assassinate).
  All four flipped helpers also guard `if (eligible.length === 0) return true`,
  so mandatory does **not** softlock on empty targets. (Trade-off accepted: a
  player can no longer decline an assassinate they'd rather skip — but that's the
  printed rule.)
- **C.2 — FIXED.** Guard changed `=== 1` → `<= 1` in `returnOwnTroopChoice`
  (handler-helpers.ts:1433), plus a clearer log for the 0- vs 1-troop case.
- **C.3 — KEEP the typeFilter (no change).** The card text literally reads
  "eot promote any **undead** cards you played", so `typeFilter: 'Undead'` is the
  printed intent; the committed `type` data is reliable (old "unreliable" note is
  outdated).

The findings below are retained for the record.

---

## C.1 — `optional` default flipped from `true` → `opts?.optional`

These shared helpers in `src/engine/handler-helpers.ts` previously hard-coded
`optional: true` on their `pendingChoice` (so the effect was always declinable).
PR #88 added an `optional?: boolean` option and changed the default to
`opts?.optional` — i.e. **the choice is now MANDATORY unless a caller passes
`optional: true`**. Because almost no existing caller passes it, this silently
makes the effect mandatory for nearly every card that uses these helpers.

Please confirm, per card, that "mandatory if able" is the intended printed
behaviour (many Tyrants effects read "you *may* assassinate / deploy / supplant").

### Affected helpers (file:line of the changed default)

- `assassinateChoice` — handler-helpers.ts:598 (prompt's `optional` at :643)
- `deployChoice` — handler-helpers.ts:652 (`optional` at :697)
- `supplantChoice` — handler-helpers.ts:706
- `moveEnemyTroopChoice` — handler-helpers.ts:899 (two prompt sites, `optional` at :947 and :956)
- `recruitFromMarketFiltered` — handler-helpers.ts:1131
- `returnOwnTroopChoice` — handler-helpers.ts:1428 (`opts?.optional ?? true` → `opts?.optional` at :1441)

### Card handlers now silently MANDATORY (did NOT pass `optional: true`)

**`assassinateChoice`** — every call site below is now mandatory. The ONLY call
passing `optional: true` is aberrations.ts:365 (unchanged).
- drow.ts:49, :51 (deathblade), :55, :62, :64 (underdark-ranger)
- demons.ts:25 (glabrezu), :28, :42, :54
- dragons.ts:103 (black-wyrmling), :106, :111
- elemental.ts:19 (water-elemental-myrmidon), :25 (crushing-wave-cultist), :26 (eternal-flame-cultist), :53 (vanifer)
- undead.ts:73, :78 (ravenous-zombies), :84, :127, :201
- aberrations.ts:305, :309

**`deployChoice`** — all call sites now mandatory (none pass `optional: true`):
- aberrations.ts:138 (grimlock), :143 (cranium-rats), :288 (umber-hulk), :353 (neogi)
- demons.ts:32, :34 (gibbering-mouther), :41
- dragons.ts:105, :108 (white-wyrmling), :149 (white-dragon)
- drow.ts:18 (mercenary-squad), :58, :61
- elemental.ts:25 (crushing-wave-cultist), :36, :48 (water-elemental), :50 (gar-shatterkeel), :52 (olhydra)
- undead.ts:31, :32, :82

**`supplantChoice`** — all call sites now mandatory (none pass `optional: true`):
- demons.ts:31, :39 (derro), :50, :51
- dragons.ts:133 (black-dragon), :146 (red-dragon)
- drow.ts:46 (advance-scout), :52 (doppelganger), :59
- elemental.ts:52 (olhydra)
- undead.ts:58, :107 (ogre-zombie), :173, :236

**`moveEnemyTroopChoice`** — now mandatory:
- demons.ts:22 (hezrou), dragons.ts:96 (cleric-of-laogzed)
- (drow.ts:33 council-member passes `optional: true` — unchanged)

**`recruitFromMarketFiltered`** — now mandatory:
- elemental.ts:13 (aerisi-kalinoth), :50 (gar-shatterkeel), :51 (marlos-urnrayle), :53 (vanifer)
- (undead.ts:158 passes `optional: true` — unchanged)

**`returnOwnTroopChoice`** — its only caller (aberrations.ts:191) passes
`optional: false` explicitly, so this particular default change is **a no-op in
practice**. (But see C.2 — the same function has a separate, real issue.)

### Related (NOT the `opts?.optional` flip, but also silently now-mandatory)

For completeness: PR #88 also hard-changed several helpers from `optional: true`
→ `optional: false` (no caller opt-in possible). These are a distinct pattern but
the same behavioural concern — every card using them is now mandatory:
- `assassinateAtLastPlacedSpySite` (handler-helpers.ts:278)
- `supplantAtLastReturnedSpySite` (:509)
- `giveOutcastToChosenOpponent` (:1242)
- `returnEnemyTroopChoice` (:1473)
- `returnEnemySpyChoice` (:1528)
- `giveOutcastToOpponentAdjacentToLastDeploy` (:1796)
- `returnAnySpiesAndSupplantAtEach` (:1881)

(`takeTrophyAndPlace` changed `true` → `opts?.optional ?? true`, which keeps the
default optional — **no behaviour change**, just allows opt-out. Listed only to
reassure you it's safe.)

---

## C.2 — `returnOwnTroopChoice` last-troop guard (`=== 1`) — CONFIRMED, latent softlock

`src/engine/handler-helpers.ts:1433` (in `returnOwnTroopChoice`, def at :1428):

```ts
const eligible = TROOP_SPACES.filter(t => ctx.G.troops[t.id] === me.color).map(t => t.id);
if (eligible.length === 1) {
  Mechanics.log(ctx.G, '(return own troop: you have no valid troops on the board — skipped)');
  return true;
}
```

**Trace with ZERO own troops:** `eligible.length === 0`, so the `=== 1` guard is
**false** — it does NOT skip. It falls through and creates a `pendingChoice` with
`options: []` and `optional: opts?.optional`. Its sole caller (aberrations.ts:191)
passes `optional: false`, so the choice is **mandatory with an empty options list**.

**Does that softlock?** Yes, for a human:
- The resolver's resume path (`if (!spaceId) return true`) *would* complete on a
  null response — but the UI only renders a **Decline** button when the choice is
  `optional` (src/App.tsx:1123, :1854). A mandatory choice with no options has
  nothing to click and no decline → the human is stuck. (The AI self-resolves:
  `ids[0]` is `undefined`, which the resume path treats as "declined" and
  completes — so AI games wouldn't hang, only human ones.)

**Is it reachable today?** No. The only caller gates the "Return one of your
troops" menu option behind `playerHasOwnTroopOnBoard(G, actorId, { returnFailsafe: true })`
(handler-helpers.ts), which requires **≥2** troops. So `returnOwnTroopChoice` is
only ever entered with ≥2 troops, and `=== 1` / `=== 0` are both unreachable.
This is a deliberate "you can't return your last troop" design (the `=== 1` skip +
the ≥2 gate are two halves of it).

**Verdict:** Your reading is correct. `=== 1` is the wrong guard in isolation —
it skips the 1-troop case (with a misleading "no valid troops" message) but lets
the 0-troop case fall through to a mandatory empty-options softlock. It's only
safe right now because the caller pre-gates at ≥2. **Recommended fix: `<= 1`**
(cleanly skips both 0 and 1 troops, removing the latent softlock for any future
caller that doesn't replicate the ≥2 gate). The log message could also be
softened to cover the 1-troop "can't return your last troop" case.

---

## C.3 — `high-priest-of-myrkul` `typeFilter: 'Undead'` — data is reliable, filter behaves correctly

`src/engine/handlers/undead.ts:227-231`:
```ts
'high-priest-of-myrkul': sequence( ... flagEotPromote({ optional: true, typeFilter: 'Undead' })),
```
The filter is applied in `eotEligibleIndices` (src/game.ts:308-311):
`if (data?.type !== trigger.typeFilter) continue;` — so promote targets are
restricted to cards played this turn whose card-data `type === 'Undead'`.

**Is the committed `type` data reliable?** Yes, it looks correct, contrary to the
old "unreliable" note:
- Undead half-deck: 20 cards → 14 typed `Undead`; the 6 non-`Undead` are
  **Conjurer (Human)**, **Cultist of Myrkul (Human)**, **High Priest of Myrkul
  (Human)**, **Necromancer (Human)**, **Flesh Golem (Construct)**, **Carrion
  Crawler (Monstrosity)**. Every one of those is genuinely *not* undead (living
  cultists/necromancers, a construct, a monstrosity), so excluding them is
  correct.
- Cross-deck: the only non-undead-deck cards typed `Undead` are **demons/Ghoul
  (×3)** — and a Ghoul *is* undead, so if you play Drow+Demons... wait, Undead+Demons,
  the filter correctly lets High Priest promote a Ghoul played that turn.

**Verdict:** The filter behaves correctly — it includes the 14 real Undead cards
(plus cross-deck Undead like Ghoul) and excludes exactly the 6 genuinely non-undead
cards. It does **not** wrongly exclude anything. Your prior "leave it unrestricted"
note appears to predate the corrected `type` data. The remaining question is purely
design: does High Priest of Myrkul's printed text actually intend "promote an
**Undead** card you played this turn"? If yes, this is right as committed; if the
card means "any card," the filter should be dropped. That's your call.

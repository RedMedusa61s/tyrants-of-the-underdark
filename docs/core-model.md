# Tyrants of the Underdark — Core Model

Domain model for the engine, derived from the 2016 GF9/WotC rulebook (`docs/rulebook.pdf`). Engine details (turn loop, effect handlers, context) live in `engine.md`; this doc fixes the data shapes and invariants.

Rulebook citations use the form `(rules p.N)`.

---

## 1. Players and houses

A `PlayerState` (one per seat, 2–4 players) holds:

- `Color` — Black, Red, Orange, Blue.
- `Deck`, `Hand`, `Discard` — ordered lists of `MinionCard`.
- `InnerCircle` — list of promoted cards (not part of deck; never reshuffled). Scored separately at end of game.
- `TrophyHall` — list of assassinated enemy troops (1 VP each at end). Also where troops "return" from when being deployed? **No.** Trophy hall holds *killed enemy troops*; your own troops live in `Barracks`.
- `Barracks` — supply of your color's troop pieces (40). When empty, deploying gains 1 VP instead (rules p.12).
- `SpiesAvailable` — count of spies remaining off-board (start 5).
- `VPTokens` — running tally of VP tokens claimed mid-game (1 and 5 denominations).
- `SiteControlMarkers` — markers taken from controlled sites; each gives a per-turn effect (control side vs total-control side).
- `HandSize = 5`. End-of-turn step refills to this from deck (reshuffle discard when needed).

Starting deck (rules p.4): 7 Nobles + 3 Soldiers (all from the always-available pool, not the market half-decks).

---

## 2. Cards

`MinionCard` — immutable record:

| Field | Type | Notes |
|---|---|---|
| `Name` | string | Unique key for registry. |
| `Cost` | int | Influence to recruit. |
| `Aspect` | enum `Aspect` | Ambition, Conquest, Malice, Guile, Obedience. |
| `Type` | string | "Drow", "Elf", "Human", "Demon", "Dragon", ... (flavor + a few rules hooks). |
| `Source` | enum `CardSource` | Core (Noble/Soldier/HouseGuard/PriestessOfLolth/InsaneOutcast), Drow, Dragons, Elemental, Demons. |
| `DeckVP` | int | VP if card ends game in deck/hand/discard. Can be negative (Insane Outcast = -1). |
| `InnerCircleVP` | int | VP if promoted. |
| `Rarity` | int (1–3) | Copies in its half-deck. |
| `RulesText` | string | Display only. |
| `EffectKey` | string | Slug → handler in `CardRegistry`. |

**Pool counts** (rules p.2):
- 28 Nobles, 12 Soldiers, 15 House Guards, 15 Priestesses of Lolth, 30 Insane Outcasts.
- 4 market half-decks × 40 cards each.

**`Aspect`**: Ambition (recruiting/inner circle), Conquest (map dominance), Malice (assassination), Guile (spies/disruption), Obedience (workhorse). Used by Focus keyword (Elemental deck).

---

## 3. Map

Static board data loaded once from a TSV/JSON. Three `Section`s (Left, Center, Right). For 2p only Center is in play; 3p Center + one outer; 4p all three (rules p.4).

`Site` — immutable definition:
- `Id`, `Name`, `Section`, `VP` (end-game VP for controller).
- `TroopSlots` — number of troop spaces (typically 2–4, some 5).
- `IsStartingSite` (black box).
- `HasControlMarker` — boolean; if true, has a flippable token with two effect keys (`ControlEffect` / `TotalControlEffect`).

`Route` — connects exactly two sites, has 1+ ordered `TroopSpace`s in a line.

`TroopSpace` — the only place troop pieces sit. Two flavors:
- Site-space: belongs to a `Site`.
- Route-space: belongs to a `Route` between two sites.
- Some site-spaces start with a *white troop* (the `×` marker, rules p.4 setup step 6).

Runtime state: `Map.Occupancy : Dict<TroopSpaceId, Troop?>` where `Troop` is `{ Color | White }`. Spies are *not* in troop spaces — they sit at a `Site` (any number, any players, rules p.12).

`Map.SpiesAtSite : Dict<SiteId, List<(Color, SpyId)>>`.

`Map.SiteControlMarker : Dict<SiteId, SiteControlMarkerState>` where the marker can be: on-board (face-up = total-control side per setup p.4 step 7), held-by-player, or "returned to board" after a controller tie.

### Presence (rules p.10, p.22)

A player has presence at a *site* if:
- They have a spy at that site, OR
- They have a troop in any of that site's troop spaces, OR
- They have a troop in a route-space adjacent to that site.

A player has presence at a *route-space* if:
- That space is adjacent (in the route ordering) to either a site they have presence at, or a space they have a troop in.

This is a derived predicate — compute on demand, do not cache in `GameState`.

### Control (rules p.10–11)

`SiteControl(site)`:
- Tally troops per color in the site's troop spaces. White troops count for no one.
- If one color strictly leads → that color controls.
- Else → no one controls; marker returns to the board.

`TotalControl(site, color)`: every troop space at the site is `color`'s troop AND no enemy spies are present at the site.

**Invariant:** after every mutation of map occupancy or spy placement, recompute control for affected sites and update marker ownership atomically inside `Mechanics`.

---

## 4. Market

`MarketState`:
- `Deck` — the shuffled 80-card market deck (2 of 4 half-decks).
- `Row` — exactly 6 face-up market cards (rules p.4 step 5). When one leaves (recruited/devoured), refill from top of deck.
- `AlwaysAvailable` — face-up piles of `HouseGuard`, `PriestessOfLolth`, and (if Demons in play) `InsaneOutcast`. Recruitable directly, never refilled by market deck.
- `Devoured` — discard pile for permanently removed cards.

When deck empties, end-of-game trigger fires (rules p.14).

---

## 5. Resources

Per-turn, *not* persistent:

```
GameState.CurrentTurn.Pool : { Power : int, Influence : int }
```

Cleared at end of turn (rules p.7 "any resources in your pool that you didn't expend are lost"). All resource grants from cards go into this pool. Costs deduct from it.

Base actions (rules p.8, exhaustively):
- **Assassinate**: 3 Power. Take an enemy troop from a space where you have presence → trophy hall.
- **Deploy**: 1 Power. Take a troop from your barracks → empty troop-space where you have presence. (Or anywhere on the board if your map presence is zero — rules p.12.)
- **Recruit**: Influence equal to card's cost. Take from market row or always-available → your discard.
- **Return enemy spy**: 3 Power. Send an enemy spy from a site where you have presence → its owner's reserve.

Card-only actions (no Power/Influence cost — granted by card text):
- **Move**, **Place a spy**, **Promote**, **Devour**, **Return a troop or spy** (own or enemy variants — see rules p.13), **Supplant**, **Draw**.

---

## 6. Turn structure

```
PlayerTurn:
  Step 1 — Main phase (any order, any number of times):
    • Play a card from hand → resolve all of its text top-to-bottom.
    • Expend pool resources for a base action.
  Step 2 — End of turn (fixed order):
    1. Promote any cards flagged for end-of-turn promotion.
    2. For each site-control marker: gain VP per its side (control vs total-control).
    3. Discard played cards and remaining hand.
    4. Draw up to 5 (reshuffle discard if deck runs out).
```

Game ends at end of the current *round* (all players take their last turn) when either trigger has fired (rules p.14):
- Any player deploys their last barracks troop.
- The market deck becomes empty.

---

## 7. Effect handlers

One `IEffectHandler` per `EffectKey`, signature:

```csharp
bool Execute(GameState g, PlayerState actor, EffectContext ctx);
```

Returns `true` if the effect ran to completion this call; `false` if it suspended awaiting input.

`EffectContext` carries:
- `Card` (the card being played / triggered).
- `PendingChoice` — null when not waiting; set to a typed choice request (target picker, "choose one" option, opponent picker, etc.) when suspending. UI fills `PendingChoice.Response` and re-enters.
- `Paused` — boolean mirror of "have we suspended".
- `HandlerState` — opaque `object?` slot for multi-stage handlers to stash progress (e.g. `enum Stage { Picking, Resolving, Done }`).
- `Frame` — for nested "card invokes card" (e.g. promote text that triggers another card's text) — preserves outer handler state.

**Convention** (lifted from Innovation): null `PendingChoice` immediately after consuming. Guard `if (g.IsGameOver) return true;` before any phase resets that follow.

### Specific quirks to model from day one

1. **Insane Outcast self-eject** (rules p.9): on play, optional cost `Discard a card → return Insane Outcast to supply`. Also: if it would be *devoured or promoted*, return it to the supply instead. Encode the second rule as a global hook in `Mechanics.Devour` and `Mechanics.Promote`.
2. **Focus** (rules p.9, Elemental): "If you played another card of this aspect this turn, OR reveal a card of this aspect from hand → bonus effect." Needs `Turn.CardsPlayedByAspect` tally and a reveal sub-choice.
3. **Demons devour-on-play** (rules p.4 sidebar): some Demon cards require devouring one of your own cards to play. This is part of the play cost, evaluated before normal text.
4. **"Anywhere on the board"** (rules p.11): when card text uses this phrase, the presence requirement is waived. Encode as a flag on the action call, not a special handler.
5. **"You" vs active player in opponent-targeted text** (gotcha inherited from Innovation): default the verb target to the *targeted* player when text reads "I demand X — if you do, Y" or similar. Tyrants has fewer of these than Innovation but Place-a-Spy / Return effects need care.
6. **Promote-at-end-of-turn** (rules p.8 end-of-turn step 1): cards that say "at the end of your turn, promote this" set a `Turn.PendingPromotions` list at play time. Inner-circle membership freezes the card out of further deck cycling.

---

## 8. Mechanics façade

All zone/score mutations route through static `Mechanics.*`:

```
Draw(player, n)
Discard(player, card)
Reshuffle(player)
Recruit(player, source)              // source: MarketSlot | AlwaysAvailable
Devour(card)                          // honors InsaneOutcast self-eject
Promote(player, card)                 // honors InsaneOutcast self-eject
DeployTroop(player, space)            // checks presence unless flagged Anywhere
AssassinateTroop(player, space)       // routes through TrophyHall
MoveTroop(player, from, to)
ReturnTroop(troopOwner, source)       // → barracks
ReturnSpy(spyOwner, site)             // → reserve
PlaceSpy(player, site)
GainPower(n) / GainInfluence(n) / ExpendPower(n) / ExpendInfluence(n)
GainVPTokens(player, n)
RefreshMarketRow()
```

Every mutation that affects map occupancy or spies recomputes site control for affected sites and updates `SiteControlMarker` ownership inside the same call. Every mutation logs a structured entry to the turn-log. `IsGameOver` is set by `RefreshMarketRow()` when deck empties and by `DeployTroop` when the actor's barracks empties.

---

## 9. Determinism

- One seed in `GameState.Rng` (initial setup: deck shuffles, first-player choice if scripted, market deck shuffle).
- Per-seat controller RNGs (AI tiebreaks). Both seeds captured at `GameSetup.Create(seed, controllerSeeds)`.
- No `DateTime.Now`, no unseeded `Random`. Anywhere.
- Card data file is fixed-order; in-game shuffles use `Rng` only.

---

## 10. Persistence / replay

- Per-turn snapshot taken at the *start* of each player's turn → base64 blob the user can paste back. Mid-turn (mid-effect) snapshots deliberately do not round-trip; the UI disables Save during effect resolution.
- Move log: append-only string-of-lines, replayable from the seed (preferred for tests).

---

## 11. Final scoring (rules p.14)

For each player:
- ∑ `Site.VP` over sites they control.
- 2 × count of sites under their total control.
- 1 × trophy hall size.
- ∑ `DeckVP` over cards in deck + hand + discard.
- ∑ `InnerCircleVP` over inner-circle cards.
- + VP tokens collected during the game.

Highest wins; ties shared (rules p.14).

---

## 12. Out of scope (deliberately)

- Online multiplayer.
- AI beyond basic heuristics (Random, Greedy-VP, plus one per faction once shipped).
- Expansion content (Aberrations, Updated Edition exclusives) — first pass implements the base box's four half-decks: Drow, Dragons, Elemental, Demons.

---

## Decisions (locked 2026-05-13)

1. **Card data source:** TTS workshop mod `881660322` (no Vassal module exists). Extract card names + sheet positions from `881660322.json`; transcribe rules text from card faces manually against the rulebook for verification.
2. **MVP scope:** 4 players + AI from the start (not 2p hot-seat MVP first).
3. **Edition:** Original 2016 release. Defer Updated Edition / Aberrations & Undead expansion.

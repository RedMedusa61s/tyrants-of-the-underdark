# Tyrants of the Underdark

A TypeScript + React + boardgame.io port of the original (2016) edition of *Tyrants
of the Underdark* by Wizards of the Coast. Single-player hot-seat: P1 is the human,
P2–P4 are configurable AI opponents (random or heuristic).

## Status

Playable scaffold with substantial card-effect coverage. Active development; see
"Report a problem" in-app for filing bugs.

## Quick start

```bash
npm install
npm run extract-assets   # see "Assets" below
npm run dev              # http://localhost:5173
```

## Assets (copyright)

Card art, board art, and tokens are property of Wizards of the Coast and are **not**
redistributed here. To populate `assets/cards/`, `assets/board/`, etc. locally:

1. Subscribe to and download [TTS Workshop mod 881660322](https://steamcommunity.com/sharedfiles/filedetails/?id=881660322) (Tabletop Simulator).
2. `npm run extract-assets` — pulls images out of the mod's cached files and writes
   them to `assets/`. See `scripts/extract-assets.mjs` for details.

The JSON data files (`assets/card-data.json`, `assets/site-positions-ocr.json`,
`assets/slot-positions-auto.json`) are derived configuration and **are** committed.

## Developer mode

The eight calibration / verification tabs (`calibrate`, `routes`, `cards`, `costs`,
`text`, `sites`, `edges`, `slots`) are hidden by default. Append `?dev=1` to the URL
to enable them; the flag persists in `localStorage`. A small "hide dev tabs" button
appears in dev mode to switch back.

## Headless AI training harness

```bash
npm run sim -- --games 50                      # 1 heuristic vs 3 random, default
npm run sim -- --games 100 \
    --p1 heuristic --p2 heuristic \
    --p3 random --p4 random
```

Outputs per-game JSON to `training-logs/<timestamp>/`. Each game is a self-contained
record: full move trace, per-turn state codecs, turn logs, final scores. Used as the
foundation for future AI training work; see `docs/` and the "Public game-log repo"
section below.

## Reporting bugs

Click **"Report a problem"** in the header. The dialog captures the current game
state codec, recent log lines, and your description, then files a GitHub Issue on
`johnchampaign/tyrants-of-the-underdark`. If GitHub isn't configured in your
environment (see `.env.example`), the report is saved locally to
`training-logs/problem-reports/<timestamp>.json` so feedback isn't lost.

## Public game-log repo

Completed games — both browser playthroughs and headless sim runs — can be published
to the public `logs/` directory on the main repo for AI training datasets. The flow
goes through a Cloudflare Worker (see `worker/`) so the GitHub token lives only in
Worker secrets, never in client builds. Per-log SHA256 deduplication keeps the repo
size manageable.

## Project layout

```
src/                   React + boardgame.io app
  ai/                  Random and heuristic decision-makers
  components/          UI: MapView, NewGameDialog, GameLog, CardCalibration, etc.
  data/                Sites, routes, troop-spaces, card data accessor
  engine/              Card-effect handlers, map state, scoring, registry
  game.ts              boardgame.io Game definition
  App.tsx              Top-level shell (Client, header, tabs, modals)
scripts/               Asset extraction, OCR, headless sim, calibration tools
assets/                Data JSONs (committed) + extracted art (gitignored)
worker/                Cloudflare Worker — relay for bug reports and game logs
docs/                  Rules notes, design docs
training-logs/         Local development outputs (gitignored)
```

# Tyrants of the Underdark

An unofficial, fan-made digital port of the deck-building / area-control board game
*Tyrants of the Underdark* (original 2016 edition by Wizards of the Coast). Built
with TypeScript, React, and [boardgame.io](https://boardgame.io). Play hot-seat
(one human seat plus configurable AI opponents — random or heuristic — for 2-, 3-,
and 4-player games) or async online multiplayer against other humans.

## Play it

→ **<https://tyrants-online.pages.dev/>**

→ **Source code:** <https://github.com/johnchampaign/tyrants-of-the-underdark>

No account or download required — just open the URL. The site serves both the
hot-seat game and online multiplayer.

> The old GitHub Pages URL (`johnchampaign.github.io/tyrants-of-the-underdark`)
> now redirects here. It was static-only and could never host the online lobby
> backend, so the canonical site moved to Cloudflare Pages.

## Deploying

The canonical deployment is the **Cloudflare Pages** project `tyrants-online`.
It serves the static client *and* the online-multiplayer lobby backend, which
runs as Cloudflare Pages Functions under `functions/api/*` (GitHub Pages is
static-only and can't host that — hence the move).

The project is **not** git-connected, so deploys are manual:

```sh
npm run build
npx wrangler pages deploy dist --project-name tyrants-online --branch <production-branch>
```

`<production-branch>` must match the branch set as **Production** in the
Cloudflare dashboard (Workers & Pages → tyrants-online → Settings → Builds &
deployments). Deploying any other branch produces a throwaway *preview* that
never reaches `tyrants-online.pages.dev`. The Production branch is currently
**`framework-port`** (a historical leftover); if you change it to `main` in the
dashboard, deploy with `--branch main` instead.

Pushes to `main` no longer deploy the app to GitHub Pages — that workflow
(`.github/workflows/deploy.yml`) now only publishes a redirect to the Cloudflare
site.

### First-run image download (one time, ~25 MB)

The first time you load the page you'll be asked whether to import card and board
images. These art assets are owned by Wizards of the Coast and aren't redistributed
from this repo. The importer fetches them from the original publisher-uploaded
images hosted on imgur (the same set used by the public Tabletop Simulator workshop
mod), slices the deck sheets into individual cards in your browser, and stores
everything in IndexedDB so subsequent loads are instant.

If you'd rather not download the art, **click "Skip — play with placeholders"** on
the import dialog (or toggle "Images: off" in the header at any time). The game
runs in a no-images schematic mode: cards are rendered as text panels showing the
same name, cost, aspect, and effect text; the map is drawn as a node-and-edge
diagram with site cards and route lines. Gameplay is fully identical between modes;
only the visuals change.

## Local development

```bash
npm install
npm run dev              # http://localhost:5173
```

The dev build also supports the optional `npm run extract-assets` flow if you have
the [TTS Workshop mod 881660322](https://steamcommunity.com/sharedfiles/filedetails/?id=881660322)
installed locally — it pulls images out of the mod's cached files and writes them
to `assets/`. This is only needed if you want to work on art/calibration tooling;
the in-app importer covers normal use.

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

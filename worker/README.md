# tyrants-relay (Cloudflare Worker)

Single Worker handling two routes for the Tyrants of the Underdark project:

| Route | Purpose |
|---|---|
| `POST /problem-report` | Creates a GitHub Issue (description + state + log) on the target repo. Labels: `bug`, `from-game`. |
| `POST /game-log` | Hashes the JSON, dedups via the Contents API, commits to `logs/<hash>.json` on the target repo. |

The Worker is the single place the GitHub PAT lives — the browser and the
headless sim only know the Worker URL.

## Setup

```bash
cd worker
npm install
```

### Secrets

```bash
wrangler login                                # one-time
wrangler secret put GITHUB_TOKEN              # paste your fine-grained PAT
wrangler secret put GITHUB_REPO               # e.g. "johnchampaign/tyrants-of-the-underdark"
```

The PAT needs only:
- **Contents: Read and write** (for `logs/<hash>.json` commits)
- **Issues: Read and write** (for `/problem-report`)
- Scoped to the single target repo (fine-grained tokens).

### Local dev

```bash
npm run dev          # http://localhost:8787
```

`wrangler dev` will prompt for the secrets the first time if they aren't set
locally; you can use a separate test repo to avoid noisy commits while iterating.

### Deploy

```bash
npm run deploy
```

Cloudflare prints the public URL (typically
`https://tyrants-relay.<your-cf-handle>.workers.dev`). Paste that URL back to
the dev so the client can be wired to it.

## Tail logs

```bash
npm run tail
```

Useful for watching live POST traffic during testing.

## CORS

`wrangler.toml` sets `ALLOWED_ORIGIN = "*"` (any origin can hit the relay).
Tighten this to your deployed game URL later if you want.

## Payload shapes

### `POST /problem-report`

```json
{
  "description": "string (required)",
  "expected": "string (optional)",
  "includeState": true,
  "includeLog": true,
  "state": { ... },
  "log": ["...", "..."],
  "meta": { "turn": 17, "currentPlayer": "0", ... }
}
```

Response: `{ ok, url, number }` or `{ ok: false, error }`.

### `POST /game-log`

```json
{
  "game": { ... full game record ... },
  "source": "sim:heuristic-vs-random",
  "meta": { "winner": 0, "turns": 92, ... }
}
```

Response: `{ ok, deduped, path, hash, htmlUrl?, downloadUrl? }` or
`{ ok: false, error }`. When `deduped: true`, the file already existed on the
repo and no new commit was made.

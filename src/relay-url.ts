// Resolves the base URL of the Cloudflare Worker relay that handles problem
// reports, game-log uploads, and report-status polling.
//
// The relay URL is NOT a secret — it's a public Worker endpoint (it already
// appears in plaintext in .env.example and the GitHub repo variable). We
// therefore default to it in *production* so reporting works on every deploy
// regardless of how the bundle was built. This matters because the Cloudflare
// Pages site (tyrants-online) is deployed manually via `wrangler pages deploy`
// — a `vite build` run without `.env` loaded would otherwise bake in the
// dev-only fallback and silently break reporting.
//
// Resolution order:
//   1. VITE_TOTU_RELAY_URL if set (explicit override — any deploy or local).
//   2. In production with no override: the public relay (DEFAULT_RELAY).
//   3. In dev with no override: undefined → callers use the local Vite
//      middleware (/__report-problem, /__publish-game-log) so dev reports
//      don't hit the production relay.
const DEFAULT_RELAY = 'https://tyrants-relay.johnchampaign.workers.dev';

export function relayBaseUrl(): string | undefined {
  const configured = import.meta.env.VITE_TOTU_RELAY_URL as string | undefined;
  if (configured) return configured.replace(/\/$/, '');
  if (import.meta.env.DEV) return undefined;
  return DEFAULT_RELAY;
}

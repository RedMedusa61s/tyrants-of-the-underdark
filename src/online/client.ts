// Browser-side API client for online multiplayer. Imports ONLY from the
// framework's /client and the adapter types — never /server. The browser
// bundle must not pull in the server barrel (node:fs).

import type { GameClientApi, MessagingClientApi } from 'digital-boardgame-framework/client';
import type { BgioState, TyrantsAction, PlayerId } from '../adapter/tyrantsAdapter';
import { AI_VERSION } from '../ai-version';

const delay = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

/** Capture an anomalous API response (HTML where JSON was expected, or a 5xx)
 *  into a small localStorage ring buffer + the console, so a recurrence of the
 *  "weird error message" lock (#89) is definitively recorded. The `cf-ray`
 *  lets the maintainer correlate the exact request with Cloudflare's logs; the
 *  build stamp shows whether the client was stale. Best-effort — never throws. */
function logApiAnomaly(entry: Record<string, unknown>): void {
  try {
    const KEY = 'totu.api-anomaly-log';
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
    arr.push({ ...entry, clientBuild: AI_VERSION });
    if (arr.length > 30) arr.splice(0, arr.length - 30);
    localStorage.setItem(KEY, JSON.stringify(arr));
  } catch { /* localStorage full / unavailable — non-fatal */ }
  try { console.warn('[totu api anomaly]', { ...entry, clientBuild: AI_VERSION }); } catch { /* ignore */ }
}

/** Fetch an /api endpoint expecting JSON, resilient to the transient windows
 *  (a mid-deploy SPA-fallback, a Cloudflare Function cold-start, a Supabase
 *  blip) where a request briefly gets HTML / a 5xx / a dropped connection
 *  instead of reaching a healthy Function. Two failure classes, handled
 *  differently by side-effect safety:
 *
 *   - IDEMPOTENT reads (state poll, legal actions, chat list) have no side
 *     effect, so a transient failure of ANY kind — HTML, 5xx, or a network
 *     throw — is safe to retry hard. We back off across several attempts so a
 *     blip is absorbed inside the single call and the player never sees a
 *     scary banner for a hiccup that self-heals a second later.
 *   - NON-IDEMPOTENT writes (submit, report, claim) might have applied
 *     server-side before failing, so a blind retry could double-apply. We only
 *     retry the HTML case — an HTML body proves the request got the SPA
 *     fallback and never hit the Function, so it had no side effect.
 *
 *  Every anomaly (HTML or 5xx) is captured via logApiAnomaly for diagnosis. */
async function apiJson(
  doFetch: () => Promise<Response>,
  opts: { idempotent?: boolean } = {},
): Promise<any> {
  // Idempotent reads get a backoff ladder (~0/0.4/0.9/1.6/2.6s ≈ 5.5s total),
  // long enough to ride out a deploy or cold-start window. Writes get the
  // single cautious HTML retry only.
  const backoff = opts.idempotent ? [400, 500, 700, 1000] : [800];
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    let r: Response;
    try {
      r = await doFetch();
    } catch (netErr: any) {
      // Network-level failure (connection dropped, DNS, offline). No response
      // reached us, so a read definitely had no side effect — retry it.
      logApiAnomaly({ t: Date.now(), networkError: String(netErr?.message ?? netErr), attempt });
      lastErr = new Error('Lost connection to the server. Reconnecting…');
      if (opts.idempotent && attempt < backoff.length) { await delay(backoff[attempt]); continue; }
      throw lastErr;
    }

    const text = await r.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    if (r.ok && data !== null) return data;

    const isHtml = data === null && /^\s*</.test(text);
    const transient = isHtml || r.status >= 500;
    if (transient) {
      logApiAnomaly({
        t: Date.now(),
        status: r.status,
        contentType: r.headers.get('content-type'),
        cfRay: r.headers.get('cf-ray'),
        cfCache: r.headers.get('cf-cache-status'),
        isHtml,
        bodySnippet: text.slice(0, 80),
        attempt,
      });
      // Reads retry on any transient; writes retry only the side-effect-free
      // HTML (SPA-fallback) case.
      const mayRetry = opts.idempotent ? true : isHtml;
      if (mayRetry && attempt < backoff.length) { await delay(backoff[attempt]); continue; }
    }

    lastErr = new Error(
      (data && data.error)
        || (isHtml
          ? 'The server was briefly unavailable. Reconnecting…'
          : `Server error (HTTP ${r.status}). Please reload and try again.`),
    );
    throw lastErr;
  }
  throw lastErr ?? new Error('Server error. Please reload and try again.');
}

export interface Invites {
  gameId: string;
  invites: Record<PlayerId, string>;
}

// Create a new game with a player count (2-4). Returns one invite URL per seat.
// Optional `ai` maps seat ids ('0'..'3') to a difficulty key ('random' |
// 'standard'); those seats become server-driven, rated AI opponents.
export async function createGame(
  numPlayers: number,
  ai?: Partial<Record<PlayerId, string>>,
): Promise<Invites> {
  const r = await fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numPlayers, ...(ai ? { ai } : {}) }),
  });
  if (!r.ok) {
    const data: any = await r.json().catch(() => ({}));
    throw new Error(data?.error || `createGame failed: ${r.status}`);
  }
  return r.json();
}

// Lightweight status read for the lobby's "games in progress" list. Returns
// { deleted: true } if the game no longer exists.
export async function fetchStatus(
  gameId: string,
  token: string,
): Promise<
  | { deleted: true }
  | { deleted?: false; yourTurn: boolean; gameOver: boolean; turn: number; you: PlayerId }
> {
  const r = await fetch(`/api/games/${gameId}?as=${encodeURIComponent(token)}`);
  if (r.status === 404) return { deleted: true };
  const data: any = await r.json();
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
  return data;
}

// End a game server-side (token-gated). 404 is treated as success (already gone).
export async function deleteGame(gameId: string, token: string): Promise<void> {
  const r = await fetch(`/api/games/${gameId}?as=${encodeURIComponent(token)}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 404) throw new Error(`delete failed: ${r.status}`);
}

// Attach the player's hub identity to their seat (ranked attribution).
// Best-effort: a failure just leaves the seat unattributed (casual play).
export async function claimSeat(gameId: string, token: string, identityToken: string): Promise<void> {
  try {
    await fetch(`/api/games/${gameId}/claim?as=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityToken }),
    });
  } catch { /* ignore — ranked attribution is optional */ }
}

// Per-(game, token) client the useGame hook consumes.
export function makeClient(
  gameId: string, token: string, getIdentityToken?: () => string | undefined,
): GameClientApi<BgioState, TyrantsAction> {
  const base = `/api/games/${gameId}`;
  const q = `?as=${encodeURIComponent(token)}`;
  return {
    fetch: () => apiJson(() => fetch(`${base}${q}`), { idempotent: true }),
    submit: (action) =>
      apiJson(() => fetch(`${base}/submit${q}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, identityToken: getIdentityToken?.() }),
      })),
    legalActions: () => apiJson(() => fetch(`${base}/legal${q}`), { idempotent: true }),
    report: (body) =>
      apiJson(() => fetch(`${base}/report${q}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })),
  };
}

// In-game chat transport for the framework's ChatPanel/useMessages. Both calls
// hit /api/games/:id/chat (auth-gated by the token; the server stamps the seat)
// and return the refreshed ChatMessage[].
export function makeMessagingClient(gameId: string, token: string): MessagingClientApi {
  const base = `/api/games/${gameId}/chat`;
  const q = `?as=${encodeURIComponent(token)}`;
  return {
    listMessages: () => apiJson(() => fetch(`${base}${q}`), { idempotent: true }),
    postMessage: (body) =>
      apiJson(() => fetch(`${base}${q}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })),
  };
}

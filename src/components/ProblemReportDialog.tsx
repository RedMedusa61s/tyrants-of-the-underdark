// Problem-report modal. Captures a user description + (optionally) the current
// game state and recent log lines, then POSTs to the vite-side endpoint
// `/__report-problem` which either files a GitHub Issue or writes the report
// to disk. Patterned after the Innovation port's BugReportDialog (modal form +
// markdown body + GitHub Issues API).

import { useState } from 'react';
import type { TyrantsState } from '../game';

interface Props {
  G: TyrantsState;
  ctxInfo: { turn: number; currentPlayer: string; gameover?: unknown };
  config?: { numPlayers: number; halfDecks: string[]; aiStyles: string[] };
  onClose: () => void;
}

interface SubmitResult {
  ok: boolean;
  url?: string;
  number?: number;
  filePath?: string;
  note?: string;
  error?: string;
}

/** GitHub repo to file issues against when no relay is configured (or the
 *  relay submit fails). Kept in sync with the source repo. */
const FALLBACK_REPO = 'johnchampaign/tyrants-of-the-underdark';

/** True when we should expect the relay POST to succeed: either a remote
 *  relay URL is configured, or we're on a dev host where the Vite middleware
 *  at /__report-problem is available. On production GH Pages with no relay
 *  configured, the fetch will hit a 404 / index.html and the JSON parse will
 *  fail — better to surface the GitHub-fallback path immediately. */
function relayAvailable(): boolean {
  if (import.meta.env.VITE_TOTU_RELAY_URL) return true;
  const host = typeof location !== 'undefined' ? location.hostname : '';
  return host === 'localhost' || host === '127.0.0.1';
}

/** Build a GitHub "new issue" URL with title and body prefilled so the user
 *  can submit the report by hand when the API path is unavailable. Body is
 *  truncated to keep the URL under GitHub's practical limit (~8KB). */
function githubIssueUrl(args: {
  description: string;
  expected?: string;
  meta: Record<string, unknown>;
  stateSummary?: string;
  logTail?: string[];
}): string {
  const lines: string[] = [];
  lines.push(args.description.trim());
  if (args.expected?.trim()) {
    lines.push('', '**Expected:**', args.expected.trim());
  }
  lines.push('', '**Meta:**', '```json', JSON.stringify(args.meta, null, 2), '```');
  if (args.stateSummary) {
    lines.push('', '**State (truncated):**', '```json', args.stateSummary, '```');
  }
  if (args.logTail && args.logTail.length) {
    lines.push('', '**Recent log:**', '```', ...args.logTail, '```');
  }
  // Keep the body to ~6000 chars after URL-encoding overhead. Encoded
  // length is roughly 3x for JSON, so target ~2000 chars of raw text.
  let body = lines.join('\n');
  const MAX = 2000;
  if (body.length > MAX) {
    body = body.slice(0, MAX) + '\n\n…[truncated — paste full state in a comment after creating the issue]';
  }
  const title = args.description.trim().slice(0, 80).replace(/\s+/g, ' ');
  const params = new URLSearchParams({ title, body });
  return `https://github.com/${FALLBACK_REPO}/issues/new?${params.toString()}`;
}

export function ProblemReportDialog({ G, ctxInfo, config, onClose }: Props) {
  const [description, setDescription] = useState('');
  const [expected, setExpected] = useState('');
  const [includeState, setIncludeState] = useState(true);
  const [includeLog, setIncludeLog] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  async function submit() {
    if (!description.trim() || submitting) return;
    setSubmitting(true);
    setResult(null);

    // The state we attach is a slim view (full G is huge). The base64 codec of
    // the most recent turn-start snapshot is the most useful single artifact:
    // it lets the dev replay from the exact turn the bug happened on.
    const latestSnapshot = G.snapshots[G.snapshots.length - 1];
    const state = includeState ? {
      latestSnapshotCodec: latestSnapshot?.codec,
      latestSnapshotTurn: latestSnapshot?.turn,
      latestSnapshotPlayer: latestSnapshot?.playerId,
      pendingChoice: G.pendingChoice,
      pausedHandlerState: G.pausedHandlerState,
      players: Object.fromEntries(Object.entries(G.players).map(([pid, p]) => [pid, {
        color: p.color, vp: p.vp, power: p.power, influence: p.influence,
        barracksLeft: p.barracksLeft, hand: p.hand.map(c => c.name),
        deckSize: p.deck.length, discardSize: p.discard.length,
        innerCircleSize: p.innerCircle.length, trophyHall: p.trophyHall,
      }])),
      troops: Object.fromEntries(Object.entries(G.troops).filter(([, v]) => v != null)),
      spies: Object.fromEntries(Object.entries(G.spies).filter(([, arr]) => arr.length > 0)),
      siteControl: Object.fromEntries(Object.entries(G.siteControl).filter(([, v]) => v != null)),
      controlMarkers: Object.fromEntries(Object.entries(G.controlMarkers).filter(([, m]) => m.holder != null)),
    } : undefined;

    const meta = {
      userAgent: navigator.userAgent,
      turn: ctxInfo.turn,
      currentPlayer: ctxInfo.currentPlayer,
      gameover: ctxInfo.gameover ?? null,
      ...(config && {
        numPlayers: config.numPlayers,
        halfDecks: config.halfDecks,
        aiStyles: config.aiStyles,
      }),
    };

    // No relay configured AND we're not running on a dev host where the
    // /__report-problem Vite middleware would catch it: skip the fetch
    // entirely and open a GitHub Issues page with the report prefilled.
    // The user submits the issue themselves (one click, requires being
    // logged in to GitHub). This is the fallback that lets iPad / static-
    // hosting users file bugs without any backend.
    if (!relayAvailable()) {
      const url = githubIssueUrl({
        description: description.trim(),
        expected: expected.trim(),
        meta,
        stateSummary: includeState && state ? JSON.stringify(state, null, 2).slice(0, 1500) : undefined,
        logTail: includeLog ? G.log.slice(-20) : undefined,
      });
      window.open(url, '_blank', 'noopener');
      setResult({
        ok: true,
        url,
        note: 'Opened a prefilled GitHub Issues tab. Sign in to GitHub and click "Submit new issue" to complete.',
      });
      setSubmitting(false);
      return;
    }

    // Relay path: POST to either the configured Cloudflare Worker
    // (production) or the Vite middleware at /__report-problem (dev).
    const relayUrl = import.meta.env.VITE_TOTU_RELAY_URL as string | undefined;
    const submitUrl = relayUrl ? `${relayUrl.replace(/\/$/, '')}/problem-report` : '/__report-problem';

    try {
      const resp = await fetch(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          expected: expected.trim() || undefined,
          includeState,
          includeLog,
          state,
          log: includeLog ? G.log : undefined,
          meta,
        }),
      });
      const data = (await resp.json().catch(() => null)) as SubmitResult | null;
      if (data && typeof data === 'object' && 'ok' in data) {
        setResult(data);
      } else {
        // Relay responded but body wasn't JSON (e.g. GH Pages 404 HTML).
        // Fall back to the GitHub URL path so the user has a working route.
        const url = githubIssueUrl({
          description: description.trim(),
          expected: expected.trim(),
          meta,
          stateSummary: includeState && state ? JSON.stringify(state, null, 2).slice(0, 1500) : undefined,
          logTail: includeLog ? G.log.slice(-20) : undefined,
        });
        window.open(url, '_blank', 'noopener');
        setResult({
          ok: true,
          url,
          note: 'Relay returned an unexpected response, so we opened a prefilled GitHub Issues tab instead. Sign in to GitHub and click "Submit new issue" to complete.',
        });
      }
    } catch (err) {
      setResult({ ok: false, error: String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
    }}>
      <div style={{
        background: '#1a1228', color: '#e6e1f2',
        border: '2px solid #3a2055', borderRadius: 6,
        padding: 24, width: 560, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
      }}>
        <h2 style={{ marginTop: 0 }}>Report a problem</h2>
        <p style={{ fontSize: 12, opacity: 0.75, marginTop: -4 }}>
          Describe what happened. The current game state and recent log lines can be attached
          so the dev can replay the exact situation. Submits a GitHub issue (or saves locally
          if GitHub isn't configured).
        </p>

        <label style={{ display: 'block', marginTop: 12, fontSize: 12, opacity: 0.85 }}>
          What happened? <span style={{ color: '#ff8888' }}>*</span>
        </label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={4}
          placeholder="e.g. I played Spellspinner, picked Return-a-spy + supplant, and the supplant didn't fire at chchitl..."
          autoFocus
          style={{
            width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 6,
            background: '#0c0814', color: '#e6e1f2', border: '1px solid #3a2055',
            borderRadius: 4, fontFamily: 'inherit', fontSize: 13, resize: 'vertical',
          }}
        />

        <label style={{ display: 'block', marginTop: 12, fontSize: 12, opacity: 0.85 }}>
          What did you expect to happen? <span style={{ opacity: 0.5 }}>(optional)</span>
        </label>
        <textarea
          value={expected}
          onChange={e => setExpected(e.target.value)}
          rows={2}
          style={{
            width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 6,
            background: '#0c0814', color: '#e6e1f2', border: '1px solid #3a2055',
            borderRadius: 4, fontFamily: 'inherit', fontSize: 13, resize: 'vertical',
          }}
        />

        <div style={{ marginTop: 16, display: 'flex', gap: 16, fontSize: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={includeState} onChange={e => setIncludeState(e.target.checked)} />
            Include game state (codec + player summary)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={includeLog} onChange={e => setIncludeLog(e.target.checked)} />
            Include log (last 40 lines)
          </label>
        </div>

        {result && (
          <div style={{
            marginTop: 16, padding: 10, borderRadius: 4,
            background: result.ok ? 'rgba(80, 200, 120, 0.15)' : 'rgba(200, 80, 80, 0.15)',
            border: `1px solid ${result.ok ? '#5a9b6f' : '#9b5a5a'}`,
            fontSize: 13,
          }}>
            {result.ok ? (
              <>
                <div><b>Report submitted.</b></div>
                {result.url && (
                  <div style={{ marginTop: 6 }}>
                    Issue: <a href={result.url} target="_blank" rel="noreferrer" style={{ color: '#9bd' }}>{result.url}</a>
                  </div>
                )}
                {result.filePath && (
                  <div style={{ marginTop: 4, opacity: 0.7 }}>Saved locally: <code>{result.filePath}</code></div>
                )}
                {result.note && <div style={{ marginTop: 4, opacity: 0.7 }}>{result.note}</div>}
              </>
            ) : (
              <>
                <div><b>Submission failed.</b></div>
                <div style={{ marginTop: 4, opacity: 0.85, wordBreak: 'break-word' }}>{result.error}</div>
                {result.filePath && (
                  <div style={{ marginTop: 4, opacity: 0.7 }}>Saved locally anyway: <code>{result.filePath}</code></div>
                )}
              </>
            )}
          </div>
        )}

        <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={submitting}
            style={{ padding: '8px 16px', background: '#2a1840', color: '#e6e1f2', border: '1px solid #3a2055', borderRadius: 4, cursor: submitting ? 'not-allowed' : 'pointer' }}>
            {result?.ok ? 'Close' : 'Cancel'}
          </button>
          {!result?.ok && (
            <button onClick={submit} disabled={!description.trim() || submitting}
              style={{
                padding: '8px 16px', background: '#5a3380', color: '#fff',
                border: 'none', borderRadius: 4,
                cursor: !description.trim() || submitting ? 'not-allowed' : 'pointer',
                opacity: !description.trim() || submitting ? 0.5 : 1,
              }}>
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

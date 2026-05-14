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

    try {
      const resp = await fetch('/__report-problem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          expected: expected.trim() || undefined,
          includeState,
          includeLog,
          state,
          log: includeLog ? G.log : undefined,
          meta: {
            userAgent: navigator.userAgent,
            turn: ctxInfo.turn,
            currentPlayer: ctxInfo.currentPlayer,
            gameover: ctxInfo.gameover ?? null,
            ...(config && {
              numPlayers: config.numPlayers,
              halfDecks: config.halfDecks,
              aiStyles: config.aiStyles,
            }),
          },
        }),
      });
      const data = (await resp.json().catch(() => ({ ok: false, error: 'non-json response' }))) as SubmitResult;
      setResult(data);
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

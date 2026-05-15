// Game log + state-codec viewer/loader.
// Lists every turn captured so far (snapshot + log lines) and offers a paste box for
// rewinding to an arbitrary saved state.

import { useState } from 'react';
import type { TyrantsState } from '../game';
import { publishGameLog, type PublishContext } from '../publish-game-log';

interface Props {
  G: TyrantsState;
  onLoad: (codec: string) => void;
  /** Game metadata for the publish-log button. When provided the button is
   *  enabled; otherwise we still render it but disabled with a hint that
   *  configuration is missing. */
  publishContext?: Omit<PublishContext, 'source'>;
}

type UploadStatus =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'ok'; deduped: boolean; url?: string }
  | { kind: 'error'; message: string };

export function GameLog({ G, onLoad, publishContext }: Props) {
  const [pasted, setPasted] = useState('');
  const [expandedTurn, setExpandedTurn] = useState<number | null>(null);
  const [upload, setUpload] = useState<UploadStatus>({ kind: 'idle' });

  async function uploadLog() {
    if (!publishContext) return;
    setUpload({ kind: 'uploading' });
    const result = await publishGameLog(G, { ...publishContext, source: 'browser-manual-upload' });
    if (result.ok) {
      setUpload({ kind: 'ok', deduped: !!result.deduped, url: result.htmlUrl });
    } else {
      setUpload({ kind: 'error', message: result.error ?? 'unknown error' });
    }
  }

  // Pair each snapshot with its matching turn's log lines (if completed).
  const entries = G.snapshots.map(s => ({
    snapshot: s,
    log: G.turnLogs.find(t => t.turn === s.turn),
  })).slice().reverse();

  function copy(text: string) {
    navigator.clipboard.writeText(text);
  }

  function downloadAll() {
    const payload = {
      exportedAt: new Date().toISOString(),
      log: G.log,
      turnLogs: G.turnLogs,
      snapshots: G.snapshots,
      players: Object.fromEntries(Object.entries(G.players).map(([pid, p]) => [pid, { color: p.color, vp: p.vp }])),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tyrants-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ padding: 8 }}>
      <div style={{ marginBottom: 12, fontSize: 12, opacity: 0.85 }}>
        Each entry below is one turn. The codec is a base64 snapshot of the game at that
        turn's start. Copy a codec, then paste into the box below and click <b>Load</b> to
        rewind to that state. Newest turns first.
      </div>

      <div style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <textarea
          value={pasted}
          onChange={e => setPasted(e.target.value)}
          placeholder="Paste a codec here to load..."
          rows={3}
          style={{ flex: 1, padding: 6, fontFamily: 'monospace', fontSize: 11, background: '#0c0814', color: '#e6e1f2', border: '1px solid #3a2055', borderRadius: 4 }}
        />
        <button
          onClick={() => {
            if (!pasted.trim()) return;
            if (!confirm('Load this state? Current game progress will be replaced.')) return;
            onLoad(pasted.trim());
            setPasted('');
          }}
          disabled={!pasted.trim()}
          style={{ padding: '8px 16px', background: '#5a3380', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        >
          Load state
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, opacity: 0.7, flex: 1 }}>
          {entries.length} turn{entries.length === 1 ? '' : 's'} captured.
        </div>
        <button onClick={uploadLog}
          disabled={!publishContext || upload.kind === 'uploading'}
          title={publishContext
            ? 'Upload this game log to the public log repo. The relay deduplicates by content, so repeat uploads of the same state are no-ops.'
            : 'Upload disabled — game session context not available.'}
          style={{
            fontSize: 12, padding: '4px 10px', borderRadius: 3, border: 'none',
            background: !publishContext ? '#2a1840' : upload.kind === 'uploading' ? '#3a2055' : '#5a3380',
            color: '#fff',
            cursor: !publishContext || upload.kind === 'uploading' ? 'default' : 'pointer',
            opacity: !publishContext ? 0.5 : 1,
          }}>
          {upload.kind === 'uploading' ? 'Uploading…' : 'Upload log'}
        </button>
        <button onClick={downloadAll}
          style={{ fontSize: 12, padding: '4px 10px', background: '#3a2055', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer' }}>
          Download full log (JSON)
        </button>
      </div>
      {upload.kind === 'ok' && (
        <div style={{ marginBottom: 8, padding: 6, background: '#1a2a18', border: '1px solid #3a5530', borderRadius: 3, fontSize: 11 }}>
          {upload.deduped
            ? 'Already uploaded earlier — server deduped, nothing committed.'
            : 'Uploaded successfully.'}
          {upload.url && <> <a href={upload.url} target="_blank" rel="noreferrer" style={{ color: '#9fd' }}>View commit ↗</a></>}
          <button onClick={() => setUpload({ kind: 'idle' })}
            style={{ marginLeft: 8, padding: '0 6px', fontSize: 10, background: 'transparent', color: '#9fd', border: '1px solid #3a5530', borderRadius: 2, cursor: 'pointer' }}>
            dismiss
          </button>
        </div>
      )}
      {upload.kind === 'error' && (
        <div style={{ marginBottom: 8, padding: 6, background: '#2a1818', border: '1px solid #553030', borderRadius: 3, fontSize: 11 }}>
          Upload failed: {upload.message}
          <button onClick={() => setUpload({ kind: 'idle' })}
            style={{ marginLeft: 8, padding: '0 6px', fontSize: 10, background: 'transparent', color: '#fcc', border: '1px solid #553030', borderRadius: 2, cursor: 'pointer' }}>
            dismiss
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {entries.map(({ snapshot, log }) => {
          const isOpen = expandedTurn === snapshot.turn;
          return (
            <div key={snapshot.turn} style={{ background: '#1a1228', borderRadius: 4, padding: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  onClick={() => setExpandedTurn(isOpen ? null : snapshot.turn)}
                  style={{ cursor: 'pointer', fontSize: 13, flex: 1 }}>
                  {isOpen ? '▾' : '▸'} Turn {snapshot.turn} · P{Number(snapshot.playerId) + 1} ({snapshot.color})
                  {log && <span style={{ opacity: 0.6, marginLeft: 8, fontSize: 11 }}>· {log.lines.length} actions</span>}
                </span>
                <button onClick={() => copy(snapshot.codec)} style={{ fontSize: 11, padding: '2px 8px' }}>
                  Copy codec
                </button>
                <button onClick={() => { if (confirm(`Load turn ${snapshot.turn}? Current progress replaced.`)) onLoad(snapshot.codec); }}
                  style={{ fontSize: 11, padding: '2px 8px', background: '#3a2055', color: '#fff', border: 'none', borderRadius: 3 }}>
                  Load
                </button>
              </div>
              {isOpen && (
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  {log ? (
                    <>
                      <div style={{ opacity: 0.7, marginBottom: 4 }}>Actions during this turn:</div>
                      {log.lines.length === 0
                        ? <div style={{ opacity: 0.5 }}>(no actions logged)</div>
                        : log.lines.map((l, i) => <div key={i} style={{ padding: '1px 0', opacity: 0.9 }}>{l}</div>)
                      }
                    </>
                  ) : (
                    <div style={{ opacity: 0.5 }}>(turn in progress)</div>
                  )}
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, opacity: 0.6 }}>codec ({snapshot.codec.length} chars)</summary>
                    <pre style={{ marginTop: 4, padding: 6, background: '#0c0814', borderRadius: 3, fontSize: 10, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                      {snapshot.codec}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          );
        })}
        {entries.length === 0 && <div style={{ opacity: 0.6, fontSize: 12 }}>No turns recorded yet — play a turn to populate.</div>}
      </div>
    </div>
  );
}

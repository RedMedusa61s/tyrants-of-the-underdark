import { useEffect, useMemo, useState } from 'react';
import { useGame } from 'digital-boardgame-framework/client';
import { makeClient } from './client';
import { rememberOpenedGame } from './myGames';
import type { BgioState, TyrantsAction, PlayerId } from '../adapter/tyrantsAdapter';

// Deliberately MINIMAL ("ugly buttons") UI: a JSON dump of the redacted view
// plus one button per legal action. This is the end-to-end multiplayer proof;
// the pretty board is the hotseat App's job and is untouched.

function actionLabel(a: TyrantsAction): string {
  switch (a.kind) {
    case 'deployStartingTroop': return `Deploy starting troop @ ${a.siteId}`;
    case 'playCard': return `Play hand card #${a.handIndex}`;
    case 'recruitFromMarket': return `Recruit market slot ${a.marketIndex}`;
    case 'recruitFromAuxStack': return `Recruit ${a.stack}`;
    case 'deployTroop': return `Deploy troop @ ${a.spaceId}`;
    case 'assassinateTroop': return `Assassinate @ ${a.spaceId}`;
    case 'returnEnemySpy': return `Return ${a.targetColor} spy @ ${a.siteId}`;
    case 'resolveChoice': return `Resolve: ${JSON.stringify(a.response)}`;
    case 'endTurn': return 'End turn';
  }
}

export function OnlinePlay({ gameId, token }: { gameId: string; token: string }) {
  const client = useMemo(() => makeClient(gameId, token), [gameId, token]);
  const { view, yourTurn, gameOver, you, turn, legalActions, submit, reportBug, loading, error } =
    useGame<BgioState, TyrantsAction>(client, { pollMs: 2000 });

  useEffect(() => {
    if (you != null) rememberOpenedGame(gameId, you as PlayerId, token);
  }, [you, gameId, token]);

  const [reportMsg, setReportMsg] = useState('');
  const [reported, setReported] = useState<string | null>(null);

  if (loading && !view) return <p>Loading…</p>;
  if (!view) return <p style={{ color: '#f66' }}>Error: {error?.message ?? 'no view'}</p>;

  const status = gameOver
    ? 'Game over.'
    : yourTurn
      ? 'Your move.'
      : `Waiting for the active player…`;

  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Tyrants — Online (minimal)</h1>
      <p>
        You are <strong style={{ color: '#bf9cff' }}>seat {you ?? '…'}</strong>.{' '}
        <span style={{ color: '#aab' }}>{status}</span>{' '}
        <span style={{ color: '#667' }}>(turn {turn})</span>
      </p>

      {error && <p style={{ color: '#f66' }}>⚠ {error.message}</p>}

      <h2 style={{ fontSize: 16 }}>Legal actions</h2>
      {yourTurn && !gameOver ? (
        legalActions.length === 0
          ? <p style={{ color: '#aab' }}>No legal actions.</p>
          : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {legalActions.map((a, i) => (
                <button key={i} onClick={() => submit(a)} style={actBtn}>
                  {actionLabel(a)}
                </button>
              ))}
            </div>
          )
      ) : (
        <p style={{ color: '#aab' }}>Not your turn — controls hidden.</p>
      )}

      <h2 style={{ fontSize: 16, marginTop: 24 }}>Redacted state (your view)</h2>
      <pre style={{
        background: '#100a18', border: '1px solid #332', borderRadius: 6, padding: 12,
        maxHeight: 480, overflow: 'auto', fontSize: 11, color: '#cbd',
      }}>
        {JSON.stringify(view, null, 2)}
      </pre>

      <p style={{ marginTop: 16 }}>
        <a href="/lobby" style={{ color: '#6cf' }}>← Lobby</a>
      </p>

      <details style={{ marginTop: 12, color: '#aab' }}>
        <summary style={{ cursor: 'pointer' }}>Report a problem</summary>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            value={reportMsg}
            onChange={(e) => setReportMsg(e.target.value)}
            placeholder="What went wrong?"
            style={{ flex: 1, padding: 6, borderRadius: 4, border: '1px solid #445', background: '#0f0a18', color: 'white' }}
          />
          <button
            disabled={!reportMsg.trim()}
            onClick={async () => {
              const id = await reportBug(reportMsg.trim(), 'bug');
              setReported(id);
              setReportMsg('');
            }}
            style={{ ...actBtn, opacity: reportMsg.trim() ? 1 : 0.5 }}
          >
            Send
          </button>
        </div>
        {reported && <p style={{ fontSize: 13 }}>Thanks — filed as <code>{reported}</code>.</p>}
      </details>
    </div>
  );
}

const actBtn: React.CSSProperties = {
  background: '#2d6cdf',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 13,
  cursor: 'pointer',
};

import { useEffect, useState } from 'react';
import { useIdentity, Leaderboard, SignInBar } from 'digital-boardgame-framework/client';
import { createGame, fetchStatus, deleteGame, type Invites } from './client';
import { listMyGames, rememberCreatedGame, forgetGame, type MyGame } from './myGames';
import type { PlayerId } from '../adapter/tyrantsAdapter';

const COLOR_NAMES = ['Black', 'Red', 'Orange', 'Blue'];

export function Lobby() {
  const [numPlayers, setNumPlayers] = useState(2);
  const [game, setGame] = useState<Invites | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  async function onCreate() {
    setBusy(true);
    setErr(null);
    try {
      const g = await createGame(numPlayers);
      rememberCreatedGame(g.gameId, g.invites);
      setGame(g);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <h1>Tyrants of the Underdark — Online</h1>
      <SignInBar />
      <p style={{ color: '#aab' }}>
        Minimal async multiplayer. Pick a player count, create a game, send one
        link per seat (or open them in separate tabs).
      </p>
      <p style={{ marginTop: -4 }}>
        <a href="/" style={{ color: '#6cf' }}>← Play solo / vs AI / hotseat (main game)</a>
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <span>Players:</span>
        {[2, 3, 4].map((n) => (
          <button
            key={n}
            onClick={() => setNumPlayers(n)}
            style={{ ...mini, ...(numPlayers === n ? { background: '#5a3380', color: 'white' } : {}) }}
          >
            {n}
          </button>
        ))}
      </div>

      <button onClick={onCreate} disabled={busy} style={btn}>
        {busy ? 'Creating…' : `New ${numPlayers}-player game`}
      </button>
      {err && <p style={{ color: '#f66' }}>{err}</p>}

      {game && (
        <div style={{ marginTop: 24 }}>
          <p>Game <code>{game.gameId}</code> created. Share one link per seat:</p>
          {(Object.keys(game.invites) as PlayerId[]).map((seat) => (
            <InviteRow key={seat} seat={seat} url={game.invites[seat]} />
          ))}
        </div>
      )}

      <GamesInProgress reloadKey={reloadKey} />

      <div style={{ marginTop: 36 }}>
        <h2 style={{ fontSize: 18 }}>Leaderboard</h2>
        <p style={{ color: '#778', fontSize: 12, marginTop: -4 }}>
          Per-game ratings (Glicko-2). Anon players are provisional (*); sign in
          to make your rating permanent and carry it across devices. ·{' '}
          <a href={`${HUB_URL}/leaderboard?game=tyrants`} target="_blank" rel="noopener"
             style={{ color: '#6cf' }}>open full page ↗</a>
        </p>
        <TyrantsLeaderboard />
      </div>

      <MoreGames />
    </div>
  );
}

function TyrantsLeaderboard() {
  const { identity } = useIdentity();
  return <Leaderboard game="tyrants" highlightPlayerId={identity?.playerId} />;
}

/** The cross-game hub's canonical URL. Its games.json is the single source of
 *  truth (served CORS-open), so adding a game there makes it appear here with
 *  no change to this file. */
const HUB_URL = 'https://games-hub-5vo.pages.dev';

interface HubGame {
  id: string;
  name: string;
  blurb?: string;
  url: string | null;
  status: string;
  accent?: string;
}

/** "More board games" — the other games from the hub, fetched live. Filters out
 *  Tyrants itself; hides entirely if the hub is unreachable (never breaks the
 *  lobby). */
function MoreGames() {
  const [games, setGames] = useState<HubGame[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`${HUB_URL}/games.json`, { cache: 'no-cache' })
      .then((r) => r.json())
      .then((d) => {
        if (alive) setGames(((d?.games ?? []) as HubGame[]).filter((g) => g.id !== 'tyrants'));
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (failed || (games && games.length === 0)) return null;

  return (
    <div style={{ marginTop: 36 }}>
      <h2 style={{ fontSize: 18 }}>More board games</h2>
      <p style={{ color: '#778', fontSize: 12, marginTop: -4 }}>
        Other games by the same author — <a href={HUB_URL} style={{ color: '#6cf' }}>see all →</a>
      </p>
      {!games && <p style={{ color: '#778' }}>Loading…</p>}
      {games?.map((g) => {
        const playable = g.status !== 'soon' && !!g.url;
        const inner = (
          <>
            <strong style={{ color: playable ? '#cbd' : '#889' }}>{g.name}</strong>
            {g.status === 'soon' && <span style={{ color: '#778', fontSize: 12 }}> (coming soon)</span>}
            {g.blurb && <div style={{ color: '#889', fontSize: 12 }}>{g.blurb}</div>}
          </>
        );
        const frame: React.CSSProperties = {
          display: 'block', margin: '10px 0', paddingLeft: 10,
          borderLeft: `3px solid ${g.accent ?? '#5a3380'}`,
        };
        return playable ? (
          <a key={g.id} href={g.url!} style={{ ...frame, textDecoration: 'none' }}>{inner}</a>
        ) : (
          <div key={g.id} style={{ ...frame, opacity: 0.6 }}>{inner}</div>
        );
      })}
    </div>
  );
}

function seatLabel(seat: PlayerId): string {
  const i = Number(seat);
  return `Seat ${seat} (${COLOR_NAMES[i] ?? seat})`;
}

function GamesInProgress({ reloadKey }: { reloadKey: number }) {
  const [games, setGames] = useState<MyGame[]>([]);
  const [status, setStatus] = useState<Record<string, string>>({});

  function load() {
    const gs = listMyGames();
    setGames(gs);
    gs.forEach(async (g) => {
      const seat = Object.keys(g.seats)[0] as PlayerId | undefined;
      const token = seat ? g.seats[seat] : undefined;
      if (!token) return;
      try {
        const st = await fetchStatus(g.gameId, token);
        const label = st.deleted ? 'ended'
          : st.gameOver ? 'finished'
          : st.yourTurn ? 'seat 0: your turn'
          : 'waiting';
        setStatus((prev) => ({ ...prev, [g.gameId]: label }));
      } catch {
        setStatus((prev) => ({ ...prev, [g.gameId]: 'unavailable' }));
      }
    });
  }

  useEffect(load, [reloadKey]);

  if (games.length === 0) return null;

  return (
    <div style={{ marginTop: 36 }}>
      <h2 style={{ fontSize: 18 }}>Games in progress</h2>
      <p style={{ color: '#778', fontSize: 12, marginTop: -4 }}>
        Remembered on this device only — clearing browser data forgets them.
      </p>
      {games.map((g) => (
        <div
          key={g.gameId}
          style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '10px 0', flexWrap: 'wrap' }}
        >
          <code style={{ minWidth: 90 }}>{g.gameId.slice(0, 8)}…</code>
          <span style={{ color: '#aab', minWidth: 130 }}>{status[g.gameId] ?? 'loading…'}</span>
          {(Object.keys(g.seats) as PlayerId[]).map((seat) => (
            <a key={seat} href={`/play/${g.gameId}?as=${g.seats[seat]}`} style={{ color: '#6cf' }}>
              Resume {seatLabel(seat)}
            </a>
          ))}
          <button style={mini} onClick={() => { forgetGame(g.gameId); load(); }}>
            Remove
          </button>
          <button
            style={{ ...mini, color: '#f88' }}
            onClick={async () => {
              const seat = Object.keys(g.seats)[0] as PlayerId | undefined;
              const token = seat ? g.seats[seat] : undefined;
              if (token && confirm('End this game for all players? This deletes it.')) {
                try { await deleteGame(g.gameId, token); } catch { /* already gone */ }
              }
              forgetGame(g.gameId);
              load();
            }}
          >
            End
          </button>
        </div>
      ))}
    </div>
  );
}

function InviteRow({ seat, url }: { seat: PlayerId; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
      <strong style={{ width: 140 }}>{seatLabel(seat)}</strong>
      <a href={url} style={{ color: '#6cf', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {url}
      </a>
      <button
        style={{ ...btn, padding: '4px 10px' }}
        onClick={() => {
          navigator.clipboard?.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: '#5a3380',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  padding: '8px 16px',
  fontSize: 15,
  cursor: 'pointer',
};

const mini: React.CSSProperties = {
  background: 'transparent',
  color: '#aab',
  border: '1px solid #445',
  borderRadius: 4,
  padding: '3px 10px',
  fontSize: 13,
  cursor: 'pointer',
};

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { BoardProps } from 'boardgame.io/react';
import { useGame } from 'digital-boardgame-framework/client';
import { makeClient } from './client';
import { rememberOpenedGame } from './myGames';
import { Board, BoardModeContext, type OnlineReportCategory, type OnlineReportResult } from '../App';
import { AI_VERSION } from '../ai-version';
import { relayBaseUrl } from '../relay-url';
import type { TyrantsState } from '../game';
import type { BgioState, TyrantsAction, PlayerId } from '../adapter/tyrantsAdapter';

// ONLINE play renders the REAL Tyrants board — the exact same <Board/> component
// hotseat uses — fed by a BoardProps-shaped object backed by the framework's
// useGame/submit instead of a boardgame.io Client.
//
// The seam (see App.tsx BoardModeContext):
//   - G / ctx     come straight from the redacted server view.
//   - playerID    is the server-assigned seat (`you`); Board reads it via
//                 BoardModeContext.mySeat and renders that seat's controls.
//   - isActive    is `yourTurn`.
//   - moves       is a PROXY: each bgio move name maps 1:1 onto a framework
//                 Action and is dispatched through submit(...). The 9 move names
//                 match the 9 TyrantsAction kinds exactly (see tyrantsAdapter).
//   - undo / redo / reset / loadState are no-ops online (hotseat-only rewind).
//   - isOnline=true gates off the local AI driver + all localStorage / archive /
//     publish side effects inside Board.
//
// A submit is fire-and-forget from the board's perspective (bgio moves return
// void); useGame re-fetches the authoritative view, which re-renders the board.

/** Build the moves proxy: bgio-move-name(...args) -> submit(Action). The arg
 *  shapes mirror toBgioAction in tyrantsAdapter.ts (the inverse mapping). */
function makeMovesProxy(
  submit: (a: TyrantsAction) => void,
): BoardProps<TyrantsState>['moves'] {
  const moves: Record<string, (...args: any[]) => void> = {
    deployStartingTroop: (siteId: string) => submit({ kind: 'deployStartingTroop', siteId }),
    playCard: (handIndex: number) => submit({ kind: 'playCard', handIndex }),
    recruitFromMarket: (marketIndex: number) => submit({ kind: 'recruitFromMarket', marketIndex }),
    recruitFromAuxStack: (stack: 'houseGuards' | 'priestesses') =>
      submit({ kind: 'recruitFromAuxStack', stack }),
    deployTroop: (spaceId: string) => submit({ kind: 'deployTroop', spaceId }),
    assassinateTroop: (spaceId: string) => submit({ kind: 'assassinateTroop', spaceId }),
    returnEnemySpy: (siteId: string, targetColor: string) =>
      submit({ kind: 'returnEnemySpy', siteId, targetColor: targetColor as any }),
    resolveChoice: (response: unknown) => submit({ kind: 'resolveChoice', response }),
    endTurn: () => submit({ kind: 'endTurn' }),
    // Hotseat-only rewind controls — no-ops online. Board disables/hides their
    // entry points when isOnline (undo button is gated on G.undoStack, which is
    // stripped by viewFor, so it's always disabled online anyway).
    undo: () => { /* online: server is authoritative; no client-side undo */ },
    redo: () => { /* online: no-op */ },
    loadState: () => { /* online: server is authoritative; no local snapshot load */ },
  };
  return moves as unknown as BoardProps<TyrantsState>['moves'];
}

export function OnlinePlay({ gameId, token }: { gameId: string; token: string }) {
  const client = useMemo(() => makeClient(gameId, token), [gameId, token]);
  const { view, yourTurn, you, submit, loading, error } =
    useGame<BgioState, TyrantsAction>(client, { pollMs: 2000 });

  useEffect(() => {
    if (you != null) rememberOpenedGame(gameId, you as PlayerId, token);
  }, [you, gameId, token]);

  // submit() returns a Promise; the board calls moves.x(...) synchronously and
  // ignores the result, so we fire-and-forget and let useGame re-fetch.
  //
  // PHANTOM "engine rejected" FIX: the same logical move could fire twice (rapid
  // click, a React re-invoke, or a submit racing useGame's poll). The first
  // applies server-side; the duplicate then hits a server that already advanced
  // and tryApplyAction rejects it — surfacing an "Illegal action" banner even
  // though the game moved on correctly. We guard two ways:
  //   1. SERIALIZE: only one submit is in flight at a time; the rest queue and
  //      apply in order. This keeps useGame's view/error consistent (no two
  //      submits interleaving their setState) and matches turn-based intent.
  //   2. DEDUPE identical actions: if an action with the *same* JSON payload is
  //      already in flight or sitting in the queue, drop the new one. Distinct
  //      moves a player makes in quick succession are NOT dropped (different
  //      payloads → different keys), so legitimate rapid play still works.
  // The keep-latest semantics aren't needed: every queued action is preserved
  // and applied in order; only exact duplicates are coalesced.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const queueRef = useRef<{ items: { key: string; action: TyrantsAction }[]; draining: boolean }>(
    { items: [], draining: false },
  );

  const enqueueSubmit = useCallback((a: TyrantsAction) => {
    const key = JSON.stringify(a);
    const q = queueRef.current;
    // Drop an exact-duplicate of something already pending/in-flight.
    if (q.items.some((it) => it.key === key)) return;
    q.items.push({ key, action: a });
    if (q.draining) return;
    q.draining = true;
    (async () => {
      while (q.items.length > 0) {
        const next = q.items[0]; // keep it in the queue so a duplicate is still detected
        try {
          // useGame.submit clears `error` on success and re-fetches the
          // authoritative view; a transient/stale error never lingers past the
          // next successful submit. On failure it re-syncs and rethrows — we
          // swallow the throw here (board ignores it) so the queue keeps draining.
          await submitRef.current(next.action);
        } catch {
          /* error surfaced via useGame.error; refresh already re-synced the view */
        } finally {
          q.items.shift();
        }
      }
      q.draining = false;
    })();
  }, []);

  const moves = useMemo(() => makeMovesProxy(enqueueSubmit), [enqueueSubmit]);

  // Online problem reports go to ONE canonical triage channel: GitHub Issues,
  // via the same relay the hotseat uses. We ALSO write the framework report
  // store (Supabase dbf_reports) so the authoritative server snapshot is kept
  // for replay, and reference its id from the issue. Two writes, one inbox:
  //   1. client.report() -> server.report -> dbf_reports (durable snapshot).
  //   2. relay /problem-report -> GitHub issue, labelled by symptom category.
  // The clientBuild/build stamp (AI_VERSION git SHA) lets triage tell which
  // build a report came from. A 'multiplayer' category adds area:multiplayer
  // so framework-class bugs are filterable and routable upstream.
  const reportProblem = useMemo(
    () =>
      async (
        message: string,
        opts?: { category?: OnlineReportCategory },
      ): Promise<OnlineReportResult> => {
        const category = opts?.category ?? 'game';
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : undefined;

        // 1. Durable authoritative snapshot in the framework store (best-effort:
        //    the GitHub issue is the canonical channel, so a store failure here
        //    must not block filing the issue).
        let reportId: string | undefined;
        try {
          const r = await client.report({
            message,
            clientBuild: `tyrants-online@${AI_VERSION}`,
            userAgent: ua,
          });
          reportId = r.reportId;
        } catch { /* non-fatal — fall through to the issue */ }

        // 2. Canonical GitHub issue via the relay (dev: local /__report-problem).
        const relay = relayBaseUrl();
        const submitUrl = relay ? `${relay}/problem-report` : '/__report-problem';
        const labels = category === 'multiplayer' ? ['area:multiplayer'] : [];
        let issueUrl: string | undefined;
        let issueNumber: number | undefined;
        try {
          const resp = await fetch(submitUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              description: message,
              labels,
              meta: {
                mode: 'online',
                gameId,
                seat: you ?? null,
                build: `tyrants-online@${AI_VERSION}`,
                category,
                frameworkReportId: reportId ?? null,
                userAgent: ua,
              },
            }),
          });
          const data = (await resp.json().catch(() => null)) as
            | { ok?: boolean; url?: string; number?: number }
            | null;
          if (data?.ok) { issueUrl = data.url; issueNumber = data.number; }
        } catch { /* relay unreachable — reportId (if any) is still returned */ }

        return { reportId, issueUrl, issueNumber };
      },
    [client, gameId, you],
  );

  if (loading && !view) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!view) {
    return (
      <p style={{ padding: 24, color: '#f66' }}>
        Error: {error?.message ?? 'no view'} · <a href="/lobby" style={{ color: '#6cf' }}>← Lobby</a>
      </p>
    );
  }

  // Construct the BoardProps the real Board expects. Only the props Board
  // actually consumes need to be faithful: G, ctx, moves, plus the bgio-required
  // shape. The rest (events, log, matchData, etc.) are filled with safe stubs.
  const boardProps = {
    G: view.G,
    ctx: view.ctx as unknown as BoardProps<TyrantsState>['ctx'],
    moves,
    playerID: you ?? null,
    isActive: yourTurn,
    isMultiplayer: true,
    isConnected: true,
    events: {
      endTurn: () => {},
      endPhase: () => {},
      endStage: () => {},
      setPhase: () => {},
      setStage: () => {},
      endGame: () => {},
      setActivePlayers: () => {},
    } as unknown as BoardProps<TyrantsState>['events'],
    reset: () => {},
    undo: () => {},
    redo: () => {},
    log: [],
    matchID: gameId,
    matchData: undefined,
    sendChatMessage: () => {},
    chatMessages: [],
    plugins: (view as any).plugins ?? {},
  } as unknown as BoardProps<TyrantsState>;

  return (
    <BoardModeContext.Provider value={{ isOnline: true, mySeat: (you ?? '0') as string, onlineError: error, reportProblem }}>
      <Board {...boardProps} />
    </BoardModeContext.Provider>
  );
}

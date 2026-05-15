import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Client } from 'boardgame.io/react';
import type { BoardProps } from 'boardgame.io/react';
import { TyrantsGame, type TyrantsState, type CardRef } from './game';
import { MapView } from './components/MapView';
import { CardCalibration } from './components/CardCalibration';
import { CostVerify } from './components/CostVerify';
import { SiteVerify } from './components/SiteVerify';
import { SlotCalibration } from './components/SlotCalibration';
import { SectionDividerCalibration } from './components/SectionDividerCalibration';
import { MarkerCalibration } from './components/MarkerCalibration';
import { GameLog } from './components/GameLog';
import { CardTextVerify } from './components/CardTextVerify';
import { RouteVerify } from './components/RouteVerify';
import { ProblemReportDialog } from './components/ProblemReportDialog';
import { FirstRunImageImport } from './components/FirstRunImageImport';
import { PlaceholderCard } from './components/PlaceholderCard';
import { useCachedImage } from './image-cache';
import { SITES } from './data/sites';
import { sitesSpaces, TROOP_SPACES } from './data/troop-spaces';
import { hasPresence, checkTokenConservation } from './engine/map-state';
import { publishGameLog } from './publish-game-log';
import { archiveGame, getAllArchivedGames, payloadForArchivedGame } from './game-archive';
import { LogUploadConsentDialog } from './components/LogUploadConsentDialog';
import { decideAiMove, type AiMove } from './ai/random-ai';
import { decideHeuristicMove } from './ai/heuristic-ai';
import { lookupCard } from './card-data';
import { scoreAll } from './engine/scoring';

const HUMAN_SEAT = '0';
const AI_THINK_MS = 400;
const SAVE_KEY = 'totu.savegame';
const CONFIG_KEY = 'totu.gameconfig';
const DEV_KEY = 'totu.dev-mode';
const NO_IMAGES_KEY = 'totu.no-images';

function readUrlBoolFlag(param: string, storageKey: string): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has(param)) {
      const val = params.get(param) === '1' || params.get(param) === 'true';
      localStorage.setItem(storageKey, val ? '1' : '0');
      return val;
    }
    return localStorage.getItem(storageKey) === '1';
  } catch { return false; }
}

/** Read dev-mode from URL (?dev=1 / ?dev=0) and persist in localStorage. The URL
 *  param takes precedence and updates the stored value; otherwise we honor the
 *  stored flag. Visiting the app fresh shows only player-facing tabs. */
function initialDevMode(): boolean {
  return readUrlBoolFlag('dev', DEV_KEY);
}

/** No-images mode (?no-images=1 / ?no-images=0). When on, the first-run image
 *  import gate is skipped and the Card component renders text-only
 *  placeholders. Lets users play the game without ever fetching art, and lets
 *  the dev exercise the placeholder UI without clearing the image cache. */
export function isNoImagesMode(): boolean {
  return readUrlBoolFlag('no-images', NO_IMAGES_KEY);
}

type AiStyle = 'random' | 'heuristic';
type HalfDeck = 'drow' | 'dragons' | 'elemental' | 'demons';
const HALF_DECKS: HalfDeck[] = ['drow', 'dragons', 'elemental', 'demons'];
type ThirdPlayerSide = 'left' | 'right';
interface GameConfig {
  numPlayers: number;
  /** AI style for seats 1..N-1 (seat 0 is the human). */
  aiStyles: AiStyle[];
  /** Exactly 2 half-decks chosen for the market. */
  halfDecks: HalfDeck[];
  /** For 3-player games only: which outer section plays alongside the center.
   *  Ignored for 2-player (center only) and 4-player (all three sections). */
  thirdPlayerSide?: ThirdPlayerSide;
}
const AI_FNS: Record<AiStyle, (G: TyrantsState, pid: string) => AiMove | null> = {
  random: decideAiMove,
  heuristic: decideHeuristicMove,
};

/** Rulebook p.5: 2P = center only; 3P = center + one outer; 4P = all three. */
function activeSectionsFor(cfg: GameConfig): Array<'left' | 'center' | 'right'> {
  if (cfg.numPlayers <= 2) return ['center'];
  if (cfg.numPlayers === 3) return ['center', cfg.thirdPlayerSide ?? 'left'];
  return ['left', 'center', 'right'];
}

interface SessionCtx {
  config: GameConfig;
  onNewGame: () => void;
}
const SessionContext = createContext<SessionCtx | null>(null);

function Card({ card, onClick, label }: { card: CardRef; onClick?: () => void; label?: string }) {
  const [hover, setHover] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const imgUrl = useCachedImage(card.image);
  // No-images mode forces the placeholder regardless of cache state. Also
  // falls back to placeholder if the image actually 404s at runtime.
  const showPlaceholder = isNoImagesMode() || imgFailed;
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 120, margin: 4, borderRadius: 8,
        cursor: onClick ? 'pointer' : 'default',
        background: '#1a1228',
        position: 'relative',
      }}
      title={card.name}
    >
      {showPlaceholder ? (
        <PlaceholderCard card={card} hover={hover} />
      ) : (
        <img
          src={imgUrl}
          alt={card.name}
          onError={() => setImgFailed(true)}
          style={{
            width: '100%', display: 'block', borderRadius: 8,
            boxShadow: hover ? '0 8px 32px rgba(0,0,0,0.8)' : '0 2px 8px rgba(0,0,0,0.5)',
            transform: hover ? 'scale(2.5)' : 'scale(1)',
            transformOrigin: 'center center',
            transition: 'transform 120ms ease-out, box-shadow 120ms ease-out',
            zIndex: hover ? 1000 : 1,
            position: 'relative',
            pointerEvents: 'none',
          }}
        />
      )}
      {label && <div style={{ padding: '2px 6px', fontSize: 11, opacity: 0.8 }}>{label}</div>}
    </div>
  );
}

type BaseAction = null | { kind: 'deploy' | 'assassinate' } | { kind: 'return-spy'; siteId?: string };

function Board({ G, ctx, moves }: BoardProps<TyrantsState>) {
  const session = useContext(SessionContext);
  const [tab, setTab] = useState<'game' | 'map' | 'calibrate' | 'routes' | 'cards' | 'costs' | 'text' | 'sites' | 'whites' | 'slots' | 'dividers' | 'markers' | 'log'>('game');
  const [baseAction, setBaseAction] = useState<BaseAction>(null);
  const [reportOpen, setReportOpen] = useState(false);
  // Bulk-upload status: 'idle' default, 'uploading' while POSTing, 'done'
  // briefly after to show counts to the user. Auto-clears via setTimeout.
  const [bulkUpload, setBulkUpload] = useState<
    | { kind: 'idle' }
    | { kind: 'uploading'; progress: string }
    | { kind: 'done'; uploaded: number; deduped: number; failed: number }
  >({ kind: 'idle' });
  // Pending consent: when the user clicks Upload logs we count the records
  // first, open the disclosure dialog, and only kick off the actual POST
  // loop after they confirm.
  const [pendingConsent, setPendingConsent] = useState<{ recordCount: number } | null>(null);
  const [devMode, setDevModeState] = useState<boolean>(initialDevMode);
  const setDevMode = (v: boolean) => {
    setDevModeState(v);
    try { localStorage.setItem(DEV_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  };

  // Restore the most-recent saved snapshot once on mount (resume after reload).
  // Saved games are cleared by the "New game" button and when the game ends.
  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    const saved = localStorage.getItem(SAVE_KEY);
    if (saved && G.snapshots.length <= 1 && !G.endGameTriggeredAtTurn) {
      try { moves.loadState(saved); } catch { /* corrupted save — ignore */ }
    }
  }, [G.snapshots.length, G.endGameTriggeredAtTurn, moves]);

  // Persist the latest snapshot codec on every turn boundary. Clear on gameover.
  //
  // CRITICAL: we skip the very first invocation. On mount, both useEffects fire on
  // the same render — the load effect dispatches loadState (async, lands next
  // render), but the save effect would otherwise immediately write the fresh
  // setup codec into localStorage, clobbering the real saved game. By skipping
  // the first save we preserve the existing save until the load completes; the
  // first real write happens once loadState lands and snapshots grows.
  const firstSaveRef = useRef(true);
  useEffect(() => {
    if (firstSaveRef.current) { firstSaveRef.current = false; return; }
    if (ctx.gameover) { localStorage.removeItem(SAVE_KEY); return; }
    if (G.snapshots.length === 0) return;
    const latest = G.snapshots[G.snapshots.length - 1].codec;
    localStorage.setItem(SAVE_KEY, latest);
  }, [G.snapshots.length, ctx.gameover]);

  // Best-effort archive on page unload (tab close, refresh, navigate away).
  // IndexedDB writes are not guaranteed to flush before the page is killed,
  // but in practice browsers give the write a brief window — and since this
  // is purely additive (it can't lose data, only fail to capture some), it's
  // worth attempting. Skip when the game is in setup phase (nothing useful
  // to capture) or has reached gameover (already archived in the gameover
  // effect below).
  useEffect(() => {
    function onUnload() {
      if (!session) return;
      if (G.setupPhase) return;
      if (ctx.gameover) return;
      // Fire-and-forget. We don't await; the browser may kill us mid-write.
      void archiveGame(G, {
        numPlayers: Object.keys(G.players).length,
        halfDecks: session.config.halfDecks,
        aiStyles: session.config.aiStyles,
      });
    }
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [G, ctx.gameover, session]);

  // On game-over: archive the completed game locally (IndexedDB) AND attempt
  // an auto-publish to the public log relay. The archive is the authoritative
  // local copy; auto-publish is best-effort. If it fails (network hiccup, no
  // relay URL configured, etc.), the user can re-submit later via the bulk
  // "Upload logs" button in the header — the relay's SHA256 dedup means
  // duplicate uploads are no-ops server-side, so we can be loose about
  // retries.
  const publishedRef = useRef(false);
  useEffect(() => {
    if (!ctx.gameover) return;
    if (publishedRef.current) return;
    publishedRef.current = true;
    const context = {
      numPlayers: Object.keys(G.players).length,
      halfDecks: session?.config.halfDecks ?? [],
      aiStyles: session?.config.aiStyles ?? [],
    };
    archiveGame(G, context).catch(err => {
      // eslint-disable-next-line no-console
      console.warn('[archive-game] failed:', err);
    });
    publishGameLog(G, { ...context, source: 'browser-game' }).then(r => {
      if (r.ok) {
        // eslint-disable-next-line no-console
        console.info('[publish-game-log]', r.deduped ? 'deduped' : 'published', r.path ?? r.filePath, r.htmlUrl ?? '');
      } else {
        // eslint-disable-next-line no-console
        console.warn('[publish-game-log] failed:', r.error);
      }
    });
  }, [ctx.gameover, G, session]);

  // Dev-only: mirror the live game log to disk via the vite plugin endpoint.
  // Lets the developer (or an assistant) read the current state without manual
  // copy/paste. Writes on every state mutation (including silent INVALID_MOVE
  // failures, which don't grow the log) so a vanished-deploy / failed-action
  // can be diagnosed after the fact.
  useEffect(() => {
    const violations = checkTokenConservation(G);
    if (violations.length > 0) {
      // eslint-disable-next-line no-console
      console.warn('[TOKEN CONSERVATION VIOLATION]', violations);
    }
    const payload = {
      writtenAt: new Date().toISOString(),
      turn: ctx.turn,
      currentPlayer: ctx.currentPlayer,
      gameover: ctx.gameover ?? null,
      tokenConservation: violations.length === 0 ? 'ok' : violations,
      log: G.log,
      turnLogs: G.turnLogs,
      snapshots: G.snapshots,
      pendingChoice: G.pendingChoice,
      pausedHandlerState: G.pausedHandlerState,
      setupPhase: G.setupPhase,
      // Map state — useful for diagnosing "the spy/troop didn't appear" bugs.
      troops: Object.fromEntries(Object.entries(G.troops).filter(([, v]) => v != null)),
      spies: Object.fromEntries(Object.entries(G.spies).filter(([, arr]) => arr.length > 0)),
      siteControl: Object.fromEntries(Object.entries(G.siteControl).filter(([, v]) => v != null)),
      controlMarkers: Object.fromEntries(Object.entries(G.controlMarkers).filter(([, m]) => m.holder != null)),
      players: Object.fromEntries(Object.entries(G.players).map(([pid, p]) => [pid, {
        color: p.color, vp: p.vp, power: p.power, influence: p.influence,
        barracksLeft: p.barracksLeft, handSize: p.hand.length,
        deckSize: p.deck.length, discardSize: p.discard.length,
        innerCircleSize: p.innerCircle.length,
        trophies: p.trophyHall,
        hand: p.hand.map(c => c.name),
      }])),
    };
    fetch('/__save-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => { /* ignore — endpoint only exists in dev */ });
  }, [G.log.length, ctx.turn, ctx.currentPlayer, ctx.gameover, G, G.log, G.turnLogs, G.snapshots, G.pendingChoice, G.players]);
  // P1 is the human; P2/P3/P4 are AI. The UI is always rendered from P1's perspective.
  const me = HUMAN_SEAT;
  const p = G.players[me];
  const myTurn = ctx.currentPlayer === HUMAN_SEAT;
  const isAiTurn = ctx.currentPlayer !== HUMAN_SEAT;
  const aiHasPendingChoice = !!G.pendingChoice && G.pendingChoice.playerId !== HUMAN_SEAT;

  // Per-AI-turn summary modal. The user clicks through each AI's completed turn to
  // see what they did before play continues to the next seat.
  const [shownTurnLogCount, setShownTurnLogCount] = useState(0);
  // Find the next AI-turn log we haven't shown yet. We track the absolute index so
  // OK can jump the counter past it (skipping any interleaved human turns), instead
  // of just incrementing by 1 and forcing the user to click through the gap.
  const pendingAiSummaryIdx = (() => {
    for (let i = shownTurnLogCount; i < G.turnLogs.length; i++) {
      if (G.turnLogs[i].playerId !== HUMAN_SEAT) return i;
    }
    return -1;
  })();
  const pendingAiSummary = pendingAiSummaryIdx >= 0 ? G.turnLogs[pendingAiSummaryIdx] : null;
  const showingModal = !!pendingAiSummary;

  // AI driver: dispatch one random move per state tick whenever it's an AI seat's turn
  // (or an AI has a pending choice). State updates re-run this effect, so the AI keeps
  // playing until control returns to P1. Paused while a turn-summary modal is open so
  // the user has time to read each AI's actions.
  useEffect(() => {
    if (showingModal) return;
    if (!isAiTurn && !aiHasPendingChoice) return;
    const handle = setTimeout(() => {
      const seatIdx = Number(ctx.currentPlayer);
      const style = session?.config.aiStyles[seatIdx - 1] ?? 'random';
      const decide = AI_FNS[style] ?? decideAiMove;
      const decided = decide(G, ctx.currentPlayer);
      if (!decided) return;
      const fn = (moves as Record<string, (...args: unknown[]) => void>)[decided.name];
      if (typeof fn === 'function') fn(...decided.args);
    }, AI_THINK_MS);
    return () => clearTimeout(handle);
  }, [G, ctx.currentPlayer, isAiTurn, aiHasPendingChoice, moves, showingModal, session]);

  // Human-facing pending choices that drive map UI.
  const humanSitePick = G.pendingChoice
    && G.pendingChoice.kind === 'select-site'
    && G.pendingChoice.playerId === HUMAN_SEAT
    ? G.pendingChoice : null;
  const humanSpacePick = G.pendingChoice
    && G.pendingChoice.kind === 'select-troop-space'
    && G.pendingChoice.playerId === HUMAN_SEAT
    ? G.pendingChoice : null;
  const humanMarketPick = G.pendingChoice
    && G.pendingChoice.kind === 'select-market-card'
    && G.pendingChoice.playerId === HUMAN_SEAT
    ? G.pendingChoice : null;
  const humanMapPick = humanSitePick || humanSpacePick;
  const clickableMarketSlots = humanMarketPick
    ? new Set((humanMarketPick.options as number[] | undefined) ?? [])
    : null;

  // Auto-focus the map tab whenever the human needs to click something on the board.
  useEffect(() => {
    if ((G.setupPhase && myTurn) || humanMapPick || baseAction) {
      if (tab !== 'map') setTab('map');
    }
  }, [G.setupPhase, myTurn, humanMapPick, baseAction, tab]);

  // Clear pending base action whenever it's no longer the human's turn or a card prompt fires.
  useEffect(() => {
    if (!myTurn || humanMapPick) setBaseAction(null);
  }, [myTurn, humanMapPick]);

  // Compute base-action eligibility on the fly.
  const baseActionClickableSites: Set<string> | undefined = (() => {
    if (!baseAction) return undefined;
    if (baseAction.kind === 'return-spy') {
      // Sites where you have presence AND an enemy spy is present.
      const out = new Set<string>();
      for (const s of SITES) {
        if (!hasPresence(G, p.color, { site: s.id })) continue;
        const spies = G.spies[s.id] ?? [];
        if (spies.some(c => c !== p.color)) out.add(s.id);
      }
      return out;
    }
    return undefined;
  })();
  const baseActionClickableSpaces: Set<string> | undefined = (() => {
    if (!baseAction || baseAction.kind === 'return-spy') return undefined;
    const out = new Set<string>();
    for (const t of TROOP_SPACES) {
      if (!(t.id in G.troops)) continue; // outside active sections
      const occ = G.troops[t.id];
      if (baseAction.kind === 'deploy') {
        if (occ) continue;
        if (t.parentSite && hasPresence(G, p.color, { site: t.parentSite })) out.add(t.id);
        else if (t.parentRoute && hasPresence(G, p.color, { space: t.id })) out.add(t.id);
      } else if (baseAction.kind === 'assassinate') {
        if (!occ || occ === p.color) continue;
        if (t.parentSite && hasPresence(G, p.color, { site: t.parentSite })) out.add(t.id);
        else if (t.parentRoute && hasPresence(G, p.color, { space: t.id })) out.add(t.id);
      }
    }
    return out;
  })();

  const startingClickable = G.setupPhase && myTurn
    ? new Set(SITES.filter(s => s.isStartingSite && s.id in G.siteControl && sitesSpaces(s.id).every(sp => sp.id in G.troops && !G.troops[sp.id])).map(s => s.id))
    : humanSitePick
      ? new Set((humanSitePick.options as string[] | undefined) ?? SITES.map(s => s.id))
      : baseActionClickableSites;

  const clickableSpaces = humanSpacePick
    ? new Set((humanSpacePick.options as string[] | undefined) ?? [])
    : baseActionClickableSpaces;

  const handleSiteClick = (siteId: string) => {
    if (G.setupPhase && myTurn) { moves.deployStartingTroop(siteId); return; }
    if (humanSitePick) { moves.resolveChoice(siteId); return; }
    if (baseAction?.kind === 'return-spy') {
      // Pick which enemy spy if multiple colors present at this site.
      const enemyColors = (G.spies[siteId] ?? []).filter(c => c !== p.color);
      if (enemyColors.length > 0) {
        // Just take the first for simplicity; could surface a sub-prompt if 2+.
        moves.returnEnemySpy(siteId, enemyColors[0]);
        // Stay in return-spy mode; auto-cancelled by the power-watchdog effect.
      }
    }
  };
  const logClick = (kind: string, target: string, extras?: Record<string, unknown>) => {
    fetch('/__log-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        at: new Date().toISOString(),
        turn: ctx.turn, currentPlayer: ctx.currentPlayer,
        kind, target,
        baseAction: baseAction?.kind ?? null,
        pendingChoice: G.pendingChoice ? { kind: G.pendingChoice.kind, prompt: G.pendingChoice.prompt } : null,
        power: p.power, barracksLeft: p.barracksLeft,
        ...extras,
      }),
    }).catch(() => { /* dev-only endpoint */ });
  };

  const handleSpaceClick = (spaceId: string) => {
    if (humanSpacePick) { logClick('resolveChoice/space', spaceId); moves.resolveChoice(spaceId); return; }
    // Stay in the chosen base-action mode after a successful click so the player can
    // chain deploys / assassinations without re-clicking the button. The mode is
    // auto-cleared by the useEffect below when power drops below the action's cost.
    if (baseAction?.kind === 'deploy') {
      logClick('deployTroop', spaceId, { occupant: G.troops[spaceId] ?? null });
      moves.deployTroop(spaceId);
      return;
    }
    if (baseAction?.kind === 'assassinate') {
      logClick('assassinateTroop', spaceId, { occupant: G.troops[spaceId] ?? null });
      moves.assassinateTroop(spaceId);
      return;
    }
    logClick('space-click-noop', spaceId);
  };

  // Auto-cancel sticky base-action mode when the player can no longer afford it.
  useEffect(() => {
    if (!baseAction) return;
    const cost = baseAction.kind === 'deploy' ? 1 : 3;
    if (p.power < cost) setBaseAction(null);
  }, [baseAction, p.power]);

  // Action bar — base actions + End Turn. Rendered in BOTH the map tab and the
  // game tab so the player can always Cancel sticky modes / switch actions
  // while looking at the map.
  const canDeploy = myTurn && p.power >= 1 && !G.pendingChoice;
  const canAssassinate = myTurn && p.power >= 3 && !G.pendingChoice;
  const canReturnSpy = myTurn && p.power >= 3 && !G.pendingChoice;
  const actionBtn = (label: string, enabled: boolean, active: boolean, onClick: () => void) => (
    <button onClick={onClick} disabled={!enabled}
      style={{
        padding: '6px 12px',
        background: active ? '#ffcc44' : '#2a1840',
        color: active ? '#000' : '#e6e1f2',
        border: '1px solid #3a2055', borderRadius: 4,
        cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.4,
      }}>{label}</button>
  );
  const deployLabel = p.barracksLeft <= 0 ? 'Deploy (1 Power → +1 VP)' : 'Deploy (1 Power)';
  const actionBar = (
    <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
      {actionBtn(deployLabel, canDeploy, baseAction?.kind === 'deploy',
        () => setBaseAction(baseAction?.kind === 'deploy' ? null : { kind: 'deploy' }))}
      {actionBtn('Assassinate (3 Power)', canAssassinate, baseAction?.kind === 'assassinate',
        () => setBaseAction(baseAction?.kind === 'assassinate' ? null : { kind: 'assassinate' }))}
      {actionBtn('Return enemy spy (3 Power)', canReturnSpy, baseAction?.kind === 'return-spy',
        () => setBaseAction(baseAction?.kind === 'return-spy' ? null : { kind: 'return-spy' }))}
      {baseAction && actionBtn('Cancel', true, false, () => setBaseAction(null))}
      <button onClick={() => moves.endTurn()} disabled={!myTurn}
        style={{ padding: '8px 16px', background: '#3a2055', color: 'white', border: 'none', borderRadius: 4, cursor: myTurn ? 'pointer' : 'not-allowed', marginLeft: 'auto' }}>
        End Turn
      </button>
    </div>
  );

  // End-of-game scoreboard.
  if (ctx.gameover) {
    const scores = scoreAll(G);
    const ranked = Object.entries(scores).sort((a, b) => b[1].total - a[1].total);
    const winner = ranked[0];
    return (
      <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ margin: 0 }}>Game Over</h1>
        <div style={{ marginTop: 8, fontSize: 18 }}>
          Winner: <b>P{Number(winner[0]) + 1} ({G.players[winner[0]].color})</b> — {winner[1].total} VP
        </div>
        <table style={{ marginTop: 24, width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #3a2055', textAlign: 'left' }}>
              <th style={{ padding: 4 }}>Player</th>
              <th>Sites</th>
              <th>Total ctrl</th>
              <th>Trophies</th>
              <th>Deck VP</th>
              <th>Inner VP</th>
              <th>VP tokens</th>
              <th>Riders</th>
              <th style={{ textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map(([pid, s]) => {
              const riderText = s.riderBonuses.map(r => `${r.source} +${r.vp}`).join(', ');
              const riderTip = s.riderBonuses.length === 0
                ? 'No end-of-game scoring riders.'
                : s.riderBonuses.map(r => `${r.source}: +${r.vp}`).join('\n');
              const sitesTip = s.sitesDetail.length === 0
                ? 'You control no sites.'
                : s.sitesDetail.map(d => `${d.site}: +${d.vp}`).join('\n') + `\n— total: +${s.sites}`;
              const totalCtrlTip = s.totalControlDetail.length === 0
                ? 'You have total control of no sites.'
                : s.totalControlDetail.map(d => `${d.site}: +2`).join('\n') + `\n— total: +${s.totalControl}`;
              const trophiesTip = Object.entries(s.trophiesDetail)
                .filter(([, n]) => n > 0)
                .map(([c, n]) => `${c}: ${n}`)
                .join('\n') + `\n— total: ${s.trophies}`;
              const deckTip = s.deckVpDetail.length === 0
                ? 'No deck-VP cards.'
                : s.deckVpDetail.map(d => `${d.card} ×${d.count} @ ${d.vpEach}: +${d.vp}`).join('\n') + `\n— total: +${s.deckVp}`;
              const innerTip = s.innerCircleVpDetail.length === 0
                ? 'No Inner Circle cards.'
                : s.innerCircleVpDetail.map(d => `${d.card} ×${d.count} @ ${d.vpEach}: +${d.vp}`).join('\n') + `\n— total: +${s.innerCircleVp}`;
              const tokensTip = `Mid-game VP tokens earned (site control, deploy-on-empty-barracks, card effects): ${s.vpTokens}`;
              const cell = (val: number | string, tip: string) => (
                <td title={tip} style={{ cursor: 'help' }}>{val}</td>
              );
              const COLOR_HEX: Record<string, string> = { black: '#1a1a1a', red: '#c43c3c', orange: '#e08a2e', blue: '#3473b8', white: '#d0d0d0' };
              const trophiesCell = (
                <td title={trophiesTip} style={{ cursor: 'help' }}>
                  <div>{s.trophies}</div>
                  <div style={{ display: 'flex', gap: 2, marginTop: 2, flexWrap: 'wrap' }}>
                    {Object.entries(s.trophiesDetail)
                      .filter(([, n]) => n > 0)
                      .map(([c, n]) => (
                        <span key={c} title={`${c}: ${n}`}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 2,
                            fontSize: 10, padding: '0 4px', borderRadius: 8,
                            background: 'rgba(255,255,255,0.06)',
                          }}>
                          <span style={{
                            width: 8, height: 8, borderRadius: '50%',
                            background: COLOR_HEX[c] ?? '#888',
                            border: c === 'black' ? '1px solid #555' : 'none',
                          }} />
                          {n}
                        </span>
                      ))}
                  </div>
                </td>
              );
              return (
                <tr key={pid} style={{ borderBottom: '1px solid #1a1228' }}>
                  <td style={{ padding: 4 }}>P{Number(pid) + 1} ({G.players[pid].color})</td>
                  {cell(s.sites, sitesTip)}
                  {cell(s.totalControl, totalCtrlTip)}
                  {trophiesCell}
                  {cell(s.deckVp, deckTip)}
                  {cell(s.innerCircleVp, innerTip)}
                  {cell(s.vpTokens, tokensTip)}
                  <td title={riderTip} style={{ maxWidth: 200, fontSize: 11, opacity: 0.8, cursor: 'help' }}>{riderText || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{s.total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ marginTop: 16, opacity: 0.6, fontSize: 12 }}>
          Reload the page to start a fresh game.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, maxWidth: 1280, margin: '0 auto' }}>
      {pendingAiSummary && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: '#1a1228', color: '#e6e1f2',
            border: '2px solid #3a2055', borderRadius: 6,
            padding: 24, maxWidth: 560, minWidth: 320,
            boxShadow: '0 4px 20px rgba(0,0,0,0.8)',
          }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>
              P{Number(pendingAiSummary.playerId) + 1} ({pendingAiSummary.color}) — turn {pendingAiSummary.turn}
            </h2>
            <div style={{ marginTop: 12, maxHeight: '50vh', overflowY: 'auto', fontSize: 13 }}>
              {pendingAiSummary.lines.length === 0
                ? <div style={{ opacity: 0.6 }}>(no actions)</div>
                : pendingAiSummary.lines.map((l, i) => (
                  <div key={i} style={{ padding: '2px 0', borderBottom: '1px solid #2a1840' }}>{l}</div>
                ))}
            </div>
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button onClick={() => setShownTurnLogCount(pendingAiSummaryIdx + 1)}
                style={{ padding: '6px 16px', background: '#5a3380', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ margin: 0, flex: 1 }}>Tyrants of the Underdark</h1>
        <button onClick={() => {
          const cur = isNoImagesMode();
          localStorage.setItem(NO_IMAGES_KEY, cur ? '0' : '1');
          window.location.reload();
        }}
          title="Toggle no-images mode (uses text-only placeholder cards). Persists across reloads."
          style={{ padding: '6px 14px', background: isNoImagesMode() ? '#5a3380' : 'transparent', color: '#e6e1f2', border: '1px solid #3a2055', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
          {isNoImagesMode() ? '🖼 images off' : '🖼 images on'}
        </button>
        <button onClick={async () => {
          // Click 1: count records and open the disclosure dialog. Actual
          // upload only fires after the user confirms in the dialog (see
          // onConfirm below). The relay dedups by content, so the user can
          // re-click later without producing duplicate commits server-side.
          if (bulkUpload.kind === 'uploading') return;
          const archived = await getAllArchivedGames().catch(() => []);
          setPendingConsent({ recordCount: archived.length + 1 });
        }}
          disabled={bulkUpload.kind === 'uploading'}
          title="Upload every completed game stored locally plus the current in-progress game to the public log relay. Already-uploaded records dedup server-side."
          style={{
            padding: '6px 14px',
            background: bulkUpload.kind === 'done' && bulkUpload.failed === 0 ? '#2a4830'
              : bulkUpload.kind === 'done' ? '#5a3030'
              : '#3a2055',
            color: '#e6e1f2', border: '1px solid #5a3380', borderRadius: 4,
            cursor: bulkUpload.kind === 'uploading' ? 'default' : 'pointer',
            opacity: bulkUpload.kind === 'uploading' ? 0.8 : 1,
          }}>
          {bulkUpload.kind === 'uploading' ? `Uploading ${bulkUpload.progress}…`
            : bulkUpload.kind === 'done'
              ? (bulkUpload.failed > 0
                  ? `${bulkUpload.failed} failed · ${bulkUpload.uploaded + bulkUpload.deduped} ok`
                  : `${bulkUpload.uploaded} new · ${bulkUpload.deduped} deduped`)
              : 'Upload logs'}
        </button>
        <button onClick={() => setReportOpen(true)}
          style={{ padding: '6px 14px', background: '#3a2055', color: '#e6e1f2', border: '1px solid #5a3380', borderRadius: 4, cursor: 'pointer' }}>
          Report a problem
        </button>
        <button onClick={async () => {
          if (!confirm('Start a new game? Current progress will be lost.')) return;
          // Archive the current playthrough before discarding it, so it
          // doesn't get lost between sessions. The bulk Upload-logs button
          // picks it up on the next click.
          if (session) {
            try {
              await archiveGame(G, {
                numPlayers: Object.keys(G.players).length,
                halfDecks: session.config.halfDecks,
                aiStyles: session.config.aiStyles,
              });
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn('[archive-game] new-game archive failed:', err);
            }
          }
          session?.onNewGame();
        }} style={{ padding: '6px 14px', background: '#5a1f1f', color: '#fdd', border: '1px solid #802626', borderRadius: 4, cursor: 'pointer' }}>
          New game
        </button>
      </div>
      <LogUploadConsentDialog
        open={pendingConsent !== null}
        recordCount={pendingConsent?.recordCount ?? 0}
        onCancel={() => setPendingConsent(null)}
        onConfirm={async () => {
          setPendingConsent(null);
          if (bulkUpload.kind === 'uploading') return;
          const archived = await getAllArchivedGames().catch(() => []);
          const total = archived.length + 1;
          let done = 0, uploaded = 0, deduped = 0, failed = 0;
          setBulkUpload({ kind: 'uploading', progress: `0 / ${total}` });
          const relayUrl = (import.meta.env.VITE_TOTU_RELAY_URL as string | undefined);
          const submitUrl = relayUrl ? `${relayUrl.replace(/\/$/, '')}/game-log` : '/__publish-game-log';
          for (const a of archived) {
            const body = payloadForArchivedGame(a);
            const resp = await fetch(submitUrl, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }).then(r => r.json().catch(() => ({ ok: false }))).catch(() => ({ ok: false }));
            if (resp.ok) { (resp.deduped ? deduped++ : uploaded++); } else { failed++; }
            done++;
            setBulkUpload({ kind: 'uploading', progress: `${done} / ${total}` });
          }
          const r = await publishGameLog(G, {
            numPlayers: Object.keys(G.players).length,
            halfDecks: session?.config.halfDecks ?? [],
            aiStyles: session?.config.aiStyles ?? [],
            source: 'browser-bulk-upload',
          });
          if (r.ok) { (r.deduped ? deduped++ : uploaded++); } else { failed++; }
          setBulkUpload({ kind: 'done', uploaded, deduped, failed });
          setTimeout(() => setBulkUpload({ kind: 'idle' }), 6000);
        }}
      />
      {reportOpen && (
        <ProblemReportDialog
          G={G}
          ctxInfo={{ turn: ctx.turn, currentPlayer: ctx.currentPlayer, gameover: ctx.gameover }}
          config={session?.config ? {
            numPlayers: session.config.numPlayers,
            halfDecks: session.config.halfDecks,
            aiStyles: session.config.aiStyles,
          } : undefined}
          onClose={() => setReportOpen(false)}
        />
      )}
      <div style={{ marginTop: 8, opacity: 0.7 }}>
        Player P{Number(me) + 1} ({p.color}) — Turn: P{Number(ctx.currentPlayer) + 1} {myTurn ? '(your turn)' : ''}
        {' · '}Power: {p.power} · Influence: {p.influence} · Deck: {p.deck.length} · Discard: {p.discard.length} · Barracks: {p.barracksLeft}
        {' · '}<b style={{ color: '#ffcc44' }}>VP: {p.vp}</b>
        {G.endGameTriggeredAtTurn !== null && <span style={{ color: '#ffcc44', marginLeft: 8 }}>· Final round!</span>}
      </div>
      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.6 }}>
        Scoreboard: {Object.entries(G.players).map(([pid, pl]) => (
          <span key={pid} style={{ marginRight: 12 }}>
            P{Number(pid) + 1} ({pl.color}): {pl.vp} VP tokens
            {' · '}{Object.values(G.controlMarkers).filter(m => m.holder === pl.color).length} markers
            {' · '}{Object.values(pl.trophyHall).reduce((s, n) => s + n, 0)} trophies
          </span>
        ))}
      </div>

      {G.setupPhase && (
        <div style={{ marginTop: 12, padding: 12, background: '#3a2055', borderRadius: 4 }}>
          <div style={{ fontWeight: 'bold' }}>
            Setup — P{Number(ctx.currentPlayer) + 1} ({G.players[ctx.currentPlayer].color}) to deploy
            {isAiTurn ? ' (AI thinking…)' : ''}
          </div>
          <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
            {myTurn ? 'Click any glowing starting site on the map.' : 'Waiting on AI.'}
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
        {(devMode
          ? ['game', 'map', 'calibrate', 'routes', 'cards', 'costs', 'text', 'sites', 'whites', 'slots', 'dividers', 'markers', 'log'] as const
          : ['game', 'map', 'log'] as const
        ).map(t => (
          <button key={t} onClick={() => {
            // Manual tab change implicitly cancels any sticky base action — the
            // user is leaving the map context, so they don't want the deploy /
            // assassinate / return-spy mode to follow them around.
            if (baseAction) setBaseAction(null);
            setTab(t);
          }}
            style={{ padding: '4px 12px', background: tab === t ? '#3a2055' : 'transparent', color: '#e6e1f2', border: '1px solid #3a2055', borderRadius: 4, cursor: 'pointer' }}>
            {t}
          </button>
        ))}
        {devMode && (
          <button onClick={() => { setDevMode(false); if (tab !== 'game' && tab !== 'map' && tab !== 'log') setTab('game'); }}
            title="Hide development tabs (calibrate, routes, cards, costs, text, sites, edges, slots). Re-enable with ?dev=1 in the URL."
            style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11, background: 'transparent', color: '#888', border: '1px solid #444', borderRadius: 3, cursor: 'pointer' }}>
            hide dev tabs
          </button>
        )}
      </div>

      {tab === 'map' && (
        <div style={{ marginTop: 16 }}>
          {humanMapPick && (
            <div style={{ marginBottom: 8, padding: 8, background: '#3a2055', borderRadius: 4 }}>
              <b>{humanMapPick.prompt}</b>
              {humanMapPick.optional && (
                <button onClick={() => moves.resolveChoice(null)} style={{ marginLeft: 12, padding: '2px 8px', fontSize: 12 }}>
                  Decline
                </button>
              )}
            </div>
          )}
          <MapView G={G}
            clickableSites={startingClickable} onSiteClick={handleSiteClick}
            clickableSpaces={clickableSpaces} onSpaceClick={handleSpaceClick} />
          {/* Action bar mirrored here so the user can Cancel sticky base-actions
              and reach Assassinate / Return Spy / End Turn while in map mode. */}
          {actionBar}
        </div>
      )}
      {tab === 'calibrate' && <div style={{ marginTop: 16 }}><MapView calibrate /></div>}
      {tab === 'routes' && <div style={{ marginTop: 16 }}><MapView editRoutes /></div>}
      {tab === 'cards' && <div style={{ marginTop: 16 }}><CardCalibration /></div>}
      {tab === 'costs' && <div style={{ marginTop: 16 }}><CostVerify /></div>}
      {tab === 'text' && <div style={{ marginTop: 16 }}><CardTextVerify /></div>}
      {tab === 'sites' && <div style={{ marginTop: 16 }}><SiteVerify /></div>}
      {tab === 'whites' && <div style={{ marginTop: 16 }}><RouteVerify /></div>}
      {tab === 'slots' && <div style={{ marginTop: 16 }}><SlotCalibration /></div>}
      {tab === 'dividers' && <div style={{ marginTop: 16 }}><SectionDividerCalibration /></div>}
      {tab === 'markers' && <div style={{ marginTop: 16 }}><MarkerCalibration /></div>}
      {tab === 'log' && <div style={{ marginTop: 16 }}><GameLog G={G} onLoad={(codec) => moves.loadState(codec)} /></div>}

      {tab === 'game' && <>
        {G.pendingChoice && (
          <div style={{ marginTop: 16, padding: 12, background: '#3a2055', borderRadius: 4 }}>
            <div style={{ fontWeight: 'bold' }}>{G.pendingChoice.prompt}</div>
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
              For P{Number(G.pendingChoice.playerId) + 1}.
              {G.pendingChoice.kind === 'select-card-in-hand' && ' Click a card in hand to discard it.'}
              {G.pendingChoice.kind === 'select-site' && ' Click a glowing site on the map.'}
              {G.pendingChoice.kind === 'select-troop-space' && ' Click a glowing troop space on the map.'}
            </div>
            {G.pendingChoice.kind === 'choose-one' && G.pendingChoice.playerId === ctx.currentPlayer && (
              <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {((G.pendingChoice.options as string[] | undefined) ?? []).map((label, i) => (
                  <button key={i} onClick={() => moves.resolveChoice(i)} style={{ padding: '6px 12px', background: '#5a3380', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            {G.pendingChoice.kind === 'select-player' && G.pendingChoice.playerId === ctx.currentPlayer && (
              <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {((G.pendingChoice.options as string[] | undefined) ?? []).map(pid => (
                  <button key={pid} onClick={() => moves.resolveChoice(pid)}
                    style={{ padding: '6px 12px', background: '#5a3380', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                    P{Number(pid) + 1} ({G.players[pid].color})
                  </button>
                ))}
              </div>
            )}
            {G.pendingChoice.optional && (
              <button onClick={() => moves.resolveChoice(null)} style={{ marginTop: 8, padding: '4px 12px' }}>
                Decline
              </button>
            )}
          </div>
        )}

        <h2 style={{ marginTop: 24 }}>
          Market <span style={{ fontSize: 13, opacity: 0.7, fontWeight: 'normal' }}>· {G.market.deck.length} cards left in deck</span>
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
          {G.market.row.map((c, i) => {
            if (!c) return <div key={i} style={{ width: 120, height: 168, margin: 4, border: '1px dashed #444', borderRadius: 8 }} />;
            const inPickMode = !!clickableMarketSlots;
            const slotPickable = inPickMode && clickableMarketSlots!.has(i);
            const cost = lookupCard(c.deck, c.slot)?.cost ?? '?';
            const label = inPickMode
              ? (slotPickable ? 'pick' : '—')
              : `recruit (${cost} Inf)`;
            const onClick = inPickMode
              ? (slotPickable ? () => moves.resolveChoice(i) : undefined)
              : (myTurn ? () => moves.recruitFromMarket(i) : undefined);
            return <Card key={i} card={c} label={label} onClick={onClick} />;
          })}
        </div>

        {G.pendingChoice?.kind === 'select-card-in-discard' && G.pendingChoice.playerId === ctx.currentPlayer && (
          <>
            <h2 style={{ marginTop: 24 }}>Discard — pick one</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
              {p.discard.map((c, i) => (
                <Card key={i} card={c} label="pick" onClick={() => moves.resolveChoice(i)} />
              ))}
            </div>
          </>
        )}

        {G.pendingChoice?.kind === 'select-card-in-inner-circle' && G.pendingChoice.playerId === ctx.currentPlayer && (
          <>
            <h2 style={{ marginTop: 24 }}>Inner Circle — pick one to devour</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
              {p.innerCircle.map((c, i) => (
                <Card key={i} card={c} label="devour" onClick={() => moves.resolveChoice(i)} />
              ))}
            </div>
          </>
        )}

        {G.pendingChoice?.kind === 'select-played-card' && G.pendingChoice.playerId === ctx.currentPlayer && (
          <>
            <h2 style={{ marginTop: 24 }}>Played this turn — pick one to promote</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
              {G.cardsPlayedThisTurn.map((c, i) => (
                <Card key={i} card={c} label="promote" onClick={() => moves.resolveChoice(i)} />
              ))}
            </div>
          </>
        )}

        <h2 style={{ marginTop: 24 }}>Your Hand</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
          {p.hand.map((c, i) => {
            const isChoosing = G.pendingChoice?.kind === 'select-card-in-hand' && G.pendingChoice.playerId === ctx.currentPlayer;
            // If options provided, only those indices are pickable (e.g. Focus reveal filtered to one aspect).
            const opts = isChoosing ? (G.pendingChoice!.options as number[] | undefined) : undefined;
            const eligible = !isChoosing || !opts || opts.includes(i);
            const onClick = isChoosing
              ? (eligible ? () => moves.resolveChoice(i) : undefined)
              : (myTurn && !G.pendingChoice ? () => moves.playCard(i) : undefined);
            const label = isChoosing ? (eligible ? 'pick' : '—') : 'play';
            return <Card key={i} card={c} label={label} onClick={onClick} />;
          })}
        </div>

        {actionBar}

        <details style={{ marginTop: 24 }}>
          <summary style={{ cursor: 'pointer', opacity: 0.7 }}>Log ({G.log.length})</summary>
          <pre style={{ fontSize: 12, opacity: 0.7 }}>{G.log.slice(-20).reverse().join('\n')}</pre>
        </details>
      </>}
    </div>
  );
}

function NewGameDialog({ onStart, hasSave, onResume, lastConfig }: {
  onStart: (cfg: GameConfig) => void;
  hasSave: boolean;
  onResume: () => void;
  lastConfig: GameConfig | null;
}) {
  // Defaults seeded from the most recent stored config so reopening the dialog
  // remembers the prior numPlayers / AI styles / half-deck pick.
  const [numPlayers, setNumPlayers] = useState(lastConfig?.numPlayers ?? 4);
  const [styles, setStyles] = useState<AiStyle[]>(
    lastConfig?.aiStyles?.length ? lastConfig.aiStyles : ['heuristic', 'heuristic', 'heuristic']
  );
  const [halfDecks, setHalfDecks] = useState<HalfDeck[]>(
    lastConfig?.halfDecks?.length === 2 ? lastConfig.halfDecks : ['drow', 'dragons']
  );
  const [thirdSide, setThirdSide] = useState<ThirdPlayerSide>(
    lastConfig?.thirdPlayerSide ?? 'left'
  );

  function setStyle(i: number, s: AiStyle) {
    setStyles(prev => {
      const next = prev.slice();
      next[i] = s;
      return next;
    });
  }

  function toggleDeck(d: HalfDeck) {
    setHalfDecks(prev => {
      if (prev.includes(d)) return prev.filter(x => x !== d);
      if (prev.length >= 2) return [prev[1], d]; // bump oldest, keep last 2
      return [...prev, d];
    });
  }

  function randomizeDecks() {
    const pool = [...HALF_DECKS].sort(() => Math.random() - 0.5);
    setHalfDecks([pool[0], pool[1]]);
  }

  const opponentCount = numPlayers - 1;
  const trimmedStyles = styles.slice(0, opponentCount);
  while (trimmedStyles.length < opponentCount) trimmedStyles.push('heuristic');

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#1a1228', color: '#e6e1f2', border: '2px solid #3a2055', borderRadius: 8, padding: 32, minWidth: 420, maxWidth: 560 }}>
        <h1 style={{ marginTop: 0 }}>Tyrants of the Underdark</h1>
        {hasSave && (
          <div style={{ marginBottom: 24, padding: 12, background: '#2a1840', borderRadius: 4 }}>
            <div style={{ marginBottom: 8 }}>A game in progress was found.</div>
            <button onClick={onResume} style={{ padding: '8px 16px', background: '#5a3380', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
              Resume saved game
            </button>
          </div>
        )}
        <h3>New game</h3>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, opacity: 0.85 }}>Number of players</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {[2, 3, 4].map(n => (
              <button key={n} onClick={() => setNumPlayers(n)}
                style={{
                  padding: '6px 16px', cursor: 'pointer', borderRadius: 4,
                  background: numPlayers === n ? '#5a3380' : '#2a1840',
                  color: '#e6e1f2', border: '1px solid #3a2055',
                }}>{n}</button>
            ))}
          </div>
          <div style={{ marginTop: 6, fontSize: 11, opacity: 0.65 }}>
            {numPlayers === 2 && 'Center section only.'}
            {numPlayers === 3 && 'Center + one outer section.'}
            {numPlayers === 4 && 'All three sections.'}
          </div>
        </div>
        {numPlayers === 3 && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 4, opacity: 0.85 }}>Which outer section?</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['left', 'right'] as ThirdPlayerSide[]).map(side => (
                <button key={side} onClick={() => setThirdSide(side)}
                  style={{
                    padding: '6px 16px', cursor: 'pointer', borderRadius: 4,
                    background: thirdSide === side ? '#5a3380' : '#2a1840',
                    color: '#e6e1f2', border: '1px solid #3a2055',
                  }}>{side}</button>
              ))}
            </div>
          </div>
        )}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', marginBottom: 4, opacity: 0.85 }}>Opponents (P1 is you)</label>
          {Array.from({ length: opponentCount }, (_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ width: 32, opacity: 0.7 }}>P{i + 2}</span>
              {(['random', 'heuristic'] as AiStyle[]).map(s => (
                <button key={s} onClick={() => setStyle(i, s)}
                  style={{
                    padding: '4px 12px', cursor: 'pointer', borderRadius: 4, fontSize: 12,
                    background: trimmedStyles[i] === s ? '#5a3380' : '#2a1840',
                    color: '#e6e1f2', border: '1px solid #3a2055',
                  }}>{s}</button>
              ))}
            </div>
          ))}
        </div>
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', marginBottom: 4, opacity: 0.85 }}>
            Market half-decks (pick 2) <span style={{ opacity: 0.5, fontSize: 11 }}>· {halfDecks.length}/2 selected</span>
          </label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            {HALF_DECKS.map(d => {
              const on = halfDecks.includes(d);
              const idx = halfDecks.indexOf(d);
              return (
                <button key={d} onClick={() => toggleDeck(d)}
                  style={{
                    padding: '6px 12px', cursor: 'pointer', borderRadius: 4,
                    background: on ? '#5a3380' : '#2a1840',
                    color: '#e6e1f2', border: '1px solid #3a2055',
                    fontSize: 12, position: 'relative',
                  }}>
                  {d}{on && <span style={{ marginLeft: 6, opacity: 0.7 }}>#{idx + 1}</span>}
                </button>
              );
            })}
          </div>
          <button onClick={randomizeDecks}
            style={{ padding: '4px 12px', fontSize: 12, background: '#2a1840', color: '#e6e1f2', border: '1px solid #3a2055', borderRadius: 4, cursor: 'pointer' }}>
            Random 2
          </button>
        </div>
        <button
          disabled={halfDecks.length !== 2}
          onClick={() => onStart({ numPlayers, aiStyles: trimmedStyles, halfDecks, thirdPlayerSide: thirdSide })}
          style={{
            padding: '10px 24px', fontSize: 14, color: '#fff', border: 'none',
            borderRadius: 4,
            background: halfDecks.length === 2 ? '#5a3380' : '#3a3a3a',
            cursor: halfDecks.length === 2 ? 'pointer' : 'not-allowed',
            opacity: halfDecks.length === 2 ? 1 : 0.5,
          }}>
          Start game
        </button>
      </div>
    </div>
  );
}

function ClientHolder({ config, onNewGame }: { config: GameConfig; onNewGame: () => void }) {
  // Memoize the Client so it isn't re-created on every render — that would discard
  // game state. Re-create only when numPlayers changes.
  // Wrap the game definition so the setup closure carries the chosen half-decks
  // (boardgame.io's React Client doesn't expose setupData directly, so we bind
  // it via a fresh setup function per config). Re-create the Client whenever
  // numPlayers or halfDecks change.
  const ClientCmp = useMemo(() => {
    const origSetup = TyrantsGame.setup!;
    const game = {
      ...TyrantsGame,
      setup: (args: Parameters<typeof origSetup>[0]) =>
        origSetup(args, {
          halfDecks: config.halfDecks,
          activeSections: activeSectionsFor(config),
        }),
    };
    return Client({ game, board: Board, numPlayers: config.numPlayers, debug: false });
  }, [config.numPlayers, config.halfDecks]);
  return (
    <SessionContext.Provider value={{ config, onNewGame }}>
      <ClientCmp />
    </SessionContext.Provider>
  );
}

function loadConfig(): GameConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as Partial<GameConfig>;
    if (cfg && typeof cfg.numPlayers === 'number' && Array.isArray(cfg.aiStyles)) {
      const halfDecks = (Array.isArray(cfg.halfDecks) && cfg.halfDecks.length === 2
        ? cfg.halfDecks
        : ['drow', 'dragons']) as HalfDeck[];
      return { numPlayers: cfg.numPlayers, aiStyles: cfg.aiStyles, halfDecks };
    }
  } catch { /* fall through */ }
  return null;
}

/** When a saved game exists but no stored config (e.g. save from before the
 *  New-Game-Dialog refactor), reconstruct a usable config by decoding the codec
 *  to count players. AI styles default to all-heuristic — user can still hit
 *  "New game" if they want to reconfigure. */
function configFromSave(codec: string): GameConfig | null {
  try {
    const json = decodeURIComponent(escape(atob(codec.trim())));
    const parsed = JSON.parse(json) as { players?: Record<string, unknown> };
    if (!parsed.players) return null;
    const numPlayers = Object.keys(parsed.players).length;
    if (numPlayers < 2 || numPlayers > 4) return null;
    const aiStyles: AiStyle[] = Array.from({ length: numPlayers - 1 }, () => 'heuristic');
    return { numPlayers, aiStyles, halfDecks: ['drow', 'dragons'] };
  } catch { return null; }
}

export function App() {
  // First-run gate: if a remote image source is configured and we haven't
  // imported yet, the bulk-import dialog renders on top and the rest of the
  // app waits behind it. Skipped entirely when no-images mode is on (the
  // placeholder card renders without needing any fetched art).
  const [imagesReady, setImagesReady] = useState<boolean>(() => {
    if (isNoImagesMode()) return true;
    return typeof localStorage !== 'undefined' && localStorage.getItem('totu.image-cache-ready') === '1';
  });

  // Hot-seat mode: single tab, no playerID gating. P1 is the human; P2..PN are AI.
  // Mounting flow: if we have a saved game AND its config, jump straight back into
  // the Client (Board's useEffect will restore the codec). Otherwise show the
  // new-game dialog.
  const [config, setConfig] = useState<GameConfig | null>(() => {
    const save = localStorage.getItem(SAVE_KEY);
    if (!save) return null;
    // Prefer the explicit stored config; if absent (e.g. legacy save), derive
    // numPlayers from the codec and assume heuristic opponents.
    const cfg = loadConfig() ?? configFromSave(save);
    return cfg ?? null;
  });
  const [savedConfig] = useState<GameConfig | null>(() => {
    const save = localStorage.getItem(SAVE_KEY);
    return loadConfig() ?? (save ? configFromSave(save) : null);
  });

  function startNew(cfg: GameConfig) {
    localStorage.removeItem(SAVE_KEY);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    setConfig(cfg);
  }

  function newGameFromSession() {
    localStorage.removeItem(SAVE_KEY);
    setConfig(null);
  }

  function resumeSaved() {
    if (savedConfig) setConfig(savedConfig);
  }

  return (
    <>
      {!imagesReady && <FirstRunImageImport onClose={() => setImagesReady(true)} />}
      {(() => {
        if (!config) {
          const hasSave = !!localStorage.getItem(SAVE_KEY) && !!savedConfig;
          return <NewGameDialog onStart={startNew} hasSave={hasSave} onResume={resumeSaved} lastConfig={savedConfig} />;
        }
        return <ClientHolder config={config} onNewGame={newGameFromSession} />;
      })()}
    </>
  );
}

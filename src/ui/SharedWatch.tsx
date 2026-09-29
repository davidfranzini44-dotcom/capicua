// A shared match (…/?ver=<token>): anyone with the link watches the board live — no
// friendship, no sign-up (a guest session is made quietly when there's none). Two ways to
// see it: the normal spectator table, and (&modo=transmision) a clean 9:16 screen for a
// second phone that TikTok LIVE screen-shares. Nobody's fichas ever reach this screen.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChatCircleDotsIcon } from '@phosphor-icons/react';
import type { Seat } from '../../supabase/functions/_shared/domino.ts';
import type { PublicState } from '../../supabase/functions/_shared/table.ts';
import { useI18n } from '../i18n';
import { leaveShared, redeemShare, ShareError, type LinkWatchers, type ShareTarget } from '../lib/shareMatch';
import { openSponsor, useSponsor, type TableSponsor } from '../lib/sponsor';
import { supabase } from '../lib/supabase';
import { useRoom } from '../lib/useRoom';
import { allWatchers, useSpectatorChat } from '../lib/watch';
import { SpectatorsSheet, useSpectatorToast, useUnread } from './Spectators';
import { TableView, type ChatBubbles } from './TableView';
import './share.css';

/** Set while the guest session this screen made is in use, so leaving can sign it out again. */
const MADE_SESSION = 'capicua.watchSession';

type Problem = 'invalid' | 'gone' | 'session' | 'offline' | 'server' | 'notStarted';

export default function SharedWatch({ target, onExit }: { target: ShareTarget | 'malformed'; onExit: () => void }) {
  const [phase, setPhase] = useState<{ k: 'opening' } | { k: 'problem'; p: Problem } | { k: 'player' } | { k: 'ready'; uid: string; roomId: string }>(
    () => (target === 'malformed' ? { k: 'problem', p: 'invalid' } : { k: 'opening' }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (target === 'malformed') return;
    let live = true;
    (async () => {
      let session = (await supabase.auth.getSession()).data.session;
      if (!session) {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error || !data.session) {
          if (live) setPhase({ k: 'problem', p: navigator.onLine === false ? 'offline' : 'session' });
          return;
        }
        session = data.session;
        try { sessionStorage.setItem(MADE_SESSION, '1'); } catch { /* private mode */ }
      }
      try {
        const r = await redeemShare(target.token);
        if (live) setPhase(r.player ? { k: 'player' } : { k: 'ready', uid: session.user.id, roomId: r.roomId });
      } catch (e) {
        const code = e instanceof ShareError ? e.code : 'server_error';
        if (live) setPhase({ k: 'problem', p: code === 'link_invalid' ? 'invalid' : code === 'link_gone' ? 'gone' : code === 'offline' ? 'offline' : 'server' });
      }
    })();
    return () => { live = false; };
  }, [target, attempt]);

  /** Leave: stop counting as a viewer, and drop the guest session if this screen made it. */
  const exit = useCallback(async (roomId?: string) => {
    if (roomId) await leaveShared(roomId);
    let made = false;
    try { made = sessionStorage.getItem(MADE_SESSION) === '1'; sessionStorage.removeItem(MADE_SESSION); } catch { /* private mode */ }
    if (made) await supabase.auth.signOut().catch(() => {});
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    onExit();
  }, [onExit]);

  if (phase.k === 'opening') return <ShareMessage busy />;
  if (phase.k === 'problem') return <ShareProblem p={phase.p} onRetry={() => { setPhase({ k: 'opening' }); setAttempt((a) => a + 1); }} onHome={() => exit()} />;
  if (phase.k === 'player') return <PlayerHere onGo={() => exit()} />;
  const broadcast = target !== 'malformed' && target.broadcast;
  return broadcast
    ? <BroadcastScreen roomId={phase.roomId} uid={phase.uid} onLeave={() => exit(phase.roomId)} />
    : <SharedTable roomId={phase.roomId} uid={phase.uid} onLeave={() => exit(phase.roomId)} />;
}

// ---------- states ----------

export function ShareMessage({ title, sub, busy, children }: { title?: string; sub?: string; busy?: boolean; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <main className="screen center share-message" aria-busy={busy}>
      <h1 className="logo small">Capicúa</h1>
      {busy ? <p role="status">{t.share.opening}</p> : <>
        <h2>{title}</h2>
        {sub && <p className="fine">{sub}</p>}
      </>}
      {children}
    </main>
  );
}

export function ShareProblem({ p, onRetry, onHome }: { p: Problem; onRetry?: () => void; onHome: () => void }) {
  const { t } = useI18n();
  const words: Record<Problem, [string, string]> = {
    invalid: [t.share.invalid, t.share.invalidSub],
    gone: [t.share.gone, t.share.goneSub],
    notStarted: [t.share.notStarted, t.share.notStartedSub],
    session: [t.share.sessionFailed, t.share.sessionFailedSub],
    offline: [t.share.sessionFailed, t.share.errors.offline],
    server: [t.share.sessionFailed, t.share.sessionFailedSub],
  };
  const retry = p === 'session' || p === 'offline' || p === 'server' || p === 'notStarted';
  return (
    <ShareMessage title={words[p][0]} sub={words[p][1]}>
      <div className="share-message-actions">
        {retry && onRetry && <button className="btn primary" onClick={onRetry}>{t.share.retry}</button>}
        <button className={`btn ${retry ? 'ghost' : 'primary'}`} onClick={onHome}>{t.share.goHome}</button>
      </div>
    </ShareMessage>
  );
}

function PlayerHere({ onGo }: { onGo: () => void }) {
  const { t } = useI18n();
  return <ShareMessage title={t.share.youPlay}><button className="btn primary" onClick={onGo}>{t.share.goToTable}</button></ShareMessage>;
}

// ---------- the live table as a link viewer sees it ----------

/** What both ways of watching draw: the public game from the sharer's seat. */
export interface SharedBoard {
  view: PublicState;
  focus: Seat;
  names: string[];
  levels: (number | null)[];
  avatars: (string | null)[];
  away: Set<Seat>;
  sponsor: TableSponsor | null;
  turnDeadline: number | null;
  chat: ChatBubbles;
  pot?: number;
}

/** The shared room, live (useRoom's link-viewer mode), turned into what the table draws. */
function useSharedBoard(roomId: string, uid: string) {
  const r = useRoom(roomId, uid, { shared: true });
  const info = r.sharedInfo;
  const sponsor = useSponsor(r.game?.sponsor_id);
  const game = r.game;
  let board: SharedBoard | null = null;
  if (game && info) {
    const view = game.public_state;
    const seatRow = (s: number) => r.seats.find((x) => x.seat === s);
    const turnSeat = seatRow(view.turn);
    board = {
      view,
      focus: info.focus_seat,
      names: [0, 1, 2, 3].map((s) => seatRow(s)?.name ?? ''),
      levels: [0, 1, 2, 3].map((s) => seatRow(s)?.level ?? null),
      avatars: [0, 1, 2, 3].map((s) => info.players.find((p) => p.seat === s)?.avatar_url ?? null),
      away: new Set(r.seats.filter((s) => s.away).map((s) => s.seat)),
      sponsor,
      turnDeadline: turnSeat && !turnSeat.is_bot && !turnSeat.away && game.auto_delay_ms === game.turn_ms ? r.receivedAt + game.turn_ms : null,
      chat: r.chat,
      pot: game.pot || undefined,
    };
  }
  return { r, info, board, gameId: game?.id ?? null };
}

/** "m:ss" until a moment, ticking. */
function useCountdown(until: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  if (until === null) return null;
  const s = Math.max(0, Math.ceil((until - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function SharedTable({ roomId, uid, onLeave }: { roomId: string; uid: string; onLeave: () => void }) {
  const { t } = useI18n();
  const { r, info, board, gameId } = useSharedBoard(roomId, uid);
  const specChat = useSpectatorChat(roomId);
  const [specOpen, setSpecOpen] = useState(false);
  const specToast = useSpectatorToast(specChat.messages, uid, true);
  const specUnread = useUnread(specChat.messages, uid, specOpen);
  // Writing to the table takes a name; a guest session made just to watch reads along.
  const [canWrite, setCanWrite] = useState(false);
  useEffect(() => {
    supabase.from('profiles').select('needs_name').eq('id', uid).maybeSingle()
      .then(({ data }) => setCanWrite(data?.needs_name === false), () => {});
  }, [uid]);

  if (r.gone) return <ShareProblem p="gone" onHome={onLeave} />;
  if (info && info.room.phase === 'lobby') return <ShareProblem p="notStarted" onRetry={() => r.reload()} onHome={onLeave} />;
  if (!board || !info) return <ShareMessage busy />;
  const watchers = allWatchers([], info.watchers ?? { count: 0, names: [] }, (n) => t.share.byLink.replace('{n}', String(n)));
  return (
    <>
      <SharedTableView board={board} status={r.status === 'live' ? 'live' : 'reconnecting'} endsAt={Date.parse(info.ends_at)}
        watchers={watchers.list.map((w) => w.name)} watcherCount={watchers.count} unread={specUnread} notice={specToast}
        onWatchersTap={() => setSpecOpen(true)} onLeave={onLeave} onMessage={() => setSpecOpen(true)}
        onSponsorTap={board.sponsor ? () => openSponsor(board.sponsor!, gameId ?? undefined) : undefined} />
      {specOpen && (
        <SpectatorsSheet watchers={watchers.list} count={watchers.count} uid={uid} messages={specChat.messages}
          onSend={canWrite ? specChat.send : undefined} readOnlyNote={t.share.readOnly} onClose={() => setSpecOpen(false)} />
      )}
    </>
  );
}

/** The normal spectator table for a shared match (also what the design preview draws). */
export function SharedTableView({ board, status, endsAt, watchers, watcherCount, unread = 0, notice, onWatchersTap, onLeave, onMessage, onSponsorTap }: {
  board: SharedBoard; status: 'live' | 'reconnecting'; endsAt: number | null;
  watchers: string[]; watcherCount: number; unread?: number; notice?: string | null;
  onWatchersTap: () => void; onLeave: () => void; onMessage: () => void; onSponsorTap?: () => void;
}) {
  const { t } = useI18n();
  const { view, focus } = board;
  const over = view.winner !== null;
  const closesIn = useCountdown(over ? endsAt : null);
  const noop = () => {};
  const hostAway = board.away.has(focus) && !over ? t.share.hostAway.replace('{name}', board.names[focus]) : null;
  return (
    <TableView
      view={view} myHand={[]} mySeat={focus} names={board.names} levels={board.levels} avatars={board.avatars}
      onPlay={noop} onNextHand={noop} onExit={onLeave} chat={board.chat} onChat={noop} away={board.away}
      pot={board.pot} turnDeadline={board.turnDeadline} sponsor={board.sponsor} onSponsorTap={onSponsorTap}
      notice={hostAway ?? notice}
      watchers={watchers} watcherCount={watcherCount} onWatchersTap={onWatchersTap} watchersUnread={unread}
      resultNote={closesIn ? <p className="share-closes" role="timer">{t.share.closesIn.replace('{t}', closesIn)}</p> : undefined}
      endActions={<button className="btn primary" onClick={onLeave}>{t.share.goHome}</button>}
      watching={{
        name: board.names[focus], onLeave, status,
        tools: (
          <button className="btn ghost watch-msg" onClick={onMessage}>
            <ChatCircleDotsIcon size={20} weight="fill" />{t.spec.message}{unread > 0 && <i className="watchers-dot" aria-hidden />}
          </button>
        ),
      }}
    />
  );
}

// ---------- the second-phone broadcast ----------

const fullscreenSupported = () =>
  typeof document !== 'undefined' && !!(document.fullscreenEnabled || (document as unknown as { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled);
async function enterFullscreen() {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
  if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
  else await el.webkitRequestFullscreen?.();
}

/** Keep the screen on while `on` (asked again whenever the page comes back). */
function useWakeLock(on: boolean): 'on' | 'off' | 'unsupported' {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!on || !supported) return;
    let alive = true;
    let lock: WakeLockSentinel | null = null;
    const ask = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen').then((l) => {
        if (!alive) { l.release().catch(() => {}); return; }
        lock = l;
        setHeld(true);
        l.addEventListener('release', () => { if (alive) setHeld(false); });
      }, () => { if (alive) setHeld(false); });
    };
    ask();
    document.addEventListener('visibilitychange', ask);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', ask);
      lock?.release().catch(() => {});
    };
  }, [on, supported]);
  return !supported ? 'unsupported' : held && on ? 'on' : 'off';
}

function BroadcastScreen({ roomId, uid, onLeave }: { roomId: string; uid: string; onLeave: () => void }) {
  const [started, setStarted] = useState(false);
  const [keepAwake, setKeepAwake] = useState(true);
  const wake = useWakeLock(started && keepAwake);
  const [fsFailed, setFsFailed] = useState(false);
  const start = async (full: boolean) => {
    if (full) {
      try { await enterFullscreen(); } catch { setFsFailed(true); }
    }
    setStarted(true);
  };
  if (!started) {
    return <BroadcastSetup fullscreen={fullscreenSupported() && !fsFailed} wake={wake !== 'unsupported'} keepAwake={keepAwake}
      onKeepAwake={setKeepAwake} onStart={start} onLeave={onLeave} />;
  }
  return <BroadcastLive roomId={roomId} uid={uid} onLeave={onLeave} />;
}

export function BroadcastSetup({ fullscreen, wake, keepAwake, onKeepAwake, onStart, onLeave }: {
  fullscreen: boolean; wake: boolean; keepAwake: boolean; onKeepAwake: (v: boolean) => void;
  onStart: (fullscreen: boolean) => void; onLeave: () => void;
}) {
  const { t } = useI18n();
  return (
    <main className="screen cast-setup">
      <h1 className="logo small">Capicúa</h1>
      <h2>{t.share.castTitle}</h2>
      <p className="fine">{t.share.castSub}</p>
      <ul className="cast-tips">{t.share.castTips.map((tip, i) => <li key={i}>{tip}</li>)}</ul>
      {wake ? (
        <label className="setting-row push-row cast-wake">
          <span>☀️ {t.share.wake}<small>{keepAwake ? t.share.wakeOn : ''}</small></span>
          <input type="checkbox" checked={keepAwake} onChange={(e) => onKeepAwake(e.target.checked)} />
        </label>
      ) : <p className="fine left">{t.share.noWake}</p>}
      {fullscreen ? (
        <>
          <button className="btn primary big-btn" onClick={() => onStart(true)}>{t.share.fullscreen}</button>
          <button className="btn ghost" onClick={() => onStart(false)}>{t.share.startWithout}</button>
        </>
      ) : (
        <>
          <p className="fine left">{t.share.noFullscreen}</p>
          <button className="btn primary big-btn" onClick={() => onStart(false)}>{t.share.startWithout}</button>
        </>
      )}
      <button className="link-btn" onClick={onLeave}>{t.share.goHome}</button>
    </main>
  );
}

function BroadcastLive({ roomId, uid, onLeave }: { roomId: string; uid: string; onLeave: () => void }) {
  const { r, board } = useSharedBoard(roomId, uid);
  const overlay = r.gone ? 'ended' : r.status === 'reconnecting' ? 'lost' : null;
  return <BroadcastCanvas board={board} overlay={overlay} onLeave={onLeave} />;
}

/** The clean 9:16 canvas TikTok captures: the table only; press and hold to leave. */
export function BroadcastCanvas({ board, overlay, onLeave }: { board: SharedBoard | null; overlay: 'ended' | 'lost' | null; onLeave: () => void }) {
  const { t } = useI18n();
  const [exitOpen, setExitOpen] = useState(false);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHold = () => { if (hold.current) clearTimeout(hold.current); hold.current = null; };
  // Nothing on this screen scrolls or zooms by accident.
  useEffect(() => {
    document.documentElement.classList.add('broadcast-mode');
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExitOpen(true);
    window.addEventListener('keydown', onKey);
    return () => { document.documentElement.classList.remove('broadcast-mode'); window.removeEventListener('keydown', onKey); };
  }, []);
  const noop = () => {};
  return (
    <div className="broadcast-canvas" aria-label="Capicúa"
      onPointerDown={() => { cancelHold(); hold.current = setTimeout(() => setExitOpen(true), 900); }}
      onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold}
      onContextMenu={(e) => e.preventDefault()}>
      {board && overlay !== 'ended' && (
        <TableView presentation="broadcast"
          view={board.view} myHand={[]} mySeat={board.focus} names={board.names} levels={board.levels} avatars={board.avatars}
          onPlay={noop} onNextHand={noop} onExit={onLeave} chat={board.chat} onChat={noop} away={board.away}
          turnDeadline={board.turnDeadline} sponsor={board.sponsor} endActions={null}
          watching={{ name: board.names[board.focus], onLeave }} />
      )}
      {overlay === 'ended' && (
        <div className="cast-card"><h1 className="table-wordmark">CAPICÚA</h1><p>{t.share.castEnded}</p></div>
      )}
      {overlay === 'lost' && <p className="cast-banner" role="status">{t.share.castLost}</p>}
      {exitOpen && (
        <div className="cast-exit" role="dialog" aria-modal="true" aria-label={t.share.castExit} onPointerDown={(e) => e.stopPropagation()}>
          <button className="btn danger" onClick={onLeave}>{t.share.castExit}</button>
          <button className="btn primary" onClick={() => setExitOpen(false)} autoFocus>{t.share.castKeep}</button>
        </div>
      )}
      <span className="sr-only">{t.share.castExitHint}</span>
    </div>
  );
}

export type { LinkWatchers };

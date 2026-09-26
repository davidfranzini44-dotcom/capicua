import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import {
  isPollona, legalMoves, playerCount, sameTile, sideOf, standings,
  type GameEvent, type GameState, type Move, type Seat, type Tile,
} from '../../supabase/functions/_shared/domino.ts';
import { gameXp, type PublicState } from '../../supabase/functions/_shared/table.ts';
import { useI18n } from '../i18n';
import { useTableLook } from '../lib/look';
import { BUBBLE_MS, PHRASE_IDS, PHRASES, type PhraseId } from '../quickchat';
import { Board } from './Board';
import { Avatar } from './common';
import { Confetti } from './Confetti';
import { handLayout } from './handLayout';
import { LookPicker } from './LookPicker';
import { arrowPath, OWNER_ARROW, ownerRole, type OwnerRole } from './owners';
import { HandTile, TileBack } from './Tile';
import { ListIcon, XIcon, ChatCircleDotsIcon, MicrophoneSlashIcon } from '@phosphor-icons/react';
import './table.css';

/** Latest sound-button phrase per seat; the view hides it after it goes stale. */
export type ChatBubbles = Partial<Record<Seat, { id: PhraseId; at: number }>>;

export interface TableViewProps {
  view: PublicState;
  myHand: Tile[];
  mySeat: Seat;
  /** Display names by absolute seat. */
  names: string[];
  /** Levels by absolute seat (online only). */
  levels?: (number | null)[];
  /** Profile pictures by absolute seat (online only). */
  avatars?: (string | null)[];
  onPlay: (move: Move) => void;
  onNextHand: () => void;
  onExit: () => void;
  /** Buttons shown when the game is over (play again / rematch). */
  endActions: ReactNode;
  chat: ChatBubbles;
  onChat: (id: PhraseId) => void;
  /** Seats currently talking on voice chat. */
  speaking?: Set<Seat>;
  /** Voice control, rendered next to the sound buttons. */
  voice?: ReactNode;
  /** Chips riding on this game, if any. */
  pot?: number;
  /** Seats that left and are being played by the server. */
  away?: Set<Seat>;
  /** Tap another player's avatar (used to mute them on voice). */
  onSeatTap?: (seat: Seat) => void;
  /** Seats I've muted on voice. */
  mutedSeats?: Set<Seat>;
  /** Local timestamp when the current player's turn runs out (online). */
  turnDeadline?: number | null;
  /** Extra line under the result (e.g. chips won, side bets). */
  resultNote?: ReactNode;
  /** Human seats whose owner doesn't have the table open right now. */
  offline?: Set<Seat>;
  /** Text for the leave confirmation (online games explain the server keeps playing). */
  exitConfirm?: string;
  /** Online games earn XP; practice doesn't. */
  showXp?: boolean;
  /** A short message (e.g. a refused move) shown in the line under the hand, never over the table. */
  notice?: string | null;
  /** Watching a friend's game: their seat is "mine", their hand stays face down, no playing. */
  watching?: { name: string; onLeave: () => void };
  /** Friends watching this table (the players can always see who). */
  watchers?: string[];
}

/** Autoplay when only one tile can be played — a per-device preference. */
function useAutoplayPref(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem('capicua.autoplay') !== '0'; } catch { return true; } // on unless turned off
  });
  const set = (v: boolean) => {
    setOn(v);
    try { localStorage.setItem('capicua.autoplay', v ? '1' : '0'); } catch { /* storage unavailable */ }
  };
  return [on, set];
}

/** "Show who played each tile" — on unless the player turns it off (per device). */
function useShowOwnersPref(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem('capicua.showOwners') !== '0'; } catch { return true; }
  });
  const set = (v: boolean) => {
    setOn(v);
    try { localStorage.setItem('capicua.showOwners', v ? '1' : '0'); } catch { /* storage unavailable */ }
  };
  return [on, set];
}

/** Tall enough for full-size hand tiles? Short phones get smaller ones so the board has room. */
function useViewportHeight() {
  const [h, setH] = useState(() => window.innerHeight);
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return h;
}

/** Opponent colors in free-for-all (by position around the table). */
const FFA_COLORS = ['var(--us)', 'var(--them)', '#6fb7ff', '#c79bff'];

export function TableView(props: TableViewProps) {
  const {
    view, myHand, mySeat, names, levels, avatars, onPlay, onNextHand, onExit, chat, onChat,
    speaking, voice, pot, away, onSeatTap, mutedSeats, turnDeadline, resultNote, offline, exitConfirm, notice,
    watching, watchers,
  } = props;
  const { t, lang, setLang } = useI18n();
  const [pending, setPending] = useState<Tile | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDialogElement>(null);
  const [autoplay, setAutoplay] = useAutoplayPref();
  const [showOwners, setShowOwners] = useShowOwnersPref();
  const look = useTableLook();
  const [now, setNow] = useState(() => Date.now());
  const handRef = useRef<HTMLDivElement>(null);
  const handWidth = useWidth(handRef);
  const viewportHeight = useViewportHeight();
  const hand = handLayout(myHand.length, handWidth, viewportHeight < 700 ? 46 : undefined);

  const mode = view.rules.mode;
  const n = playerCount(mode);
  const rel = (offset: number) => ((mySeat + offset) % n) as Seat;
  const mySide = sideOf(mode, mySeat);
  const name = (s: Seat) => (s === mySeat && !watching ? t.you : names[s]);
  const playing = !view.handResult && view.winner === null;
  /** The bottom seat is up (me, or the friend I'm watching). */
  const bottomTurn = view.turn === mySeat && playing;
  const myTurn = bottomTurn && !watching;

  const myMoves = useMemo(() => {
    if (!myTurn) return [];
    const hands: Tile[][] = Array.from({ length: n }, () => []);
    hands[mySeat] = myHand;
    return legalMoves({ ...view, hands, boneyard: [] } as GameState, mySeat);
  }, [view, myHand, mySeat, myTurn, n]);

  // A new state from the server can make a half-finished selection stale.
  useEffect(() => setPending(null), [view.line.length, view.turn]);

  // One move per turn: a tap plus autoplay (or a double tap) before the server's answer
  // arrives would send it twice, and the second one comes back as "not your turn".
  const moveKey = `${view.handNo}:${view.events.length}`;
  const sent = useRef<{ key: string; at: number } | null>(null);

  // Only one thing you can do? Do it (after a beat, so you see it happen).
  const single = myMoves.length === 1 ? myMoves[0] : null;
  useEffect(() => {
    if (!autoplay || !single) return;
    const id = setTimeout(() => play(single), 650);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, single && JSON.stringify(single), view.line.length, view.handNo]);

  useEffect(() => {
    if (!view.handResult) {
      setShowResult(false);
      return;
    }
    const id = setTimeout(() => setShowResult(true), 1100);
    return () => clearTimeout(id);
  }, [view.handResult]);

  const lastEvent = view.events.at(-1);
  const paseCorridoKey = lastEvent?.kind === 'paseCorrido'
    ? `${view.handNo}:${view.events.length}:${lastEvent.seat}:${lastEvent.points}`
    : '';
  const paseCorridoText = lastEvent?.kind === 'paseCorrido'
    ? `${t.paseCorrido} ${sideOf(mode, lastEvent.seat) === mySide ? (mode === '2v2' ? t.us : t.you) : name(lastEvent.seat)} +${lastEvent.points}`
    : '';
  useEffect(() => {
    setToast(null);
    if (!paseCorridoKey) return;
    setToast(paseCorridoText);
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [paseCorridoKey, paseCorridoText]);

  // Tick while bubbles or a turn timer are on screen.
  const ticking = Object.keys(chat).length > 0 || (turnDeadline != null && playing);
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [ticking]);

  const play = (m: Move) => {
    setPending(null);
    const last = sent.current;
    if (last && last.key === moveKey && Date.now() - last.at < 3000) return; // already sent for this turn
    sent.current = { key: moveKey, at: Date.now() };
    onPlay(m);
  };

  const onTileTap = (tile: Tile) => {
    const options = myMoves.filter((m): m is Extract<Move, { type: 'play' }> => m.type === 'play' && sameTile(m.tile, tile));
    if (options.length === 0) return;
    // Fits only one end: play it straight away. Fits both: pick the end on the board.
    if (options.length === 1) play(options[0]);
    else setPending(pending && sameTile(pending, tile) ? null : tile);
  };

  const targets = pending
    ? myMoves.flatMap((m) => (m.type === 'play' && sameTile(m.tile, pending) ? [m.side] : []))
    : [];

  const newestPlay = [...view.events].reverse().find((e) => e.kind === 'play') as Extract<GameEvent, { kind: 'play' }> | undefined;
  const newestKey = newestPlay ? `${newestPlay.tile[0]}-${newestPlay.tile[1]}` : null;

  const recent = view.events.filter((e) => e.kind !== 'paseCorrido').slice(-3);
  const bubble = (s: Seat): { text: string; chat: boolean } | null => {
    const c = chat[s];
    if (c && now - c.at < BUBBLE_MS) return { text: PHRASES[c.id].es, chat: true };
    const e = [...recent].reverse().find((ev) => ev.seat === s);
    if (e?.kind === 'pass') return { text: t.passed, chat: false };
    if (e?.kind === 'draw') return { text: t.drew, chat: false };
    return null;
  };

  const secondsLeft = turnDeadline != null && playing ? Math.max(0, Math.ceil((turnDeadline - now) / 1000)) : null;

  let status: string;
  if (!playing) status = '';
  else if (myTurn) {
    if (myMoves.length === 0) status = view.boneyardCount > 0 ? t.drawing : t.noPlay;
    else if (pending) status = t.chooseSide;
    else if (view.mustOpen) status = `${t.openWith} ${view.mustOpen[0]}-${view.mustOpen[1]}`;
    else status = t.yourTurn;
  } else status = away?.has(view.turn) ? `${t.serverPlaysFor} ${name(view.turn)}` : `${name(view.turn)} ${t.thinking}`;

  /** Marker spot for a seat when "who played each tile" is on. */
  const ownerOf = showOwners ? (s: Seat) => ownerRole(mode, mySeat, s) : null;

  const colorOf = (s: Seat) => (mode === 'ffa' ? FFA_COLORS[(s - mySeat + n) % n] : sideOf(mode, s) === mySide ? 'var(--us)' : 'var(--them)');

  const seatProps = (s: Seat) => ({
    name: name(s),
    avatar: avatars?.[s] ?? null,
    level: levels?.[s] ?? null,
    color: colorOf(s),
    count: view.handCounts[s],
    active: view.turn === s && playing,
    bubble: bubble(s),
    speaking: speaking?.has(s) ?? false,
    away: away?.has(s) ?? false,
    offline: offline?.has(s) ?? false,
    muted: mutedSeats?.has(s) ?? false,
    onTap: onSeatTap ? () => onSeatTap(s) : undefined,
    seconds: view.turn === s ? secondsLeft : null,
    owner: ownerOf?.(s),
  });

  const myBubble = bubble(mySeat);
  const copy = lang === 'es'
    ? { pick: 'Elige una ficha iluminada', place: 'Toca un extremo iluminado', tiles: 'fichas', chat: 'Chat', practice: 'Voz disponible en partidas online', done: 'Listo' }
    : { pick: 'Choose a highlighted tile', place: 'Tap a highlighted end', tiles: 'tiles', chat: 'Chat', practice: 'Voice is available in online games', done: 'Done' };

  useEffect(() => {
    if (menuOpen) menuRef.current?.showModal();
    else menuRef.current?.close();
  }, [menuOpen]);

  return (
    <div className={`table-screen table-redesign mode-${mode} ${look.className}`} style={look.style} onKeyDown={(e) => {
      if (e.key === 'Escape') { setPending(null); setChatOpen(false); }
    }}>
      <header className="table-header">
        <div className="table-topbar">
          <button className="table-icon" onClick={() => setMenuOpen(true)} aria-label={t.settings}><ListIcon size={25} /></button>
          <h1 className="table-wordmark">CAPICÚA</h1>
          <button className="table-icon" onClick={() => (!playing || confirm(exitConfirm ?? t.exitConfirm)) && onExit()} aria-label={t.exit}><XIcon size={25} /></button>
        </div>
        <Scores view={view} mySeat={mySeat} name={name} colorOf={colorOf} pot={pot} watchers={watchers} watching={!!watching} />
      </header>

      <div className="table-rail"><div className="felt">
        {mode === '1v1' ? (
          <SeatBadge {...seatProps(rel(1))} pos="top" />
        ) : (
          <SeatBadge {...seatProps(rel(2))} pos="top" partnerLabel={mode === '2v2' ? t.partner : undefined} />
        )}
        {mode !== '1v1' && <>
          <SeatBadge {...seatProps(rel(3))} pos="left" />
          <SeatBadge {...seatProps(rel(1))} pos="right" />
        </>}

        {mode === '1v1' && (
          <div className={`boneyard ${view.boneyardCount === 0 ? 'empty' : ''}`} title={t.pile}>
            <span className="pile">{Array.from({ length: Math.min(view.boneyardCount, 5) }, (_, i) => <TileBack key={i} />)}</span>
            <small>{t.pile}: {view.boneyardCount}</small>
          </div>
        )}

        <div className="board-wrap">
          <Board line={view.line} origin={view.origin} newestKey={newestKey} targets={targets} selected={pending}
            ownerOf={ownerOf} nameOf={name} onPickSide={(side) => {
            const move = myMoves.find((m) => m.type === 'play' && pending && sameTile(m.tile, pending) && m.side === side);
            if (move) play(move);
          }} />
        </div>

        <div className={`self-seat ${bottomTurn ? 'active' : ''} ${speaking?.has(mySeat) ? 'speaking' : ''}`}>
          <div className="avatar">
            <Avatar name={name(mySeat)} url={avatars?.[mySeat]} />
            {bottomTurn && <TurnArrow />}
          </div>
          <b>{ownerOf && <OwnerChip role="me" />}{name(mySeat)}</b>
          {myBubble && <span className="self-bubble">{myBubble.text}</span>}
        </div>

      </div></div>

      <footer className="my-area">
        {chatOpen && (
          <div className="chat-panel" id="table-chat">
            <button className="chat-close table-icon" onClick={() => setChatOpen(false)} aria-label={t.cancel}><XIcon size={20} /></button>
            {PHRASE_IDS.map((id) => (
              <button key={id} className="chat-chip" onClick={() => { onChat(id); setChatOpen(false); }}>
                {PHRASES[id].es}
                {lang === 'en' && <small>{PHRASES[id].en}</small>}
              </button>
            ))}
          </div>
        )}
        {watching && (
          <div className="watch-bar">
            <span className="backs" aria-hidden>{Array.from({ length: Math.min(view.handCounts[mySeat], 7) }, (_, i) => <TileBack key={i} />)}</span>
            <span>👁 {t.watch.watching} <b>{watching.name}</b> · {view.handCounts[mySeat]} {view.handCounts[mySeat] === 1 ? t.watch.tile : t.watch.tiles}</span>
          </div>
        )}
        {/* A big 1v1 hand (lots of draws) wraps into balanced rows sized to fit the screen. */}
        <div ref={handRef} hidden={!!watching} className={`hand ${hand.rows > 1 ? 'multi' : ''}`}
          style={{ '--per-row': hand.perRow, '--tile-w': `${hand.tile}px` } as CSSProperties}>
          <div className="hand-rows">
            {myHand.map((tile) => {
              const playable = myMoves.some((m) => m.type === 'play' && sameTile(m.tile, tile));
              const selected = pending !== null && sameTile(pending, tile);
              return (
                <button
                  key={`${tile[0]}-${tile[1]}`}
                  className={`hand-tile ${myTurn ? (playable ? 'playable' : 'dim') : ''} ${selected ? 'selected' : ''}`}
                  onClick={() => onTileTap(tile)}
                  disabled={!playable}
                  aria-label={`${tile[0]}–${tile[1]}`}
                  aria-pressed={selected}
                >
                  <HandTile tile={tile} />
                </button>
              );
            })}
          </div>
        </div>
        <div className={`table-instruction ${notice ? 'notice' : ''}`} role="status" aria-live="polite">
          {notice || toast || (pending ? view.line.length === 0 ? (lang === 'es' ? 'Toca el centro para salir' : 'Tap the center to start') : copy.place : myTurn && myMoves.length > 0 ? (view.mustOpen ? status : copy.pick) : status)}
          {!notice && !toast && playing && secondsLeft !== null && <span className={secondsLeft <= 5 ? 'urgent' : ''}> · {secondsLeft} s</span>}
          {pending && <button className="table-cancel" onClick={() => setPending(null)} aria-label={t.cancel}><XIcon size={17} /></button>}
        </div>
        {watching ? (
          <div className="table-tools watch-tools">
            <button className="btn ghost" onClick={watching.onLeave}>{t.watch.stop}</button>
          </div>
        ) : (
          <div className="table-tools">
            {voice ?? <span className="practice-voice" title={copy.practice}><MicrophoneSlashIcon size={25} /><small>{lang === 'es' ? 'Sin voz' : 'No voice'}</small></span>}
            <button className={`table-chat-button ${chatOpen ? 'on' : ''}`} onClick={() => setChatOpen((o) => !o)} aria-expanded={chatOpen} aria-controls="table-chat"><ChatCircleDotsIcon size={28} weight="fill" /><span>{copy.chat}</span></button>
          </div>
        )}
      </footer>

      <dialog ref={menuRef} className="table-settings" onCancel={() => setMenuOpen(false)} onClose={() => setMenuOpen(false)}>
        <h2>{t.settings}</h2>
        <label>{t.language}<select value={lang} onChange={(e) => setLang(e.target.value as 'es' | 'en')}><option value="es">Español</option><option value="en">English</option></select></label>
        <label><span>{t.auto}<small>{t.autoplayHint}</small></span><input type="checkbox" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} /></label>
        <label><span>{t.showOwners}<small>{t.showOwnersHint}</small></span><input type="checkbox" checked={showOwners} onChange={(e) => setShowOwners(e.target.checked)} /></label>
        <LookPicker compact />
        <button className="btn primary" onClick={() => setMenuOpen(false)}>{copy.done}</button>
      </dialog>

      {showResult && view.handResult && view.winner === null && (
        <ResultSheet view={view} mySeat={mySeat} name={name} onNext={onNextHand} endActions={props.endActions} note={resultNote} />
      )}
      {showResult && view.winner !== null && (
        <GameOver view={view} mySeat={mySeat} name={name} endActions={props.endActions} note={resultNote} showXp={props.showXp} />
      )}
    </div>
  );
}

function Scores({ view, mySeat, name, colorOf, pot, watchers, watching }: {
  view: PublicState; mySeat: Seat; name: (s: Seat) => string; colorOf: (s: Seat) => string; pot?: number;
  watchers?: string[]; watching?: boolean;
}) {
  const { t } = useI18n();
  const mode = view.rules.mode;
  const mySide = sideOf(mode, mySeat);
  const middle = (
    <div className="target">
      {t.to} {view.rules.target}
      <small>{t.hand} {view.handNo}{watchers?.length ? <span className="watchers" title={`${t.watch.watchedBy}: ${watchers.join(', ')}`} aria-label={`${t.watch.watchedBy}: ${watchers.join(', ')}`}> · 👁 {watchers.length}</span> : null}</small>
      {pot ? <span className="pot">🪙 {pot.toLocaleString()}</span> : null}
    </div>
  );
  if (mode === 'ffa') {
    const order = [0, 1, 2, 3].map((i) => ((mySeat + i) % 4) as Seat);
    return (
      <div className="scores ffa">
        {order.slice(0, 2).map((s) => <MiniScore key={s} label={name(s)} value={view.scores[s]} color={colorOf(s)} />)}
        {middle}
        {order.slice(2).map((s) => <MiniScore key={s} label={name(s)} value={view.scores[s]} color={colorOf(s)} />)}
      </div>
    );
  }
  const other = mySide === 0 ? 1 : 0;
  const theirLabel = mode === '1v1' ? name(((mySeat + 1) % 2) as Seat) : t.them;
  return (
    <div className="scores">
      <div className="score us"><span>{mode === '1v1' ? name(mySeat) : watching ? name(mySeat) : t.us}</span><b>{view.scores[mySide]}</b></div>
      {middle}
      <div className="score them"><span>{theirLabel}</span><b>{view.scores[other]}</b></div>
    </div>
  );
}

function MiniScore({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="score mini">
      <span>{label}</span>
      <b style={{ color }}>{value}</b>
    </div>
  );
}

/** Content width of an element, kept up to date as the screen turns or resizes. */
function useWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(() => Math.min(window.innerWidth, 720) - 16);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** Gold arrow beside the avatar of whoever's turn it is, pointing at them (CSS flips it for the right seat). */
function TurnArrow() {
  return (
    <span className="turn-arrow" aria-hidden>
      <svg viewBox="0 0 16 16"><path d="M1 8 L8.5 1.5 V5.2 H15 V10.8 H8.5 V14.5 Z" /></svg>
    </span>
  );
}

/** The small marker a player's tiles carry on the board, shown by their name as a key. */
function OwnerChip({ role }: { role: OwnerRole }) {
  return (
    <svg className={`owner-chip owner-${role}`} viewBox="-1 -1 2 2" aria-hidden>
      <circle r={0.92} className="owner-chip-bg" />
      <path d={arrowPath(0, 0, 0.43, OWNER_ARROW[role])} className="owner-mark" />
    </svg>
  );
}

function SeatBadge({
  name, avatar, level, color, count, active, bubble, pos, partnerLabel, speaking, away, offline, muted, onTap, seconds, owner,
}: {
  name: string; avatar?: string | null; level: number | null; color: string; count: number; active: boolean;
  bubble: { text: string; chat: boolean } | null; pos: 'top' | 'left' | 'right'; partnerLabel?: string;
  speaking: boolean; away: boolean; offline: boolean; muted: boolean; onTap?: () => void; seconds: number | null;
  owner?: OwnerRole;
}) {
  const { t, lang } = useI18n();
  return (
    <div className={`seat seat-${pos} ${active ? 'active' : ''} ${speaking ? 'speaking' : ''} ${away ? 'away' : ''} ${offline ? 'offline' : ''}`} style={{ '--seat-color': color } as CSSProperties}>
      <button className={`avatar ${onTap ? 'tappable' : ''}`} onClick={onTap} disabled={!onTap} aria-label={onTap ? `${name} · ${muted ? t.voice.muted : t.voice.live}` : name} aria-pressed={onTap ? muted : undefined}>
        {speaking && <span className="talk-ring" aria-hidden />}
        <Avatar name={name} url={avatar} />
        {level != null && <span className="lvl">{level}</span>}
        {muted ? <span className="mic-dot">🔇</span> : speaking && <span className="mic-dot eq"><i /><i /><i /></span>}
        {active && seconds !== null && seconds <= 10 && <span className={`seat-timer ${seconds <= 5 ? 'hot' : ''}`}>{seconds}</span>}
        {active && <TurnArrow />}
      </button>
      <div className="seat-info">
        <span className="seat-name">{owner && <OwnerChip role={owner} />}{name}{partnerLabel && <small> · {partnerLabel}</small>}</span>
        {offline && <span className="offline-tag">📵 {t.offline}</span>}
        <span className="seat-tiles" aria-label={`${count} ${count === 1 ? (lang === 'es' ? 'ficha' : 'tile') : (lang === 'es' ? 'fichas' : 'tiles')}`}>
          <span className="backs" aria-hidden>{Array.from({ length: Math.min(count, 7) }, (_, i) => <TileBack key={i} />)}</span>
          <b className="tile-count" aria-hidden>{count}</b>
        </span>
      </div>
      {bubble && <span className={`bubble ${bubble.chat ? 'chat' : ''}`}>{bubble.text}</span>}
    </div>
  );
}

function ResultSheet({
  view, mySeat, name, onNext, endActions, note,
}: { view: PublicState; mySeat: Seat; name: (s: Seat) => string; onNext: () => void; endActions: ReactNode; note?: ReactNode }) {
  const { t } = useI18n();
  const r = view.handResult!;
  const mode = view.rules.mode;
  const mySide = sideOf(mode, mySeat);
  const ours = r.side === mySide;
  const title = r.capicua ? t.capicua : r.kind === 'domino' ? t.domino : t.tranque;
  const over = view.winner !== null;
  const weWon = view.winner === mySide;
  const seats = Array.from({ length: playerCount(mode) }, (_, i) => i as Seat);
  const winnerLabel = mode === '2v2' ? (ours ? t.us : t.them) : name(r.winnerSeat);

  let finalTitle: string = weWon ? (mode === '2v2' ? t.weWon : t.youWon) : mode === '2v2' ? t.weLost : t.youLost;
  if (over && mode === 'ffa' && !weWon) {
    const place = standings(view.scores).findIndex((x) => x.side === mySide) + 1;
    finalTitle = place === 2 ? t.second : t.youLost;
  }

  return (
    <div className="sheet-backdrop">
      <div className={`sheet ${ours ? 'good' : 'bad'}`}>
        {over ? (
          <>
            <h2 className="big">{finalTitle}</h2>
            {isPollona(view) && <div className="pollona">{t.pollona}</div>}
            {mode === 'ffa' ? (
              <ol className="standings">
                {standings(view.scores).map((x) => <li key={x.side}>{name(x.side as Seat)} <b>{x.score}</b></li>)}
              </ol>
            ) : (
              <p className="final">{mode === '1v1' ? t.you : t.us} {view.scores[mySide]} · {mode === '1v1' ? name(((mySeat + 1) % 2) as Seat) : t.them} {view.scores[mySide === 0 ? 1 : 0]}</p>
            )}
          </>
        ) : (
          <>
            <h2>{title}</h2>
            <p className="who">{r.winnerSeat === mySeat ? t.youWonHand : `${name(r.winnerSeat)} ${t.wonHand}`}</p>
            {r.tieToMano && <p className="note">{t.tieToMano}</p>}
          </>
        )}
        <div className="gain">
          <span>{winnerLabel}</span>
          <b>+{r.total}</b>
          {r.bonus > 0 && <small>{r.points} {t.points} + {r.bonus} {t.bonus}</small>}
        </div>
        {note}
        <ul className="reveal">
          {seats.map((s) => (
            <li key={s} className={sideOf(mode, s) === mySide ? 'us' : 'them'}>
              <span className="rname">{name(s)}</span>
              <span className="rtiles">
                {r.hands[s].map((tile) => <HandTile key={`${tile[0]}-${tile[1]}`} tile={tile} className="mini" />)}
              </span>
              <b>{r.counts[s]}</b>
            </li>
          ))}
        </ul>
        {over ? <div className="sheet-actions">{endActions}</div> : <button className="btn primary" onClick={onNext}>{t.nextHand}</button>}
      </div>
    </div>
  );
}

/** End of the game: celebration (or commiseration) plus a summary of how it went. */
function GameOver({ view, mySeat, name, endActions, note, showXp }: {
  view: PublicState; mySeat: Seat; name: (s: Seat) => string; endActions: ReactNode; note?: ReactNode; showXp?: boolean;
}) {
  const { t } = useI18n();
  const mode = view.rules.mode;
  const mySide = sideOf(mode, mySeat);
  const order = standings(view.scores);
  const place = order.findIndex((x) => x.side === mySide) + 1;
  const won = view.winner === mySide;
  const second = mode === 'ffa' && place === 2;
  const pollona = won && isPollona(view);
  const capicuas = view.tally.capicuas[mySide];
  const theirCapicuas = view.tally.capicuas.reduce((a, b) => a + b, 0) - capicuas;
  const xp = gameXp({ won, capicuas, pollona, placedSecond: second });
  const title = won ? (mode === '2v2' ? t.weWon : t.youWon) : second ? t.second : mode === '2v2' ? t.weLost : t.youLost;
  const sideName = (side: number) => (mode === '2v2' ? (side === mySide ? t.us : t.them) : name(side as Seat));

  return (
    <div className={`gameover-backdrop ${won ? 'won' : second ? 'second' : 'lost'}`}>
      {won && <Confetti />}
      <div className="gameover">
        <div className="go-trophy">{won ? '🏆' : second ? '🥈' : '🤝'}</div>
        <h2 className="go-title">{title}</h2>
        {pollona && <div className="pollona">{t.pollona}</div>}
        {!won && !second && <p className="fine">{t.summary.nextOne}</p>}

        <ol className="go-scores">
          {order.map((x, i) => (
            <li key={x.side} className={x.side === mySide ? 'me' : ''}>
              <span className="go-place">{i + 1}</span>
              <span className="go-name">{sideName(x.side)}</span>
              <b>{x.score}</b>
            </li>
          ))}
        </ol>

        <div className="go-stats">
          <div><b>{view.handNo}</b><small>{t.summary.hands}</small></div>
          <div><b>{capicuas}<em> / {theirCapicuas}</em></b><small>{t.stats.capicuas}</small></div>
          <div><b>{view.tally.tranques[mySide]}</b><small>{t.summary.tranquesWon}</small></div>
          <div><b>{view.tally.hands[mySide]}</b><small>{t.summary.handsWon}</small></div>
        </div>

        <div className="go-rewards">
          {showXp && <div className="reward xp"><span>⭐</span><b>+{xp} XP</b></div>}
          {note}
        </div>

        <div className="sheet-actions">{endActions}</div>
      </div>
    </div>
  );
}

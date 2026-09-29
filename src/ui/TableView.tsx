import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import {
  canRescue, isPollona, legalMoves, lockedFor, playerCount, sameTile, sideOf, standings,
  type GameEvent, type GameState, type HandResult, type Move, type Power, type Seat, type Tile,
} from '../../supabase/functions/_shared/domino.ts';
import { gameXp, LEAVER_XP, type PublicState } from '../../supabase/functions/_shared/table.ts';
import { useI18n } from '../i18n';
import { useTableLook } from '../lib/look';
import { playSfx, useSfxPref } from '../lib/sfx';
import { playEarnSfx, playPowerSfx } from '../lib/arcadeSfx';
import { draftPickSide, draftTapTile, draftView, startDraft, type Draft } from '../lib/powerDraft';
import { ArcadeIntro, Charges, PowerBar, PowersPanel, Stars, useArcadeIntro } from './Arcade';
import { snapshotOf, tableFx, type Bonus, type FxSnapshot } from '../lib/tableFx';
import { placementRun } from '../lib/tableMotion';
import { BUBBLE_MS, PHRASE_IDS, PHRASES, type PhraseId } from '../quickchat';
import { Board } from './Board';
import { SponsorCredit, SponsorMark } from './Sponsor';
import type { TableSponsor } from '../lib/sponsor';
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
  /** Online: give the game up for good (a bot finishes it) and be free to play another. Offered next to leaving. */
  onForfeit?: () => void;
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
  /** Tap another player's avatar (online: opens their card to mute or report them). */
  onSeatTap?: (seat: Seat) => void;
  /** Seats I've muted on voice. */
  mutedSeats?: Set<Seat>;
  /** Local timestamp when the current player's turn runs out (online). */
  turnDeadline?: number | null;
  /** Online, between hands: who tapped "Listo", who's still to, and when the next hand deals anyway. */
  readyUp?: ReadyUp;
  /** Extra line under the result (e.g. chips won, side bets). */
  resultNote?: ReactNode;
  /** Human seats whose owner doesn't have the table open right now. */
  offline?: Set<Seat>;
  /** Seats whose player left the app mid-hand (fair play) and hasn't come back yet. */
  outOfApp?: Set<Seat>;
  /** Text for the leave confirmation (online games explain the server keeps playing). */
  exitConfirm?: string;
  /** Online games earn XP; practice doesn't. */
  showXp?: boolean;
  /** A short message (e.g. a refused move) shown in the line under the hand, never over the table. */
  notice?: string | null;
  /** Watching a friend's game: their seat is "mine", their hand stays face down, no playing. `tools`: listen / message. */
  watching?: { name: string; onLeave: () => void; tools?: ReactNode };
  /** Friends watching this table (the players can always see who). */
  watchers?: string[];
  /** Tap 👁: who's watching and what they say. */
  onWatchersTap?: () => void;
  /** Spectator messages since the panel was last opened. */
  watchersUnread?: number;
  /** Board look: the Focus Table (default) or the classic board, kept for the design comparison preview. */
  presentation?: 'classic' | 'focus';
  /** The sponsor printed on this table's felt, if any. */
  sponsor?: TableSponsor | null;
  /** "Patrocinado por…" tapped (counts it and opens their link). */
  onSponsorTap?: () => void;
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

/** How long a bonus pop-up stays on screen. */
const BONUS_MS = 1900;
/** The hand summary appears this long after the hand ends (longer after a capicúa, so its pop-up finishes first). */
const RESULT_MS = 1100;
const RESULT_AFTER_BONUS_MS = BONUS_MS + 200;

/** Opponent colors in free-for-all (by position around the table). */
const FFA_COLORS = ['var(--us)', 'var(--them)', '#6fb7ff', '#c79bff'];

export function TableView(props: TableViewProps) {
  const {
    view, myHand, mySeat, names, levels, avatars, onPlay, onNextHand, onExit, chat, onChat,
    speaking, voice, pot, away, onSeatTap, mutedSeats, turnDeadline, readyUp, resultNote, offline, outOfApp, exitConfirm, notice,
    watching, watchers,
  } = props;
  const { t, lang, setLang } = useI18n();
  const [pending, setPending] = useState<Tile | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [bonus, setBonus] = useState<Bonus | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** The "step away or forfeit" choice when leaving a game in progress. */
  const [leaving, setLeaving] = useState(false);
  const menuRef = useRef<HTMLDialogElement>(null);
  const [autoplay, setAutoplay] = useAutoplayPref();
  const [showOwners, setShowOwners] = useShowOwnersPref();
  const [sfx, setSfx] = useSfxPref();
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

  /** The game as I can see it: my own hand, and only how many fichas the others hold. */
  const mine = useMemo(() => {
    const hands: Tile[][] = Array.from({ length: n }, (_, i) => (i === mySeat ? myHand : Array.from({ length: view.handCounts[i] ?? 0 }, () => [0, 0] as Tile)));
    return { ...view, hands, boneyard: [] } as GameState;
  }, [view, myHand, mySeat, n]);
  const myMoves = useMemo(() => (myTurn ? legalMoves(mine, mySeat) : []), [mine, mySeat, myTurn]);

  // Arcade: powers menu, the power being chosen, the first-time guide.
  const arcade = view.arcade ?? null;
  const [powersOpen, setPowersOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [callArmed, setCallArmed] = useState(false);
  const [introOpen, setIntroOpen] = useArcadeIntro(!!arcade && !watching);
  const [arcadeNotice, setArcadeNotice] = useState<string | null>(null);
  const dv = draft && myTurn ? draftView(mine, mySeat, draft) : null;
  const stuck = !!arcade && myTurn && myMoves.length === 0 && canRescue(mine, mySeat);
  /** Autoplay would take the choice away while a power could still be used. */
  const powersReady = !!arcade && myTurn && (arcade.charges[mySeat] ?? 0) > 0 && !arcade.powerUsed;

  // A new state from the server can make a half-finished selection stale.
  useEffect(() => setPending(null), [view.line.length, view.turn]);
  // …and a power being chosen (the turn moved on, or a timeout played for me). Cancelling is always free.
  useEffect(() => {
    setDraft(null);
    setPowersOpen(false);
    setCallArmed(false);
  }, [view.handNo, view.events.length, view.turn]);

  // One move per turn: a tap plus autoplay (or a double tap) before the server's answer
  // arrives would send it twice, and the second one comes back as "not your turn".
  const moveKey = `${view.handNo}:${view.events.length}`;
  const sent = useRef<{ key: string; at: number } | null>(null);

  // Only one thing you can do? Do it (after a beat, so you see it happen).
  const single = myMoves.length === 1 ? myMoves[0] : null;
  useEffect(() => {
    if (!autoplay || !single || draft || powersOpen || powersReady || callArmed) return;
    const id = setTimeout(() => play(single), 650);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, single && JSON.stringify(single), view.line.length, view.handNo, draft, powersOpen, powersReady, callArmed]);

  // The hand's summary waits for the last tile to land — and for a capicúa pop-up to finish.
  const resultDelay = view.handResult?.capicua ? RESULT_AFTER_BONUS_MS : RESULT_MS;
  useEffect(() => {
    if (!view.handResult) {
      setShowResult(false);
      return;
    }
    const id = setTimeout(() => setShowResult(true), resultDelay);
    return () => clearTimeout(id);
  }, [view.handResult, resultDelay]);

  // Sounds and bonus pop-ups for whatever just happened (never for a state seen before).
  const fxPrev = useRef<FxSnapshot | null>(null);
  /** When I last laid a tile myself: its sound already played on the tap. */
  const myTileAt = useRef(0);
  /** Same for a power I just confirmed. */
  const myPowerAt = useRef(0);
  const fxKey = `${view.handNo}:${view.events.length}:${view.handResult ? 1 : 0}:${view.winner}`;
  useEffect(() => {
    const fx = tableFx(fxPrev.current, view, mySeat);
    fxPrev.current = snapshotOf(view);
    let delay = 0;
    const pe = fx.powerEvent;
    if (pe) {
      if (!(pe.seat === mySeat && Date.now() - myPowerAt.current < 2500)) playPowerSfx(pe.power);
      myPowerAt.current = 0;
      delay += 160;
      if (!watching && pe.power === 'cambio' && pe.target === mySeat) flashArcade(t.arcade.swappedYou.replace('{name}', name(pe.seat)));
    }
    if (fx.earned.length) {
      playEarnSfx(delay + 250);
      if (!watching && fx.earned.some((e) => e.seat === mySeat && e.reason === 'block')) flashArcade(t.arcade.earnedYou);
    }
    for (const result of fx.callResults) {
      if (result.success) playEarnSfx(delay + 250);
      if (!watching && result.seat === mySeat) flashArcade(result.success ? t.arcade.callPass.success : t.arcade.callPass.failed);
    }
    for (const m of fx.moves) {
      if (m.sound === 'tile' && m.seat === mySeat && Date.now() - myTileAt.current < 2500) {
        myTileAt.current = 0;
        continue;
      }
      playSfx(m.sound, delay);
      delay += 120;
    }
    if (fx.fanfare) playSfx(fx.fanfare, delay + 220);
    if (fx.bonus) setBonus(fx.bonus);
    if (fx.ending) playSfx(fx.ending, resultDelay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fxKey]);

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
    if (callArmed && m.type === 'play' && !m.lock) {
      m = { ...m, callPass: true };
      setCallArmed(false);
    }
    const power: Power | null = m.type === 'play' ? (m.lock ? 'candado' : null) : m.type === 'pass' || m.type === 'draw' ? null : m.type;
    if (power) {
      playPowerSfx(power); // right away, not when the server answers
      myPowerAt.current = Date.now();
    } else if (m.type === 'play') {
      playSfx('tile');
      myTileAt.current = Date.now();
    }
    onPlay(m);
  };

  /** A short Arcade message in the status line (it clears itself). */
  const flashArcade = (text: string) => {
    setArcadeNotice(text);
    setTimeout(() => setArcadeNotice((cur) => (cur === text ? null : cur)), 3500);
  };

  const pickPower = (p: Power) => {
    setPowersOpen(false);
    setCallArmed(false);
    setPending(null);
    setDraft(startDraft(p));
  };
  const confirmDraft = () => {
    if (!dv?.move) return;
    const move = dv.move;
    setDraft(null);
    play(move);
  };

  const onTileTap = (tile: Tile) => {
    if (draft) {
      setDraft(draftTapTile(mine, mySeat, draft, tile));
      return;
    }
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

  const recent = view.events.filter((e) => e.kind !== 'paseCorrido' && e.kind !== 'paseSalida').slice(-3);
  // A power stays announced by its player until three more things happen at the table.
  const recentPowers = view.events.slice(-4).filter((e): e is Extract<GameEvent, { kind: 'power' }> => e.kind === 'power');
  const recentEarns = view.events.slice(-3).filter((e): e is Extract<GameEvent, { kind: 'earn' }> => e.kind === 'earn' && e.reason === 'block');
  const recentCalls = view.events.slice(-4).filter((e): e is Extract<GameEvent, { kind: 'callPass' | 'callPassResult' }> => e.kind === 'callPass' || e.kind === 'callPassResult');
  const bubble = (s: Seat): { text: string; chat: boolean } | null => {
    const c = chat[s];
    if (c && now - c.at < BUBBLE_MS) return { text: PHRASES[c.id].es, chat: true };
    const call = [...recentCalls].reverse().find((ev) => ev.seat === s);
    if (call) return { text: call.kind === 'callPass' ? t.arcade.callPass.bubble : call.success ? t.arcade.callPass.bubbleSuccess : t.arcade.callPass.bubbleFailed, chat: true };
    const pw = [...recentPowers].reverse().find((ev) => ev.seat === s);
    if (pw) return { text: `${t.arcade.bubble[pw.power].replace('{name}', pw.target !== undefined ? name(pw.target as Seat) : '')}`, chat: true };
    if (recentEarns.some((ev) => ev.seat === s)) return { text: '⚡+1', chat: true };
    const e = [...recent].reverse().find((ev) => ev.seat === s);
    if (e?.kind === 'redeal') return { text: t.redealBubble.replace('{n}', String(e.doubles)), chat: true };
    if (e?.kind === 'pass') return { text: t.passed, chat: false };
    if (e?.kind === 'draw') return { text: t.drew, chat: false };
    return null;
  };

  const secondsLeft = turnDeadline != null && playing ? Math.max(0, Math.ceil((turnDeadline - now) / 1000)) : null;

  let status: string;
  if (!playing) status = '';
  else if (myTurn) {
    if (myMoves.length === 0) status = stuck ? t.arcade.stuck : view.boneyardCount > 0 ? t.drawing : t.noPlay;
    else if (pending) status = t.chooseSide;
    else if (view.mustOpen) status = `${t.openWith} ${view.mustOpen[0]}-${view.mustOpen[1]}`;
    else status = t.yourTurn;
  } else status = away?.has(view.turn) ? `${t.serverPlaysFor} ${name(view.turn)}` : `${name(view.turn)} ${t.thinking}`;

  // Arcade: a Candado closed one of my ends for this turn — say so in front of whatever the line says.
  const closedEnd = myTurn ? lockedFor(view, mySeat) : null;
  const lockNote = closedEnd ? `${t.arcade.lockedYou.replace('{end}', closedEnd === 'L' ? t.arcade.left : t.arcade.right)} · ` : '';

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
    outOfApp: outOfApp?.has(s) ?? false,
    muted: mutedSeats?.has(s) ?? false,
    onTap: onSeatTap ? () => onSeatTap(s) : undefined,
    seconds: view.turn === s ? secondsLeft : null,
    owner: ownerOf?.(s),
    charges: arcade ? arcade.charges[s] ?? 0 : null,
    locked: !!arcade && playing && lockedFor(view, s) !== null,
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
    <div className={`table-screen table-redesign mode-${mode} ${arcade ? 'ruleset-arcade' : ''} ${props.presentation === 'classic' ? '' : 'table-focus'} ${look.className}`} style={look.style} onKeyDown={(e) => {
      if (e.key === 'Escape') { setPending(null); setChatOpen(false); setDraft(null); setPowersOpen(false); }
    }}>
      <header className="table-header">
        <div className="table-topbar">
          <button className="table-icon" onClick={() => setMenuOpen(true)} aria-label={t.settings}><ListIcon size={25} /></button>
          <h1 className="table-wordmark">CAPICÚA</h1>
          <button className="table-icon" aria-label={t.exit} onClick={() => {
            if (!playing) return onExit();
            if (props.onForfeit) return setLeaving(true);
            if (confirm(exitConfirm ?? t.exitConfirm)) onExit();
          }}><XIcon size={25} /></button>
        </div>
        <Scores view={view} mySeat={mySeat} name={name} colorOf={colorOf} pot={pot} watchers={watchers} watching={!!watching}
          onWatchersTap={props.onWatchersTap} unread={props.watchersUnread} />
      </header>

      <div className="table-rail"><div className="felt">
        {mode === '1v1' ? (
          <SeatBadge {...seatProps(rel(1))} pos="top" />
        ) : (
          <SeatBadge {...seatProps(rel(2))} pos="top" partnerLabel={mode === '2v2' ? t.partner : undefined} />
        )}
        {/* In pairs every seat carries its role on the same line, so the three stay level. */}
        {mode !== '1v1' && <>
          <SeatBadge {...seatProps(rel(3))} pos="left" partnerLabel={mode === '2v2' ? t.rival : undefined} />
          <SeatBadge {...seatProps(rel(1))} pos="right" partnerLabel={mode === '2v2' ? t.rival : undefined} />
        </>}

        {mode === '1v1' && (
          <div className={`boneyard ${view.boneyardCount === 0 ? 'empty' : ''}`} title={t.pile}>
            <span className="pile">{Array.from({ length: Math.min(view.boneyardCount, 5) }, (_, i) => <TileBack key={i} />)}</span>
            <small>{t.pile}: {view.boneyardCount}</small>
          </div>
        )}

        <div className="board-wrap">
          {props.sponsor && <SponsorMark sponsor={props.sponsor} />}
          {dv ? (
            <Board key={view.handNo} line={dv.line} origin={dv.origin} newestKey={null} targets={dv.sides} selected={dv.selected}
              ghostKeys={dv.ghosts} ownerOf={ownerOf} nameOf={name}
              lockedSide={dv.move?.type === 'play' && dv.move.lock ? dv.move.lock : arcade?.lock?.side ?? null}
              onPickSide={(side) => setDraft(draftPickSide(mine, mySeat, draft!, side))} />
          ) : (
            <Board key={view.handNo} line={view.line} origin={view.origin} newestKey={newestKey} targets={targets} selected={pending}
              ownerOf={ownerOf} nameOf={name} lockedSide={playing ? arcade?.lock?.side ?? null : null} onPickSide={(side) => {
              const move = myMoves.find((m) => m.type === 'play' && pending && sameTile(m.tile, pending) && m.side === side);
              if (move) play(move);
            }} />
          )}
        </div>

        {bonus && (
          <BonusPop
            key={bonus.key}
            title={bonus.kind === 'capicua' ? t.capicua : bonus.kind === 'paseSalida' ? t.paseSalida : t.paseCorrido}
            points={bonus.points}
            who={name(bonus.seat)}
            ours={sideOf(mode, bonus.seat) === mySide}
            onDone={() => setBonus(null)}
          />
        )}
        {bonus?.kind === 'capicua' && view.winner === null && sideOf(mode, bonus.seat) === mySide && <Confetti pieces={48} duration={1500} />}

        <div className={`self-seat ${bottomTurn ? 'active' : ''} ${speaking?.has(mySeat) ? 'speaking' : ''}`}>
          <div className="avatar">
            <Avatar name={name(mySeat)} url={avatars?.[mySeat]} />
            {bottomTurn && <TurnArrow />}
          </div>
          <b>{ownerOf && <OwnerChip role="me" />}{name(mySeat)}{arcade && <Charges n={arcade.charges[mySeat] ?? 0} label={t.arcade.charges} />}</b>
          {myBubble && <span className="self-bubble">{myBubble.text}</span>}
        </div>

      </div></div>

      <footer className={`my-area ${watching ? 'watching' : ''}`}>
        {powersOpen && arcade && (
          <PowersPanel state={mine} seat={mySeat} onPick={pickPower}
            onCallPass={() => { setPowersOpen(false); setPending(null); setCallArmed(true); }}
            onClose={() => setPowersOpen(false)} />
        )}
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
              const playable = dv ? dv.tiles.some((x) => sameTile(x, tile)) : myMoves.some((m) => m.type === 'play' && sameTile(m.tile, tile));
              const selected = dv ? dv.selected !== null && sameTile(dv.selected, tile) : pending !== null && sameTile(pending, tile);
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
        {dv && draft ? (
          <PowerBar draft={draft} view={dv} nameOf={name} nextName={name(((mySeat + 1) % n) as Seat)} busy={false}
            onTarget={(target) => setDraft({ ...(draft as Extract<Draft, { power: 'cambio' }>), target })}
            onHalf={(half) => setDraft({ ...(draft as Extract<Draft, { power: 'comodin' }>), half })}
            onLock={(lock) => setDraft({ ...(draft as Extract<Draft, { power: 'candado' }>), lock })}
            onConfirm={confirmDraft} onCancel={() => setDraft(null)} />
        ) : (
        <div className={`table-instruction ${notice || arcadeNotice || callArmed ? 'notice' : ''}`} role="status" aria-live="polite">
          {notice || arcadeNotice || (callArmed ? <Say long={t.arcade.callPass.armed} short={t.arcade.callPass.armedShort} /> : (
            // One inline run, so the 🔒 stays on the text's line instead of wrapping as its own item.
            <span>
              {lockNote && <Say long={lockNote} short="🔒 " />}
              {pending ? view.line.length === 0 ? (lang === 'es' ? 'Toca el centro para salir' : 'Tap the center to start') : copy.place
                : myTurn && myMoves.length > 0 ? (view.mustOpen ? status : copy.pick)
                : stuck ? <Say long={t.arcade.stuck} short={t.arcade.stuckShort} className="stuck-say" /> : status}
            </span>
          ))}
          {!notice && playing && secondsLeft !== null && <span className={secondsLeft <= 5 ? 'urgent' : ''}> · {secondsLeft} s</span>}
          {(pending || callArmed) && <button className="table-cancel" onClick={() => { setPending(null); setCallArmed(false); }} aria-label={t.cancel}><XIcon size={17} /></button>}
          {stuck && <button className="btn ghost table-pass" onClick={() => play({ type: 'pass' })} title={t.arcade.stuck}>{t.arcade.pass}</button>}
        </div>
        )}
        {watching ? (
          <div className="table-tools watch-tools">
            {watching.tools}
            <button className="btn ghost" onClick={watching.onLeave} aria-label={t.watch.stop}>{watching.tools ? t.watch.stopShort : t.watch.stop}</button>
          </div>
        ) : (
          <div className="table-tools">
            {voice ?? <span className="practice-voice" title={copy.practice}><MicrophoneSlashIcon size={25} /><small>{lang === 'es' ? 'Sin voz' : 'No voice'}</small></span>}
            {arcade && (
              <button className={`table-powers-button ${powersOpen ? 'on' : ''} ${stuck || (powersReady && !powersOpen) ? 'ready' : ''}`}
                onClick={() => { setChatOpen(false); setDraft(null); setCallArmed(false); setPowersOpen((o) => !o); }} aria-expanded={powersOpen} aria-controls="powers-panel"
                aria-label={`${t.arcade.powersBtn} · ${arcade.charges[mySeat] ?? 0}`}>
                <b aria-hidden>⚡{arcade.charges[mySeat] ?? 0}</b><span aria-hidden>{t.arcade.powersBtn}</span>
              </button>
            )}
            <button className={`table-chat-button ${chatOpen ? 'on' : ''}`} onClick={() => { setPowersOpen(false); setChatOpen((o) => !o); }} aria-expanded={chatOpen} aria-controls="table-chat"><ChatCircleDotsIcon size={28} weight="fill" /><span>{copy.chat}</span></button>
          </div>
        )}
      </footer>

      <dialog ref={menuRef} className="table-settings" onCancel={() => setMenuOpen(false)} onClose={() => setMenuOpen(false)}>
        <h2>{t.settings}</h2>
        <label>{t.language}<select value={lang} onChange={(e) => setLang(e.target.value as 'es' | 'en')}><option value="es">Español</option><option value="en">English</option></select></label>
        <label><span>{t.auto}<small>{t.autoplayHint}</small></span><input type="checkbox" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} /></label>
        <label><span>{t.showOwners}<small>{t.showOwnersHint}</small></span><input type="checkbox" checked={showOwners} onChange={(e) => setShowOwners(e.target.checked)} /></label>
        <label><span>{t.sfx}<small>{t.sfxHint}</small></span><input type="checkbox" checked={sfx} onChange={(e) => setSfx(e.target.checked)} /></label>
        {arcade && <button className="btn ghost" onClick={() => { setMenuOpen(false); setIntroOpen(true); }}>⚡ {t.arcade.intro.again}</button>}
        <LookPicker compact />
        {props.sponsor && <SponsorCredit sponsor={props.sponsor} onTap={props.onSponsorTap} />}
        <button className="btn primary" onClick={() => setMenuOpen(false)}>{copy.done}</button>
      </dialog>

      {showResult && view.handResult && view.winner === null && (
        <ResultSheet view={view} mySeat={mySeat} name={name} onNext={onNextHand} endActions={props.endActions} note={resultNote}
          readyUp={readyUp} watching={!!watching} />
      )}
      {showResult && view.winner !== null && (
        <GameOver view={view} mySeat={mySeat} name={name} endActions={props.endActions} note={resultNote} showXp={props.showXp && !arcade}
          credit={props.sponsor ? <SponsorCredit sponsor={props.sponsor} onTap={props.onSponsorTap} /> : undefined} />
      )}
      {introOpen && <ArcadeIntro onClose={() => setIntroOpen(false)} />}
      {leaving && props.onForfeit && (
        <div className="sheet-backdrop" onClick={() => setLeaving(false)}>
          <div className="sheet leave-sheet" role="dialog" aria-label={t.leaveSheet.title} onClick={(e) => e.stopPropagation()}>
            <h2>{t.leaveSheet.title}</h2>
            <button className="leave-choice" onClick={() => { setLeaving(false); onExit(); }}>
              <b>{t.leaveSheet.pause}</b>
              <small>{t.leaveSheet.pauseSub}</small>
            </button>
            <button className="leave-choice danger" onClick={() => { setLeaving(false); props.onForfeit!(); }}>
              <b>{t.leaveSheet.forfeit}</b>
              <small>{t.leaveSheet.forfeitSub.replace('{xp}', String(-LEAVER_XP))}</small>
            </button>
            <button className="btn primary" onClick={() => setLeaving(false)}>{t.leaveSheet.stay}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Scores({ view, mySeat, name, colorOf, pot, watchers, watching, onWatchersTap, unread = 0 }: {
  view: PublicState; mySeat: Seat; name: (s: Seat) => string; colorOf: (s: Seat) => string; pot?: number;
  watchers?: string[]; watching?: boolean; onWatchersTap?: () => void; unread?: number;
}) {
  const { t, lang } = useI18n();
  const mode = view.rules.mode;
  const mySide = sideOf(mode, mySeat);
  const run = placementRun(view.events, mode);
  const streakChip = (side: number) => run?.side === side ? (
    <small key={`${view.handNo}-${run.count}-${side}`} className="score-streak"
      title={lang === 'es' ? `${run.count} fichas seguidas de este equipo` : `${run.count} consecutive tiles from this team`}
      aria-label={lang === 'es' ? `Racha: ${run.count} fichas seguidas` : `Streak: ${run.count} consecutive tiles`}>
      🔥{run.count}
    </small>
  ) : null;
  const middle = (
    <div className="target">
      {t.to} {view.rules.target}
      <small>{t.hand} {view.handNo}{(watchers?.length || (watching && onWatchersTap)) ? (
        onWatchersTap ? (
          <button type="button" className="watchers watchers-btn" onClick={onWatchersTap}
            aria-label={`${t.spec.title}: ${watchers?.join(', ') ?? ''}${unread ? ` · ${unread}` : ''}`}>
            👁 {watchers?.length ?? 0}{unread > 0 && <i className="watchers-dot" aria-hidden />}
          </button>
        ) : <span className="watchers" title={`${t.watch.watchedBy}: ${watchers!.join(', ')}`} aria-label={`${t.watch.watchedBy}: ${watchers!.join(', ')}`}> · 👁 {watchers!.length}</span>
      ) : null}</small>
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
  const ourLabel = mode === '1v1' ? name(mySeat) : watching ? name(mySeat) : t.us;
  if (view.arcade) {
    return (
      <div className="scores arcade">
        <div className="score us"><span><i className="score-label">{ourLabel}</i>{streakChip(mySide)}</span><Stars n={view.scores[mySide]} label={ourLabel} /></div>
        <div className="target"><span className="arcade-label">⚡ ARCADE</span><small>{t.hand} {view.handNo}</small></div>
        <div className="score them"><span><i className="score-label">{theirLabel}</i>{streakChip(other)}</span><Stars n={view.scores[other]} label={theirLabel} /></div>
      </div>
    );
  }
  return (
    <div className="scores">
      <div className="score us"><span><i className="score-label">{ourLabel}</i>{streakChip(mySide)}</span><b key={view.scores[mySide]}>{view.scores[mySide]}</b></div>
      {middle}
      <div className="score them"><span><i className="score-label">{theirLabel}</i>{streakChip(other)}</span><b key={view.scores[other]}>{view.scores[other]}</b></div>
    </div>
  );
}

/** Why a tranque went the way it did: who blocked and who they were counted against (patio), or the pair totals (general). */
function TranqueWhy({ r, mySeat, name }: { r: HandResult; mySeat: Seat; name: (s: Seat) => string }) {
  const { t } = useI18n();
  const q = r.tranque!;
  if (q.rule === 'patio' && q.blocker !== undefined && q.versus !== undefined) {
    const line = q.blocker === mySeat ? t.tranquePatioMe : t.tranquePatio.replace('{a}', name(q.blocker));
    return <p className="note">{line.replace('{x}', String(r.counts[q.blocker]))
      .replace('{b}', q.versus === mySeat ? t.tranqueVsMe : name(q.versus)).replace('{y}', String(r.counts[q.versus]))}</p>;
  }
  if (q.rule === 'team') {
    const mine = sideOf('2v2', mySeat);
    const total = (side: number) => r.counts.reduce((a, c, p) => (sideOf('2v2', p) === side ? a + c : a), 0);
    return <p className="note">{t.tranqueTeam.replace('{us}', t.us).replace('{x}', String(total(mine)))
      .replace('{them}', t.them).replace('{y}', String(total(1 - mine)))}</p>;
  }
  return null;
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

/**
 * Extra points (capicúa, pase corrido, pase de salida) celebrated over the board. It never
 * takes a tap (the game goes on underneath) and leaves on its own.
 */
function BonusPop({ title, points, who, ours, onDone }: {
  title: string; points: number; who: string; ours: boolean; onDone: () => void;
}) {
  useEffect(() => {
    const id = setTimeout(onDone, BONUS_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="bonus-pop" role="status" aria-live="polite">
      <div className={`bonus-card ${ours ? 'ours' : 'theirs'}`} style={{ animationDuration: `${BONUS_MS}ms` }}>
        <b className="bonus-title">{title}</b>
        <span className="bonus-who">{points > 0 && <strong>+{points}</strong>}{who}</span>
      </div>
    </div>
  );
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

/**
 * A status message with a shorter wording for phones where the status shares its
 * row with the voice, powers and chat buttons (CSS picks one; both read the same).
 */
function Say({ long, short, className = '' }: { long: string; short: string; className?: string }) {
  return <><span className={`say-long ${className}`}>{long}</span><span className={`say-short ${className}`} aria-hidden>{short}</span></>;
}

function SeatBadge({
  name, avatar, level, color, count, active, bubble, pos, partnerLabel, speaking, away, offline, outOfApp, muted, onTap, seconds, owner,
  charges, locked,
}: {
  name: string; avatar?: string | null; level: number | null; color: string; count: number; active: boolean;
  bubble: { text: string; chat: boolean } | null; pos: 'top' | 'left' | 'right'; partnerLabel?: string;
  speaking: boolean; away: boolean; offline: boolean; outOfApp: boolean; muted: boolean; onTap?: () => void; seconds: number | null;
  owner?: OwnerRole;
  /** Arcade: power uses left (null outside Arcade). */
  charges?: number | null;
  /** Arcade: one end is closed for this player's turn. */
  locked?: boolean;
}) {
  const { t, lang } = useI18n();
  return (
    <div className={`seat seat-${pos} ${active ? 'active' : ''} ${speaking ? 'speaking' : ''} ${away ? 'away' : ''} ${offline || outOfApp ? 'offline' : ''} ${locked ? 'locked' : ''}`} style={{ '--seat-color': color } as CSSProperties}>
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
        {charges != null && <Charges n={charges} label={t.arcade.charges} />}
        {locked && <span className="offline-tag lock-tag">🔒 <span className="tag-text">{t.arcade.lockTag}</span></span>}
        {outOfApp
          ? <span className="offline-tag out-of-app">📵 <span className="tag-text">{t.fair.outTag}</span></span>
          : offline && <span className="offline-tag">📵 <span className="tag-text">{t.offline}</span></span>}
        <span className="seat-tiles" aria-label={`${count} ${count === 1 ? (lang === 'es' ? 'ficha' : 'tile') : (lang === 'es' ? 'fichas' : 'tiles')}`}>
          <span className="backs" aria-hidden>{Array.from({ length: Math.min(count, 7) }, (_, i) => <TileBack key={i} />)}</span>
          <b className="tile-count" aria-hidden>{count}</b>
        </span>
      </div>
      {bubble && <span className={`bubble ${bubble.chat ? 'chat' : ''}`}>{bubble.text}</span>}
    </div>
  );
}

export interface ReadyUp {
  ready: Set<Seat>;
  /** People at the table who haven't tapped "Listo" yet (bots and players who left don't count). */
  waiting: Seat[];
  /** Local timestamp when the next hand deals on its own. */
  deadline: number | null;
}

/** Seconds until `deadline`, ticking. */
function useCountdown(deadline: number | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline == null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);
  return deadline == null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}

function ResultSheet({
  view, mySeat, name, onNext, endActions, note, readyUp, watching,
}: {
  view: PublicState; mySeat: Seat; name: (s: Seat) => string; onNext: () => void; endActions: ReactNode; note?: ReactNode;
  readyUp?: ReadyUp; watching?: boolean;
}) {
  const { t } = useI18n();
  const [tapped, setTapped] = useState(false);
  const secs = useCountdown(readyUp?.deadline);
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
            {r.tranque && <TranqueWhy r={r} mySeat={mySeat} name={name} />}
            {r.tieToMano && <p className="note">{t.tieToMano}</p>}
          </>
        )}
        {view.arcade ? (
          <div className="gain arcade-gain">
            <span>{winnerLabel}</span>
            <b>⭐ {t.arcade.star}</b>
            <small className="arcade-running">
              {t.us} <Stars n={view.scores[mySide]} label={t.us} /> · {t.them} <Stars n={view.scores[mySide === 0 ? 1 : 0]} label={t.them} />
            </small>
            {view.events.some((e) => e.kind === 'earn' && e.reason === 'comeback') && (
              <small className="arcade-comeback">⚡ {t.arcade.comeback} {ours ? t.them : t.us}</small>
            )}
          </div>
        ) : (
          <div className="gain">
            <span>{winnerLabel}</span>
            <b>+{r.total}</b>
            {r.bonus > 0 && <small>{r.points} {t.points} + {r.bonus} {t.bonus}</small>}
          </div>
        )}
        {note}
        <ul className="reveal">
          {seats.map((s) => (
            <li key={s} className={sideOf(mode, s) === mySide ? 'us' : 'them'}>
              {readyUp?.ready.has(s) && <i className="rready" title={t.between.ready} aria-label={t.between.ready}>✓</i>}
              <span className="rname">{name(s)}</span>
              <span className="rtiles">
                {r.hands[s].map((tile) => <HandTile key={`${tile[0]}-${tile[1]}`} tile={tile} className="mini" />)}
              </span>
              <b>{r.counts[s]}</b>
            </li>
          ))}
        </ul>
        <Contributions view={view} mySeat={mySeat} name={name} />
        {over ? <div className="sheet-actions">{endActions}</div>
          : readyUp ? (() => {
            const iAmReady = tapped || readyUp.ready.has(mySeat);
            const others = readyUp.waiting.filter((s) => s !== mySeat || !iAmReady);
            const clock = secs != null && <small className="ready-clock">{t.between.auto.replace('{s}', String(secs))}</small>;
            if (watching || iAmReady) {
              return (
                <div className="ready-wait" role="status">
                  <b>{watching ? '' : `✓ ${t.between.ready} · `}{others.length ? t.between.waiting.replace('{names}', others.map(name).join(', ')) : t.between.dealing}</b>
                  {clock}
                </div>
              );
            }
            return (
              <button className="btn primary ready-btn" onClick={() => { setTapped(true); onNext(); }}>
                {t.between.ready}{secs != null && <span className="ready-secs" aria-label={t.between.auto.replace('{s}', String(secs))}>{secs}</span>}
              </button>
            );
          })()
          : !watching && <button className="btn primary" onClick={onNext}>{t.nextHand}</button>}
      </div>
    </div>
  );
}

/**
 * Who is carrying the game: points each player brought in (hands they closed, pase
 * corrido / de salida; Arcade: stars), tiles laid, passes, hands closed by dominó.
 * Games started before these counts existed simply don't show it.
 */
function Contributions({ view, mySeat, name }: { view: PublicState; mySeat: Seat; name: (s: Seat) => string }) {
  const { t } = useI18n();
  const st = view.seatStats;
  if (!st) return null;
  const mode = view.rules.mode;
  const mySide = sideOf(mode, mySeat);
  const seats = Array.from({ length: playerCount(mode) }, (_, i) => i as Seat);
  if (seats.every((s) => !st.tiles[s] && !st.points[s])) return null;
  const best = seats.reduce((b, s) => (st.points[s] > st.points[b] || (st.points[s] === st.points[b] && st.tiles[s] > st.tiles[b]) ? s : b), seats[0]);
  const hasMvp = st.points[best] > 0 && seats.filter((s) => st.points[s] === st.points[best] && st.tiles[s] === st.tiles[best]).length === 1;
  // Share of the points: of the team's in pairs, of everyone's otherwise.
  const pool = (s: Seat) => (mode === '2v2' ? view.scores[sideOf(mode, s)] : st.points.reduce((a, b) => a + b, 0));
  const share = (s: Seat) => (pool(s) > 0 ? Math.round((100 * st.points[s]) / pool(s)) : 0);
  return (
    <table className="contrib">
      <caption>{t.between.title}</caption>
      <thead>
        <tr>
          <th scope="col"><span className="sr-only">{t.players}</span></th>
          <th scope="col">{view.arcade ? t.between.stars : t.between.points}</th>
          <th scope="col">{t.between.tiles}</th>
          <th scope="col">{t.between.passes}</th>
          <th scope="col">{t.between.dominoes}</th>
        </tr>
      </thead>
      <tbody>
        {seats.map((s) => (
          <tr key={s} className={`${sideOf(mode, s) === mySide ? 'us' : 'them'} ${hasMvp && s === best ? 'mvp' : ''}`}>
            <th scope="row">
              <span className="cname">
                {hasMvp && s === best && <span className="mvp-star" title={t.between.mvp} aria-label={t.between.mvp}>⭐</span>}
                {name(s)}
                {st.capicuas[s] > 0 && <small className="ccap" title={`${st.capicuas[s]} ${t.between.capicuas}`}>✨{st.capicuas[s]}</small>}
              </span>
              <span className="cbar" title={t.between.share.replace('{p}', String(share(s)))}><i style={{ width: `${share(s)}%` }} /></span>
            </th>
            <td><b>{st.points[s]}</b></td>
            <td>{st.tiles[s]}</td>
            <td>{st.passes[s]}</td>
            <td>{st.dominoes[s]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** End of the game: celebration (or commiseration) plus a summary of how it went. */
function GameOver({ view, mySeat, name, endActions, note, showXp, credit }: {
  view: PublicState; mySeat: Seat; name: (s: Seat) => string; endActions: ReactNode; note?: ReactNode; showXp?: boolean;
  /** "Mesa patrocinada por…" */
  credit?: ReactNode;
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
              {view.arcade ? <Stars n={x.score} label={sideName(x.side)} /> : <b>{x.score}</b>}
            </li>
          ))}
        </ol>

        <div className="go-stats">
          <div><b>{view.handNo}</b><small>{t.summary.hands}</small></div>
          <div><b>{capicuas}<em> / {theirCapicuas}</em></b><small>{t.stats.capicuas}</small></div>
          <div><b>{view.tally.tranques[mySide]}</b><small>{t.summary.tranquesWon}</small></div>
          <div><b>{view.tally.hands[mySide]}</b><small>{t.summary.handsWon}</small></div>
        </div>

        <Contributions view={view} mySeat={mySeat} name={name} />

        <div className="go-rewards">
          {showXp && <div className="reward xp"><span>⭐</span><b>+{xp} XP</b></div>}
          {note}
        </div>

        <div className="sheet-actions">{endActions}</div>
        {credit}
      </div>
    </div>
  );
}

import type { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Mode, Rules, Seat, Tile } from '../../supabase/functions/_shared/domino.ts';
import type { PublicState, SideBetKind } from '../../supabase/functions/_shared/table.ts';
import { playPhrase, type PhraseId } from '../quickchat';
import { OUT_OF_APP_MS, type TableAlert } from './fairPlay';
import type { ChatBubbles } from '../ui/TableView';
import { loadSharedRoom, ShareError, type SharedRoomInfo } from './shareMatch';
import { onlineEnabled, supabase } from './supabase';

export interface RoomRow {
  id: string;
  code: string;
  kind: 'public' | 'custom' | 'tournament';
  mode: Mode;
  rules: Rules;
  stake: number;
  turn_seconds: number;
  visibility: 'public' | 'private';
  host: string | null;
  phase: 'lobby' | 'ready' | 'countdown' | 'playing' | 'finished';
  phase_ends_at: string | null;
  current_game: string | null;
  /** Set on a tournament match's table. */
  tournament_id: string | null;
}

export interface SeatRow {
  seat: Seat;
  user_id: string | null;
  is_bot: boolean;
  name: string;
  level: number;
  ready: boolean;
  away: boolean;
  left_game: boolean;
}

export interface GameRow {
  id: string;
  public_state: PublicState;
  version: number;
  stake: number;
  pot: number;
  turn_ms: number;
  auto_delay_ms: number | null;
  settled: boolean;
  /** The sponsor printed on this table's felt. */
  sponsor_id?: string | null;
}

export interface SideBetRow {
  kind: SideBetKind;
  amount: number;
  multiplier: number;
  status: 'open' | 'won' | 'lost' | 'refunded';
  payout: number;
  game_id: string | null;
}

const ROOM_COLS = 'id, code, kind, mode, rules, stake, turn_seconds, visibility, host, phase, phase_ends_at, current_game, tournament_id';
const SEAT_COLS = 'seat, user_id, is_bot, name, level, ready, away, left_game';
const GAME_COLS = 'id, public_state, version, stake, pot, turn_ms, auto_delay_ms, settled, sponsor_id';

export interface RoomOptions {
  /**
   * Watching through a share link: the table comes from shared_room() (no join code),
   * the game is the link's own, there are no tiles, bets or alerts of mine to load, and
   * this screen doesn't add itself to the table's presence. Checked again every 20 s,
   * which also keeps the viewer counted; `gone` once the link stops opening the game.
   */
  shared?: boolean;
}

/** Link viewers re-check the link (and get counted) this often. */
const SHARED_REFRESH_MS = 20_000;

/**
 * Live view of one table: room, seats, the current game, my own tiles, my
 * side bets, and sound-button chatter. Reads go straight to Postgres
 * (RLS-scoped); changes arrive over Realtime, and a full reload runs whenever
 * the connection (re)subscribes or the tab comes back into view.
 */
export function useRoom(roomId: string, uid: string, opts: RoomOptions = {}) {
  const shared = !!opts.shared;
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [seats, setSeats] = useState<SeatRow[]>([]);
  const [game, setGame] = useState<GameRow | null>(null);
  const [hand, setHand] = useState<Tile[]>([]);
  const [bets, setBets] = useState<SideBetRow[]>([]);
  const [chat, setChat] = useState<ChatBubbles>({});
  const [gone, setGone] = useState(false);
  /** User ids with this table open right now (Realtime presence). */
  const [online, setOnline] = useState<Set<string>>(new Set());
  /** …and which of them are on the table's voice chat (shared through presence, so others see it before joining). */
  const [inVoice, setInVoice] = useState<Set<string>>(new Set());
  const myVoice = useRef(false);
  /** Local time the current game row arrived — turn timers count from here (no clock skew). */
  const [receivedAt, setReceivedAt] = useState(0);
  /** Fair play: each player's latest "left the app / came back / screenshot", and the newest one to announce. */
  const [alerts, setAlerts] = useState<Record<string, TableAlert>>({});
  const [lastAlert, setLastAlert] = useState<TableAlert | null>(null);
  /** Realtime link: 'live' once subscribed, 'reconnecting' while it (or the phone's connection) is down. */
  const [status, setStatus] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  /** Link viewers: what shared_room() adds (players' photos, link watchers, when the link ends). */
  const [sharedInfo, setSharedInfo] = useState<SharedRoomInfo | null>(null);

  const gameId = useRef<string | null>(null);
  const version = useRef(-1);
  const channel = useRef<RealtimeChannel | null>(null);

  const acceptGame = useCallback((g: GameRow) => {
    if (g.id === gameId.current && g.version <= version.current) return;
    gameId.current = g.id;
    version.current = g.version;
    setGame({ ...g, pot: Number(g.pot) });
    setReceivedAt(Date.now());
  }, []);

  const loadGame = useCallback(async (id: string) => {
    const [{ data: g }, { data: h }] = await Promise.all([
      supabase.from('games').select(GAME_COLS).eq('id', id).maybeSingle(),
      shared ? Promise.resolve({ data: null }) : supabase.from('game_hands').select('tiles').eq('game_id', id).eq('user_id', uid).maybeSingle(),
    ]);
    if (g) acceptGame(g as GameRow);
    setHand((h?.tiles as Tile[]) ?? []);
  }, [acceptGame, uid, shared]);

  const loadSeats = useCallback(async () => {
    const { data } = await supabase.from('room_seats').select(SEAT_COLS).eq('room_id', roomId).order('seat');
    if (data) setSeats(data as SeatRow[]);
  }, [roomId]);

  /** After a reload: who is still out of the app (no announcement for old news). */
  const loadAlerts = useCallback(async (id: string) => {
    if (shared) return;
    const { data } = await supabase.from('table_alerts').select('id, user_id, seat, kind, seconds, created_at')
      .eq('game_id', id).gte('created_at', new Date(Date.now() - OUT_OF_APP_MS).toISOString()).order('id');
    const latest: Record<string, TableAlert> = {};
    for (const a of data ?? []) latest[a.user_id] = { ...a, at: Date.parse(a.created_at) } as TableAlert;
    setAlerts(latest);
  }, [shared]);

  const loadBets = useCallback(async () => {
    if (shared) return;
    const { data } = await supabase.from('side_bets').select('kind, amount, multiplier, status, payout, game_id').eq('room_id', roomId).eq('user_id', uid);
    if (data) setBets(data.map((b) => ({ ...b, multiplier: Number(b.multiplier), payout: Number(b.payout) })) as SideBetRow[]);
  }, [roomId, uid, shared]);

  /** Link viewers: the table through shared_room(); null when it can't be read right now. */
  const loadSharedTable = useCallback(async (): Promise<RoomRow | null> => {
    try {
      const info = await loadSharedRoom(roomId);
      setSharedInfo(info);
      // The link's own game — never whatever the table moved on to.
      return { ...info.room, current_game: info.game_id, code: '', visibility: 'private', host: null, phase_ends_at: null };
    } catch (e) {
      if (e instanceof ShareError && e.code === 'link_gone') setGone(true);
      return null;
    }
  }, [roomId]);

  const loadAll = useCallback(async () => {
    let data: RoomRow | null;
    if (shared) {
      data = await loadSharedTable();
      if (!data) return;
    } else {
      data = (await supabase.from('rooms').select(ROOM_COLS).eq('id', roomId).maybeSingle()).data as RoomRow | null;
      if (!data) {
        setGone(true);
        return;
      }
    }
    setRoom(data);
    await Promise.all([loadSeats(), loadBets()]);
    if (data.current_game) {
      if (data.current_game !== gameId.current) version.current = -1;
      await Promise.all([loadGame(data.current_game), loadAlerts(data.current_game)]);
    } else {
      gameId.current = null;
      setGame(null);
      setHand([]);
    }
  }, [roomId, shared, loadSharedTable, loadSeats, loadBets, loadGame, loadAlerts]);

  useEffect(() => {
    const ch = supabase
      .channel(`room:${roomId}`, { config: { broadcast: { self: false }, presence: { key: uid } } })
      .on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState<{ voice?: boolean }>();
        setOnline(new Set(Object.keys(state)));
        setInVoice(new Set(Object.entries(state).filter(([, metas]) => metas.some((m) => m.voice)).map(([id]) => id)));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, (p) => {
        if (p.eventType === 'DELETE') return setGone(true);
        loadAll();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_seats', filter: `room_id=eq.${roomId}` }, loadSeats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'side_bets', filter: `user_id=eq.${uid}` }, loadBets)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `room_id=eq.${roomId}` }, (p) => {
        const row = p.new as GameRow;
        if (row.id !== gameId.current) return;
        // Updates that didn't touch the (large) public_state arrive without it.
        if (row.public_state) acceptGame(row);
        else loadGame(row.id);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_hands', filter: `user_id=eq.${uid}` }, (p) => {
        const row = p.new as { game_id: string; tiles: Tile[] };
        if (row.game_id === gameId.current && row.tiles) setHand(row.tiles);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'table_alerts', filter: `room_id=eq.${roomId}` }, (p) => {
        const a = { ...(p.new as Omit<TableAlert, 'at'>), at: Date.now() };
        setAlerts((all) => ({ ...all, [a.user_id]: a }));
        setLastAlert(a);
      })
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        const { seat, id } = payload as { seat: Seat; id: PhraseId };
        setChat((c) => ({ ...c, [seat]: { id, at: Date.now() } }));
        playPhrase(id, seat);
      })
      .subscribe((s) => {
        if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') setStatus('reconnecting');
        if (s !== 'SUBSCRIBED') return;
        setStatus(navigator.onLine === false ? 'reconnecting' : 'live');
        loadAll();
        // A link viewer isn't one of the table's people: it doesn't show up in its presence.
        if (!shared) ch.track({ at: Date.now(), voice: myVoice.current });
      });
    channel.current = ch;

    const onVisible = () => document.visibilityState === 'visible' && loadAll();
    const onOffline = () => setStatus('reconnecting');
    const onOnline = () => { setStatus('live'); loadAll(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    const every = shared ? setInterval(loadAll, SHARED_REFRESH_MS) : undefined;
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      clearInterval(every);
      supabase.removeChannel(ch);
    };
  }, [roomId, uid, shared, loadAll, loadSeats, loadBets, loadGame, acceptGame]);

  const sendChat = useCallback((seat: Seat, id: PhraseId) => {
    setChat((c) => ({ ...c, [seat]: { id, at: Date.now() } }));
    playPhrase(id, seat);
    channel.current?.send({ type: 'broadcast', event: 'chat', payload: { seat, id } });
  }, []);

  /** Tell the table whether I'm on voice. */
  const setVoicePresence = useCallback((on: boolean) => {
    if (myVoice.current === on) return;
    myVoice.current = on;
    channel.current?.track({ at: Date.now(), voice: on });
  }, []);

  return { room, seats, game, hand, bets, chat, gone, online, inVoice, receivedAt, alerts, lastAlert, status, sharedInfo, sendChat, setVoicePresence, reload: loadAll };
}

export type RoomData = ReturnType<typeof useRoom>;

export interface PlayerStats {
  id: string;
  display_name: string;
  xp: number;
  games: number;
  wins: number;
  capicuas: number;
  pollonas: number;
  biggest_pot: number;
  tournaments_won: number;
  avatar_url: string | null;
  /** Chip balance (missing on placeholder cards until the profile loads). */
  chips?: number;
  /** Their player code — the same one friends use to add them. */
  friend_code?: string;
}

/** Public profile stats for the people at a table (for lobby cards). */
export function usePlayerStats(ids: string[]) {
  const [stats, setStats] = useState<Record<string, PlayerStats>>({});
  const key = [...ids].sort().join(',');
  useEffect(() => {
    if (!key || !onlineEnabled) return;
    supabase.from('profiles').select('id, display_name, xp, games, wins, capicuas, pollonas, biggest_pot, tournaments_won, avatar_url, chips, friend_code').in('id', key.split(','))
      .then(({ data }) => data && setStats(Object.fromEntries(data.map((p) => [p.id, { ...p, biggest_pot: Number(p.biggest_pot), chips: Number(p.chips) } as PlayerStats]))));
  }, [key]);
  return stats;
}

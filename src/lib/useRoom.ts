import type { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Mode, Rules, Seat, Tile } from '../../supabase/functions/_shared/domino.ts';
import type { PublicState, SideBetKind } from '../../supabase/functions/_shared/table.ts';
import { playPhrase, type PhraseId } from '../quickchat';
import type { ChatBubbles } from '../ui/TableView';
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
const GAME_COLS = 'id, public_state, version, stake, pot, turn_ms, auto_delay_ms, settled';

/**
 * Live view of one table: room, seats, the current game, my own tiles, my
 * side bets, and sound-button chatter. Reads go straight to Postgres
 * (RLS-scoped); changes arrive over Realtime, and a full reload runs whenever
 * the connection (re)subscribes or the tab comes back into view.
 */
export function useRoom(roomId: string, uid: string) {
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
      supabase.from('game_hands').select('tiles').eq('game_id', id).eq('user_id', uid).maybeSingle(),
    ]);
    if (g) acceptGame(g as GameRow);
    setHand((h?.tiles as Tile[]) ?? []);
  }, [acceptGame, uid]);

  const loadSeats = useCallback(async () => {
    const { data } = await supabase.from('room_seats').select(SEAT_COLS).eq('room_id', roomId).order('seat');
    if (data) setSeats(data as SeatRow[]);
  }, [roomId]);

  const loadBets = useCallback(async () => {
    const { data } = await supabase.from('side_bets').select('kind, amount, multiplier, status, payout, game_id').eq('room_id', roomId).eq('user_id', uid);
    if (data) setBets(data.map((b) => ({ ...b, multiplier: Number(b.multiplier), payout: Number(b.payout) })) as SideBetRow[]);
  }, [roomId, uid]);

  const loadAll = useCallback(async () => {
    const { data } = await supabase.from('rooms').select(ROOM_COLS).eq('id', roomId).maybeSingle();
    if (!data) {
      setGone(true);
      return;
    }
    setRoom(data as RoomRow);
    await Promise.all([loadSeats(), loadBets()]);
    if (data.current_game) {
      if (data.current_game !== gameId.current) version.current = -1;
      await loadGame(data.current_game);
    } else {
      gameId.current = null;
      setGame(null);
      setHand([]);
    }
  }, [roomId, loadSeats, loadBets, loadGame]);

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
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        const { seat, id } = payload as { seat: Seat; id: PhraseId };
        setChat((c) => ({ ...c, [seat]: { id, at: Date.now() } }));
        playPhrase(id, seat);
      })
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        loadAll();
        ch.track({ at: Date.now(), voice: myVoice.current });
      });
    channel.current = ch;

    const onVisible = () => document.visibilityState === 'visible' && loadAll();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(ch);
    };
  }, [roomId, uid, loadAll, loadSeats, loadBets, loadGame, acceptGame]);

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

  return { room, seats, game, hand, bets, chat, gone, online, inVoice, receivedAt, sendChat, setVoicePresence, reload: loadAll };
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
}

/** Public profile stats for the people at a table (for lobby cards). */
export function usePlayerStats(ids: string[]) {
  const [stats, setStats] = useState<Record<string, PlayerStats>>({});
  const key = [...ids].sort().join(',');
  useEffect(() => {
    if (!key || !onlineEnabled) return;
    supabase.from('profiles').select('id, display_name, xp, games, wins, capicuas, pollonas, biggest_pot, tournaments_won, avatar_url').in('id', key.split(','))
      .then(({ data }) => data && setStats(Object.fromEntries(data.map((p) => [p.id, { ...p, biggest_pot: Number(p.biggest_pot) } as PlayerStats]))));
  }, [key]);
  return stats;
}

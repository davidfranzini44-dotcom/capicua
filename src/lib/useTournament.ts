import { useCallback, useEffect, useState } from 'react';
import type { Rules } from '../../supabase/functions/_shared/domino.ts';
import type { Seeding, TournamentMode, Visibility } from '../../supabase/functions/_shared/tournament.ts';
import { onlineEnabled, supabase } from './supabase';

export interface TournamentRow {
  id: string;
  code: string;
  name: string;
  host: string;
  mode: TournamentMode;
  size: number;
  buy_in: number;
  rules: Rules;
  turn_seconds: number;
  phase: 'lobby' | 'playing' | 'finished' | 'cancelled';
  rounds: number | null;
  pot: number;
  champion: string | null;
  /** Scheduled start (ISO); null on older tournaments the host starts by hand. */
  starts_at: string | null;
  cancel_reason: 'host' | 'not_enough' | null;
  /** How the first round is matched. */
  seeding: Seeding;
  /** Public: listed in Mesas → Torneos abiertos. */
  visibility: Visibility;
  /** Made by an admin: "Capicúa" organizes it and the admin doesn't play. */
  official: boolean;
  /** On the home screen. */
  featured: boolean;
  /** The house's part of the pot (official tournaments). */
  prize: number;
  description: string | null;
}

/** A first-round match fixed before the draw: a players' pick, or an admin's. */
export interface PairRow { entry_a: string; entry_b: string; set_by: 'player' | 'admin' }

export interface EntryRow {
  id: string;
  player1: string;
  player2: string | null;
  eliminated_round: number | null;
  placement: number | null;
}

export interface MatchRow {
  id: string;
  round: number;
  slot: number;
  entry_a: string | null;
  entry_b: string | null;
  room_id: string | null;
  winner: string | null;
  status: 'waiting' | 'ready' | 'playing' | 'done';
  result: 'played' | 'bye' | 'forfeit' | 'no_show' | null;
  ready_by: string | null;
}

/** What an invite shows before joining (from the game function; non-members can't read the tables). */
export interface TournamentPeek {
  id: string;
  code: string;
  name: string;
  mode: TournamentMode;
  size: number;
  buyIn: number;
  phase: TournamentRow['phase'];
  target: number;
  host: string;
  pot: number;
  startsAt: string | null;
  seeding?: Seeding;
  member: boolean;
  entries: { id: string; names: string[]; open: boolean }[];
  /** From a server newer than 7ab6646 (open tournaments). */
  turnSeconds?: number;
  visibility?: Visibility;
  official?: boolean;
  prize?: number;
  description?: string | null;
}

const T_COLS = 'id, code, name, host, mode, size, buy_in, rules, turn_seconds, phase, rounds, pot, champion, starts_at, cancel_reason, seeding, visibility, official, featured, prize, description';

/**
 * Live view of one tournament for its members: settings, sign-ups, the
 * bracket and everyone's names. `missing` = not a member (or no such
 * tournament) — show the invite preview instead.
 */
export function useTournament(id: string | null) {
  const [t, setT] = useState<TournamentRow | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  /** Who has checked in (scheduled tournaments, during the 15 minutes before the start). */
  const [checkins, setCheckins] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});
  /** Everyone's XP (for matching by experience). */
  const [xp, setXp] = useState<Record<string, number>>({});
  const [pairs, setPairs] = useState<PairRow[]>([]);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: tr }, { data: es }, { data: ms }, { data: cs }, { data: ps0 }] = await Promise.all([
      supabase.from('tournaments').select(T_COLS).eq('id', id).maybeSingle(),
      supabase.from('tournament_entries').select('id, player1, player2, eliminated_round, placement').eq('tournament_id', id).order('created_at'),
      supabase.from('tournament_matches').select('id, round, slot, entry_a, entry_b, room_id, winner, status, result, ready_by')
        .eq('tournament_id', id).order('round').order('slot'),
      supabase.from('tournament_checkins').select('user_id').eq('tournament_id', id),
      supabase.from('tournament_pairs').select('entry_a, entry_b, set_by').eq('tournament_id', id).order('created_at'),
    ]);
    if (!tr) return setMissing(true);
    setMissing(false);
    setT({ ...tr, pot: Number(tr.pot), prize: Number(tr.prize ?? 0) } as TournamentRow);
    setEntries((es ?? []) as EntryRow[]);
    setMatches((ms ?? []) as MatchRow[]);
    setCheckins(new Set((cs ?? []).map((c) => c.user_id as string)));
    setPairs((ps0 ?? []) as PairRow[]);
    const ids = [...new Set([tr.host, ...(es ?? []).flatMap((e) => [e.player1, e.player2])].filter(Boolean))] as string[];
    const { data: ps } = await supabase.from('profiles').select('id, display_name, xp').in('id', ids);
    setNames(Object.fromEntries((ps ?? []).map((p) => [p.id, p.display_name])));
    setXp(Object.fromEntries((ps ?? []).map((p) => [p.id, Number(p.xp ?? 0)])));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`tournament:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_entries', filter: `tournament_id=eq.${id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_matches', filter: `tournament_id=eq.${id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_checkins', filter: `tournament_id=eq.${id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_pairs', filter: `tournament_id=eq.${id}` }, load)
      .subscribe((status) => status === 'SUBSCRIBED' && load());
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(ch);
    };
  }, [id, load]);

  return { t, entries, matches, checkins, names, xp, pairs, missing, reload: load };
}

/** Tournaments I'm in or host, newest first (cancelled ones hidden). */
export function useMyTournaments(uid: string | undefined) {
  const [list, setList] = useState<TournamentRow[] | null>(null);
  useEffect(() => {
    if (!uid) return;
    (async () => {
      const [{ data: es }, { data: hosted }] = await Promise.all([
        supabase.from('tournament_entries').select('tournament_id').or(`player1.eq.${uid},player2.eq.${uid}`),
        supabase.from('tournaments').select('id').eq('host', uid),
      ]);
      const ids = [...new Set([...(es ?? []).map((e) => e.tournament_id as string), ...(hosted ?? []).map((x) => x.id as string)])];
      if (!ids.length) return setList([]);
      const { data } = await supabase.from('tournaments').select(T_COLS).in('id', ids).neq('phase', 'cancelled')
        .order('created_at', { ascending: false }).limit(20);
      setList((data ?? []).map((x) => ({ ...x, pot: Number(x.pot), prize: Number(x.prize) }) as TournamentRow));
    })();
  }, [uid]);
  return list;
}

/** A public tournament still taking sign-ups, as anyone may see it (migration 20261016000000). */
export interface PublicTournament {
  id: string;
  code: string;
  name: string;
  mode: TournamentMode;
  size: number;
  buy_in: number;
  prize: number;
  pot: number;
  starts_at: string | null;
  seeding: Seeding;
  official: boolean;
  featured: boolean;
  /** "Capicúa" for official ones. */
  host: string;
  description: string | null;
  people: number;
  capacity: number;
  /** I'm signed up (or organize it). */
  member: boolean;
}

/**
 * Public tournaments taking sign-ups, soonest first (official and featured on top): all of them
 * for Mesas → Torneos abiertos, or only the ones an admin put on the home screen. Refreshed every
 * minute and when the app comes back to the front. Null while loading.
 */
export function usePublicTournaments(featuredOnly: boolean, enabled = true): PublicTournament[] | null {
  const [list, setList] = useState<PublicTournament[] | null>(null);
  useEffect(() => {
    if (!enabled || !onlineEnabled) return;
    let live = true;
    const load = () => {
      supabase.rpc('public_tournaments', { p_featured_only: featuredOnly }).then(({ data, error }) => {
        if (!live) return;
        // An older database without the function: nothing to show.
        setList(error ? [] : ((data ?? []) as PublicTournament[]).map((x) => ({ ...x, pot: Number(x.pot), prize: Number(x.prize) })));
      }, () => { if (live) setList([]); });
    };
    load();
    const every = setInterval(load, 60_000);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      clearInterval(every);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [featuredOnly, enabled]);
  return list;
}

/** One tournament someone played, as their history lists it (migration 20261013000000). */
export interface TournamentHistoryRow {
  id: string;
  name: string;
  mode: TournamentMode;
  size: number;
  rounds: number | null;
  pot: number;
  finished_at: string;
  placement: number | null;
  eliminated_round: number | null;
  /** Players or pairs that took part. */
  entries: number;
  partner: string | null;
  /** The winner's name(s); null when nobody played the final. */
  champion: string | null;
}

/** A player's finished tournaments, newest first (null while loading). */
export function useTournamentHistory(userId: string | null | undefined): TournamentHistoryRow[] | null {
  const [rows, setRows] = useState<{ user: string; list: TournamentHistoryRow[] } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    supabase.rpc('tournament_history', { p_user: userId }).then(({ data }) => {
      if (live) setRows({ user: userId, list: ((data ?? []) as TournamentHistoryRow[]).map((r) => ({ ...r, pot: Number(r.pot) })) });
    }, () => { if (live) setRows({ user: userId, list: [] }); });
    return () => { live = false; };
  }, [userId]);
  return rows && rows.user === userId ? rows.list : null;
}

/** For a tournament table: the tournament's name and whether this match is its final. */
export function useTournamentMatch(roomId: string, tournamentId: string | null): { name: string; final: boolean } | null {
  const [info, setInfo] = useState<{ room: string; name: string; final: boolean } | null>(null);
  useEffect(() => {
    if (!tournamentId) return;
    let live = true;
    Promise.all([
      supabase.from('tournament_matches').select('round').eq('room_id', roomId).maybeSingle(),
      supabase.from('tournaments').select('name, rounds').eq('id', tournamentId).maybeSingle(),
    ]).then(([m, tr]) => {
      if (!live || !tr.data) return;
      setInfo({ room: roomId, name: tr.data.name as string, final: !!m.data && m.data.round === tr.data.rounds });
    }, () => {});
    return () => { live = false; };
  }, [roomId, tournamentId]);
  return info?.room === roomId ? { name: info.name, final: info.final } : null;
}

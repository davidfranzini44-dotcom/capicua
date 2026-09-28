import { useCallback, useEffect, useState } from 'react';
import type { Rules } from '../../supabase/functions/_shared/domino.ts';
import type { TournamentMode } from '../../supabase/functions/_shared/tournament.ts';
import { supabase } from './supabase';

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
}

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
  member: boolean;
  entries: { id: string; names: string[]; open: boolean }[];
}

const T_COLS = 'id, code, name, host, mode, size, buy_in, rules, turn_seconds, phase, rounds, pot, champion, starts_at, cancel_reason';

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
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: tr }, { data: es }, { data: ms }, { data: cs }] = await Promise.all([
      supabase.from('tournaments').select(T_COLS).eq('id', id).maybeSingle(),
      supabase.from('tournament_entries').select('id, player1, player2, eliminated_round, placement').eq('tournament_id', id).order('created_at'),
      supabase.from('tournament_matches').select('id, round, slot, entry_a, entry_b, room_id, winner, status, result, ready_by')
        .eq('tournament_id', id).order('round').order('slot'),
      supabase.from('tournament_checkins').select('user_id').eq('tournament_id', id),
    ]);
    if (!tr) return setMissing(true);
    setMissing(false);
    setT({ ...tr, pot: Number(tr.pot) } as TournamentRow);
    setEntries((es ?? []) as EntryRow[]);
    setMatches((ms ?? []) as MatchRow[]);
    setCheckins(new Set((cs ?? []).map((c) => c.user_id as string)));
    const ids = [...new Set([tr.host, ...(es ?? []).flatMap((e) => [e.player1, e.player2])].filter(Boolean))] as string[];
    const { data: ps } = await supabase.from('profiles').select('id, display_name').in('id', ids);
    setNames(Object.fromEntries((ps ?? []).map((p) => [p.id, p.display_name])));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`tournament:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_entries', filter: `tournament_id=eq.${id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_matches', filter: `tournament_id=eq.${id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_checkins', filter: `tournament_id=eq.${id}` }, load)
      .subscribe((status) => status === 'SUBSCRIBED' && load());
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(ch);
    };
  }, [id, load]);

  return { t, entries, matches, checkins, names, missing, reload: load };
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
      setList((data ?? []).map((x) => ({ ...x, pot: Number(x.pot) }) as TournamentRow));
    })();
  }, [uid]);
  return list;
}

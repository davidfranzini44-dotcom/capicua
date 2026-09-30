-- How a tournament's first round is matched, and fixing it (the owner's call, 2026-09-29):
--   * the host picks at creation (and may change before the start): a draw ('random'), by
--     experience — most XP plays least ('xp') — or the players pick their opponents ('pick');
--   * the host edits name, start time, target, timer and that choice before the start, but
--     never sets matches by hand; an app admin can edit anything and fix any match;
--   * admins see every tournament, so they can open one and fix it.
-- The draw itself happens in the `game` function at the start (drawFirstRound).

alter table public.tournaments add column seeding text not null default 'random'
  check (seeding in ('random', 'xp', 'pick'));

-- First-round matches fixed before the draw: players' picks ('pick' tournaments) or an
-- admin's. The draw keeps as many as the bracket can hold, admins' first.
create table public.tournament_pairs (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  entry_a uuid not null references public.tournament_entries (id) on delete cascade,
  entry_b uuid not null references public.tournament_entries (id) on delete cascade,
  set_by text not null check (set_by in ('player', 'admin')),
  created_at timestamptz not null default now(),
  primary key (tournament_id, entry_a, entry_b),
  check (entry_a <> entry_b)
);
alter table public.tournament_pairs enable row level security;
revoke all on public.tournament_pairs from anon;
create policy "members see the fixed matches" on public.tournament_pairs for select to authenticated
  using (public.is_tournament_member(tournament_id));
alter publication supabase_realtime add table public.tournament_pairs;

-- Members = the host and everyone entered — and the app's admins, who may fix any tournament.
create or replace function public.is_tournament_member(p_tournament uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tournaments where id = p_tournament and host = auth.uid())
      or exists (select 1 from tournament_entries where tournament_id = p_tournament and auth.uid() in (player1, player2))
      or public.is_admin();
$$;

-- …and may watch any of its matches too.
create or replace function public.watch_tournament_match(p_room uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_tournament uuid;
  v_focus uuid;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  select r.tournament_id into v_tournament from public.rooms r where r.id = p_room and r.kind = 'tournament';
  if v_tournament is null then raise exception 'not_a_tournament_match'; end if;
  if not (exists (select 1 from public.tournaments where id = v_tournament and host = v_uid)
          or exists (select 1 from public.tournament_entries
                     where tournament_id = v_tournament and v_uid in (player1, player2))
          or public.is_admin()) then
    raise exception 'not_in_tournament';
  end if;
  if exists (select 1 from public.room_seats where room_id = p_room and user_id = v_uid) then
    raise exception 'already_in_room';
  end if;
  select s.user_id into v_focus from public.room_seats s
  where s.room_id = p_room and s.user_id is not null and not s.is_bot
  order by s.seat limit 1;
  if v_focus is null then raise exception 'friend_not_playing'; end if;
  insert into public.room_spectators (room_id, user_id) values (p_room, v_uid)
  on conflict (room_id, user_id) do update set expires_at = now() + interval '6 hours';
  return jsonb_build_object('room_id', p_room, 'focus', v_focus,
    'name', (select display_name from public.profiles where id = v_focus));
end;
$$;

-- Watching a friend's game. A friend of someone seated at a table can watch
-- it: they read the table, the seats and the public game state (the board,
-- scores, tile counts) — never anyone's hand, which stays owner-only. The
-- players can see who is watching.

create table public.room_spectators (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '6 hours',
  primary key (room_id, user_id)
);
create index room_spectators_user on public.room_spectators (user_id);
alter table public.room_spectators enable row level security;
create policy "players and the watcher see who is watching" on public.room_spectators for select to authenticated
  using (user_id = auth.uid() or public.is_room_member(room_id));

create function public.is_room_viewer(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from room_spectators where room_id = p_room and user_id = auth.uid() and expires_at > now());
$$;

-- Extra read access for watchers (policies add up). game_hands, side_bets and game_private are not touched.
create policy "watching friends see the room" on public.rooms for select to authenticated using (public.is_room_viewer(id));
create policy "watching friends see the seats" on public.room_seats for select to authenticated using (public.is_room_viewer(room_id));
create policy "watching friends see the game" on public.games for select to authenticated using (public.is_room_viewer(room_id));

-- Start watching the table a friend is sitting at. Returns the room.
create function public.watch_friend(p_friend uuid) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_room uuid;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not exists (
    select 1 from friendships
    where user_a = least(v_uid, p_friend) and user_b = greatest(v_uid, p_friend) and status = 'accepted'
  ) then
    raise exception 'not_friends';
  end if;
  select r.id into v_room
  from rooms r join room_seats s on s.room_id = r.id
  where s.user_id = p_friend and not s.left_game
  order by (r.phase = 'playing') desc, r.updated_at desc
  limit 1;
  if v_room is null then raise exception 'friend_not_playing'; end if;
  if exists (select 1 from room_seats where room_id = v_room and user_id = v_uid) then raise exception 'already_in_room'; end if;
  insert into room_spectators (room_id, user_id) values (v_room, v_uid)
  on conflict (room_id, user_id) do update set expires_at = now() + interval '6 hours';
  return v_room;
end;
$$;

create function public.stop_watching(p_room uuid) returns void
language sql volatile security definer set search_path = public as $$
  delete from room_spectators where room_id = p_room and user_id = auth.uid();
$$;

revoke all on function public.watch_friend(uuid) from public, anon;
revoke all on function public.stop_watching(uuid) from public, anon;
grant execute on function public.watch_friend(uuid) to authenticated;
grant execute on function public.stop_watching(uuid) to authenticated;

alter publication supabase_realtime add table public.room_spectators;

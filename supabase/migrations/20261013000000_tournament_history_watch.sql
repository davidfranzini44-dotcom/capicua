-- Tournaments, after the fact and from the stands (the owner's call, 2026-09-29):
--   * everyone who plays one keeps it in their history, with where they finished;
--   * every member (the host and everyone entered, knocked out or not) can watch any of its
--     matches as a spectator, through the same grant friends use (room_spectators);
--   * anyone watching a table can share it, not only a friend of a player.

-- Watch one of my tournament's matches. Returns the table and the player to watch it from.
create function public.watch_tournament_match(p_room uuid) returns jsonb
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
                     where tournament_id = v_tournament and v_uid in (player1, player2))) then
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

-- A player's tournaments, newest first: where they finished, with whom, and who won. Their own,
-- or anyone's for a signed-in player with a name (like the rest of a profile).
create function public.tournament_history(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null or not (p_user = auth.uid() or public.can_see_profiles()) then '[]'::jsonb
  else coalesce((
    select jsonb_agg(item order by finished_at desc)
    from (
      select t.finished_at, jsonb_build_object(
        'id', t.id, 'name', t.name, 'mode', t.mode, 'size', t.size, 'rounds', t.rounds, 'pot', t.pot,
        'finished_at', t.finished_at, 'placement', e.placement, 'eliminated_round', e.eliminated_round,
        'entries', (select count(*) from public.tournament_entries x where x.tournament_id = t.id),
        'partner', (select p.display_name from public.profiles p
                    where p.id = case when e.player1 = p_user then e.player2 else e.player1 end),
        'champion', (select string_agg(p.display_name, ' & ' order by p.display_name)
                     from public.tournament_entries c join public.profiles p on p.id in (c.player1, c.player2)
                     where c.id = t.champion)) as item
      from public.tournament_entries e
      join public.tournaments t on t.id = e.tournament_id
      where p_user in (e.player1, e.player2) and t.phase = 'finished'
      order by t.finished_at desc
      limit 30) h), '[]'::jsonb)
  end;
$$;

-- Anyone watching a table (a friend, or a member of its tournament) can share it: from their
-- friend's seat when a friend plays there, otherwise from the first player's.
create or replace function public.create_room_share_link(p_room uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_seat smallint;
  v_game uuid;
  v_token text;
  v_id uuid;
  v_expires timestamptz := now() + interval '4 hours';
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  select s.seat into v_seat from public.room_seats s
  where s.room_id = p_room and s.user_id = v_uid and not s.is_bot and not s.left_game;
  if v_seat is null and exists (select 1 from public.room_spectators rs
                                where rs.room_id = p_room and rs.user_id = v_uid and rs.expires_at > now()) then
    select s.seat into v_seat
    from public.room_seats s
    left join public.friendships f on f.status = 'accepted'
      and f.user_a = least(v_uid, s.user_id) and f.user_b = greatest(v_uid, s.user_id)
    where s.room_id = p_room and s.user_id is not null and not s.is_bot
    order by (f.user_a is not null) desc, s.seat
    limit 1;
  end if;
  if v_seat is null then raise exception 'not_seated'; end if;
  select g.id into v_game
  from public.rooms r join public.games g on g.id = r.current_game
  where r.id = p_room and r.phase = 'playing' and g.finished_at is null;
  if v_game is null then raise exception 'no_live_game'; end if;
  -- Every live link is a way in: a table keeps at most 10.
  if (select count(*) from public.room_share_links l
      where l.game_id = v_game and l.revoked_at is null and l.expires_at > now()) >= 10 then
    raise exception 'too_many_links';
  end if;
  -- Links that ended a day ago aren't needed any more.
  delete from public.room_share_links where expires_at < now() - interval '1 day';
  -- 32 random bytes from two v4 UUIDs (244 random bits, from the server's CSPRNG), URL-safe.
  v_token := rtrim(translate(encode(decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/', '-_'), '=');
  insert into public.room_share_links (room_id, game_id, created_by, token_hash, focus_seat, expires_at)
  values (p_room, v_game, v_uid, sha256(convert_to(v_token, 'UTF8')), v_seat, v_expires)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_expires, 'focus_seat', v_seat);
end;
$$;

revoke all on function public.watch_tournament_match(uuid) from public, anon;
revoke all on function public.tournament_history(uuid) from public, anon;
grant execute on function public.watch_tournament_match(uuid) to authenticated;
grant execute on function public.tournament_history(uuid) to authenticated;

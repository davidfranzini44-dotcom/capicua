-- Spectators share too (the owner's call, 2026-09-29). A friend watching a table can make a
-- link for it, shown from the seat of the friend they came to see; people watching by link
-- just pass on the link they have (nothing here). The players still see everyone watching and
-- can turn any link off; the spectator can turn off their own.

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
  if v_seat is null then
    -- A friend watching: from their friend's seat (the first one, if several friends play here).
    select s.seat into v_seat
    from public.room_spectators rs
    join public.room_seats s on s.room_id = rs.room_id and s.user_id is not null and not s.is_bot
    join public.friendships f on f.status = 'accepted'
      and f.user_a = least(v_uid, s.user_id) and f.user_b = greatest(v_uid, s.user_id)
    where rs.room_id = p_room and rs.user_id = v_uid and rs.expires_at > now()
    order by s.seat
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

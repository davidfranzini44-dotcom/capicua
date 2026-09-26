-- Private-table lobby: the host arranges who sits where (who partners with
-- whom in 2v2) — swap two chairs, move someone to an empty one, or shuffle.
-- p_users[i] is the player for chair i-1 (null = empty); it must hold exactly
-- the people already at the table. Everyone but the host confirms again after.

create function public.set_seats(p_room uuid, p_users uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_room rooms%rowtype;
  v_rows room_seats[];
  v_row room_seats;
  v_chairs int;
  v_seated int;
begin
  select * into v_room from rooms where id = p_room for update;
  if not found then raise exception 'room_not_found'; end if;
  if v_room.host is distinct from auth.uid() then raise exception 'host_only'; end if;
  if v_room.kind <> 'custom' or v_room.phase <> 'lobby' then raise exception 'game_in_progress'; end if;

  v_chairs := case when v_room.mode = '1v1' then 2 else 4 end;
  select array_agg(s), count(*) into v_rows, v_seated from room_seats s where s.room_id = p_room;
  if coalesce(array_length(p_users, 1), 0) <> v_chairs
     or (select count(u) from unnest(p_users) u) <> v_seated
     or (select count(distinct u) from unnest(p_users) u) <> v_seated
     or exists (select 1 from unnest(v_rows) s where s.user_id is null or not (s.user_id = any (p_users)))
  then
    raise exception 'bad_seat';
  end if;

  delete from room_seats where room_id = p_room;
  for i in 1 .. v_chairs loop
    continue when p_users[i] is null;
    select s.* into v_row from unnest(v_rows) s where s.user_id = p_users[i];
    v_row.seat := i - 1;
    v_row.ready := v_row.user_id = v_room.host;
    insert into room_seats values (v_row.*);
  end loop;
  update rooms set updated_at = now() where id = p_room;
end;
$$;
revoke all on function public.set_seats(uuid, uuid[]) from public, anon;
grant execute on function public.set_seats(uuid, uuid[]) to authenticated;

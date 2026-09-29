-- "Mi voz al aire" now starts ON at private tables (the owner's call, 2026-09-29): what is
-- stored is who turned it OFF, per table. Players see it on their mic ("AL AIRE"), get told
-- once when people watch by link, and can turn it off at any time. Public tables still never
-- send their voice out. Nobody had turned it off yet (off was the old default), so there is
-- nothing to carry over; room_voice_air goes.

create table public.room_voice_off (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table public.room_voice_off enable row level security;
-- No policies or grants: only the functions below touch it.
revoke all on public.room_voice_off from public, anon, authenticated;

-- The seats whose player's voice is on air: everyone still playing at a private table, except
-- those who turned it off.
create or replace function public.room_air_seats(p_room uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(s.seat order by s.seat), '[]'::jsonb)
  from public.room_seats s
  join public.rooms r on r.id = s.room_id and r.kind = 'custom'
  where s.room_id = p_room and s.user_id is not null and not s.is_bot and not s.left_game
    and not exists (select 1 from public.room_voice_off o where o.room_id = s.room_id and o.user_id = s.user_id);
$$;

-- Put my voice back on air at this table, or take it off (always allowed; remembered only for
-- someone seated there).
create or replace function public.set_voice_on_air(p_room uuid, p_on boolean) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not coalesce(p_on, false) then
    insert into public.room_voice_off (room_id, user_id)
    select p_room, v_uid where exists (select 1 from public.room_seats s where s.room_id = p_room and s.user_id = v_uid)
    on conflict do nothing;
    return false;
  end if;
  if not exists (select 1 from public.room_seats s
                 where s.room_id = p_room and s.user_id = v_uid and not s.is_bot and not s.left_game) then
    raise exception 'not_seated';
  end if;
  if not exists (select 1 from public.rooms where id = p_room and kind = 'custom') then
    raise exception 'air_private_only';
  end if;
  delete from public.room_voice_off where room_id = p_room and user_id = v_uid;
  return true;
end;
$$;

drop table public.room_voice_air;

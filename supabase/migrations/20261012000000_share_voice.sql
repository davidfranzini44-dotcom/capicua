-- Table voice for people watching by link — the watch screen and the TikTok screen. Only at
-- private (custom) tables, where the whole table already shares one voice room: public 2v2
-- voice is each team's own and never leaves the table, and public 1v1/ffa have none.
--
-- Each player decides for their own voice, at each table ("Mi voz al aire"), and it starts
-- off. It is enforced twice: the player's own app lets only the link listeners listed here
-- subscribe to its tracks (LiveKit enforces that on its server), and a viewer's app plays only
-- the players who turned it on. The `game` function hands a link viewer a listen-only voice
-- token, as share_air_identity(link, viewer), while the link is live.

create table public.room_voice_air (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table public.room_voice_air enable row level security;
-- No policies or grants: only the functions below touch it.
revoke all on public.room_voice_air from public, anon, authenticated;

-- A link listener's name in the voice room: one per viewer and link, and opaque — the players
-- allow it without ever learning who the viewer is.
create function public.share_air_identity(p_link uuid, p_user uuid) returns text
language sql immutable set search_path = '' as $$
  select 'air-' || left(encode(sha256(convert_to(p_link::text || ':' || p_user::text, 'UTF8')), 'hex'), 24);
$$;

-- The seats whose player has their voice on air (still playing at this private table).
create function public.room_air_seats(p_room uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(s.seat order by s.seat), '[]'::jsonb)
  from public.room_voice_air a
  join public.rooms r on r.id = a.room_id and r.kind = 'custom'
  join public.room_seats s on s.room_id = a.room_id and s.user_id = a.user_id and not s.is_bot and not s.left_game
  where a.room_id = p_room;
$$;

-- Put my voice on air at this table, or take it off (always allowed).
create function public.set_voice_on_air(p_room uuid, p_on boolean) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not coalesce(p_on, false) then
    delete from public.room_voice_air where room_id = p_room and user_id = v_uid;
    return false;
  end if;
  if not exists (select 1 from public.room_seats s
                 where s.room_id = p_room and s.user_id = v_uid and not s.is_bot and not s.left_game) then
    raise exception 'not_seated';
  end if;
  if not exists (select 1 from public.rooms where id = p_room and kind = 'custom') then
    raise exception 'air_private_only';
  end if;
  insert into public.room_voice_air (room_id, user_id) values (p_room, v_uid) on conflict do nothing;
  return true;
end;
$$;

-- As before (people watching by link right now, not counting friends already listed: how
-- many, and the names of those who have one), plus `on_air`: the seats whose voice goes out
-- to them, and — for the table's own players only — `air`: the voice identities of everyone
-- watching through a live link now, which are the only link listeners a player's app lets in.
create or replace function public.room_share_watchers(p_room uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with live as (
    select v.link_id, v.user_id, p.display_name, p.needs_name,
           exists (select 1 from public.room_spectators rs
                   where rs.room_id = p_room and rs.user_id = v.user_id and rs.expires_at > now()) as friend
    from public.room_share_viewers v
    join public.room_share_links l on l.id = v.link_id
    join public.profiles p on p.id = v.user_id
    where v.room_id = p_room and v.seen_at > now() - interval '75 seconds' and public.share_link_live(l.id))
  select case when auth.uid() is null
    or not (public.is_room_member(p_room) or public.is_room_viewer(p_room) or public.is_share_room_viewer(p_room)) then null
  else jsonb_build_object(
    'count', (select count(distinct user_id) from live where not friend),
    'names', (select coalesce(jsonb_agg(distinct display_name) filter (where not needs_name), '[]'::jsonb) from live where not friend),
    'on_air', public.room_air_seats(p_room),
    'air', case when public.is_room_member(p_room)
                then (select coalesce(jsonb_agg(distinct public.share_air_identity(link_id, user_id)), '[]'::jsonb) from live) end)
  end;
$$;

revoke all on function public.share_air_identity(uuid, uuid) from public, anon, authenticated;
revoke all on function public.room_air_seats(uuid) from public, anon, authenticated;
revoke all on function public.set_voice_on_air(uuid, boolean) from public, anon;
grant execute on function public.set_voice_on_air(uuid, boolean) to authenticated;

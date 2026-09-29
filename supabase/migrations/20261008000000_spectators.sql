-- Spectators, part two: they see who else is watching, send short messages the
-- whole table reads, and listen to the players' voice unless a player turns
-- that off (spectators_hear — the player's own phone enforces it in LiveKit).

-- Watchers see each other (players already see them).
create policy "watchers see who else is watching" on public.room_spectators for select to authenticated
  using (public.is_room_viewer(room_id));

-- On unless the player turns it off (Settings, or the spectators panel at the table).
alter table public.profiles add column spectators_hear boolean not null default true;

create function public.set_spectators_hear(p_on boolean) returns void
language sql volatile security definer set search_path = public as $$
  update profiles set spectators_hear = coalesce(p_on, true) where id = auth.uid();
$$;
revoke all on function public.set_spectators_hear(boolean) from public, anon;
grant execute on function public.set_spectators_hear(boolean) to authenticated;

-- What spectators say to the table. Written only by spectator_say(), so a player
-- can't pose as a spectator to pass free-text hints to their partner.
create table public.room_messages (
  id bigserial primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  body text not null check (char_length(body) between 1 and 80),
  created_at timestamptz not null default now()
);
create index room_messages_room on public.room_messages (room_id, created_at desc);
alter table public.room_messages enable row level security;
create policy "the table and its watchers read spectator messages" on public.room_messages for select to authenticated
  using (public.is_room_member(room_id) or public.is_room_viewer(room_id));
alter publication supabase_realtime add table public.room_messages;

-- A spectator (watching, not seated) says something: 1–80 characters, no links,
-- at most one every 3 s and 12 a minute; banned players can't.
create function public.spectator_say(p_room uuid, p_text text) returns bigint
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_text text := regexp_replace(btrim(coalesce(p_text, '')), '\s+', ' ', 'g');
  v_name text;
  v_id bigint;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from room_spectators where room_id = p_room and user_id = v_uid and expires_at > now())
     or exists (select 1 from room_seats where room_id = p_room and user_id = v_uid) then
    raise exception 'not_watching';
  end if;
  if char_length(v_text) < 1 or char_length(v_text) > 80 or v_text ~* '(https?://|www\.)' then
    raise exception 'bad_message';
  end if;
  select display_name into v_name from profiles where id = v_uid and (banned_until is null or banned_until < now());
  if v_name is null then raise exception 'banned'; end if;
  if exists (select 1 from room_messages where room_id = p_room and user_id = v_uid and created_at > now() - interval '3 seconds')
     or (select count(*) from room_messages where room_id = p_room and user_id = v_uid and created_at > now() - interval '1 minute') >= 12 then
    raise exception 'too_fast';
  end if;
  insert into room_messages (room_id, user_id, name, body) values (p_room, v_uid, v_name, v_text) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.spectator_say(uuid, text) from public, anon;
grant execute on function public.spectator_say(uuid, text) to authenticated;

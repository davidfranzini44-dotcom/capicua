-- Sharing a live match. A player seated at a table makes a link (…/?ver=<token>) that
-- anyone can open to watch that game's board live — no friendship needed; the app makes
-- a guest session when there's none. Nobody's fichas are ever readable: link viewers get
-- the game's public row, the seats, spectator messages and a projection of the table
-- without its join code — never game_hands, game_private, side_bets or room_spectators.
--
-- A link belongs to one game (a rematch needs a new one), lasts at most 4 hours, stops
-- working 2 minutes after the match ends, and any player at the table can turn it off.
-- Access is re-checked against the link on every read, so turning it off or letting it
-- expire removes it at once. Only a SHA-256 digest of the token is stored.
--
-- (Dated after 20261010000000 on purpose: it builds on the watch, spectator and
-- unique-name migrations, and a CLI timestamp of today would sort before them.)

create table public.room_share_links (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  -- The seat the board is shown from (the player who shared it).
  focus_seat smallint not null check (focus_seat between 0 and 3),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index room_share_links_game on public.room_share_links (game_id) where revoked_at is null;
create index room_share_links_expires on public.room_share_links (expires_at) where revoked_at is null;
alter table public.room_share_links enable row level security;

-- Who opened a link: one row per viewer and link. It only counts heads and remembers the
-- way in; the permission itself comes from the link being live.
create table public.room_share_viewers (
  link_id uuid not null references public.room_share_links (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  primary key (link_id, user_id)
);
create index room_share_viewers_room on public.room_share_viewers (room_id, seen_at);
create index room_share_viewers_user on public.room_share_viewers (user_id);
alter table public.room_share_viewers enable row level security;

-- Neither table has policies or grants: only the functions below touch them.
revoke all on public.room_share_links from public, anon, authenticated;
revoke all on public.room_share_viewers from public, anon, authenticated;

-- Does this link still open its game? Not turned off, not expired, still the room's
-- current game (no rematch), and not over — or over less than 2 minutes ago.
create function public.share_link_live(p_link uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.room_share_links l
    join public.rooms r on r.id = l.room_id and r.current_game = l.game_id
    join public.games g on g.id = l.game_id
    where l.id = p_link and l.revoked_at is null and l.expires_at > now()
      and (g.finished_at is null or g.finished_at > now() - interval '2 minutes'));
$$;

-- Is the signed-in user watching this exact game through a live link?
create function public.is_share_game_viewer(p_game uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.room_share_viewers v join public.room_share_links l on l.id = v.link_id
    where v.user_id = auth.uid() and l.game_id = p_game and public.share_link_live(l.id));
$$;

-- …or this table (for its seats and spectator messages).
create function public.is_share_room_viewer(p_room uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.room_share_viewers v join public.room_share_links l on l.id = v.link_id
    where v.user_id = auth.uid() and v.room_id = p_room and public.share_link_live(l.id));
$$;

-- Extra read access for link viewers (policies add up). Not rooms: its row has the join code.
create policy "link viewers see the game" on public.games for select to authenticated
  using (public.is_share_game_viewer(id));
create policy "link viewers see the seats" on public.room_seats for select to authenticated
  using (public.is_share_room_viewer(room_id));
create policy "link viewers read spectator messages" on public.room_messages for select to authenticated
  using (public.is_share_room_viewer(room_id));

-- A guest session that hasn't picked a name (every session the app makes just to watch)
-- reads only its own profile: the shared table brings the players' photos and levels itself.
create function public.can_see_profiles() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and not needs_name);
$$;
drop policy "profiles are public to players" on public.profiles;
create policy "profiles are public to players" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.can_see_profiles()));

-- Share the match I'm playing. Returns the token once (it's never stored), the link's id
-- (to turn it off) and when it ends.
create function public.create_room_share_link(p_room uuid) returns jsonb
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

-- Open a link. The token is hashed and looked up by its digest (so comparing it can't
-- leak the token through timing). Returns the table and the game to watch — nothing private.
-- A player at that table just gets `player: true` (and isn't counted as a viewer).
create function public.watch_shared_match(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_link public.room_share_links%rowtype;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{40,64}$' then raise exception 'link_invalid'; end if;
  select * into v_link from public.room_share_links where token_hash = sha256(convert_to(p_token, 'UTF8'));
  if not found then raise exception 'link_invalid'; end if;
  if not public.share_link_live(v_link.id) then raise exception 'link_gone'; end if;
  if exists (select 1 from public.room_seats where room_id = v_link.room_id and user_id = v_uid) then
    return jsonb_build_object('room_id', v_link.room_id, 'game_id', v_link.game_id, 'focus_seat', v_link.focus_seat, 'player', true);
  end if;
  insert into public.room_share_viewers (link_id, room_id, user_id) values (v_link.id, v_link.room_id, v_uid)
  on conflict (link_id, user_id) do update set seen_at = now();
  return jsonb_build_object('room_id', v_link.room_id, 'game_id', v_link.game_id, 'focus_seat', v_link.focus_seat, 'player', false);
end;
$$;

-- People watching a table through links right now (seen in the last 75 s), not counting
-- friends already watching: how many, and the names of those who have one — never who
-- they are otherwise. For the table's players and its viewers.
create function public.room_share_watchers(p_room uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null
    or not (public.is_room_member(p_room) or public.is_room_viewer(p_room) or public.is_share_room_viewer(p_room)) then null
  else jsonb_build_object(
    'count', count(distinct v.user_id),
    'names', coalesce(jsonb_agg(distinct p.display_name) filter (where not p.needs_name), '[]'::jsonb))
  end
  from public.room_share_viewers v
  join public.room_share_links l on l.id = v.link_id
  join public.profiles p on p.id = v.user_id
  where v.room_id = p_room and v.seen_at > now() - interval '75 seconds' and public.share_link_live(l.id)
    and not exists (select 1 from public.room_spectators rs
                    where rs.room_id = p_room and rs.user_id = v.user_id and rs.expires_at > now());
$$;

-- What a link viewer's screen needs besides the live game row: the table without its join
-- code, the players' public faces, how many are watching, and when the link ends. Calling
-- it also keeps the viewer counted. Refused once the link stops opening the game.
create function public.shared_room(p_room uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_link public.room_share_links%rowtype;
  v_room public.rooms%rowtype;
  v_finished timestamptz;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  select l.* into v_link
  from public.room_share_viewers v join public.room_share_links l on l.id = v.link_id
  where v.user_id = v_uid and v.room_id = p_room and public.share_link_live(l.id)
  order by l.created_at desc limit 1;
  if not found then raise exception 'link_gone'; end if;
  update public.room_share_viewers set seen_at = now() where link_id = v_link.id and user_id = v_uid;
  select * into v_room from public.rooms where id = p_room;
  select finished_at into v_finished from public.games where id = v_link.game_id;
  return jsonb_build_object(
    'room', jsonb_build_object('id', v_room.id, 'kind', v_room.kind, 'mode', v_room.mode, 'rules', v_room.rules,
      'stake', v_room.stake, 'turn_seconds', v_room.turn_seconds, 'phase', v_room.phase,
      'current_game', v_room.current_game, 'tournament_id', v_room.tournament_id),
    'game_id', v_link.game_id,
    'focus_seat', v_link.focus_seat,
    'ends_at', case when v_finished is null then v_link.expires_at
                    else least(v_link.expires_at, v_finished + interval '2 minutes') end,
    'players', (select coalesce(jsonb_agg(jsonb_build_object('seat', s.seat, 'avatar_url', p.avatar_url) order by s.seat), '[]'::jsonb)
                from public.room_seats s left join public.profiles p on p.id = s.user_id and not s.is_bot
                where s.room_id = p_room),
    'watchers', public.room_share_watchers(p_room));
end;
$$;

-- Stop watching through a link (closing the screen).
create function public.leave_shared_match(p_room uuid) returns void
language sql volatile security definer set search_path = '' as $$
  delete from public.room_share_viewers where room_id = p_room and user_id = auth.uid();
$$;

-- Turn a link off: whoever made it, or anyone still playing at that table. Idempotent.
create function public.revoke_room_share_link(p_link uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_link public.room_share_links%rowtype;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  select * into v_link from public.room_share_links where id = p_link;
  if not found then raise exception 'not_allowed'; end if;
  if v_link.created_by <> v_uid and not exists (
    select 1 from public.room_seats s
    where s.room_id = v_link.room_id and s.user_id = v_uid and not s.is_bot and not s.left_game) then
    raise exception 'not_allowed';
  end if;
  update public.room_share_links set revoked_at = coalesce(revoked_at, now()) where id = p_link;
  delete from public.room_share_viewers where link_id = p_link;
end;
$$;

-- The links still open on the game I'm playing (never their tokens), so a player can turn
-- them off after reopening the app.
create function public.room_share_links_active(p_room uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null or not exists (
      select 1 from public.room_seats s
      where s.room_id = p_room and s.user_id = auth.uid() and not s.is_bot and not s.left_game) then '[]'::jsonb
  else coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'mine', l.created_by = auth.uid(), 'expires_at', l.expires_at)
                          order by l.created_at), '[]'::jsonb)
  end
  from public.room_share_links l
  where l.room_id = p_room and public.share_link_live(l.id);
$$;

-- Spectator messages: friends watching (as before) or link viewers who have a name.
-- A guest session made only to watch reads along.
create or replace function public.spectator_say(p_room uuid, p_text text) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_text text := regexp_replace(btrim(coalesce(p_text, '')), '\s+', ' ', 'g');
  v_name text;
  v_needs boolean;
  v_id bigint;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from public.room_seats where room_id = p_room and user_id = v_uid)
     or not (exists (select 1 from public.room_spectators where room_id = p_room and user_id = v_uid and expires_at > now())
             or public.is_share_room_viewer(p_room)) then
    raise exception 'not_watching';
  end if;
  if char_length(v_text) < 1 or char_length(v_text) > 80 or v_text ~* '(https?://|www\.)' then
    raise exception 'bad_message';
  end if;
  select display_name, needs_name into v_name, v_needs
  from public.profiles where id = v_uid and (banned_until is null or banned_until < now());
  if v_name is null then raise exception 'banned'; end if;
  if v_needs then raise exception 'name_required'; end if;
  if exists (select 1 from public.room_messages where room_id = p_room and user_id = v_uid and created_at > now() - interval '3 seconds')
     or (select count(*) from public.room_messages where room_id = p_room and user_id = v_uid and created_at > now() - interval '1 minute') >= 12 then
    raise exception 'too_fast';
  end if;
  insert into public.room_messages (room_id, user_id, name, body) values (p_room, v_uid, v_name, v_text) returning id into v_id;
  return v_id;
end;
$$;

-- Who may run what: helpers used inside policies need the signed-in role; the rest is
-- reached only through the functions above.
revoke all on function public.share_link_live(uuid) from public, anon, authenticated;
revoke all on function public.is_share_game_viewer(uuid) from public, anon;
revoke all on function public.is_share_room_viewer(uuid) from public, anon;
revoke all on function public.can_see_profiles() from public, anon;
grant execute on function public.is_share_game_viewer(uuid) to authenticated;
grant execute on function public.is_share_room_viewer(uuid) to authenticated;
grant execute on function public.can_see_profiles() to authenticated;

revoke all on function public.create_room_share_link(uuid) from public, anon;
revoke all on function public.watch_shared_match(text) from public, anon;
revoke all on function public.room_share_watchers(uuid) from public, anon;
revoke all on function public.shared_room(uuid) from public, anon;
revoke all on function public.leave_shared_match(uuid) from public, anon;
revoke all on function public.revoke_room_share_link(uuid) from public, anon;
revoke all on function public.room_share_links_active(uuid) from public, anon;
revoke all on function public.spectator_say(uuid, text) from public, anon;
grant execute on function public.create_room_share_link(uuid) to authenticated;
grant execute on function public.watch_shared_match(text) to authenticated;
grant execute on function public.room_share_watchers(uuid) to authenticated;
grant execute on function public.shared_room(uuid) to authenticated;
grant execute on function public.leave_shared_match(uuid) to authenticated;
grant execute on function public.revoke_room_share_link(uuid) to authenticated;
grant execute on function public.room_share_links_active(uuid) to authenticated;
grant execute on function public.spectator_say(uuid, text) to authenticated;

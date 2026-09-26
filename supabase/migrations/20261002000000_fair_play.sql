-- Fair play. A website can't stop screenshots or WhatsApp, so cheating is made
-- visible, harder and punishable instead:
--   * table_alerts: the table sees when a player leaves the app mid-hand (where
--     tiles get sent), comes back, or presses a screenshot key on a computer.
--   * user_networks: which (hashed) network each player plays from, so public
--     chip tables never seat friends or people on the same home Wi-Fi together.
--   * reports: players flag cheating; the admin reviews and bans.
--   * games.kind / games.mode: kept on the game, since rooms get deleted.

-- ---------- what the table saw ----------

create table public.table_alerts (
  id bigserial primary key,
  room_id uuid references public.rooms (id) on delete set null,
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seat smallint not null check (seat between 0 and 3),
  kind text not null check (kind in ('left', 'back', 'screenshot')),
  -- 'back': how long they were away.
  seconds int,
  created_at timestamptz not null default now()
);
create index table_alerts_user on public.table_alerts (user_id, created_at desc);
create index table_alerts_game on public.table_alerts (game_id, user_id, created_at desc);
alter table public.table_alerts enable row level security;
create policy "the table sees its alerts" on public.table_alerts for select to authenticated
  using (public.is_room_member(room_id));

-- A seated player's own app reports it. The seat comes from the server, so
-- nobody can raise an alert in someone else's name. Quietly does nothing for
-- spectators, finished games, repeats within 3 s, or past 150 per game.
create function public.fair_play_alert(p_room uuid, p_kind text, p_seconds int default null) returns bigint
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_seat smallint;
  v_game uuid;
  v_last_kind text;
  v_last_at timestamptz;
  v_secs int;
  v_id bigint;
begin
  if v_uid is null or p_kind is null or p_kind not in ('left', 'back', 'screenshot') then return null; end if;
  select s.seat, g.id into v_seat, v_game
  from room_seats s
  join rooms r on r.id = s.room_id
  join games g on g.id = r.current_game
  where s.room_id = p_room and s.user_id = v_uid and not s.is_bot
    and r.phase = 'playing' and not g.settled;
  if v_game is null then return null; end if;

  if exists (
    select 1 from table_alerts
    where game_id = v_game and user_id = v_uid and kind = p_kind and created_at > now() - interval '3 seconds'
  ) then return null; end if;
  if (select count(*) from table_alerts where game_id = v_game and user_id = v_uid) >= 150 then return null; end if;

  if p_kind = 'back' then
    select kind, created_at into v_last_kind, v_last_at from table_alerts
    where game_id = v_game and user_id = v_uid and kind in ('left', 'back')
    order by created_at desc, id desc limit 1;
    if v_last_kind = 'left' then
      -- The server's own clock when the 'left' arrived.
      v_secs := least(3600, extract(epoch from now() - v_last_at)::int);
    else
      -- The 'left' never made it (the phone went to sleep first): trust the app's count,
      -- but ignore flickers.
      v_secs := least(3600, greatest(0, coalesce(p_seconds, 0)));
      if v_secs < 2 then return null; end if;
    end if;
  end if;

  insert into table_alerts (room_id, game_id, user_id, seat, kind, seconds)
  values (p_room, v_game, v_uid, v_seat, p_kind, v_secs)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------- reports ----------

create table public.reports (
  id bigserial primary key,
  reporter uuid not null references public.profiles (id) on delete cascade,
  reported uuid not null references public.profiles (id) on delete cascade,
  game_id uuid references public.games (id) on delete set null,
  reason text not null check (reason in ('sharing', 'teaming', 'screens', 'other')),
  note text check (length(note) <= 300),
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (reporter, reported, game_id)
);
create index reports_reported on public.reports (reported, status, created_at desc);
create index reports_reporter on public.reports (reporter, created_at desc);
alter table public.reports enable row level security;
-- No policies: only the admin panel (through the game function) reads them.

-- Report someone you played with in the last 48 hours.
create function public.report_player(p_user uuid, p_game uuid, p_reason text, p_note text default null) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_user = v_uid then raise exception 'report_self'; end if;
  if p_reason is null or p_reason not in ('sharing', 'teaming', 'screens', 'other') then raise exception 'bad_reason'; end if;
  if not exists (
    select 1 from games g
    where g.id = p_game and g.created_at > now() - interval '48 hours'
      and exists (select 1 from game_hands h where h.game_id = g.id and h.user_id = v_uid)
      and exists (select 1 from game_hands h where h.game_id = g.id and h.user_id = p_user)
  ) then
    raise exception 'report_no_game';
  end if;
  if exists (select 1 from reports where reporter = v_uid and reported = p_user and game_id = p_game) then
    raise exception 'report_dup';
  end if;
  if (select count(*) from reports where reporter = v_uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'report_limit';
  end if;
  insert into reports (reporter, reported, game_id, reason, note)
  values (v_uid, p_user, p_game, p_reason, nullif(left(btrim(coalesce(p_note, '')), 300), ''));
end;
$$;

-- ---------- networks ----------

-- A hash of the network each player connects from (IPv4 address, or the /64
-- of an IPv6 one), never the address itself. Written by the game function.
create table public.user_networks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  net text not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  hits int not null default 1,
  primary key (user_id, net)
);
create index user_networks_net on public.user_networks (net, last_seen desc);
alter table public.user_networks enable row level security;

-- Mixed into the hash so it can't be reversed by trying every address.
insert into public.app_secrets (key, value)
values ('net_pepper', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- Two players were on the same network lately. Big shared networks (a mobile
-- carrier's, where many strangers show up behind one address) don't count.
create function public.same_network(p_a uuid, p_b uuid, p_days int default 7) returns boolean
language sql stable set search_path = public as $$
  select exists (
    select 1
    from user_networks x
    join user_networks y on y.net = x.net and y.user_id = p_b
    where x.user_id = p_a
      and x.last_seen > now() - make_interval(days => p_days)
      and y.last_seen > now() - make_interval(days => p_days)
      and (
        select count(distinct n.user_id) from user_networks n
        where n.net = x.net and n.last_seen > now() - make_interval(days => p_days)
      ) <= 8
  );
$$;

-- ---------- games remember their kind of table ----------

alter table public.games add column kind text, add column mode text;

create function public.games_fill_kind() returns trigger
language plpgsql set search_path = public as $$
declare
  v_kind text;
  v_mode text;
begin
  if new.room_id is not null then
    select r.kind, r.mode into v_kind, v_mode from rooms r where r.id = new.room_id;
  end if;
  new.kind := coalesce(new.kind, v_kind);
  new.mode := coalesce(new.mode, v_mode, new.public_state->'rules'->>'mode');
  return new;
end;
$$;
create trigger games_fill_kind before insert on public.games
  for each row execute function public.games_fill_kind();

update public.games g set kind = r.kind, mode = r.mode from public.rooms r where r.id = g.room_id and g.kind is null;
update public.games set mode = public_state->'rules'->>'mode' where mode is null;
create index games_created on public.games (created_at desc);

-- ---------- access ----------

revoke all on function public.fair_play_alert(uuid, text, int) from public, anon;
revoke all on function public.report_player(uuid, uuid, text, text) from public, anon;
revoke all on function public.same_network(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.games_fill_kind() from public, anon, authenticated;
grant execute on function public.fair_play_alert(uuid, text, int) to authenticated;
grant execute on function public.report_player(uuid, uuid, text, text) to authenticated;

alter publication supabase_realtime add table public.table_alerts;

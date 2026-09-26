-- Capicúa database — paste ALL of this into Supabase → SQL Editor → Run (once, on a new project).
-- Generated from supabase/migrations/*.sql

-- ===== 20260925000000_init.sql =====
-- Capicúa: salas, matchmaking, pre-game lobbies, games, hidden hands,
-- virtual chips, side bets and levels.
-- Clients only READ (through RLS). Every write goes through the `game` edge
-- function, which referees moves and moves chips inside transactions.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Jugador' check (char_length(display_name) between 1 and 20),
  chips bigint not null default 5000 check (chips >= 0),
  xp int not null default 0 check (xp >= 0),
  games int not null default 0,
  wins int not null default 0,
  capicuas int not null default 0,
  pollonas int not null default 0,
  biggest_pot bigint not null default 0,
  last_daily date,
  last_rescue date,
  -- Declining matches: 3 in 10 minutes → 5 minutes out of the queue.
  declines int not null default 0,
  declines_since timestamptz,
  queue_blocked_until timestamptz,
  created_at timestamptz not null default now()
);

-- A table: either matched in a public sala or created by a host (custom).
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  kind text not null check (kind in ('public', 'custom')),
  mode text not null check (mode in ('1v1', '2v2', 'ffa')),
  rules jsonb not null,
  stake int not null default 0 check (stake >= 0),
  turn_seconds int not null default 15,
  visibility text not null default 'private' check (visibility in ('public', 'private')),
  host uuid references public.profiles (id),
  -- lobby (custom, gathering) → ready (level gap: everyone confirms) → countdown → playing → finished
  phase text not null default 'lobby' check (phase in ('lobby', 'ready', 'countdown', 'playing', 'finished')),
  phase_ends_at timestamptz,
  current_game uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.room_seats (
  room_id uuid not null references public.rooms (id) on delete cascade,
  seat smallint not null check (seat between 0 and 3),
  user_id uuid references public.profiles (id),
  is_bot boolean not null default false,
  name text not null,
  level int not null default 1,
  ready boolean not null default false,
  -- Server is playing for them: left voluntarily (`left`) or ran out of time 3 times.
  away boolean not null default false,
  left_game boolean not null default false,
  strikes int not null default 0,
  primary key (room_id, seat),
  unique (room_id, user_id)
);

create table public.queue (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  stake int not null,
  mode text not null check (mode in ('1v1', '2v2', 'ffa')),
  level int not null,
  joined_at timestamptz not null default now()
);

-- Games outlive their table: history (and the admin's numbers) survive when a room closes.
create table public.games (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.rooms (id) on delete set null,
  public_state jsonb not null,
  version int not null default 0,
  stake int not null default 0,
  pot bigint not null default 0,
  turn_ms int not null default 15000,
  last_move_at timestamptz not null default now(),
  -- ms after last_move_at when the server will act by itself (bot turn, auto-pass, timeout, next hand)
  auto_delay_ms int,
  finished_at timestamptz,
  settled boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.rooms add constraint rooms_current_game_fk foreign key (current_game) references public.games (id) on delete set null;

-- Full engine state including every hand and the pile. No policies: service access only.
create table public.game_private (
  game_id uuid primary key references public.games (id) on delete cascade,
  state jsonb not null
);

-- Each player's own tiles; RLS lets a player read only their row.
create table public.game_hands (
  game_id uuid not null references public.games (id) on delete cascade,
  seat smallint not null check (seat between 0 and 3),
  user_id uuid references public.profiles (id),
  tiles jsonb not null,
  primary key (game_id, seat)
);

create table public.side_bets (
  id bigserial primary key,
  room_id uuid references public.rooms (id) on delete set null,
  game_id uuid references public.games (id) on delete set null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('cap1', 'cap2', 'pollona')),
  amount int not null check (amount > 0),
  multiplier numeric(6, 1) not null,
  status text not null default 'open' check (status in ('open', 'won', 'lost', 'refunded')),
  payout bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (room_id, user_id, kind)
);

create table public.chip_ledger (
  id bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  delta bigint not null,
  reason text not null check (reason in ('welcome', 'daily', 'rescue', 'stake', 'payout', 'refund', 'side_bet', 'side_bet_win')),
  game_id uuid references public.games (id) on delete set null,
  created_at timestamptz not null default now()
);

create index on public.room_seats (user_id);
create index on public.rooms (kind, visibility, phase);
create index on public.queue (stake, mode, joined_at);
create index on public.games (room_id);
create index on public.game_hands (user_id);
create index on public.side_bets (game_id);
create index on public.chip_ledger (user_id, created_at desc);

-- Helpers used by policies (security definer avoids RLS recursion on room_seats).
create function public.is_room_member(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from room_seats where room_id = p_room and user_id = auth.uid());
$$;

-- Custom rooms anyone can browse and join.
create function public.is_listed_room(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from rooms where id = p_room and kind = 'custom' and visibility = 'public' and phase = 'lobby');
$$;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_seats enable row level security;
alter table public.queue enable row level security;
alter table public.games enable row level security;
alter table public.game_private enable row level security;
alter table public.game_hands enable row level security;
alter table public.side_bets enable row level security;
alter table public.chip_ledger enable row level security;

create policy "profiles are public to players" on public.profiles for select to authenticated using (true);
create policy "members and browsers see rooms" on public.rooms for select to authenticated
  using (public.is_room_member(id) or public.is_listed_room(id));
create policy "members and browsers see seats" on public.room_seats for select to authenticated
  using (public.is_room_member(room_id) or public.is_listed_room(room_id));
create policy "see your own queue entry" on public.queue for select to authenticated using (user_id = auth.uid());
create policy "members see the game" on public.games for select to authenticated using (public.is_room_member(room_id));
create policy "players see only their own tiles" on public.game_hands for select to authenticated using (user_id = auth.uid());
create policy "players see their own side bets" on public.side_bets for select to authenticated using (user_id = auth.uid());
create policy "players see their own ledger" on public.chip_ledger for select to authenticated using (user_id = auth.uid());

-- New account → profile with starting chips (name from Google, else "Jugador").
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text := left(coalesce(nullif(split_part(new.raw_user_meta_data ->> 'full_name', ' ', 1), ''), 'Jugador'), 20);
begin
  insert into profiles (id, display_name) values (new.id, v_name);
  insert into chip_ledger (user_id, delta, reason) values (new.id, 5000, 'welcome');
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Players can rename themselves; nothing else on the profile is client-writable.
create function public.set_display_name(p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update profiles set display_name = left(btrim(p_name), 20) where id = auth.uid() and char_length(btrim(p_name)) > 0;
end;
$$;
revoke all on function public.set_display_name(text) from public, anon;
grant execute on function public.set_display_name(text) to authenticated;

alter publication supabase_realtime add table
  public.rooms, public.room_seats, public.games, public.game_hands, public.profiles, public.side_bets;

-- ===== 20260926000000_chests_admin_shop.sql =====
-- Capicúa v3: reward chests, admin tools, bans, and Stripe chip purchases.
-- Chips are bought one way only: they never convert back to money.

-- ---------- chests ----------
create table public.chests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  slot smallint not null check (slot between 0 and 3),
  kind text not null check (kind in ('wood', 'silver', 'gold', 'diamond')),
  -- locked → (start) unlocking with unlock_at → open once unlock_at has passed
  unlock_at timestamptz,
  game_id uuid references public.games (id) on delete set null,
  earned_at timestamptz not null default now(),
  unique (user_id, slot)
);
create index on public.chests (user_id);
alter table public.chests enable row level security;
create policy "players see their own chests" on public.chests for select to authenticated using (user_id = auth.uid());

-- ---------- admins & bans ----------
-- Admins are listed by email; the game server checks the signed-in (non-guest) user's email.
create table public.admins (
  email text primary key
);
alter table public.admins enable row level security;
-- Admins are added by hand in the SQL Editor (kept out of this public file):
--   insert into public.admins (email) values ('<admin google email>');

alter table public.profiles add column banned_until timestamptz;
alter table public.profiles add column ban_reason text;

-- ---------- purchases ----------
create table public.purchases (
  id bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  pack text not null,
  chips bigint not null check (chips > 0),
  amount_cents int not null,
  currency text not null default 'usd',
  stripe_session text not null unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'refunded')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index on public.purchases (user_id, created_at desc);
alter table public.purchases enable row level security;
create policy "players see their own purchases" on public.purchases for select to authenticated using (user_id = auth.uid());

-- New ledger reasons: chests, purchases, admin adjustments, refunds from closed tables.
alter table public.chip_ledger drop constraint chip_ledger_reason_check;
alter table public.chip_ledger add constraint chip_ledger_reason_check check (reason in (
  'welcome', 'daily', 'rescue', 'stake', 'payout', 'refund', 'side_bet', 'side_bet_win',
  'chest', 'chest_rush', 'purchase', 'admin'
));
alter table public.chip_ledger add column note text;

alter publication supabase_realtime add table public.chests;

-- ===== 20260926000100_function_grants.sql =====
-- Lock down SECURITY DEFINER helpers (Supabase advisor 0028/0029).
-- handle_new_user only ever runs from the auth.users trigger.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
-- RLS policies call these as the signed-in user; signed-out visitors don't need them.
revoke execute on function public.is_room_member(uuid) from public, anon;
revoke execute on function public.is_listed_room(uuid) from public, anon;
grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.is_listed_room(uuid) to authenticated;

-- ===== 20260927000000_tournaments.sql =====
-- Private knockout tournaments. A host opens one and shares its 5-letter code;
-- everyone pays the buy-in into the pot; the bracket plays out on ordinary
-- tables (rooms.kind = 'tournament'). Champion takes 70% of the pot, runner-up 30%.
-- Clients only read (members only); every change goes through the `game` function.

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null check (char_length(name) between 3 and 30),
  host uuid not null references public.profiles (id),
  mode text not null check (mode in ('1v1', '2v2')),
  -- bracket slots on offer: players in 1v1, pairs in 2v2
  size int not null check (size in (4, 8, 16)),
  buy_in int not null default 0 check (buy_in >= 0),
  rules jsonb not null,
  turn_seconds int not null default 25,
  phase text not null default 'lobby' check (phase in ('lobby', 'playing', 'finished', 'cancelled')),
  -- set when the host starts it
  rounds int,
  pot bigint not null default 0 check (pot >= 0),
  champion uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- One bracket entry: a player (1v1) or a pair (2v2; player2 empty = looking for a partner).
create table public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  player1 uuid not null references public.profiles (id),
  player2 uuid references public.profiles (id),
  eliminated_round int,
  placement int,
  created_at timestamptz not null default now()
);
create unique index tournament_entries_player1 on public.tournament_entries (tournament_id, player1);
create unique index tournament_entries_player2 on public.tournament_entries (tournament_id, player2) where player2 is not null;
create index on public.tournament_entries (player1);
create index on public.tournament_entries (player2);
alter table public.tournaments add constraint tournaments_champion_fk
  foreign key (champion) references public.tournament_entries (id) on delete set null;

-- Every match of the bracket, created when the tournament starts.
-- waiting: players not known yet · ready: table open, 2 minutes to press Ready · playing · done
create table public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round int not null,
  slot int not null,
  entry_a uuid references public.tournament_entries (id) on delete set null,
  entry_b uuid references public.tournament_entries (id) on delete set null,
  room_id uuid references public.rooms (id) on delete set null,
  winner uuid references public.tournament_entries (id) on delete set null,
  status text not null default 'waiting' check (status in ('waiting', 'ready', 'playing', 'done')),
  result text check (result in ('played', 'bye', 'forfeit')),
  ready_by timestamptz,
  unique (tournament_id, round, slot)
);
create index on public.tournament_matches (room_id);
create index on public.tournaments (host);

-- Tournament matches are played on ordinary tables.
alter table public.rooms drop constraint rooms_kind_check;
alter table public.rooms add constraint rooms_kind_check check (kind in ('public', 'custom', 'tournament'));
alter table public.rooms add column tournament_id uuid references public.tournaments (id) on delete set null;

alter table public.profiles add column tournaments_won int not null default 0;

alter table public.chip_ledger drop constraint chip_ledger_reason_check;
alter table public.chip_ledger add constraint chip_ledger_reason_check check (reason in (
  'welcome', 'daily', 'rescue', 'stake', 'payout', 'refund', 'side_bet', 'side_bet_win',
  'chest', 'chest_rush', 'purchase', 'admin', 'tournament_buyin', 'tournament_prize'
));

-- Members = the host and everyone entered. Others only see a preview through the game function.
create function public.is_tournament_member(p_tournament uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tournaments where id = p_tournament and host = auth.uid())
      or exists (select 1 from tournament_entries where tournament_id = p_tournament and auth.uid() in (player1, player2));
$$;
revoke execute on function public.is_tournament_member(uuid) from public, anon;
grant execute on function public.is_tournament_member(uuid) to authenticated;

alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.tournament_matches enable row level security;
create policy "members see the tournament" on public.tournaments for select to authenticated using (public.is_tournament_member(id));
create policy "members see the entries" on public.tournament_entries for select to authenticated using (public.is_tournament_member(tournament_id));
create policy "members see the bracket" on public.tournament_matches for select to authenticated using (public.is_tournament_member(tournament_id));

alter publication supabase_realtime add table public.tournaments, public.tournament_entries, public.tournament_matches;

-- ===== 20260928000000_avatars.sql =====
-- Profile pictures. profiles.avatar_url is either a photo the player uploaded to
-- the public `avatars` bucket (stored as '<user id>/<file>.jpg') or their Google
-- photo (an https://…googleusercontent.com URL). Players change it only through
-- set_avatar(), which refuses anyone else's file or an arbitrary website.

alter table public.profiles add column avatar_url text;

-- Google sign-ups already have a photo.
update public.profiles p
set avatar_url = coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
from auth.users u
where u.id = p.id and not coalesce(u.is_anonymous, false)
  and coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture') like 'https://%.googleusercontent.com/%';

-- New accounts: name and Google photo from the sign-in.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text := left(coalesce(nullif(split_part(new.raw_user_meta_data ->> 'full_name', ' ', 1), ''), 'Jugador'), 20);
  v_photo text := coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture');
begin
  insert into profiles (id, display_name, avatar_url)
  values (new.id, v_name, case when v_photo like 'https://%.googleusercontent.com/%' then v_photo end);
  insert into chip_ledger (user_id, delta, reason) values (new.id, 5000, 'welcome');
  return new;
end;
$$;

-- p_avatar: '<my id>/<file>.jpg' (just uploaded), 'google' (my Google photo) or null (no photo).
create function public.set_avatar(p_avatar text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_avatar is null then
    v := null;
  elsif p_avatar = 'google' then
    -- Linked accounts keep the Google details on the identity, not the user row.
    select coalesce(i.identity_data ->> 'avatar_url', i.identity_data ->> 'picture') into v
    from auth.identities i where i.user_id = auth.uid() and i.provider = 'google' limit 1;
    if v is null then
      select coalesce(raw_user_meta_data ->> 'avatar_url', raw_user_meta_data ->> 'picture') into v from auth.users where id = auth.uid();
    end if;
    if v is null or v not like 'https://%.googleusercontent.com/%' then raise exception 'no google photo'; end if;
  elsif p_avatar ~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]{1,40}\.(jpg|png|webp)$') then
    v := p_avatar;
  else
    raise exception 'bad avatar';
  end if;
  update profiles set avatar_url = v where id = auth.uid();
  return v;
end;
$$;
revoke all on function public.set_avatar(text) from public, anon;
grant execute on function public.set_avatar(text) to authenticated;

-- Moderation: an admin takes a photo down (the player can upload another).
create function public.admin_clear_avatar(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from admins a join auth.users u on lower(u.email) = lower(a.email)
    where u.id = auth.uid() and not coalesce(u.is_anonymous, false)
  ) then raise exception 'admin only'; end if;
  update profiles set avatar_url = null where id = p_user;
end;
$$;
revoke all on function public.admin_clear_avatar(uuid) from public, anon;
grant execute on function public.admin_clear_avatar(uuid) to authenticated;

-- The photos themselves: public to look at, each player writes only their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "players see their own photo files" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "players upload their own photo" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "players delete their own old photos" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ===== 20260929000000_friends_looks.sql =====
-- Saved friends (request + accept), direct table invites, and board looks
-- (felt color + domino style, each player's own). Players only read these
-- tables; every change goes through the `game` edge function.

-- ---------- friend codes ----------

-- 6 characters that are easy to read out loud (no 0/O, 1/I/L).
create function public.new_friend_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  v text;
begin
  loop
    select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + floor(random() * 31)::int, 1), '')
    into v from generate_series(1, 6);
    exit when not exists (select 1 from profiles where friend_code = v);
  end loop;
  return v;
end;
$$;

alter table public.profiles add column friend_code text unique;
do $$
declare
  r record;
begin
  for r in select id from public.profiles where friend_code is null loop
    update public.profiles set friend_code = public.new_friend_code() where id = r.id;
  end loop;
end;
$$;
alter table public.profiles alter column friend_code set default public.new_friend_code();
alter table public.profiles alter column friend_code set not null;

-- ---------- friends ----------

-- One row per pair (user_a < user_b). Pending until the other one accepts.
create table public.friendships (
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_a, user_b),
  check (user_a < user_b),
  check (requested_by in (user_a, user_b))
);
create index friendships_user_b on public.friendships (user_b);
alter table public.friendships enable row level security;
create policy "players see their own friendships" on public.friendships for select to authenticated
  using (auth.uid() in (user_a, user_b));

-- ---------- invites ----------

-- The latest invite from one friend to another (a new one replaces the old).
-- `details` is what the invite card shows, so the friend can read it without
-- being at the table yet.
create table public.table_invites (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles (id) on delete cascade,
  to_user uuid not null references public.profiles (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete cascade,
  tournament_id uuid references public.tournaments (id) on delete cascade,
  details jsonb not null default '{}',
  status text not null default 'sent' check (status in ('sent', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  unique (from_user, to_user),
  check ((room_id is null) <> (tournament_id is null))
);
create index table_invites_to_user on public.table_invites (to_user);
alter table public.table_invites enable row level security;
create policy "players see invites they sent or got" on public.table_invites for select to authenticated
  using (auth.uid() in (from_user, to_user));

-- ---------- board looks ----------

alter table public.profiles add column felt text not null default 'verde';
alter table public.profiles add column tiles text not null default 'marfil';

-- Looks bought with chips (level and free ones need no row).
create table public.owned_looks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  look text not null,
  bought_at timestamptz not null default now(),
  primary key (user_id, look)
);
alter table public.owned_looks enable row level security;
create policy "players see their own looks" on public.owned_looks for select to authenticated
  using (user_id = auth.uid());

alter table public.chip_ledger drop constraint chip_ledger_reason_check;
alter table public.chip_ledger add constraint chip_ledger_reason_check check (reason in (
  'welcome', 'daily', 'rescue', 'stake', 'payout', 'refund', 'side_bet', 'side_bet_win',
  'chest', 'chest_rush', 'purchase', 'admin', 'tournament_buyin', 'tournament_prize', 'look'
));

alter publication supabase_realtime add table public.friendships, public.table_invites;

-- ===== 20260930000000_set_seats.sql =====
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

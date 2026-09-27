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

-- ===== 20261001000000_missions.sql =====
-- Daily missions. Every day (Dominican calendar) everyone gets the same three:
-- one easy, one medium, one hard, picked from mission_defs by the date.
-- Progress counts when an online game with at least two people is settled
-- (so they can't be farmed against bots); rewards are claimed by the player,
-- and claiming all three unlocks a bonus (a silver chest, or chips if the
-- chest rack is full). Players read their own progress; everything else goes
-- through the functions below.

create table public.mission_defs (
  id text primary key,
  tier int not null check (tier between 1 and 3),
  kind text not null check (kind in ('play', 'win', 'hands', 'capicua', 'mode_1v1', 'mode_2v2', 'mode_ffa')),
  goal int not null check (goal > 0),
  chips int not null check (chips >= 0),
  xp int not null check (xp >= 0)
);
alter table public.mission_defs enable row level security;
create policy "missions are public" on public.mission_defs for select to authenticated using (true);

insert into public.mission_defs (id, tier, kind, goal, chips, xp) values
  ('play2',    1, 'play',     2, 150, 15),
  ('hands4',   1, 'hands',    4, 150, 15),
  ('pairs1',   1, 'mode_2v2', 1, 150, 15),
  ('solo1',    1, 'mode_1v1', 1, 150, 15),
  ('play4',    2, 'play',     4, 300, 30),
  ('win2',     2, 'win',      2, 300, 30),
  ('hands8',   2, 'hands',    8, 300, 30),
  ('all2',     2, 'mode_ffa', 2, 300, 30),
  ('capicua1', 3, 'capicua',  1, 500, 50),
  ('win4',     3, 'win',      4, 500, 50),
  ('hands15',  3, 'hands',   15, 450, 45);

create table public.mission_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  -- a mission_defs id, or 'bonus' once the all-three reward is claimed
  mission text not null,
  progress int not null default 0,
  claimed_at timestamptz,
  primary key (user_id, day, mission)
);
alter table public.mission_progress enable row level security;
create policy "players see their own missions" on public.mission_progress for select to authenticated using (user_id = auth.uid());

alter table public.chip_ledger drop constraint chip_ledger_reason_check;
alter table public.chip_ledger add constraint chip_ledger_reason_check check (reason in (
  'welcome', 'daily', 'rescue', 'stake', 'payout', 'refund', 'side_bet', 'side_bet_win',
  'chest', 'chest_rush', 'purchase', 'admin', 'tournament_buyin', 'tournament_prize', 'look', 'mission'
));

-- Today in the Dominican Republic (UTC-4 all year).
create function public.mission_day() returns date
language sql stable as $$ select (now() at time zone 'America/Santo_Domingo')::date $$;

-- The day's three missions: one per tier, the same for everyone.
create function public.missions_for(p_day date) returns setof public.mission_defs
language sql stable set search_path = public as $$
  select distinct on (tier) * from mission_defs order by tier, md5(p_day::text || id)
$$;

-- A game was settled: count it towards everyone's missions. Never lets a
-- problem here stop the game from finishing.
create function public.count_missions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_day date := mission_day();
  v_state jsonb := new.public_state;
  v_mode text := new.public_state -> 'rules' ->> 'mode';
  v_winner int := (new.public_state ->> 'winner')::int;
  v_seat record;
  v_mission record;
  v_side int;
  v_add int;
begin
  begin
    if (select count(*) from room_seats where room_id = new.room_id and user_id is not null and not is_bot) < 2 then
      return new;
    end if;
    for v_seat in
      select seat, user_id from room_seats where room_id = new.room_id and user_id is not null and not is_bot and not left_game
    loop
      v_side := case when v_mode = '2v2' then v_seat.seat % 2 else v_seat.seat end;
      for v_mission in select id, kind from missions_for(v_day) loop
        v_add := case v_mission.kind
          when 'play' then 1
          when 'win' then case when v_winner = v_side then 1 else 0 end
          when 'hands' then coalesce((v_state -> 'tally' -> 'hands' ->> v_side)::int, 0)
          when 'capicua' then coalesce((v_state -> 'tally' -> 'capicuas' ->> v_side)::int, 0)
          when 'mode_1v1' then case when v_mode = '1v1' then 1 else 0 end
          when 'mode_2v2' then case when v_mode = '2v2' then 1 else 0 end
          when 'mode_ffa' then case when v_mode = 'ffa' then 1 else 0 end
          else 0
        end;
        if v_add > 0 then
          insert into mission_progress (user_id, day, mission, progress) values (v_seat.user_id, v_day, v_mission.id, v_add)
          on conflict (user_id, day, mission) do update set progress = mission_progress.progress + excluded.progress;
        end if;
      end loop;
    end loop;
  exception when others then
    raise warning 'count_missions failed for game %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
create trigger count_missions after update of settled on public.games
  for each row when (new.settled and not old.settled) execute function public.count_missions();

-- Today's missions with my progress, plus the bonus row (tier 4).
create function public.my_missions()
returns table (id text, tier int, kind text, goal int, chips int, xp int, progress int, claimed boolean, resets_at timestamptz)
language sql stable security definer set search_path = public as $$
  with today as (select mission_day() as d),
  mine as (
    select m.id, m.tier, m.kind, m.goal, m.chips, m.xp, coalesce(p.progress, 0) as progress, p.claimed_at is not null as claimed
    from missions_for((select d from today)) m
    left join mission_progress p on p.user_id = auth.uid() and p.day = (select d from today) and p.mission = m.id
  )
  select mine.*, ((select d from today) + 1)::timestamp at time zone 'America/Santo_Domingo' from mine
  union all
  select 'bonus', 4, 'bonus', 3, 0, 0,
    (select count(*)::int from mine where claimed),
    exists (select 1 from mission_progress where user_id = auth.uid() and day = (select d from today) and mission = 'bonus'),
    ((select d from today) + 1)::timestamp at time zone 'America/Santo_Domingo'
  order by 2
$$;

-- Collect a finished mission's chips and XP, or ('bonus') the all-three reward.
create function public.claim_mission(p_mission text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_day date := mission_day();
  v_def mission_defs%rowtype;
  v_slot int;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from auth.users where id = v_uid and coalesce(is_anonymous, false)) then raise exception 'guest_missions'; end if;
  if exists (select 1 from profiles where id = v_uid and banned_until > now()) then raise exception 'banned'; end if;

  if p_mission = 'bonus' then
    if (select count(*) from mission_progress p join missions_for(v_day) m on m.id = p.mission
        where p.user_id = v_uid and p.day = v_day and p.claimed_at is not null) < 3 then
      raise exception 'mission_not_done';
    end if;
    insert into mission_progress (user_id, day, mission, progress, claimed_at) values (v_uid, v_day, 'bonus', 3, now())
    on conflict (user_id, day, mission) do nothing;
    if not found then raise exception 'mission_claimed'; end if;
    select s into v_slot from generate_series(0, 3) s
    where s not in (select slot from chests where user_id = v_uid) order by s limit 1;
    if v_slot is not null then
      insert into chests (user_id, slot, kind) values (v_uid, v_slot, 'silver');
      return jsonb_build_object('chest', 'silver');
    end if;
    update profiles set chips = chips + 400 where id = v_uid;
    insert into chip_ledger (user_id, delta, reason, note) values (v_uid, 400, 'mission', 'bonus');
    return jsonb_build_object('chips', 400);
  end if;

  select * into v_def from missions_for(v_day) m where m.id = p_mission;
  if not found then raise exception 'no_mission'; end if;
  update mission_progress set claimed_at = now()
  where user_id = v_uid and day = v_day and mission = p_mission and claimed_at is null and progress >= v_def.goal;
  if not found then
    if exists (select 1 from mission_progress where user_id = v_uid and day = v_day and mission = p_mission and claimed_at is not null) then
      raise exception 'mission_claimed';
    end if;
    raise exception 'mission_not_done';
  end if;
  update profiles set chips = chips + v_def.chips, xp = xp + v_def.xp where id = v_uid;
  insert into chip_ledger (user_id, delta, reason, note) values (v_uid, v_def.chips, 'mission', v_def.id);
  return jsonb_build_object('chips', v_def.chips, 'xp', v_def.xp);
end;
$$;

revoke all on function public.my_missions() from public, anon;
revoke all on function public.claim_mission(text) from public, anon;
grant execute on function public.my_missions() to authenticated;
grant execute on function public.claim_mission(text) to authenticated;

-- ===== 20261001000100_watch.sql =====
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

-- ===== 20261001000200_push.sql =====
-- Push notifications. A player's devices subscribe (Web Push); when something
-- should buzz their phone — a table invite, a friend request or answer, a
-- tournament match that's ready — a trigger queues an HTTP call (pg_net, sent
-- after the transaction commits) to the `push` edge function, which writes the
-- message in the device's language and sends it. Nothing here can make the
-- action that caused it fail.

do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net not available here: %', sqlerrm;
end;
$$;

-- Server-only settings (no policies: players can't read them).
create table public.app_secrets (
  key text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;
insert into public.app_secrets (key, value) values
  -- The database proves it's the caller with this.
  ('push_hook', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')),
  -- Where the push function lives. A new Supabase project must update this row.
  ('push_url', 'https://acohdemaxyzembfztior.supabase.co/functions/v1/push');
-- ('vapid_keys' and 'vapid_public' are created by the push function the first time it runs.)

create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  lang text not null default 'es' check (lang in ('es', 'en')),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "players see their own devices" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());

-- This device wants notifications for me (the latest owner of a device wins).
create function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_lang text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000
     or coalesce(length(p_p256dh), 0) not between 60 and 120 or coalesce(length(p_auth), 0) not between 16 and 40 then
    raise exception 'bad_subscription';
  end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth, lang)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, case when p_lang = 'en' then 'en' else 'es' end)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang;
  -- At most 10 devices per player: the oldest go.
  delete from push_subscriptions where endpoint in (
    select endpoint from push_subscriptions where user_id = auth.uid() order by created_at desc offset 10
  );
end;
$$;

create function public.push_unsubscribe(p_endpoint text) returns void
language sql volatile security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- The public half of the app's push keys (browsers need it to subscribe).
create function public.push_public_key() returns text
language sql stable security definer set search_path = public as $$
  select value from app_secrets where key = 'vapid_public';
$$;

revoke all on function public.push_subscribe(text, text, text, text) from public, anon;
revoke all on function public.push_unsubscribe(text) from public, anon;
revoke all on function public.push_public_key() from public, anon;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;
grant execute on function public.push_unsubscribe(text) to authenticated;
grant execute on function public.push_public_key() to authenticated;

-- Queue a notification for a player (only if they have a device subscribed).
create function public.notify_push(p_user uuid, p_payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or not exists (select 1 from push_subscriptions where user_id = p_user) then return; end if;
  perform net.http_post(
    url := (select value from app_secrets where key = 'push_url'),
    body := jsonb_build_object('user', p_user, 'payload', p_payload),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-hook', (select value from app_secrets where key = 'push_hook')),
    timeout_milliseconds := 8000
  );
exception when others then
  raise warning 'notify_push failed: %', sqlerrm;
end;
$$;
revoke all on function public.notify_push(uuid, jsonb) from public, anon, authenticated;

-- A friend invited me to a table or tournament (a re-sent invite counts again).
create function public.push_on_invite() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status <> 'sent' or old.created_at <> new.created_at) then
    perform notify_push(new.to_user, jsonb_build_object('kind', 'invite', 'invite', new.id, 'details', new.details));
  end if;
  return new;
end;
$$;
create trigger push_on_invite after insert or update on public.table_invites
  for each row execute function public.push_on_invite();

-- Someone asked to be my friend / accepted my request.
create function public.push_on_friendship() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_other uuid := case when new.requested_by = new.user_a then new.user_b else new.user_a end;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform notify_push(v_other, jsonb_build_object('kind', 'friend_request',
      'name', (select display_name from profiles where id = new.requested_by)));
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    perform notify_push(new.requested_by, jsonb_build_object('kind', 'friend_accepted',
      'name', (select display_name from profiles where id = v_other)));
  end if;
  return new;
end;
$$;
create trigger push_on_friendship after insert or update on public.friendships
  for each row execute function public.push_on_friendship();

-- My tournament match just opened: two minutes to press Ready.
create function public.push_on_match_ready() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_t record;
  v_player uuid;
begin
  if new.status = 'ready' and old.status is distinct from 'ready' then
    select name, code into v_t from tournaments where id = new.tournament_id;
    for v_player in
      select p from tournament_entries e, unnest(array[e.player1, e.player2]) p
      where e.id in (new.entry_a, new.entry_b) and p is not null
    loop
      perform notify_push(v_player, jsonb_build_object('kind', 'match_ready', 'name', v_t.name, 'code', v_t.code));
    end loop;
  end if;
  return new;
end;
$$;
create trigger push_on_match_ready after update on public.tournament_matches
  for each row execute function public.push_on_match_ready();

-- ===== 20261002000000_fair_play.sql =====
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

-- ===== 20261003000000_arcade.sql =====
-- Capicúa Arcade: 2v2, first team to three hands, powers earned in play (up to two held).
-- The ruleset lives in the room's and game's rules (rules.ruleset = 'arcade';
-- anything without it is Traditional). This migration keeps the two apart:
--   * the matchmaking queue knows which one you're waiting for;
--   * Arcade results go to their own counters, never to XP, Traditional
--     stats, missions or chests (the game function skips those);
--   * games remember their ruleset for history and the admin.

alter table public.queue
  add column ruleset text not null default 'traditional' check (ruleset in ('traditional', 'arcade'));
drop index if exists public.queue_stake_mode_joined_at_idx;
create index queue_match on public.queue (stake, mode, ruleset, joined_at);

alter table public.profiles
  add column arcade_games int not null default 0,
  add column arcade_wins int not null default 0;

alter table public.games add column ruleset text;

create or replace function public.games_fill_kind() returns trigger
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
  new.ruleset := coalesce(new.ruleset, new.public_state->'rules'->>'ruleset', 'traditional');
  return new;
end;
$$;
revoke all on function public.games_fill_kind() from public, anon, authenticated;

update public.games set ruleset = coalesce(public_state->'rules'->>'ruleset', 'traditional') where ruleset is null;

-- Daily missions count Traditional games only.
drop trigger if exists count_missions on public.games;
create trigger count_missions after update of settled on public.games
  for each row when (new.settled and not old.settled and coalesce(new.public_state->'rules'->>'ruleset', 'traditional') <> 'arcade')
  execute function public.count_missions();

-- ===== 20261004000000_presence_forfeit.sql =====
-- Switching tables and "last online".
--   * room_seats.forfeited: the player walked out of a game in progress to accept
--     an invite to another table. The server plays that chair to the end (stake
--     stays in the pot, leaver XP applies) and it no longer counts as their table.
--   * user_presence: when each player was last in the app, shown on profile cards
--     unless they turned it off in Settings. Read only through last_seen_of().

alter table public.room_seats add column forfeited boolean not null default false;

create table public.user_presence (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  show_last_seen boolean not null default true
);
alter table public.user_presence enable row level security;
-- No policies: only the functions below read or write it.

-- The app calls this while it's open. At most one write a minute per player.
create function public.touch_presence() returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into user_presence (user_id) values (auth.uid())
  on conflict (user_id) do update set last_seen_at = now()
  where user_presence.last_seen_at < now() - interval '1 minute';
end $$;

create function public.set_last_seen_visible(p_show boolean) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null or p_show is null then return; end if;
  insert into user_presence (user_id, show_last_seen) values (auth.uid(), p_show)
  on conflict (user_id) do update set show_last_seen = excluded.show_last_seen;
end $$;

-- Settings: is my "last online" showing?
create function public.my_presence() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('show_last_seen', coalesce((select show_last_seen from user_presence where user_id = auth.uid()), true));
$$;

-- When a player was last in the app; null if they hide it (you always see your own).
create function public.last_seen_of(p_user uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select last_seen_at from user_presence
  where user_id = p_user and auth.uid() is not null and (show_last_seen or user_id = auth.uid());
$$;

revoke all on function public.touch_presence() from public, anon;
revoke all on function public.set_last_seen_visible(boolean) from public, anon;
revoke all on function public.my_presence() from public, anon;
revoke all on function public.last_seen_of(uuid) from public, anon;
grant execute on function public.touch_presence() to authenticated;
grant execute on function public.set_last_seen_visible(boolean) to authenticated;
grant execute on function public.my_presence() to authenticated;
grant execute on function public.last_seen_of(uuid) to authenticated;

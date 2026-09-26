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

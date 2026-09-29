-- Just enough of the production database to test live-match sharing on a real Postgres
-- (PGlite): Supabase's roles and auth.uid(), and the tables, helper functions and
-- policies the share migration builds on — columns and policies as they are live.
-- The watch (20261001000100) and spectators (20261008000000) migrations are applied on
-- top of this unchanged, then the share migration itself.

create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, is_anonymous boolean not null default false);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create publication supabase_realtime;

-- Supabase gives the API roles table access by default; RLS decides the rows.
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Jugador',
  chips bigint not null default 5000,
  xp int not null default 0,
  avatar_url text,
  friend_code text,
  ban_reason text,
  banned_until timestamptz,
  last_daily date,
  needs_name boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles are public to players" on public.profiles for select to authenticated using (true);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  kind text not null default 'custom',
  mode text not null default '2v2',
  rules jsonb not null default '{}',
  stake int not null default 0,
  turn_seconds int not null default 25,
  visibility text not null default 'private',
  host uuid,
  phase text not null default 'lobby',
  phase_ends_at timestamptz,
  current_game uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tournament_id uuid
);
create table public.room_seats (
  room_id uuid not null references public.rooms (id) on delete cascade,
  seat smallint not null,
  user_id uuid references public.profiles (id),
  is_bot boolean not null default false,
  name text not null,
  level int not null default 1,
  ready boolean not null default false,
  away boolean not null default false,
  left_game boolean not null default false,
  strikes int not null default 0,
  forfeited boolean not null default false,
  primary key (room_id, seat)
);
create table public.games (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.rooms (id) on delete cascade,
  public_state jsonb not null default '{}',
  version int not null default 0,
  stake int not null default 0,
  pot bigint not null default 0,
  turn_ms int not null default 15000,
  auto_delay_ms int,
  finished_at timestamptz,
  settled boolean not null default false,
  created_at timestamptz not null default now(),
  sponsor_id uuid
);
create table public.game_hands (
  game_id uuid not null references public.games (id) on delete cascade,
  seat smallint not null,
  user_id uuid,
  tiles jsonb not null,
  primary key (game_id, seat)
);
create table public.game_private (game_id uuid primary key references public.games (id) on delete cascade, state jsonb not null);
create table public.side_bets (
  id bigserial primary key,
  room_id uuid,
  game_id uuid,
  user_id uuid not null,
  kind text not null,
  amount int not null
);
create table public.friendships (user_a uuid not null, user_b uuid not null, status text not null, primary key (user_a, user_b));

alter table public.rooms enable row level security;
alter table public.room_seats enable row level security;
alter table public.games enable row level security;
alter table public.game_hands enable row level security;
alter table public.game_private enable row level security;
alter table public.side_bets enable row level security;
alter table public.friendships enable row level security;

create function public.is_room_member(p_room uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from room_seats where room_id = p_room and user_id = auth.uid());
$$;
create function public.is_listed_room(p_room uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from rooms where id = p_room and kind = 'custom' and visibility = 'public' and phase = 'lobby');
$$;

create policy "members and browsers see rooms" on public.rooms for select to authenticated using (is_room_member(id) or is_listed_room(id));
create policy "members and browsers see seats" on public.room_seats for select to authenticated using (is_room_member(room_id) or is_listed_room(room_id));
create policy "members see the game" on public.games for select to authenticated using (is_room_member(room_id));
create policy "players see only their own tiles" on public.game_hands for select to authenticated using (user_id = auth.uid());
create policy "players see their own side bets" on public.side_bets for select to authenticated using (user_id = auth.uid());
create policy "friends see their friendships" on public.friendships for select to authenticated using (auth.uid() in (user_a, user_b));

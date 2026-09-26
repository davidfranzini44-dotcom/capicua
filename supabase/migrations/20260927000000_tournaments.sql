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

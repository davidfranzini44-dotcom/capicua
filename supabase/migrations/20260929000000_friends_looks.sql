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

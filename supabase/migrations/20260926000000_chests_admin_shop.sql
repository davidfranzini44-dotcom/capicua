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

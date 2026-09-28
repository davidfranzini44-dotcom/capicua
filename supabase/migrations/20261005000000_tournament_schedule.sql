-- Tournaments on a clock, so everyone signed up actually plays:
--   * starts_at: the host picks a start time. Check-in opens 15 minutes before;
--     at the start, whoever hasn't checked in is taken off the list (buy-in
--     back) before the draw, so no-shows never make it into the bracket.
--   * reminded: which check-in reminders went out (1 = check-in open, 2 = last call).
--   * tournament_matches.reminded: the "1 minute left to press Ready" buzz went out.
--   * result 'no_show': nobody from either side came; both are out and the
--     other side of the next match goes straight through.
--   * A server clock (pg_cron, every 30 s) calls the `game` function so starts,
--     Ready deadlines and abandoned games move on even with every app closed.

alter table public.tournaments add column starts_at timestamptz;
alter table public.tournaments add column reminded smallint not null default 0;
alter table public.tournaments add column cancel_reason text check (cancel_reason in ('host', 'not_enough'));
create index tournaments_scheduled on public.tournaments (starts_at) where phase = 'lobby';

create table public.tournament_checkins (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  checked_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);
alter table public.tournament_checkins enable row level security;
create policy "members see who checked in" on public.tournament_checkins for select to authenticated
  using (public.is_tournament_member(tournament_id));
alter publication supabase_realtime add table public.tournament_checkins;

alter table public.tournament_matches add column reminded boolean not null default false;
alter table public.tournament_matches drop constraint tournament_matches_result_check;
alter table public.tournament_matches add constraint tournament_matches_result_check
  check (result in ('played', 'bye', 'forfeit', 'no_show'));

-- ---------- the server clock ----------

do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron not available here: %', sqlerrm;
end;
$$;

-- The database proves it's the clock with this. ('game_url' and 'anon_key' —
-- the project's public anon key, which the function gateway wants — are written
-- by the game function itself the first time it runs.)
insert into public.app_secrets (key, value)
values ('cron_hook', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- Every 30 s: if any tournament has something that could be due, nudge the game function.
create function public.tournament_cron() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text := (select value from app_secrets where key = 'game_url');
  v_key text := (select value from app_secrets where key = 'anon_key');
begin
  if v_url is null or v_key is null then return; end if;
  if not exists (
    select 1 from tournaments
    where phase = 'playing' or (phase = 'lobby' and starts_at < now() + interval '16 minutes')
  ) then return; end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('action', 'cron'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'x-cron-hook', (select value from app_secrets where key = 'cron_hook')),
    timeout_milliseconds := 25000
  );
exception when others then
  raise warning 'tournament_cron failed: %', sqlerrm;
end;
$$;
revoke all on function public.tournament_cron() from public, anon, authenticated;

do $$
begin
  perform cron.schedule('capicua-tournaments', '30 seconds', 'select public.tournament_cron()');
exception when others then
  raise notice 'could not schedule the tournament clock: %', sqlerrm;
end;
$$;

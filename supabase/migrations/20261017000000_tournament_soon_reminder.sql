-- Signed up for a tournament: the phone reminds you 3 hours before it starts (the owner's call,
-- 2026-09-30: once you're signed up the home screen stops showing it, and the reminder brings you
-- back instead). It comes on top of the check-in reminders 15 and 3 minutes before.
--   * Sent by the server clock (tournament_cron, every 30 s) once per tournament (soon_reminded),
--     to everyone who signed up before the 3-hour mark (whoever joins later just saw it).
--   * A new start time sends it again (the trigger clears soon_reminded).
--   * The push function words it ('tournament_soon', with the minutes left).

alter table public.tournaments add column soon_reminded boolean not null default false;

create function public.tournament_soon_reset() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.starts_at is distinct from old.starts_at then new.soon_reminded := false; end if;
  return new;
end;
$$;
create trigger tournament_soon_reset before update of starts_at on public.tournaments
  for each row execute function public.tournament_soon_reset();

-- Tournaments starting within 3 hours (but not within 20 minutes: check-in reminders take over).
create function public.tournament_soon_reminders() returns void
language plpgsql security definer set search_path = public as $$
declare
  t record;
begin
  for t in
    update tournaments set soon_reminded = true
    where phase = 'lobby' and not soon_reminded and starts_at is not null
      and starts_at <= now() + interval '3 hours' and starts_at > now() + interval '20 minutes'
    returning id, name, code, starts_at
  loop
    perform notify_push(p.uid, jsonb_build_object(
      'kind', 'tournament_soon', 'name', t.name, 'code', t.code,
      'minutes', greatest(1, round(extract(epoch from t.starts_at - now()) / 60))::int))
    from (
      select distinct x.uid
      from tournament_entries e, unnest(array[e.player1, e.player2]) as x(uid)
      where e.tournament_id = t.id and x.uid is not null and e.created_at < t.starts_at - interval '3 hours'
    ) p;
  end loop;
end;
$$;
revoke all on function public.tournament_soon_reminders() from public, anon, authenticated;

-- The clock: the 3-hour reminders first (never in the way of the rest), then as before.
create or replace function public.tournament_cron() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text := (select value from app_secrets where key = 'game_url');
  v_key text := coalesce(
    (select value from app_secrets where key = 'anon_jwt'),
    (select value from app_secrets where key = 'anon_key' and value like 'eyJ%'));
begin
  begin
    perform tournament_soon_reminders();
  exception when others then
    raise warning 'tournament_soon_reminders failed: %', sqlerrm;
  end;
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

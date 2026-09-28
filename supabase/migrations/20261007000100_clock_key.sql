-- The tournament clock must reach the game function through its gateway, which
-- only accepts a JWT. Projects on Supabase's new API keys give the function an
-- sb_publishable_… key instead, so the clock reads its own row, 'anon_jwt' — the
-- project's legacy anon key (Settings → API Keys → Legacy), set once by hand:
--   insert into app_secrets (key, value) values ('anon_jwt', '<legacy anon key>')
--   on conflict (key) do update set value = excluded.value;
-- It falls back to 'anon_key' (written by the function) only when that is a JWT.

create or replace function public.tournament_cron() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text := (select value from app_secrets where key = 'game_url');
  v_key text := coalesce(
    (select value from app_secrets where key = 'anon_jwt'),
    (select value from app_secrets where key = 'anon_key' and value like 'eyJ%'));
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

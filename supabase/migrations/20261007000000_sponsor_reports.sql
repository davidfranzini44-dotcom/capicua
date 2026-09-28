-- Sponsors: a package of views, and a private report link for the company.
--   * max_views: views paid for (a view = one player at one game with the logo);
--     the campaign stops being picked once views_used reaches it. Null = no cap.
--   * views_used: counted by the game function as each sponsored game is dealt.
--   * report_token: the secret in the sponsor's report link (/?reporte=…). The
--     admin can replace it, which turns the old link off.
--   * sponsor_report(token): what that page shows — no sign-in needed, totals only
--     (never who the players are).

alter table public.sponsors add column max_views int check (max_views is null or max_views > 0);
alter table public.sponsors add column views_used int not null default 0;
alter table public.sponsors add column report_token text not null unique default replace(gen_random_uuid()::text, '-', '');

-- Players only need what prints the logo — not the report link or the package.
revoke select on public.sponsors from anon, authenticated;
grant select (id, name, image_path, link, style, opacity, size) on public.sponsors to authenticated;

create function public.sponsor_report(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (select * from sponsors where report_token = p_token and length(p_token) >= 24),
  hands as (
    select g.created_at, h.user_id from games g join game_hands h on h.game_id = g.id
    where g.sponsor_id = (select id from s) and h.user_id is not null
  ),
  today as (select (now() at time zone 'America/Santo_Domingo')::date as d)
  select jsonb_build_object(
    'name', s.name, 'image_path', s.image_path, 'link', s.link, 'style', s.style, 'opacity', s.opacity, 'size', s.size,
    'salas', s.salas, 'custom', s.custom, 'tournaments', s.tournaments, 'tournament_codes', s.tournament_codes,
    'starts_at', s.starts_at, 'ends_at', s.ends_at, 'paused', s.paused,
    'max_views', s.max_views, 'views_used', s.views_used,
    'games', (select count(*) from games where sponsor_id = s.id),
    'players', (select count(distinct user_id) from hands),
    'views', (select count(*) from hands),
    'taps', (select count(*) from sponsor_taps where sponsor_id = s.id),
    'tappers', (select count(distinct user_id) from sponsor_taps where sponsor_id = s.id),
    'days', (
      select jsonb_agg(jsonb_build_object('day', d.day, 'views', coalesce(v.n, 0), 'taps', coalesce(k.n, 0)) order by d.day)
      from (select generate_series((select d from today) - 29, (select d from today), interval '1 day')::date as day) d
      left join (select (created_at at time zone 'America/Santo_Domingo')::date as day, count(*) as n from hands group by 1) v on v.day = d.day
      left join (
        select (created_at at time zone 'America/Santo_Domingo')::date as day, count(*) as n
        from sponsor_taps where sponsor_id = s.id group by 1
      ) k on k.day = d.day
    ),
    'updated_at', now()
  )
  from s;
$$;
revoke all on function public.sponsor_report(text) from public;
grant execute on function public.sponsor_report(text) to anon, authenticated;

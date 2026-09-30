-- Open tournaments (the owner's call, 2026-09-30):
--   * the host picks, before creating it, private (only with the code or an invite, as before)
--     or public: listed in Mesas → Torneos abiertos for anyone to join;
--   * admins make official tournaments: "Capicúa" organizes them (the admin doesn't play),
--     always public, with an optional house prize added to the pot (split 70/30 like the rest;
--     never paid if it's called off) and a description for the details players see first;
--   * admins pick which public tournaments show on the home screen (featured), and may buzz
--     everyone with notifications on about one, once ("Avisar a todos", announced_at).
-- The tables stay members-only: everyone else reads public tournaments through
-- public_tournaments() below. Every change still goes through the `game` function.

alter table public.tournaments
  add column visibility text not null default 'private' check (visibility in ('private', 'public')),
  add column official boolean not null default false,
  add column featured boolean not null default false,
  add column prize bigint not null default 0 check (prize >= 0),
  add column description text check (char_length(description) <= 200),
  add column announced_at timestamptz,
  add constraint tournaments_official_public check (not official or visibility = 'public'),
  add constraint tournaments_featured_public check (not featured or visibility = 'public');

create index tournaments_open on public.tournaments (starts_at) where phase = 'lobby' and visibility = 'public';

-- Public tournaments still taking sign-ups, soonest first (official and featured ones on top):
-- all of them for Mesas → Torneos abiertos, or only the featured ones for the home screen.
-- `member`: I'm signed up (or organize it). Anyone may read these, signed in or not.
create function public.public_tournaments(p_featured_only boolean default false)
returns table (
  id uuid, code text, name text, mode text, size int, buy_in int, prize bigint, pot bigint,
  starts_at timestamptz, seeding text, official boolean, featured boolean, host text,
  description text, people int, capacity int, member boolean
)
language sql stable security definer set search_path = '' as $$
  select t.id, t.code, t.name, t.mode, t.size, t.buy_in, t.prize, t.pot,
    t.starts_at, t.seeding, t.official, t.featured,
    case when t.official then 'Capicúa' else h.display_name end,
    t.description,
    coalesce((select sum(case when e.player2 is null then 1 else 2 end)::int
              from public.tournament_entries e where e.tournament_id = t.id), 0),
    t.size * case when t.mode = '2v2' then 2 else 1 end,
    auth.uid() is not null and (t.host = auth.uid() or exists (
      select 1 from public.tournament_entries e where e.tournament_id = t.id and auth.uid() in (e.player1, e.player2)))
  from public.tournaments t
  join public.profiles h on h.id = t.host
  where t.visibility = 'public' and t.phase = 'lobby'
    and (t.starts_at is null or t.starts_at > now())
    and (t.featured or not p_featured_only)
  order by t.official desc, t.featured desc, t.starts_at nulls last, t.created_at
  limit 30;
$$;
revoke all on function public.public_tournaments(boolean) from public;
grant execute on function public.public_tournaments(boolean) to anon, authenticated;

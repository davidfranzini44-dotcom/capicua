-- Sponsored tables. The admin uploads a company's logo, picks which tables it
-- goes on (public salas by stake, private tables, tournaments) and for how long;
-- the game function stamps one sponsor on each game as it's dealt, and every
-- player at that table sees the logo printed on the felt. Taps on "Patrocinado
-- por…" are counted so the admin can show the sponsor what they got.

-- Is the signed-in user an admin? (Same rule as the game function: listed email, not a guest.)
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from admins a join auth.users u on lower(u.email) = lower(a.email)
    where u.id = auth.uid() and not coalesce(u.is_anonymous, false)
  );
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create table public.sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 40),
  -- the prepared logo, in the public `sponsors` bucket
  image_path text not null,
  link text check (link is null or link ~ '^https://'),
  style text not null default 'color' check (style in ('color', 'white')),
  opacity real not null default 0.4 check (opacity between 0.1 and 0.9),
  -- logo width as a share of the table's oval
  size real not null default 0.6 check (size between 0.3 and 0.9),
  -- public tables by stake (0 = friendly)
  salas int[] not null default '{}',
  custom boolean not null default false,
  tournaments boolean not null default false,
  -- only these tournaments (empty = all of them)
  tournament_codes text[] not null default '{}',
  weight int not null default 1 check (weight between 1 and 10),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  paused boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.sponsors enable row level security;
-- Players load the one on their table; nothing here is private. Changes go through the game function.
create policy "players see sponsors" on public.sponsors for select to authenticated using (true);

alter table public.games add column sponsor_id uuid references public.sponsors (id) on delete set null;
create index games_sponsor on public.games (sponsor_id, created_at) where sponsor_id is not null;

create table public.sponsor_taps (
  id bigserial primary key,
  sponsor_id uuid not null references public.sponsors (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  game_id uuid references public.games (id) on delete set null,
  created_at timestamptz not null default now()
);
create index sponsor_taps_sponsor on public.sponsor_taps (sponsor_id, created_at);
alter table public.sponsor_taps enable row level security;

-- A player tapped "Patrocinado por…": count it (once a minute per player and sponsor).
create function public.sponsor_tap(p_sponsor uuid, p_game uuid default null) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from sponsors where id = p_sponsor) then return; end if;
  if exists (
    select 1 from sponsor_taps
    where sponsor_id = p_sponsor and user_id = auth.uid() and created_at > now() - interval '1 minute'
  ) then return; end if;
  insert into sponsor_taps (sponsor_id, user_id, game_id)
  values (p_sponsor, auth.uid(), (select id from games where id = p_game));
end;
$$;
revoke all on function public.sponsor_tap(uuid, uuid) from public, anon;
grant execute on function public.sponsor_tap(uuid, uuid) to authenticated;

-- Logos: public to read, only admins upload or remove.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sponsors', 'sponsors', true, 1048576, array['image/png', 'image/webp', 'image/jpeg'])
on conflict (id) do nothing;
create policy "admins upload sponsor logos" on storage.objects for insert to authenticated
  with check (bucket_id = 'sponsors' and public.is_admin());
create policy "admins replace sponsor logos" on storage.objects for update to authenticated
  using (bucket_id = 'sponsors' and public.is_admin());
create policy "admins remove sponsor logos" on storage.objects for delete to authenticated
  using (bucket_id = 'sponsors' and public.is_admin());

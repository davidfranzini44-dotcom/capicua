-- Switching tables and "last online".
--   * room_seats.forfeited: the player walked out of a game in progress to accept
--     an invite to another table. The server plays that chair to the end (stake
--     stays in the pot, leaver XP applies) and it no longer counts as their table.
--   * user_presence: when each player was last in the app, shown on profile cards
--     unless they turned it off in Settings. Read only through last_seen_of().

alter table public.room_seats add column forfeited boolean not null default false;

create table public.user_presence (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  show_last_seen boolean not null default true
);
alter table public.user_presence enable row level security;
-- No policies: only the functions below read or write it.

-- The app calls this while it's open. At most one write a minute per player.
create function public.touch_presence() returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into user_presence (user_id) values (auth.uid())
  on conflict (user_id) do update set last_seen_at = now()
  where user_presence.last_seen_at < now() - interval '1 minute';
end $$;

create function public.set_last_seen_visible(p_show boolean) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null or p_show is null then return; end if;
  insert into user_presence (user_id, show_last_seen) values (auth.uid(), p_show)
  on conflict (user_id) do update set show_last_seen = excluded.show_last_seen;
end $$;

-- Settings: is my "last online" showing?
create function public.my_presence() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('show_last_seen', coalesce((select show_last_seen from user_presence where user_id = auth.uid()), true));
$$;

-- When a player was last in the app; null if they hide it (you always see your own).
create function public.last_seen_of(p_user uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select last_seen_at from user_presence
  where user_id = p_user and auth.uid() is not null and (show_last_seen or user_id = auth.uid());
$$;

revoke all on function public.touch_presence() from public, anon;
revoke all on function public.set_last_seen_visible(boolean) from public, anon;
revoke all on function public.my_presence() from public, anon;
revoke all on function public.last_seen_of(uuid) from public, anon;
grant execute on function public.touch_presence() to authenticated;
grant execute on function public.set_last_seen_visible(boolean) to authenticated;
grant execute on function public.my_presence() to authenticated;
grant execute on function public.last_seen_of(uuid) to authenticated;

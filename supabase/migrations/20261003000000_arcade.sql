-- Capicúa Arcade: 2v2, first team to three hands, powers earned in play (up to two held).
-- The ruleset lives in the room's and game's rules (rules.ruleset = 'arcade';
-- anything without it is Traditional). This migration keeps the two apart:
--   * the matchmaking queue knows which one you're waiting for;
--   * Arcade results go to their own counters, never to XP, Traditional
--     stats, missions or chests (the game function skips those);
--   * games remember their ruleset for history and the admin.

alter table public.queue
  add column ruleset text not null default 'traditional' check (ruleset in ('traditional', 'arcade'));
drop index if exists public.queue_stake_mode_joined_at_idx;
create index queue_match on public.queue (stake, mode, ruleset, joined_at);

alter table public.profiles
  add column arcade_games int not null default 0,
  add column arcade_wins int not null default 0;

alter table public.games add column ruleset text;

create or replace function public.games_fill_kind() returns trigger
language plpgsql set search_path = public as $$
declare
  v_kind text;
  v_mode text;
begin
  if new.room_id is not null then
    select r.kind, r.mode into v_kind, v_mode from rooms r where r.id = new.room_id;
  end if;
  new.kind := coalesce(new.kind, v_kind);
  new.mode := coalesce(new.mode, v_mode, new.public_state->'rules'->>'mode');
  new.ruleset := coalesce(new.ruleset, new.public_state->'rules'->>'ruleset', 'traditional');
  return new;
end;
$$;
revoke all on function public.games_fill_kind() from public, anon, authenticated;

update public.games set ruleset = coalesce(public_state->'rules'->>'ruleset', 'traditional') where ruleset is null;

-- Daily missions count Traditional games only.
drop trigger if exists count_missions on public.games;
create trigger count_missions after update of settled on public.games
  for each row when (new.settled and not old.settled and coalesce(new.public_state->'rules'->>'ruleset', 'traditional') <> 'arcade')
  execute function public.count_missions();

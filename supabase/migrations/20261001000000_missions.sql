-- Daily missions. Every day (Dominican calendar) everyone gets the same three:
-- one easy, one medium, one hard, picked from mission_defs by the date.
-- Progress counts when an online game with at least two people is settled
-- (so they can't be farmed against bots); rewards are claimed by the player,
-- and claiming all three unlocks a bonus (a silver chest, or chips if the
-- chest rack is full). Players read their own progress; everything else goes
-- through the functions below.

create table public.mission_defs (
  id text primary key,
  tier int not null check (tier between 1 and 3),
  kind text not null check (kind in ('play', 'win', 'hands', 'capicua', 'mode_1v1', 'mode_2v2', 'mode_ffa')),
  goal int not null check (goal > 0),
  chips int not null check (chips >= 0),
  xp int not null check (xp >= 0)
);
alter table public.mission_defs enable row level security;
create policy "missions are public" on public.mission_defs for select to authenticated using (true);

insert into public.mission_defs (id, tier, kind, goal, chips, xp) values
  ('play2',    1, 'play',     2, 150, 15),
  ('hands4',   1, 'hands',    4, 150, 15),
  ('pairs1',   1, 'mode_2v2', 1, 150, 15),
  ('solo1',    1, 'mode_1v1', 1, 150, 15),
  ('play4',    2, 'play',     4, 300, 30),
  ('win2',     2, 'win',      2, 300, 30),
  ('hands8',   2, 'hands',    8, 300, 30),
  ('all2',     2, 'mode_ffa', 2, 300, 30),
  ('capicua1', 3, 'capicua',  1, 500, 50),
  ('win4',     3, 'win',      4, 500, 50),
  ('hands15',  3, 'hands',   15, 450, 45);

create table public.mission_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  -- a mission_defs id, or 'bonus' once the all-three reward is claimed
  mission text not null,
  progress int not null default 0,
  claimed_at timestamptz,
  primary key (user_id, day, mission)
);
alter table public.mission_progress enable row level security;
create policy "players see their own missions" on public.mission_progress for select to authenticated using (user_id = auth.uid());

alter table public.chip_ledger drop constraint chip_ledger_reason_check;
alter table public.chip_ledger add constraint chip_ledger_reason_check check (reason in (
  'welcome', 'daily', 'rescue', 'stake', 'payout', 'refund', 'side_bet', 'side_bet_win',
  'chest', 'chest_rush', 'purchase', 'admin', 'tournament_buyin', 'tournament_prize', 'look', 'mission'
));

-- Today in the Dominican Republic (UTC-4 all year).
create function public.mission_day() returns date
language sql stable as $$ select (now() at time zone 'America/Santo_Domingo')::date $$;

-- The day's three missions: one per tier, the same for everyone.
create function public.missions_for(p_day date) returns setof public.mission_defs
language sql stable set search_path = public as $$
  select distinct on (tier) * from mission_defs order by tier, md5(p_day::text || id)
$$;

-- A game was settled: count it towards everyone's missions. Never lets a
-- problem here stop the game from finishing.
create function public.count_missions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_day date := mission_day();
  v_state jsonb := new.public_state;
  v_mode text := new.public_state -> 'rules' ->> 'mode';
  v_winner int := (new.public_state ->> 'winner')::int;
  v_seat record;
  v_mission record;
  v_side int;
  v_add int;
begin
  begin
    if (select count(*) from room_seats where room_id = new.room_id and user_id is not null and not is_bot) < 2 then
      return new;
    end if;
    for v_seat in
      select seat, user_id from room_seats where room_id = new.room_id and user_id is not null and not is_bot and not left_game
    loop
      v_side := case when v_mode = '2v2' then v_seat.seat % 2 else v_seat.seat end;
      for v_mission in select id, kind from missions_for(v_day) loop
        v_add := case v_mission.kind
          when 'play' then 1
          when 'win' then case when v_winner = v_side then 1 else 0 end
          when 'hands' then coalesce((v_state -> 'tally' -> 'hands' ->> v_side)::int, 0)
          when 'capicua' then coalesce((v_state -> 'tally' -> 'capicuas' ->> v_side)::int, 0)
          when 'mode_1v1' then case when v_mode = '1v1' then 1 else 0 end
          when 'mode_2v2' then case when v_mode = '2v2' then 1 else 0 end
          when 'mode_ffa' then case when v_mode = 'ffa' then 1 else 0 end
          else 0
        end;
        if v_add > 0 then
          insert into mission_progress (user_id, day, mission, progress) values (v_seat.user_id, v_day, v_mission.id, v_add)
          on conflict (user_id, day, mission) do update set progress = mission_progress.progress + excluded.progress;
        end if;
      end loop;
    end loop;
  exception when others then
    raise warning 'count_missions failed for game %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
create trigger count_missions after update of settled on public.games
  for each row when (new.settled and not old.settled) execute function public.count_missions();

-- Today's missions with my progress, plus the bonus row (tier 4).
create function public.my_missions()
returns table (id text, tier int, kind text, goal int, chips int, xp int, progress int, claimed boolean, resets_at timestamptz)
language sql stable security definer set search_path = public as $$
  with today as (select mission_day() as d),
  mine as (
    select m.id, m.tier, m.kind, m.goal, m.chips, m.xp, coalesce(p.progress, 0) as progress, p.claimed_at is not null as claimed
    from missions_for((select d from today)) m
    left join mission_progress p on p.user_id = auth.uid() and p.day = (select d from today) and p.mission = m.id
  )
  select mine.*, ((select d from today) + 1)::timestamp at time zone 'America/Santo_Domingo' from mine
  union all
  select 'bonus', 4, 'bonus', 3, 0, 0,
    (select count(*)::int from mine where claimed),
    exists (select 1 from mission_progress where user_id = auth.uid() and day = (select d from today) and mission = 'bonus'),
    ((select d from today) + 1)::timestamp at time zone 'America/Santo_Domingo'
  order by 2
$$;

-- Collect a finished mission's chips and XP, or ('bonus') the all-three reward.
create function public.claim_mission(p_mission text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_day date := mission_day();
  v_def mission_defs%rowtype;
  v_slot int;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from auth.users where id = v_uid and coalesce(is_anonymous, false)) then raise exception 'guest_missions'; end if;
  if exists (select 1 from profiles where id = v_uid and banned_until > now()) then raise exception 'banned'; end if;

  if p_mission = 'bonus' then
    if (select count(*) from mission_progress p join missions_for(v_day) m on m.id = p.mission
        where p.user_id = v_uid and p.day = v_day and p.claimed_at is not null) < 3 then
      raise exception 'mission_not_done';
    end if;
    insert into mission_progress (user_id, day, mission, progress, claimed_at) values (v_uid, v_day, 'bonus', 3, now())
    on conflict (user_id, day, mission) do nothing;
    if not found then raise exception 'mission_claimed'; end if;
    select s into v_slot from generate_series(0, 3) s
    where s not in (select slot from chests where user_id = v_uid) order by s limit 1;
    if v_slot is not null then
      insert into chests (user_id, slot, kind) values (v_uid, v_slot, 'silver');
      return jsonb_build_object('chest', 'silver');
    end if;
    update profiles set chips = chips + 400 where id = v_uid;
    insert into chip_ledger (user_id, delta, reason, note) values (v_uid, 400, 'mission', 'bonus');
    return jsonb_build_object('chips', 400);
  end if;

  select * into v_def from missions_for(v_day) m where m.id = p_mission;
  if not found then raise exception 'no_mission'; end if;
  update mission_progress set claimed_at = now()
  where user_id = v_uid and day = v_day and mission = p_mission and claimed_at is null and progress >= v_def.goal;
  if not found then
    if exists (select 1 from mission_progress where user_id = v_uid and day = v_day and mission = p_mission and claimed_at is not null) then
      raise exception 'mission_claimed';
    end if;
    raise exception 'mission_not_done';
  end if;
  update profiles set chips = chips + v_def.chips, xp = xp + v_def.xp where id = v_uid;
  insert into chip_ledger (user_id, delta, reason, note) values (v_uid, v_def.chips, 'mission', v_def.id);
  return jsonb_build_object('chips', v_def.chips, 'xp', v_def.xp);
end;
$$;

revoke all on function public.my_missions() from public, anon;
revoke all on function public.claim_mission(text) from public, anon;
grant execute on function public.my_missions() to authenticated;
grant execute on function public.claim_mission(text) to authenticated;

-- Push notifications. A player's devices subscribe (Web Push); when something
-- should buzz their phone — a table invite, a friend request or answer, a
-- tournament match that's ready — a trigger queues an HTTP call (pg_net, sent
-- after the transaction commits) to the `push` edge function, which writes the
-- message in the device's language and sends it. Nothing here can make the
-- action that caused it fail.

do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net not available here: %', sqlerrm;
end;
$$;

-- Server-only settings (no policies: players can't read them).
create table public.app_secrets (
  key text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;
insert into public.app_secrets (key, value) values
  -- The database proves it's the caller with this.
  ('push_hook', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')),
  -- Where the push function lives. A new Supabase project must update this row.
  ('push_url', 'https://acohdemaxyzembfztior.supabase.co/functions/v1/push');
-- ('vapid_keys' and 'vapid_public' are created by the push function the first time it runs.)

create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  lang text not null default 'es' check (lang in ('es', 'en')),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "players see their own devices" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());

-- This device wants notifications for me (the latest owner of a device wins).
create function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_lang text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000
     or coalesce(length(p_p256dh), 0) not between 60 and 120 or coalesce(length(p_auth), 0) not between 16 and 40 then
    raise exception 'bad_subscription';
  end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth, lang)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, case when p_lang = 'en' then 'en' else 'es' end)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang;
  -- At most 10 devices per player: the oldest go.
  delete from push_subscriptions where endpoint in (
    select endpoint from push_subscriptions where user_id = auth.uid() order by created_at desc offset 10
  );
end;
$$;

create function public.push_unsubscribe(p_endpoint text) returns void
language sql volatile security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- The public half of the app's push keys (browsers need it to subscribe).
create function public.push_public_key() returns text
language sql stable security definer set search_path = public as $$
  select value from app_secrets where key = 'vapid_public';
$$;

revoke all on function public.push_subscribe(text, text, text, text) from public, anon;
revoke all on function public.push_unsubscribe(text) from public, anon;
revoke all on function public.push_public_key() from public, anon;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;
grant execute on function public.push_unsubscribe(text) to authenticated;
grant execute on function public.push_public_key() to authenticated;

-- Queue a notification for a player (only if they have a device subscribed).
create function public.notify_push(p_user uuid, p_payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or not exists (select 1 from push_subscriptions where user_id = p_user) then return; end if;
  perform net.http_post(
    url := (select value from app_secrets where key = 'push_url'),
    body := jsonb_build_object('user', p_user, 'payload', p_payload),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-hook', (select value from app_secrets where key = 'push_hook')),
    timeout_milliseconds := 8000
  );
exception when others then
  raise warning 'notify_push failed: %', sqlerrm;
end;
$$;
revoke all on function public.notify_push(uuid, jsonb) from public, anon, authenticated;

-- A friend invited me to a table or tournament (a re-sent invite counts again).
create function public.push_on_invite() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status <> 'sent' or old.created_at <> new.created_at) then
    perform notify_push(new.to_user, jsonb_build_object('kind', 'invite', 'invite', new.id, 'details', new.details));
  end if;
  return new;
end;
$$;
create trigger push_on_invite after insert or update on public.table_invites
  for each row execute function public.push_on_invite();

-- Someone asked to be my friend / accepted my request.
create function public.push_on_friendship() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_other uuid := case when new.requested_by = new.user_a then new.user_b else new.user_a end;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform notify_push(v_other, jsonb_build_object('kind', 'friend_request',
      'name', (select display_name from profiles where id = new.requested_by)));
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    perform notify_push(new.requested_by, jsonb_build_object('kind', 'friend_accepted',
      'name', (select display_name from profiles where id = v_other)));
  end if;
  return new;
end;
$$;
create trigger push_on_friendship after insert or update on public.friendships
  for each row execute function public.push_on_friendship();

-- My tournament match just opened: two minutes to press Ready.
create function public.push_on_match_ready() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_t record;
  v_player uuid;
begin
  if new.status = 'ready' and old.status is distinct from 'ready' then
    select name, code into v_t from tournaments where id = new.tournament_id;
    for v_player in
      select p from tournament_entries e, unnest(array[e.player1, e.player2]) p
      where e.id in (new.entry_a, new.entry_b) and p is not null
    loop
      perform notify_push(v_player, jsonb_build_object('kind', 'match_ready', 'name', v_t.name, 'code', v_t.code));
    end loop;
  end if;
  return new;
end;
$$;
create trigger push_on_match_ready after update on public.tournament_matches
  for each row execute function public.push_on_match_ready();

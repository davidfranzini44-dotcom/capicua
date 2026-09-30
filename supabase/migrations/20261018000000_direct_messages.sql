-- Private one-to-one messages between accepted friends.
-- Reads use RLS + Realtime; writes and read receipts go through the game
-- function so friendship, bans, validation and rate limits stay server-side.

create table public.direct_messages (
  id bigserial primary key,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 280),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);
create index direct_messages_sender on public.direct_messages (sender_id, created_at desc);
create index direct_messages_recipient on public.direct_messages (recipient_id, created_at desc);
alter table public.direct_messages enable row level security;
create policy "players read their own direct messages" on public.direct_messages for select to authenticated
  using (auth.uid() in (sender_id, recipient_id));
alter publication supabase_realtime add table public.direct_messages;

-- Buzz the recipient when notifications are enabled. The push function localizes
-- the title; the short body is already the message the friend wrote.
create function public.push_on_direct_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify_push(new.recipient_id, jsonb_build_object(
    'kind', 'direct_message',
    'from', new.sender_id,
    'name', (select display_name from profiles where id = new.sender_id),
    'body', left(new.body, 120)
  ));
  return new;
end;
$$;
create trigger push_on_direct_message after insert on public.direct_messages
  for each row execute function public.push_on_direct_message();

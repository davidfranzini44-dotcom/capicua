-- Profile pictures. profiles.avatar_url is either a photo the player uploaded to
-- the public `avatars` bucket (stored as '<user id>/<file>.jpg') or their Google
-- photo (an https://…googleusercontent.com URL). Players change it only through
-- set_avatar(), which refuses anyone else's file or an arbitrary website.

alter table public.profiles add column avatar_url text;

-- Google sign-ups already have a photo.
update public.profiles p
set avatar_url = coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
from auth.users u
where u.id = p.id and not coalesce(u.is_anonymous, false)
  and coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture') like 'https://%.googleusercontent.com/%';

-- New accounts: name and Google photo from the sign-in.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text := left(coalesce(nullif(split_part(new.raw_user_meta_data ->> 'full_name', ' ', 1), ''), 'Jugador'), 20);
  v_photo text := coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture');
begin
  insert into profiles (id, display_name, avatar_url)
  values (new.id, v_name, case when v_photo like 'https://%.googleusercontent.com/%' then v_photo end);
  insert into chip_ledger (user_id, delta, reason) values (new.id, 5000, 'welcome');
  return new;
end;
$$;

-- p_avatar: '<my id>/<file>.jpg' (just uploaded), 'google' (my Google photo) or null (no photo).
create function public.set_avatar(p_avatar text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_avatar is null then
    v := null;
  elsif p_avatar = 'google' then
    -- Linked accounts keep the Google details on the identity, not the user row.
    select coalesce(i.identity_data ->> 'avatar_url', i.identity_data ->> 'picture') into v
    from auth.identities i where i.user_id = auth.uid() and i.provider = 'google' limit 1;
    if v is null then
      select coalesce(raw_user_meta_data ->> 'avatar_url', raw_user_meta_data ->> 'picture') into v from auth.users where id = auth.uid();
    end if;
    if v is null or v not like 'https://%.googleusercontent.com/%' then raise exception 'no google photo'; end if;
  elsif p_avatar ~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]{1,40}\.(jpg|png|webp)$') then
    v := p_avatar;
  else
    raise exception 'bad avatar';
  end if;
  update profiles set avatar_url = v where id = auth.uid();
  return v;
end;
$$;
revoke all on function public.set_avatar(text) from public, anon;
grant execute on function public.set_avatar(text) to authenticated;

-- Moderation: an admin takes a photo down (the player can upload another).
create function public.admin_clear_avatar(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from admins a join auth.users u on lower(u.email) = lower(a.email)
    where u.id = auth.uid() and not coalesce(u.is_anonymous, false)
  ) then raise exception 'admin only'; end if;
  update profiles set avatar_url = null where id = p_user;
end;
$$;
revoke all on function public.admin_clear_avatar(uuid) from public, anon;
grant execute on function public.admin_clear_avatar(uuid) to authenticated;

-- The photos themselves: public to look at, each player writes only their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "players see their own photo files" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "players upload their own photo" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "players delete their own old photos" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

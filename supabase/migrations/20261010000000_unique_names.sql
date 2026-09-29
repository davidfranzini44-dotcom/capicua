-- One name, one player. Two players can't share a name — capitals, accents, spaces
-- and punctuation don't count ("David" = "dávid" = "Da-vid") — so the name at the
-- table is always the same person. A new account picks its name before playing
-- (Google's first name comes filled in); after that the name can change once every
-- 7 days (the first change after picking it is free). Players who already shared a
-- name pick a new one the next time they open the app: the oldest account keeps it,
-- people signed in with Google before guests.

-- The part of a name that must be unique.
create function public.name_key(p text) returns text
language sql immutable parallel safe as $$
  select coalesce(
    nullif(regexp_replace(lower(translate(btrim(p),
      'áàâäãéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ',
      'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc')), '[^a-z0-9]', '', 'g'), ''),
    lower(btrim(p)))
$$;

-- Names nobody can pick: the default, the house, and the bots' names (a person called
-- "Papo" at a table with the bot Papo is exactly the confusion this is about).
create function public.name_reserved(p_key text) returns boolean
language sql immutable parallel safe as $$
  select p_key = any (array['jugador', 'capicua', 'admin', 'administrador', 'soporte', 'moderador', 'sistema', 'bot',
    'chelo', 'yuly', 'papo', 'nando', 'kirsy', 'tono'])
$$;

alter table public.profiles
  -- Still has to pick (or re-pick) a name before playing.
  add column needs_name boolean not null default true,
  add column name_changed_at timestamptz,
  add column name_key text generated always as (public.name_key(display_name)) stored;

-- Everyone who already chose a name keeps it…
update public.profiles set needs_name = false where display_name <> 'Jugador';
-- …except the newer holders of a name someone else already had.
with ranked as (
  select p.id, row_number() over (
    partition by p.name_key order by coalesce(u.is_anonymous, false), p.created_at, p.id) as n
  from public.profiles p join auth.users u on u.id = p.id
  where not p.needs_name
)
update public.profiles p set needs_name = true from ranked r where r.id = p.id and r.n > 1;

create unique index profiles_name_unique on public.profiles (name_key) where not needs_name;

-- A few free names close to the one asked for ("David" → "David27", "David RD"…).
create function public.name_suggestions(p_name text, p_uid uuid) returns text[]
language plpgsql volatile security definer set search_path = public as $$
declare
  v_base text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 17);
  v_out text[] := '{}';
  v_try text;
  i int;
begin
  if char_length(v_base) < 2 then return v_out; end if;
  for i in 1..30 loop
    exit when array_length(v_out, 1) >= 3;
    v_try := case i when 1 then v_base || ' RD' when 2 then v_base || ' DR' else v_base || (10 + floor(random() * 90))::int end;
    v_try := left(v_try, 20);
    if not name_reserved(name_key(v_try))
       and not (v_try = any (v_out))
       and not exists (select 1 from profiles where name_key = name_key(v_try) and not needs_name and id <> p_uid) then
      v_out := v_out || v_try;
    end if;
  end loop;
  return v_out;
end;
$$;

-- Can I have this name? {ok} or {ok: false, error: name_length | name_reserved | name_taken, suggestions}.
create function public.name_check(p_name text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text := regexp_replace(regexp_replace(btrim(coalesce(p_name, '')), '[[:cntrl:]\u200B-\u200D\uFEFF]', '', 'g'), '\s+', ' ', 'g');
  v_key text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  if char_length(v_name) < 2 or char_length(v_name) > 20 then
    return jsonb_build_object('ok', false, 'error', 'name_length');
  end if;
  v_key := name_key(v_name);
  if name_reserved(v_key) then
    return jsonb_build_object('ok', false, 'error', 'name_reserved', 'suggestions', to_jsonb(name_suggestions(v_name, v_uid)));
  end if;
  if exists (select 1 from profiles where name_key = v_key and not needs_name and id <> v_uid) then
    return jsonb_build_object('ok', false, 'error', 'name_taken', 'suggestions', to_jsonb(name_suggestions(v_name, v_uid)));
  end if;
  return jsonb_build_object('ok', true, 'name', v_name);
end;
$$;

-- Take a name: {ok, name} or the reason not (as name_check, plus name_cooldown with `until`).
drop function public.set_display_name(text);
create function public.set_display_name(p_name text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_me profiles%rowtype;
  v_check jsonb;
  v_name text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into v_me from profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  v_check := name_check(p_name);
  if not (v_check ->> 'ok')::boolean then return v_check; end if;
  v_name := v_check ->> 'name';
  -- Capitals or accents only (same key) never count as a change.
  if not v_me.needs_name and name_key(v_name) <> v_me.name_key
     and v_me.name_changed_at is not null and v_me.name_changed_at > now() - interval '7 days' then
    return jsonb_build_object('ok', false, 'error', 'name_cooldown', 'until', v_me.name_changed_at + interval '7 days');
  end if;
  begin
    update profiles set display_name = v_name, needs_name = false,
      -- Picking a name (at sign-up, or after a clash) doesn't start the 7 days; changing it later does.
      name_changed_at = case when v_me.needs_name or name_key(v_name) = v_me.name_key then v_me.name_changed_at else now() end
    where id = v_uid;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'name_taken', 'suggestions', to_jsonb(name_suggestions(v_name, v_uid)));
  end;
  return jsonb_build_object('ok', true, 'name', v_name);
end;
$$;

revoke all on function public.name_suggestions(text, uuid) from public, anon, authenticated;
revoke all on function public.name_check(text) from public, anon;
grant execute on function public.name_check(text) to authenticated;
revoke all on function public.set_display_name(text) from public, anon;
grant execute on function public.set_display_name(text) to authenticated;

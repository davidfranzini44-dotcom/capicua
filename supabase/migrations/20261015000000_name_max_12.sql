-- Names are 12 characters at most (the owner's call, 2026-09-30): they fit whole in the seats
-- at the table even on small phones. Anyone whose name is longer picks a shorter one the next
-- time they open the app (needs_name, like a name someone else had first); their games, XP and
-- friend code stay as they are.

create or replace function public.name_suggestions(p_name text, p_uid uuid) returns text[]
language plpgsql volatile security definer set search_path = public as $$
declare
  v_base text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 9);
  v_out text[] := '{}';
  v_try text;
  i int;
begin
  if char_length(v_base) < 2 then return v_out; end if;
  for i in 1..30 loop
    exit when array_length(v_out, 1) >= 3;
    v_try := case i when 1 then v_base || ' RD' when 2 then v_base || ' DR' else v_base || (10 + floor(random() * 90))::int end;
    v_try := left(v_try, 12);
    if not name_reserved(name_key(v_try))
       and not (v_try = any (v_out))
       and not exists (select 1 from profiles where name_key = name_key(v_try) and not needs_name and id <> p_uid) then
      v_out := v_out || v_try;
    end if;
  end loop;
  return v_out;
end;
$$;

create or replace function public.name_check(p_name text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text := regexp_replace(regexp_replace(btrim(coalesce(p_name, '')), '[[:cntrl:]\u200B-\u200D\uFEFF]', '', 'g'), '\s+', ' ', 'g');
  v_key text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  if char_length(v_name) < 2 or char_length(v_name) > 12 then
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

update public.profiles set needs_name = true
where not needs_name and char_length(display_name) > 12;

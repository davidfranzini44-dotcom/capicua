-- Lock down SECURITY DEFINER helpers (Supabase advisor 0028/0029).
-- handle_new_user only ever runs from the auth.users trigger.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
-- RLS policies call these as the signed-in user; signed-out visitors don't need them.
revoke execute on function public.is_room_member(uuid) from public, anon;
revoke execute on function public.is_listed_room(uuid) from public, anon;
grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.is_listed_room(uuid) to authenticated;

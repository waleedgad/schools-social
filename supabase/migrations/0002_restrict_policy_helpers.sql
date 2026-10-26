-- The policy helpers only need to run for signed-in users.
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.has_role(uuid, public.app_role[]) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.has_role(uuid, public.app_role[]) to authenticated;

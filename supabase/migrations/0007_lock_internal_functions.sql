-- Trigger functions run on their own; nobody should call them over the API.
revoke execute on function public.check_post_photo() from public, anon, authenticated;
revoke execute on function public.guard_post() from public, anon, authenticated;
revoke execute on function public.reset_post_on_photo_change() from public, anon, authenticated;

alter function public.storage_school(text) set search_path = '';

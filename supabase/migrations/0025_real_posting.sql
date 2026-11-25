-- Release 0.17 (real posting): safer publishing to the real Facebook Page and
-- Instagram account.
-- 1. A post Meta couldn't take right now (busy, rate limit, timeout) waits
--    for retry_at and is tried again by the publisher (5, 15, 45 minutes).
--    publish_reason is a short code the screens turn into plain Arabic or
--    English; publish_error keeps Meta's own words for support.
-- 2. Instagram safety: the container id is kept before publishing, so a
--    retry after a lost answer finds the earlier post instead of posting twice.
-- 3. The real links of a published post ("View on Facebook / Instagram").
-- 4. The school's Facebook key stopped working: Reconnect state, and what
--    the key may do (from Check connection).

alter table public.posts
  add column if not exists retry_at timestamptz,
  add column if not exists publish_reason text check (char_length(publish_reason) <= 40),
  add column if not exists ig_container_id text check (char_length(ig_container_id) <= 100),
  add column if not exists fb_url text check (char_length(fb_url) <= 500),
  add column if not exists ig_url text check (char_length(ig_url) <= 500);

create index if not exists posts_due_retry on public.posts (scheduled_at) where status = 'scheduled';

alter table public.meta_connections
  add column if not exists needs_reconnect boolean not null default false,
  add column if not exists reconnect_since timestamptz,
  add column if not exists permissions text[],
  add column if not exists checked_at timestamptz;

drop function if exists public.meta_status(uuid);
create function public.meta_status(p_school uuid)
returns table (page_id text, page_name text, ig_username text, connected_at timestamptz, last_error text, pages jsonb,
               fb_paused boolean, ig_paused boolean, token_expires_at timestamptz,
               needs_reconnect boolean, reconnect_since timestamptz, permissions text[], checked_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select c.page_id, c.page_name, c.ig_username, c.connected_at, c.last_error,
         coalesce((select jsonb_agg(jsonb_build_object('id', p->>'id', 'name', p->>'name', 'ig', p->>'ig_username'))
                   from jsonb_array_elements(c.pages) p), '[]'::jsonb),
         c.fb_paused, c.ig_paused, c.token_expires_at,
         c.needs_reconnect, c.reconnect_since, c.permissions, c.checked_at
  from public.meta_connections c
  where c.school_id = p_school and public.is_member(p_school);
$$;
revoke execute on function public.meta_status(uuid) from public, anon;
grant execute on function public.meta_status(uuid) to authenticated;

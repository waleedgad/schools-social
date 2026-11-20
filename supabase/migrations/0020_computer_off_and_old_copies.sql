-- Release 0.13 extras (final plan, "Alerts, help and access"):
-- 1. An email when a library computer has not been in touch for more than a
--    day (once per time it goes quiet).
-- 2. The website's clean-up of web copies older than 6 months that were
--    never used. Originals on the school's drives are never touched.

-- 1. When the "computer is off" email went out. A new one goes only after
--    the computer has been seen again and then goes quiet again.
alter table public.computers add column off_alert_at timestamptz;

-- 2. Web copies the clean-up may remove: older than 6 months, the school's
--    computer has the original (sent by the Mac, or a website upload the Mac
--    has already fetched and checked), and never used: not in any post, not
--    in a shared album, not an AI pick, no face question still open, not an
--    announcement design (those exist only on the website).
create index if not exists photos_created_at_idx on public.photos (created_at);

create function public.old_web_copies(p_limit int default 200)
returns table (id uuid, school_id uuid, storage_path text, edited_path text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.school_id, p.storage_path, p.edited_path
  from public.photos p
  where p.created_at < now() - interval '6 months'
    and (p.source = 'desktop' or (p.source in ('staff', 'photographer', 'whatsapp') and p.check_status = 'ready'))
    and not p.is_pick
    and not exists (select 1 from public.post_photos pp where pp.photo_id = p.id)
    and not exists (select 1 from public.shared_album_photos sa where sa.photo_id = p.id)
    and not exists (select 1 from public.face_checks fc where fc.photo_id = p.id and fc.answer is null)
  order by p.created_at
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

revoke execute on function public.old_web_copies(int) from public, anon, authenticated;
grant execute on function public.old_web_copies(int) to service_role;

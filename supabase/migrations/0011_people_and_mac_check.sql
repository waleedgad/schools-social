-- "Last seen" for the People page. Members can't update their own
-- membership row (only admins can), so this does just that one column.
create function public.touch_last_seen(p_school uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.memberships set last_seen_at = now()
  where school_id = p_school and user_id = auth.uid();
$$;
revoke execute on function public.touch_last_seen(uuid) from public, anon;
grant execute on function public.touch_last_seen(uuid) to authenticated;

-- Brand learning: every approved caption is kept (the last 12) as an
-- example of the school's voice. Only comms approvers can add one.
create function public.learn_caption(p_school uuid, p_text text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_role(p_school, array['admin', 'comms_lead', 'principal']::public.app_role[]) then
    return;
  end if;
  if coalesce(trim(p_text), '') = '' then
    return;
  end if;
  update public.schools
  set profile = jsonb_set(
    profile, '{examples}',
    (select coalesce(jsonb_agg(e), '[]'::jsonb) from (
      select e from jsonb_array_elements(jsonb_build_array(left(p_text, 1200)) || coalesce(profile -> 'examples', '[]'::jsonb)) with ordinality as x(e, n)
      order by n limit 12) s))
  where id = p_school;
end;
$$;
revoke execute on function public.learn_caption(uuid, text) from public, anon;
grant execute on function public.learn_caption(uuid, text) to authenticated;

-- Extra approver did not answer in time: the publisher (server key) either
-- lets the post go ahead or leaves it waiting, as the school chose.
create function public.overdue_extra()
returns table (id uuid, school_id uuid, scheduled_at timestamptz, action text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.school_id, p.scheduled_at, s.extra_timeout_action
  from public.posts p join public.schools s on s.id = p.school_id
  where p.status = 'waiting_extra' and s.extra_timeout_hours is not null
    and p.sent_extra_at < now() - make_interval(hours => s.extra_timeout_hours);
$$;
revoke execute on function public.overdue_extra() from public, anon, authenticated;

-- Only admins update the school row, but the comms lead looks after the
-- brand profile and can pause posting, so these two go through functions.
create function public.set_school_profile(p_school uuid, p_profile jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_role(p_school, array['admin', 'comms_lead']::public.app_role[]) then
    raise exception 'only the admin or comms lead can change the brand profile';
  end if;
  update public.schools set profile = p_profile where id = p_school;
end;
$$;
revoke execute on function public.set_school_profile(uuid, jsonb) from public, anon;
grant execute on function public.set_school_profile(uuid, jsonb) to authenticated;

create function public.set_posting_pause(p_school uuid, p_until timestamptz, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_role(p_school, array['admin', 'comms_lead']::public.app_role[]) then
    raise exception 'only the admin or comms lead can pause posting';
  end if;
  update public.schools set posting_paused_until = p_until, pause_reason = left(p_reason, 200) where id = p_school;
end;
$$;
revoke execute on function public.set_posting_pause(uuid, timestamptz, text) from public, anon;
grant execute on function public.set_posting_pause(uuid, timestamptz, text) to authenticated;

-- What happened at the event, in a sentence or two, for the AI captions.
alter table public.events add column description text check (char_length(description) <= 1000);

-- Only the comms team (the Mac app signs in as one of them) can mark a
-- photo as checked; uploaders can't skip the check on their own photos.
create function public.guard_photo_check()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null
     and new.check_status is distinct from old.check_status
     and not public.has_role(new.school_id, array['admin', 'comms']::public.app_role[]) then
    raise exception 'only the comms team can mark photos as checked';
  end if;
  if new.check_status = 'ready' and old.check_status = 'waiting' then
    new.checked_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_photo_check() from public, anon, authenticated;
create trigger photos_guard_check before update on public.photos
  for each row execute function public.guard_photo_check();

-- Announcements are designed on the website (no photos of students in
-- them), so they don't wait for the Mac's face check.
alter table public.photos drop constraint photos_source_check;
alter table public.photos add constraint photos_source_check check (source in ('staff', 'photographer', 'desktop', 'design'));

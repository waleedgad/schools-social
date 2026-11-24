-- Security review 21 Nov 2026 (tracker/security-check.md S-21N-03 to 06).
-- None of these could be used without knowing another school's ids, but
-- each closes a gap the database should never have allowed.

-- S-21N-03: a photo row could point at another school's file. New and
-- changed rows must keep their files inside their own school's folder.
-- (not valid = rows already saved are not re-checked; the server also
-- checks the folder before signing a link.)
alter table public.photos
  add constraint photos_own_folder check (
    storage_path like school_id::text || '/%' and position('..' in storage_path) = 0
    and (edited_path is null or (edited_path like school_id::text || '/%' and position('..' in edited_path) = 0))
  ) not valid;

-- The approval-link page only gets the school's own files.
create or replace function public.get_review_link(p_token text)
returns table (school_name text, label text, caption_ar text, caption_en text, status public.post_status, usable boolean, photo_paths text[])
language sql stable security definer set search_path = ''
as $$
  select s.name, l.label, p.caption_ar, p.caption_en, p.status,
         l.expires_at > now() and l.answered_at is null,
         array(select coalesce(ph.edited_path, ph.storage_path) from public.post_photos pp join public.photos ph on ph.id = pp.photo_id
               where pp.post_id = p.id
                 and coalesce(ph.edited_path, ph.storage_path) like l.school_id::text || '/%'
               order by pp.position)
  from public.review_links l
  join public.posts p on p.id = l.post_id
  join public.schools s on s.id = l.school_id
  where l.token = p_token;
$$;

-- S-21N-04: the library key goes only to people who may run the library
-- app (Admin, Comms lead, Comms), the same people who may add a computer.
create or replace function public.licence(p_school uuid, p_device text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_state text;
  v_key bytea;
  v_status jsonb;
begin
  if not public.has_role(p_school, array['admin', 'comms_lead', 'comms']::public.app_role[]) then
    return jsonb_build_object('error', 'role');
  end if;
  update public.computers set last_seen_at = now() where school_id = p_school and device_id = p_device;
  if not found then
    return jsonb_build_object('error', 'not-registered');
  end if;
  v_state := public.school_state(p_school);
  v_status := public.school_status(p_school);
  if v_state <> 'blocked' then
    select k.secret into v_key from public.school_keys k where k.school_id = p_school;
    if v_key is null then
      insert into public.school_keys (school_id, secret)
      values (p_school, decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'))
      on conflict (school_id) do nothing;
      select k.secret into v_key from public.school_keys k where k.school_id = p_school;
    end if;
  end if;
  return v_status || jsonb_build_object(
    'key', case when v_key is null then null else encode(v_key, 'base64') end,
    'checked_at', now(),
    'valid_until', now() + interval '10 days',
    'check_every_hours', 6
  );
end;
$$;

-- S-21N-05: a read-only or blocked school can't send new team alerts
-- (they can turn into emails and Slack/Teams messages). Marking one as
-- read still works. Error reports stay open on purpose: they help fix the
-- app for schools whatever their plan.
create trigger guard_school_write before insert on public.team_alerts
  for each row execute function public.guard_school_write();

-- S-21N-06: links inside a school's rows (event, category, frame) must
-- point at the same school's rows, like photos in a post already do.
create or replace function public.same_school_link()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_col text := tg_argv[0];
  v_table text := tg_argv[1];
  v_id uuid := (to_jsonb(new) ->> v_col)::uuid;
  v_school uuid;
begin
  if v_id is null or (tg_op = 'UPDATE' and v_id is not distinct from (to_jsonb(old) ->> v_col)::uuid and new.school_id = old.school_id) then
    return new;
  end if;
  execute format('select school_id from public.%I where id = $1', v_table) into v_school using v_id;
  if v_school is distinct from new.school_id then
    raise exception 'other-school-link' using errcode = '42501', detail = v_col;
  end if;
  return new;
end;
$$;
revoke execute on function public.same_school_link() from public, anon, authenticated;

create trigger same_school_event before insert or update on public.photos
  for each row execute function public.same_school_link('event_id', 'events');
create trigger same_school_event before insert or update on public.upload_links
  for each row execute function public.same_school_link('event_id', 'events');
create trigger same_school_event before insert or update on public.posts
  for each row execute function public.same_school_link('event_id', 'events');
create trigger same_school_category before insert or update on public.posts
  for each row execute function public.same_school_link('category_id', 'categories');
create trigger same_school_frame before insert or update on public.posts
  for each row execute function public.same_school_link('frame_id', 'frames');
create trigger same_school_category before insert or update on public.events
  for each row execute function public.same_school_link('category_id', 'categories');
create trigger same_school_category before insert or update on public.time_slots
  for each row execute function public.same_school_link('category_id', 'categories');
create trigger same_school_frame before insert or update on public.categories
  for each row execute function public.same_school_link('frame_id', 'frames');

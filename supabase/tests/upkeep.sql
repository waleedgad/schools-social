-- Release 0.13 extras (migration 0020): which web copies the 6-month
-- clean-up may remove, and the computers' "off" email column.
-- Run after run.sh: psql ... -d t -f supabase/tests/upkeep.sql
\set ON_ERROR_STOP 1
\set QUIET 1
create temp table results (ok boolean, name text);
create or replace function pg_temp.check(p_ok boolean, p_name text) returns void language sql as $$
  insert into results values (coalesce(p_ok, false), p_name);
$$;

insert into auth.users (id, email) values ('20000000-0000-0000-0000-00000000000a', 'u@x');
insert into public.schools (name) values ('Upkeep school') returning id as school \gset
insert into public.events (school_id, title, event_date) values (:'school', 'Old trip', current_date - 400) returning id as event \gset

-- One photo per case, all a year old unless said otherwise.
create temp table cases (name text primary key, id uuid);
create or replace function pg_temp.photo(p_name text, p_source text, p_status text, p_age interval, p_pick boolean default false) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.photos (school_id, event_id, source, storage_path, check_status, is_pick, created_at)
  values (current_setting('test.school')::uuid, null, p_source, current_setting('test.school') || '/' || p_name || '.jpg', 'ready', p_pick, now() - p_age)
  returning id into v;
  -- The trigger marks website uploads "waiting"; set what the case needs.
  update public.photos set check_status = p_status where id = v;
  insert into cases values (p_name, v);
  return v;
end $$;
select set_config('test.school', :'school', false);

select from pg_temp.photo('old_mac', 'desktop', 'ready', '1 year');
select from pg_temp.photo('new_mac', 'desktop', 'ready', '2 months');
select from pg_temp.photo('old_phone_checked', 'staff', 'ready', '1 year');
select from pg_temp.photo('old_phone_waiting', 'staff', 'waiting', '1 year');
select from pg_temp.photo('old_design', 'design', 'ready', '1 year');
select from pg_temp.photo('old_pick', 'desktop', 'ready', '1 year', true);
select from pg_temp.photo('old_in_post', 'desktop', 'ready', '1 year');
select from pg_temp.photo('old_in_album', 'desktop', 'ready', '1 year');
select from pg_temp.photo('old_face_open', 'desktop', 'ready', '1 year');
select from pg_temp.photo('old_face_answered', 'desktop', 'ready', '1 year');

insert into public.posts (school_id, created_by) values (:'school', '20000000-0000-0000-0000-00000000000a') returning id as post \gset
insert into public.post_photos (post_id, photo_id, school_id) select :'post', id, :'school' from cases where name = 'old_in_post';
insert into public.shared_albums (school_id, mac_id, name) values (:'school', 1, 'Album') returning id as album \gset
insert into public.shared_album_photos (album_id, photo_id, school_id) select :'album', id, :'school' from cases where name = 'old_in_album';
insert into public.face_checks (school_id, mac_id, photo_id, box, student_code) select :'school', 1, id, '{}', 'S1' from cases where name = 'old_face_open';
insert into public.face_checks (school_id, mac_id, photo_id, box, student_code, answer) select :'school', 2, id, '{}', 'S2', true from cases where name = 'old_face_answered';

create temp table picked as select id from public.old_web_copies(500);
create or replace function pg_temp.taken(p_name text) returns boolean language sql as $$
  select exists (select 1 from picked p join cases c on c.id = p.id where c.name = p_name);
$$;

select pg_temp.check(pg_temp.taken('old_mac'), 'a year-old photo sent by the Mac and never used is cleaned');
select pg_temp.check(pg_temp.taken('old_phone_checked'), 'an old phone upload the Mac already fetched and checked is cleaned');
select pg_temp.check(pg_temp.taken('old_face_answered'), 'an answered face question does not keep a photo');
select pg_temp.check(not pg_temp.taken('new_mac'), 'a 2-month-old photo is kept');
select pg_temp.check(not pg_temp.taken('old_phone_waiting'), 'a phone upload the Mac has not fetched yet is kept (only copy)');
select pg_temp.check(not pg_temp.taken('old_design'), 'an announcement design is kept (exists only on the website)');
select pg_temp.check(not pg_temp.taken('old_pick'), 'an AI pick is kept');
select pg_temp.check(not pg_temp.taken('old_in_post'), 'a photo in a post is kept');
select pg_temp.check(not pg_temp.taken('old_in_album'), 'a photo in a shared album is kept');
select pg_temp.check(not pg_temp.taken('old_face_open'), 'a photo with an open face question is kept');
select pg_temp.check((select count(*) from public.old_web_copies(1)) = 1, 'the batch size is respected');

-- Only the scheduled job (service key) may ask.
select pg_temp.check(not has_function_privilege('authenticated', 'public.old_web_copies(int)', 'execute'), 'signed-in people cannot call the clean-up list');
select pg_temp.check(not has_function_privilege('anon', 'public.old_web_copies(int)', 'execute'), 'visitors cannot call the clean-up list');
select pg_temp.check(has_function_privilege('service_role', 'public.old_web_copies(int)', 'execute'), 'the scheduled job can call the clean-up list');

-- The computers' "off" email column.
select pg_temp.check(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'computers' and column_name = 'off_alert_at'), 'computers remember when the "off" email went out');

\set QUIET 0
select case when ok then 'ok - ' else 'FAIL - ' end || name from results;
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' as result from results;

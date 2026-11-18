-- Release 0.13: plans, states and the owner page (migration 0019).
-- Run after run.sh: psql ... -d t -f supabase/tests/plans.sql
-- Every line prints "ok - ..." or "FAIL - ..."; the last line counts them.
\set ON_ERROR_STOP 1
\set QUIET 1
create temp table results (ok boolean, name text);
grant all on results to authenticated;

-- Runs a statement as the person in test.uid and says whether it was refused
-- with the expected message.
create or replace function pg_temp.refused(p_sql text, p_like text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlerrm like p_like;
end $$;
create or replace function pg_temp.works(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise notice 'unexpected: %', sqlerrm;
  return false;
end $$;
create or replace function pg_temp.check(p_ok boolean, p_name text) returns void language sql as $$
  insert into results values (coalesce(p_ok, false), p_name);
$$;

insert into auth.users (id, email) values
 ('10000000-0000-0000-0000-00000000000a', 'admin@x'), ('10000000-0000-0000-0000-00000000000b', 'lead@x'),
 ('10000000-0000-0000-0000-00000000000c', 'c1@x'), ('10000000-0000-0000-0000-00000000000d', 'c2@x'),
 ('10000000-0000-0000-0000-00000000000e', 'teacher@x'), ('10000000-0000-0000-0000-00000000000f', 'owner@x'),
 ('10000000-0000-0000-0000-000000000010', 'stranger@x'), ('10000000-0000-0000-0000-000000000011', 'c3@x');

-- 1. Nobody but the owner creates a school while self sign-up is off.
set test.uid = '10000000-0000-0000-0000-000000000010';
select pg_temp.check(pg_temp.refused($$select public.create_school('Mine', 'Me')$$, 'signup-closed'), 'a stranger cannot create a school');
reset test.uid;
insert into public.owners (user_id) values ('10000000-0000-0000-0000-00000000000f');

-- 2. The owner makes a school on Small (2 managing users, 1 computer), on trial.
set test.uid = '10000000-0000-0000-0000-00000000000f';
select (public.owner_create_school('Plan school', 'small', null, 'admin@x', 'en') ->> 'school_id') as school \gset
select pg_temp.check((select trial and paid_until = (now() at time zone 'Africa/Cairo')::date + 14 from schools where id = :'school'), 'a new school without a date gets a 14-day trial');
select pg_temp.check((select count(*) = 1 from invites where school_id = :'school' and role = 'admin' and email = 'admin@x'), 'the Admin is invited');
select pg_temp.check((select count(*) = 1 from owner_log where school_id = :'school' and action = 'school.created'), 'the owner log has the new school');
select pg_temp.check(public.school_state(:'school') = 'active', 'a new school is active');
select (select token from invites where school_id = :'school') as admin_token \gset

-- The Admin accepts.
set test.uid = '10000000-0000-0000-0000-00000000000a';
set test.jwt = '{"email": "admin@x"}';
select pg_temp.check(pg_temp.works(format('select public.accept_invite(%L, %L)', :'admin_token', 'Admin')), 'the Admin accepts the invite');
reset test.jwt;

-- 3. Managing users count against the plan; free roles never do.
insert into memberships (school_id, user_id, role, full_name) values (:'school', '10000000-0000-0000-0000-00000000000b', 'comms_lead', 'Lead');
select pg_temp.check(pg_temp.refused(format($$insert into invites (school_id, email, role, invited_by) values (%L, 'c1@x', 'comms', %L)$$, :'school', '10000000-0000-0000-0000-00000000000a'), 'manager-limit'), 'an invite for a third managing user is refused on Small');
select pg_temp.check(pg_temp.refused(format($$insert into memberships (school_id, user_id, role, full_name) values (%L, '10000000-0000-0000-0000-00000000000c', 'comms', 'C1')$$, :'school'), 'manager-limit'), 'a third managing user cannot join');
select pg_temp.check(pg_temp.works(format($$insert into memberships (school_id, user_id, role, full_name) values (%L, '10000000-0000-0000-0000-00000000000e', 'teacher', 'Teacher')$$, :'school')), 'a teacher joins freely');
select pg_temp.check(pg_temp.works(format($$insert into invites (school_id, email, role, invited_by) values (%L, 'p@x', 'photographer', %L)$$, :'school', '10000000-0000-0000-0000-00000000000a')), 'a photographer invite is never counted');
select pg_temp.check(pg_temp.refused(format($$update memberships set role = 'comms' where school_id = %L and user_id = '10000000-0000-0000-0000-00000000000e'$$, :'school'), 'manager-limit'), 'making the teacher a comms member is refused');
update memberships set active = false where school_id = :'school' and user_id = '10000000-0000-0000-0000-00000000000b';
select pg_temp.check(pg_temp.works(format($$update memberships set role = 'comms' where school_id = %L and user_id = '10000000-0000-0000-0000-00000000000e'$$, :'school')), 'after turning someone off there is room again');
select pg_temp.check(pg_temp.refused(format($$update memberships set active = true where school_id = %L and user_id = '10000000-0000-0000-0000-00000000000b'$$, :'school'), 'manager-limit'), 'turning them back on is over the plan');
update memberships set role = 'teacher' where school_id = :'school' and user_id = '10000000-0000-0000-0000-00000000000e';
update memberships set active = true where school_id = :'school' and user_id = '10000000-0000-0000-0000-00000000000b';

-- 4. Computers: one on Small.
select pg_temp.check((public.register_computer(:'school', 'device-0001', 'Mac 1', 'mac') ->> 'computers') = '1', 'the first computer signs in');
select pg_temp.check((public.register_computer(:'school', 'device-0002', 'Mac 2', 'mac') ->> 'error') = 'computer-limit', 'a second computer is refused on Small');
select pg_temp.check((public.register_computer(:'school', 'device-0001', 'Mac 1', 'mac') ->> 'computers') = '1', 'the same computer signs in again');

-- 5. Extras and plans from the owner page.
set test.uid = '10000000-0000-0000-0000-00000000000f';
select pg_temp.check((public.owner_set_plan(:'school', 'small', 1, 1, 'bought extras') ->> 'ok') = 'true', 'the owner adds one managing user and one computer');
select pg_temp.check((select manager_limit = 3 and computer_limit = 2 from schools where id = :'school'), 'limits are plan plus extras');
set test.uid = '10000000-0000-0000-0000-00000000000a';
select pg_temp.check(pg_temp.works(format($$insert into invites (school_id, email, role, invited_by) values (%L, 'c3@x', 'comms', %L)$$, :'school', '10000000-0000-0000-0000-00000000000a')), 'an invite for the extra managing user works');
select pg_temp.check(pg_temp.refused(format($$insert into invites (school_id, email, role, invited_by) values (%L, 'c2@x', 'comms', %L)$$, :'school', '10000000-0000-0000-0000-00000000000a'), 'manager-limit'), 'a waiting managing invite holds its place');
delete from invites where email = 'c3@x';
select pg_temp.check(pg_temp.works(format($$insert into memberships (school_id, user_id, role, full_name) values (%L, '10000000-0000-0000-0000-00000000000c', 'comms', 'C1')$$, :'school')), 'the extra managing user joins');
select pg_temp.check((public.register_computer(:'school', 'device-0002', 'Mac 2', 'mac') ->> 'computers') = '2', 'the extra computer signs in');
set test.uid = '10000000-0000-0000-0000-00000000000f';
select pg_temp.check((public.owner_set_plan(:'school', 'small', 0, 1, 'down') ->> 'error') = 'too-many-managers', 'going down below what is used is refused, nobody is removed');
select pg_temp.check((select count(*) = 3 from memberships where school_id = :'school' and active and public.is_managing(role)), 'all three managing users are still there');

-- 6. A stranger and a school member cannot use the owner functions.
set test.uid = '10000000-0000-0000-0000-00000000000a';
select pg_temp.check(pg_temp.refused($$select * from public.owner_schools()$$, 'not-owner'), 'a school admin cannot open the owner list');
select pg_temp.check(pg_temp.refused(format($$select public.owner_force_state(%L, 'active', 'x')$$, :'school'), 'not-owner'), 'a school admin cannot force a state');
select pg_temp.check(pg_temp.refused(format($$select public.owner_record_payment(%L, 1, 'EGP', null, 'cash', '2099-01-01', null)$$, :'school'), 'not-owner'), 'a school admin cannot record a payment');

-- 7. Paid until yesterday: read-only. Reading works; every change is refused.
reset test.uid;
insert into events (school_id, title, event_date) values (:'school', 'Sports day', current_date) returning id as event \gset
insert into posts (school_id, created_by, status, scheduled_at) values (:'school', '10000000-0000-0000-0000-00000000000a', 'scheduled', now() - interval '1 minute') returning id as post \gset
update schools set paid_until = (now() at time zone 'Africa/Cairo')::date - 1 where id = :'school';
select pg_temp.check(public.school_state(:'school') = 'read_only', 'one day after paid until the school is read-only');
set test.uid = '10000000-0000-0000-0000-00000000000a';
select pg_temp.check((public.school_status(:'school') ->> 'read_only_left')::int = 13, 'read-only has 13 more days');
select pg_temp.check(pg_temp.refused(format($$insert into posts (school_id, created_by) values (%L, %L)$$, :'school', '10000000-0000-0000-0000-00000000000a'), 'school-read-only'), 'read-only: no new post');
select pg_temp.check(pg_temp.refused(format($$update posts set caption_ar = 'x' where id = %L$$, :'post'), 'school-read-only'), 'read-only: no post change');
select pg_temp.check(pg_temp.refused(format($$delete from events where id = %L$$, :'event'), 'school-read-only'), 'read-only: no delete');
select pg_temp.check(pg_temp.refused(format($$update schools set name = 'New name' where id = %L$$, :'school'), 'school-read-only'), 'read-only: no settings change');
select pg_temp.check(pg_temp.refused(format($$insert into invites (school_id, email, role, invited_by) values (%L, 't2@x', 'teacher', %L)$$, :'school', '10000000-0000-0000-0000-00000000000a'), 'school-read-only'), 'read-only: no invite');
select pg_temp.check(pg_temp.refused(format($$insert into photos (school_id, storage_path) values (%L, 'x.jpg')$$, :'school'), 'school-read-only'), 'read-only: no photo');
select pg_temp.check(pg_temp.refused(format($$delete from memberships where school_id = %L and user_id = '10000000-0000-0000-0000-00000000000c'$$, :'school'), 'school-read-only'), 'read-only: nobody removed');
select pg_temp.check((public.register_computer(:'school', 'device-0003', 'PC', 'windows') ->> 'error') = 'school-read-only', 'read-only: no new computer');
select pg_temp.check((public.register_computer(:'school', 'device-0001', 'Mac 1', 'mac') ->> 'computers') = '2', 'read-only: a known computer still checks in');
select pg_temp.check(pg_temp.works(format($$select public.touch_last_seen(%L)$$, :'school')), 'read-only: last seen still works');
select pg_temp.check((select count(*) = 1 from posts where id = :'post'), 'read-only: reading works');
select pg_temp.check(pg_temp.works(format($$insert into audit_log (school_id, user_id, action) values (%L, %L, 'look')$$, :'school', '10000000-0000-0000-0000-00000000000a')), 'read-only: the audit log still records');
reset test.uid;
select pg_temp.check((select state = 'read_only' from public.all_school_states() where id = :'school'), 'the publish job sees the school is not active');
select pg_temp.check((select status = 'scheduled' from posts where id = :'post'), 'the scheduled post is kept (paused, not deleted)');

-- 8. The app's licence while read-only: key given, valid for 10 days.
set test.uid = '10000000-0000-0000-0000-00000000000c';
select public.licence(:'school', 'device-0001') as lic \gset
select pg_temp.check((:'lic'::jsonb ->> 'state') = 'read_only' and (:'lic'::jsonb ->> 'key') is not null, 'read-only: the app gets its key and the state');
select pg_temp.check(length(decode(:'lic'::jsonb ->> 'key', 'base64')) = 32, 'the key is 32 bytes');
select pg_temp.check((:'lic'::jsonb ->> 'valid_until')::timestamptz between now() + interval '9 days 23 hours' and now() + interval '10 days 1 minute', 'the app may work offline for 10 days');
select pg_temp.check((public.licence(:'school', 'device-9999') ->> 'error') = 'not-registered', 'a computer not signed in gets nothing');
set test.uid = '10000000-0000-0000-0000-000000000010';
select pg_temp.check((public.licence(:'school', 'device-0001') ->> 'error') = 'role', 'a stranger gets nothing');
select pg_temp.check(public.school_status(:'school') is null, 'a stranger cannot read the school''s plan');

-- 9. Day 15: blocked. No key.
reset test.uid;
update schools set paid_until = (now() at time zone 'Africa/Cairo')::date - 15 where id = :'school';
select pg_temp.check(public.school_state(:'school') = 'blocked', 'day 15 after paid until the school is blocked');
set test.uid = '10000000-0000-0000-0000-00000000000c';
select pg_temp.check((public.licence(:'school', 'device-0001') ->> 'key') is null, 'blocked: the app gets no key');
select pg_temp.check(pg_temp.refused(format($$insert into posts (school_id, created_by) values (%L, %L)$$, :'school', '10000000-0000-0000-0000-00000000000c'), 'school-blocked'), 'blocked: no new post');

-- 10. The owner forces a state, and a payment brings it back at once.
set test.uid = '10000000-0000-0000-0000-00000000000f';
select pg_temp.check(pg_temp.refused(format($$select public.owner_force_state(%L, 'active', '')$$, :'school'), 'reason needed'), 'forcing a state needs a reason');
select public.owner_force_state(:'school', 'active', 'paying next week');
select pg_temp.check(public.school_state(:'school') = 'active', 'a forced Active works even when not paid');
select public.owner_force_state(:'school', null, 'back to the dates');
select pg_temp.check(public.school_state(:'school') = 'blocked', 'clearing the forced state goes back to the dates');
select pg_temp.check(pg_temp.works(format($$update schools set name = 'Owner fixes name' where id = %L$$, :'school')), 'the owner can change a blocked school');
select public.owner_record_payment(:'school', 12000, 'egp', null, 'transfer', ((now() at time zone 'Africa/Cairo')::date + 365), 'year 1');
select pg_temp.check(public.school_state(:'school') = 'active', 'a payment makes the school active at once');
select pg_temp.check((select not trial from schools where id = :'school'), 'a payment ends the trial');
select pg_temp.check((select count(*) = 1 and min(currency) = 'EGP' from payments where school_id = :'school'), 'the payment is kept');
set test.uid = '10000000-0000-0000-0000-00000000000a';
select pg_temp.check(pg_temp.works(format($$update posts set caption_ar = 'back' where id = %L$$, :'post')), 'active again: changes work, posts as they were');
-- Row rules only apply to the app's own database role.
grant select on payments, owner_log, school_keys, owner_notes, owners to authenticated;
set role authenticated;
select pg_temp.check((select count(*) = 0 from payments), 'a school cannot read payments');
select pg_temp.check((select count(*) = 0 from owner_log), 'a school cannot read the owner log');
select pg_temp.check((select count(*) = 0 from school_keys), 'nobody reads the school keys');
select pg_temp.check((select count(*) = 0 from owners), 'nobody reads the owner list');
set test.uid = '10000000-0000-0000-0000-00000000000f';
select pg_temp.check((select count(*) = 0 from school_keys), 'not even the owner reads the school keys');
select pg_temp.check((select count(*) = 1 from payments), 'the owner reads payments');
reset role;
reset test.uid;
select pg_temp.check((select count(*) >= 5 from owner_log where school_id = :'school'), 'every owner action is logged');

-- 11. Plan edits wait for renewal unless applied now.
set test.uid = '10000000-0000-0000-0000-00000000000f';
select public.owner_save_plan('small', 'Small', 'صغيرة', 3, 1, 9000, true, false);
select pg_temp.check((select plan_managers = 2 from schools where id = :'school'), 'a plan change waits for the next renewal');
select public.owner_save_plan('small', 'Small', 'صغيرة', 3, 1, 9000, true, true);
select pg_temp.check((select plan_managers = 3 from schools where id = :'school'), 'apply now moves schools on the plan');

-- 12. Warnings: 14, 7 and 1 days before, then every read-only day, once each.
reset test.uid;
update schools set paid_until = (now() at time zone 'Africa/Cairo')::date + 7 where id = :'school';
select pg_temp.check((select count(*) = 1 from public.plan_warnings() where school_id = :'school' and days = 7), '7 days before: a warning');
select pg_temp.check((select count(*) = 2 from team_alerts where school_id = :'school' and kind = 'plan'), 'it goes to the Admin and the Comms lead only');
select pg_temp.check((select count(*) = 0 from public.plan_warnings() where school_id = :'school'), 'never twice');
update schools set paid_until = (now() at time zone 'Africa/Cairo')::date + 5 where id = :'school';
select pg_temp.check((select count(*) = 0 from public.plan_warnings() where school_id = :'school'), 'no warning 5 days before');
update schools set paid_until = (now() at time zone 'Africa/Cairo')::date - 2 where id = :'school';
select pg_temp.check((select count(*) = 1 from public.plan_warnings() where school_id = :'school' and state = 'read_only'), 'a read-only day: a warning');

-- 13. Self sign-up switched on by the owner: a trial school.
set test.uid = '10000000-0000-0000-0000-00000000000f';
select public.owner_save_settings('EGP', 1000, 2000, 'hello@example.com', true);
set test.uid = '10000000-0000-0000-0000-000000000010';
select public.create_school('Own school', 'Me') as own \gset
select pg_temp.check((select trial from schools where id = :'own'), 'self sign-up (when allowed) starts a trial');
select pg_temp.check((public.school_status(:'own') ->> 'contact') = 'hello@example.com', 'schools see the renew contact');
select pg_temp.check(public.signup_open(), 'sign-up shows as open');
set test.uid = '10000000-0000-0000-0000-00000000000f';
select public.owner_save_settings('EGP', 1000, 2000, 'hello@example.com', false);
set test.uid = '10000000-0000-0000-0000-000000000010';
select pg_temp.check(not public.signup_open(), 'sign-up shows as closed');

reset test.uid;
\set QUIET 0
select case when ok then 'ok - ' else 'FAIL - ' end || name from results;
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' as result from results;

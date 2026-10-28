\set ON_ERROR_STOP 0
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-00000000000a','a@x'),('00000000-0000-0000-0000-00000000000b','lead@x'),
 ('00000000-0000-0000-0000-00000000000c','m1@x'),('00000000-0000-0000-0000-00000000000d','m2@x'),('00000000-0000-0000-0000-00000000000e','p@x');
set test.uid = '00000000-0000-0000-0000-00000000000a';
select public.create_school('Test', 'Admin') as school \gset
select count(*) as categories from categories;
insert into memberships (school_id,user_id,role,full_name) values
 (:'school','00000000-0000-0000-0000-00000000000b','comms_lead','Lead'),
 (:'school','00000000-0000-0000-0000-00000000000c','comms','M1'),
 (:'school','00000000-0000-0000-0000-00000000000d','comms','M2'),
 (:'school','00000000-0000-0000-0000-00000000000e','principal','Principal');
-- member makes a post
set test.uid = '00000000-0000-0000-0000-00000000000c';
insert into posts (school_id, created_by, caption_ar) values (:'school','00000000-0000-0000-0000-00000000000c','x') returning id as post \gset
\echo 1. member approves own post -> expect error
update posts set status='approved' where id=:'post';
\echo 2. other member approves (approve_by=lead) -> expect error
set test.uid = '00000000-0000-0000-0000-00000000000d';
update posts set status='approved' where id=:'post';
\echo 3. lead approves -> approved
set test.uid = '00000000-0000-0000-0000-00000000000b';
update posts set status='approved' where id=:'post';
select status from posts where id=:'post';
\echo 4. extra approval all: member edits words -> in_review, lead approves -> waiting_extra
reset test.uid; update schools set extra_approval='all';
set test.uid = '00000000-0000-0000-0000-00000000000c';
update posts set caption_ar='y' where id=:'post';
select status from posts where id=:'post';
set test.uid = '00000000-0000-0000-0000-00000000000b';
update posts set status='approved' where id=:'post';
select status from posts where id=:'post';
\echo 5. lead tries waiting_extra -> approved -> expect error
update posts set status='approved' where id=:'post';
\echo 6. principal approves -> approved
set test.uid = '00000000-0000-0000-0000-00000000000e';
update posts set status='approved' where id=:'post';
select status, signed_off_by is not null as signed from posts where id=:'post';
\echo 7. any_other: m2 approves m1 post
reset test.uid; update schools set extra_approval='off', approve_by='any_other';
set test.uid = '00000000-0000-0000-0000-00000000000c';
insert into posts (school_id, created_by) values (:'school','00000000-0000-0000-0000-00000000000c') returning id as p2 \gset
set test.uid = '00000000-0000-0000-0000-00000000000d';
update posts set status='approved' where id=:'p2';
select status from posts where id=:'p2';
\echo 8. lead own post, self publish on -> scheduled
set test.uid = '00000000-0000-0000-0000-00000000000b';
insert into posts (school_id, created_by, status) values (:'school','00000000-0000-0000-0000-00000000000b','scheduled') returning status;
\echo 9. lead self publish off -> expect error
reset test.uid; update schools set lead_self_publish=false;
set test.uid = '00000000-0000-0000-0000-00000000000b';
insert into posts (school_id, created_by, status) values (:'school','00000000-0000-0000-0000-00000000000b','scheduled') returning status;
\echo 10. versions kept
select count(*) from post_versions;
\echo 11. principal approving in_review directly -> error
reset test.uid; update schools set lead_self_publish=true;
set test.uid = '00000000-0000-0000-0000-00000000000c';
insert into posts (school_id, created_by) values (:'school','00000000-0000-0000-0000-00000000000c') returning id as p3 \gset
set test.uid = '00000000-0000-0000-0000-00000000000e';
update posts set status='approved' where id=:'p3';
\echo 12. urgent by lead with extra all -> approved directly
reset test.uid; update schools set extra_approval='all';
set test.uid = '00000000-0000-0000-0000-00000000000b';
update posts set status='approved', urgent=true where id=:'p3';
select status from posts where id=:'p3';

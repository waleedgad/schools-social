-- B-03: the class teacher can confirm a face from ANY library photo, not only
-- photos already on the website. For a photo that isn't on the website the
-- Mac uploads two small pictures instead: the face (about 200 px) and the
-- whole photo made small (600 px) so the teacher can see who it is. They
-- live in the private photos storage at <school>/checks/..., only the
-- website server opens them (signed links, after checking the teacher's
-- class), and they are deleted as soon as the question is answered or after
-- 14 days. The face numbers never leave the Mac.
alter table public.face_checks alter column photo_id drop not null;
alter table public.face_checks add column crop_path text;
alter table public.face_checks add column context_path text;
alter table public.face_checks add column expires_at timestamptz not null default (now() + interval '14 days');
alter table public.face_checks add constraint face_checks_has_picture check (answer is not null or photo_id is not null or crop_path is not null);
-- The pictures must be this school's own check pictures.
alter table public.face_checks add constraint face_checks_own_pictures check (
  (crop_path is null or crop_path like school_id::text || '/checks/%')
  and (context_path is null or context_path like school_id::text || '/checks/%')
);
create index face_checks_expires on public.face_checks (expires_at) where answer is null;

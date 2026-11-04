-- 0.5 speed: what the database's own speed check (Supabase advisors) asked for.
--
-- 1. Every link between tables gets an index, so that lists, deletes and
--    joins stay quick as a school's photos and posts grow into the thousands
--    (the Mac app had the same problem in B-31).
-- 2. Access rules ask "who is signed in?" once per query instead of once per
--    row: auth.uid() becomes (select auth.uid()). The rules themselves are
--    unchanged; the security robot tests check that.

create index if not exists approval_cover_from_user_fk on public.approval_cover (from_user);
create index if not exists approval_cover_school_id_fk on public.approval_cover (school_id);
create index if not exists approval_cover_to_user_fk on public.approval_cover (to_user);
create index if not exists audit_log_user_id_fk on public.audit_log (user_id);
create index if not exists book_checks_checked_by_fk on public.book_checks (checked_by);
create index if not exists book_checks_school_id_fk on public.book_checks (school_id);
create index if not exists book_comments_book_id_fk on public.book_comments (book_id);
create index if not exists book_comments_school_id_fk on public.book_comments (school_id);
create index if not exists book_comments_user_id_fk on public.book_comments (user_id);
create index if not exists book_texts_book_id_fk on public.book_texts (book_id);
create index if not exists book_texts_school_id_fk on public.book_texts (school_id);
create index if not exists book_texts_user_id_fk on public.book_texts (user_id);
create index if not exists books_created_by_fk on public.books (created_by);
create index if not exists categories_frame_id_fk on public.categories (frame_id);
create index if not exists computers_user_id_fk on public.computers (user_id);
create index if not exists events_category_id_fk on public.events (category_id);
create index if not exists events_created_by_fk on public.events (created_by);
create index if not exists face_checks_answered_by_fk on public.face_checks (answered_by);
create index if not exists face_checks_created_by_fk on public.face_checks (created_by);
create index if not exists face_checks_photo_id_fk on public.face_checks (photo_id);
create index if not exists frames_school_id_fk on public.frames (school_id);
create index if not exists invites_invited_by_fk on public.invites (invited_by);
create index if not exists meta_connections_connected_by_fk on public.meta_connections (connected_by);
create index if not exists photos_event_id_fk on public.photos (event_id);
create index if not exists photos_uploaded_by_fk on public.photos (uploaded_by);
create index if not exists post_comments_school_id_fk on public.post_comments (school_id);
create index if not exists post_comments_user_id_fk on public.post_comments (user_id);
create index if not exists post_metrics_school_id_fk on public.post_metrics (school_id);
create index if not exists post_photos_photo_id_fk on public.post_photos (photo_id);
create index if not exists post_photos_school_id_fk on public.post_photos (school_id);
create index if not exists post_versions_school_id_fk on public.post_versions (school_id);
create index if not exists post_versions_user_id_fk on public.post_versions (user_id);
create index if not exists posts_approved_by_fk on public.posts (approved_by);
create index if not exists posts_assigned_to_fk on public.posts (assigned_to);
create index if not exists posts_category_id_fk on public.posts (category_id);
create index if not exists posts_created_by_fk on public.posts (created_by);
create index if not exists posts_event_id_fk on public.posts (event_id);
create index if not exists posts_frame_id_fk on public.posts (frame_id);
create index if not exists posts_signed_off_by_fk on public.posts (signed_off_by);
create index if not exists problem_reports_school_id_fk on public.problem_reports (school_id);
create index if not exists problem_reports_user_id_fk on public.problem_reports (user_id);
create index if not exists review_links_created_by_fk on public.review_links (created_by);
create index if not exists review_links_post_id_fk on public.review_links (post_id);
create index if not exists review_links_school_id_fk on public.review_links (school_id);
create index if not exists school_integrations_whatsapp_event_fk on public.school_integrations (whatsapp_event);
create index if not exists shared_album_photos_photo_id_fk on public.shared_album_photos (photo_id);
create index if not exists shared_album_photos_school_id_fk on public.shared_album_photos (school_id);
create index if not exists shared_albums_created_by_fk on public.shared_albums (created_by);
create index if not exists snippets_school_id_fk on public.snippets (school_id);
create index if not exists team_alerts_created_by_fk on public.team_alerts (created_by);
create index if not exists team_alerts_to_user_fk on public.team_alerts (to_user);
create index if not exists time_slots_category_id_fk on public.time_slots (category_id);
create index if not exists upload_links_created_by_fk on public.upload_links (created_by);
create index if not exists upload_links_event_id_fk on public.upload_links (event_id);
create index if not exists upload_links_school_id_fk on public.upload_links (school_id);
create index if not exists user_prefs_school_id_fk on public.user_prefs (school_id);

alter policy "approvers manage cover" on public.approval_cover
  using ((has_role(school_id, ARRAY['admin'::app_role, 'comms_lead'::app_role, 'principal'::app_role]) AND ((from_user = (select auth.uid())) OR has_role(school_id, ARRAY['admin'::app_role]))))
  with check ((has_role(school_id, ARRAY['admin'::app_role, 'comms_lead'::app_role, 'principal'::app_role]) AND ((from_user = (select auth.uid())) OR has_role(school_id, ARRAY['admin'::app_role]))));
alter policy "members write their own audit entries" on public.audit_log
  with check ((is_member(school_id) AND (user_id = (select auth.uid()))));
alter policy "members check names" on public.book_checks
  using (is_member(school_id))
  with check ((is_member(school_id) AND (checked_by = (select auth.uid()))));
alter policy "members comment on books" on public.book_comments
  with check ((is_member(school_id) AND (user_id = (select auth.uid()))));
alter policy "members write book texts" on public.book_texts
  with check ((is_member(school_id) AND (user_id = (select auth.uid()))));
alter policy "writers or comms remove book texts" on public.book_texts
  using (((user_id = (select auth.uid())) OR has_role(school_id, ARRAY['admin'::app_role, 'comms_lead'::app_role, 'comms'::app_role])));
alter policy "admins create invites" on public.invites
  with check ((has_role(school_id, ARRAY['admin'::app_role]) AND (invited_by = (select auth.uid()))));
alter policy "admins remove staff" on public.memberships
  using ((has_role(school_id, ARRAY['admin'::app_role]) AND (user_id <> (select auth.uid()))));
alter policy "curators and uploaders change photos" on public.photos
  using ((has_role(school_id, ARRAY['admin'::app_role, 'comms'::app_role, 'principal'::app_role]) OR ((uploaded_by = (select auth.uid())) AND is_member(school_id))));
alter policy "curators and uploaders delete photos" on public.photos
  using ((has_role(school_id, ARRAY['admin'::app_role, 'comms'::app_role, 'principal'::app_role]) OR ((uploaded_by = (select auth.uid())) AND is_member(school_id))));
alter policy "curators and uploaders read photos" on public.photos
  using ((has_role(school_id, ARRAY['admin'::app_role, 'comms'::app_role, 'principal'::app_role]) OR ((uploaded_by = (select auth.uid())) AND is_member(school_id))));
alter policy "members upload photos" on public.photos
  with check ((is_member(school_id) AND (uploaded_by = (select auth.uid()))));
alter policy "authors delete their comments" on public.post_comments
  using ((user_id = (select auth.uid())));
alter policy "curators write comments" on public.post_comments
  with check ((has_role(school_id, ARRAY['admin'::app_role, 'comms'::app_role, 'principal'::app_role]) AND (user_id = (select auth.uid()))));
alter policy "admins read reports" on public.problem_reports
  using ((has_role(school_id, ARRAY['admin'::app_role]) OR (user_id = (select auth.uid()))));
alter policy "members send reports" on public.problem_reports
  with check ((is_member(school_id) AND (user_id = (select auth.uid()))));
alter policy "members read alerts" on public.team_alerts
  using ((is_member(school_id) AND ((to_user IS NULL) OR (to_user = (select auth.uid())) OR (created_by = (select auth.uid())))));
alter policy "members send alerts" on public.team_alerts
  with check ((is_member(school_id) AND (created_by = (select auth.uid()))));
alter policy "people manage their own prefs" on public.user_prefs
  using (((user_id = (select auth.uid())) AND is_member(school_id)))
  with check (((user_id = (select auth.uid())) AND is_member(school_id)));

-- Results, Calendar and the board look up a school's posts by when they were posted.
create index if not exists posts_school_published on public.posts (school_id, status, published_at);

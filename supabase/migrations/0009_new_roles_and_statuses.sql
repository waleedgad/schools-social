-- Roles plan (28 Oct 2026): a comms lead who approves inside the comms team,
-- non-teaching staff and photographers with their own accounts. Posts gain
-- an "idea" stage for the ideas board and a stage for the optional extra
-- approver (usually the principal).
-- New enum values must be committed before other code uses them, so they
-- live in their own migration.

alter type public.app_role add value if not exists 'comms_lead';
alter type public.app_role add value if not exists 'staff';
alter type public.app_role add value if not exists 'photographer';

alter type public.post_status add value if not exists 'idea' before 'draft';
alter type public.post_status add value if not exists 'waiting_extra' after 'in_review';

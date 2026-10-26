-- Phases 3 to 5: AI picks and edits, posts with approvals, Facebook and
-- Instagram connections, photographer upload links and school settings.

-- AI results and edits live next to each photo.
alter table public.photos
  add column ai_score smallint check (ai_score between 1 and 10),
  add column ai_reason text check (char_length(ai_reason) <= 300),
  add column ai_issues text[] not null default '{}',
  add column ai_checked_at timestamptz,
  add column edited_path text unique,
  add column edit_settings jsonb,
  add column source_key text,
  add column original_name text check (char_length(original_name) <= 260),
  add column taken_at timestamptz,
  add constraint photos_source_key_unique unique (school_id, source_key);

-- How the school sounds on social media.
alter table public.schools
  add column brand_voice text check (char_length(brand_voice) <= 500),
  add column hashtags text check (char_length(hashtags) <= 300),
  add column caption_languages text not null default 'ar_en' check (caption_languages in ('ar', 'en', 'ar_en')),
  add column require_signoff boolean not null default false;

create type public.post_status as enum (
  'draft', 'in_review', 'approved', 'scheduled', 'publishing', 'published', 'failed', 'rejected'
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  event_id uuid references public.events (id) on delete set null,
  status public.post_status not null default 'draft',
  caption_ar text check (char_length(caption_ar) <= 2200),
  caption_en text check (char_length(caption_en) <= 2200),
  hashtags text check (char_length(hashtags) <= 300),
  platforms text[] not null default array['facebook', 'instagram']
    check (platforms <@ array['facebook', 'instagram']),
  sensitive boolean not null default false,
  scheduled_at timestamptz,
  published_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  signed_off_by uuid references auth.users (id) on delete set null,
  review_note text check (char_length(review_note) <= 500),
  fb_post_id text,
  ig_media_id text,
  publish_error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index posts_school_status_idx on public.posts (school_id, status, scheduled_at);
create index posts_due_idx on public.posts (scheduled_at) where status = 'scheduled';

create table public.post_photos (
  post_id uuid not null references public.posts (id) on delete cascade,
  photo_id uuid not null references public.photos (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  position smallint not null default 0,
  primary key (post_id, photo_id)
);

alter table public.posts enable row level security;
alter table public.post_photos enable row level security;

create policy "curators manage posts" on public.posts
  for all using (public.has_role(school_id, array['admin', 'comms', 'principal']::public.app_role[]))
  with check (public.has_role(school_id, array['admin', 'comms', 'principal']::public.app_role[]));
create policy "curators manage post photos" on public.post_photos
  for all using (public.has_role(school_id, array['admin', 'comms', 'principal']::public.app_role[]))
  with check (public.has_role(school_id, array['admin', 'comms', 'principal']::public.app_role[]));

-- A photo marked "not for posting" can never be attached to a post, and a
-- post can only use its own school's photos.
create function public.check_post_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_photo public.photos;
begin
  select * into v_photo from public.photos where id = new.photo_id;
  if v_photo.school_id is distinct from new.school_id
     or not exists (select 1 from public.posts where id = new.post_id and school_id = new.school_id) then
    raise exception 'photo and post belong to different schools';
  end if;
  if v_photo.contains_opted_out then
    raise exception 'photo is marked not for posting' using errcode = 'P0001', hint = 'opted_out';
  end if;
  return new;
end;
$$;

create trigger post_photos_check before insert or update on public.post_photos
  for each row execute function public.check_post_photo();

-- Approval rules, enforced in the database so no screen can skip them:
--   * approving or scheduling needs a principal or admin when the post is
--     sensitive or the school asks for sign-off on every post;
--   * changing the words of an approved post sends it back for review;
--   * people can't edit a post that is publishing or already published.
-- The publishing job runs without a signed-in user and skips these checks.
create function public.guard_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_signoff boolean;
begin
  new.updated_at := now();
  if v_uid is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status in ('publishing', 'published') then
    raise exception 'published posts cannot be changed';
  end if;

  if tg_op = 'UPDATE' and old.status in ('approved', 'scheduled') and new.status = old.status
     and (new.caption_ar is distinct from old.caption_ar
          or new.caption_en is distinct from old.caption_en
          or new.hashtags is distinct from old.hashtags
          or new.sensitive is distinct from old.sensitive) then
    new.status := 'in_review';
    new.approved_by := null;
    new.signed_off_by := null;
  end if;

  if new.status in ('publishing', 'published')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    raise exception 'only the publisher can mark a post published';
  end if;

  if new.status in ('approved', 'scheduled')
     and (tg_op = 'INSERT' or old.status not in ('approved', 'scheduled')) then
    select require_signoff into v_signoff from public.schools where id = new.school_id;
    if (new.sensitive or v_signoff)
       and not public.has_role(new.school_id, array['admin', 'principal']::public.app_role[]) then
      raise exception 'this post needs sign-off from the principal or admin' using hint = 'signoff';
    end if;
    new.approved_by := v_uid;
    if new.sensitive or v_signoff then
      new.signed_off_by := v_uid;
    end if;
  end if;

  if new.status = 'scheduled' and new.scheduled_at is null then
    new.scheduled_at := now();
  end if;

  return new;
end;
$$;

create trigger posts_guard before insert or update on public.posts
  for each row execute function public.guard_post();

-- Facebook Page and Instagram account per school. Page tokens are secrets,
-- so this table has no policies at all: only the server can read it.
-- Staff see the safe parts through meta_status().
create table public.meta_connections (
  school_id uuid primary key references public.schools (id) on delete cascade,
  page_id text,
  page_name text,
  page_token text,
  ig_user_id text,
  ig_username text,
  pages jsonb not null default '[]',
  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz not null default now(),
  last_error text
);

alter table public.meta_connections enable row level security;

create function public.meta_status(p_school uuid)
returns table (page_id text, page_name text, ig_username text, connected_at timestamptz, last_error text, pages jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select c.page_id, c.page_name, c.ig_username, c.connected_at, c.last_error,
         coalesce((select jsonb_agg(jsonb_build_object('id', p->>'id', 'name', p->>'name', 'ig', p->>'ig_username'))
                   from jsonb_array_elements(c.pages) p), '[]'::jsonb)
  from public.meta_connections c
  where c.school_id = p_school and public.is_member(p_school);
$$;

revoke execute on function public.meta_status(uuid) from public, anon;
grant execute on function public.meta_status(uuid) to authenticated;

-- Photographer and agency upload links: one per event, no account needed.
create table public.upload_links (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  label text not null check (char_length(label) between 2 and 80),
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  expires_at timestamptz not null default now() + interval '30 days',
  revoked_at timestamptz,
  upload_count int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.upload_links enable row level security;

create policy "curators manage upload links" on public.upload_links
  for all using (public.has_role(school_id, array['admin', 'comms', 'principal']::public.app_role[]))
  with check (public.has_role(school_id, array['admin', 'comms', 'principal']::public.app_role[]));

create function public.get_upload_link(p_token text)
returns table (school_name text, event_title text, event_date date, label text, usable boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.name, e.title, e.event_date, l.label,
         l.revoked_at is null and l.expires_at > now()
  from public.upload_links l
  join public.schools s on s.id = l.school_id
  join public.events e on e.id = l.event_id
  where l.token = p_token;
$$;

grant execute on function public.get_upload_link(text) to anon, authenticated;

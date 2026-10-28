-- Foundations for the 0.3 build: approval inside the comms team with an
-- optional extra approver, categories with time slots, caption variations,
-- comments and history on posts, brand profile, snippets, frames, pausing,
-- analytics, per-user layouts, holiday cover, approval links, student
-- history and the Mac check for photos uploaded on the website.

-- People: phone, classes they teach, last seen, and deactivation that keeps
-- their history. Custom permissions per role live on the school.
alter table public.memberships
  add column active boolean not null default true,
  add column phone text check (char_length(phone) <= 30),
  add column classes text[] not null default '{}',
  add column last_seen_at timestamptz;

-- The comms lead can do everything a comms member can. Every policy that
-- names 'comms' therefore also lets the comms lead in.
create or replace function public.has_role(p_school uuid, p_roles public.app_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.school_id = p_school and m.user_id = auth.uid() and m.active
      and (m.role = any (p_roles) or (m.role = 'comms_lead' and 'comms' = any (p_roles)))
  );
$$;

create or replace function public.is_member(p_school uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.school_id = p_school and m.user_id = auth.uid() and m.active
  );
$$;

-- How a school approves posts, and other school-wide settings.
alter table public.schools
  add column approve_by text not null default 'lead' check (approve_by in ('lead', 'any_other')),
  add column lead_self_publish boolean not null default true,
  add column extra_approval text not null default 'off' check (extra_approval in ('off', 'all', 'categories', 'flagged')),
  add column extra_approvers uuid[] not null default '{}',
  add column extra_timeout_hours int check (extra_timeout_hours between 1 and 168),
  add column extra_timeout_action text not null default 'hold' check (extra_timeout_action in ('hold', 'go')),
  add column posting_paused_until timestamptz,
  add column pause_reason text check (char_length(pause_reason) <= 200),
  add column photo_limit int check (photo_limit between 1 and 80),
  add column permissions jsonb not null default '{}'::jsonb,
  add column brand jsonb not null default '{}'::jsonb,
  add column profile jsonb not null default '{}'::jsonb,
  add column term_dates jsonb not null default '[]'::jsonb,
  add column self_filing boolean not null default false;

-- Content categories, each with its own colour, hashtags, frame and rules.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name_ar text not null check (char_length(name_ar) between 1 and 60),
  name_en text not null check (char_length(name_en) between 1 and 60),
  description text check (char_length(description) <= 300),
  color text not null default '#3b6cf6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  hashtags text check (char_length(hashtags) <= 300),
  frame_id uuid,
  needs_extra_approval boolean not null default false,
  auto_approve boolean not null default false,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
create index categories_school_idx on public.categories (school_id, position);

-- Weekly posting slots: "Sunday 18:00 is for Achievements".
create table public.time_slots (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  category_id uuid references public.categories (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  at_time time not null,
  platforms text[] not null default array['facebook', 'instagram'],
  created_at timestamptz not null default now()
);
create index time_slots_school_idx on public.time_slots (school_id, weekday, at_time);

-- Frames and logo corners for exported photos (PNG with transparency).
create table public.frames (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  kind text not null default 'frame' check (kind in ('frame', 'logo')),
  storage_path text not null,
  shape text not null default '4:5' check (shape in ('4:5', '1:1', '9:16', 'any')),
  created_at timestamptz not null default now()
);
alter table public.categories
  add constraint categories_frame_fk foreign key (frame_id) references public.frames (id) on delete set null;

-- Saved snippets and hashtag sets.
create table public.snippets (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'hashtags', 'signoff', 'avoid')),
  title text not null check (char_length(title) between 1 and 60),
  body text not null check (char_length(body) <= 1000),
  created_at timestamptz not null default now()
);

-- Posts: category, variations, per-platform captions, story, first comment,
-- location, alt text, assignment, ideas and urgent posts.
alter table public.posts
  add column category_id uuid references public.categories (id) on delete set null,
  add column variations jsonb not null default '[]'::jsonb,
  add column caption_ig text check (char_length(caption_ig) <= 2200),
  add column first_comment text check (char_length(first_comment) <= 2200),
  add column location text check (char_length(location) <= 120),
  add column alt_text jsonb not null default '{}'::jsonb,
  add column make_story boolean not null default false,
  add column frame_id uuid references public.frames (id) on delete set null,
  add column cover_collage boolean not null default false,
  add column collaborators text[] not null default '{}',
  add column assigned_to uuid references auth.users (id) on delete set null,
  add column due_on date,
  add column idea text check (char_length(idea) <= 1000),
  add column urgent boolean not null default false,
  add column sent_extra_at timestamptz;

-- Notes, @mentions and approvers' comments on a post.
create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  author_name text check (char_length(author_name) <= 120),
  kind text not null default 'note' check (kind in ('note', 'review', 'system')),
  body text not null check (char_length(body) between 1 and 2000),
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index post_comments_post_idx on public.post_comments (post_id, created_at);

-- Every saved caption, so any earlier version can be brought back.
create table public.post_versions (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.posts (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  caption_ar text,
  caption_en text,
  caption_ig text,
  hashtags text,
  created_at timestamptz not null default now()
);
create index post_versions_post_idx on public.post_versions (post_id, created_at desc);

-- Approval links for people without an account (for example the owner).
create table public.review_links (
  token text primary key default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  post_id uuid not null references public.posts (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  label text not null check (char_length(label) between 2 and 80),
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  answered_at timestamptz,
  answer text check (answer in ('approved', 'changes')),
  comment text check (char_length(comment) <= 1000),
  created_at timestamptz not null default now()
);

-- Holiday cover: someone else approves for set dates.
create table public.approval_cover (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  created_at timestamptz not null default now()
);

-- Each person's own layout (Today sections and so on), on Mac and website.
create table public.user_prefs (
  user_id uuid not null references auth.users (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  today jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, school_id)
);

-- Results from Facebook and Instagram.
create table public.post_metrics (
  post_id uuid not null references public.posts (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram')),
  likes int not null default 0,
  comments int not null default 0,
  shares int not null default 0,
  reach int not null default 0,
  saves int not null default 0,
  fetched_at timestamptz not null default now(),
  primary key (post_id, platform)
);
create table public.account_metrics (
  school_id uuid not null references public.schools (id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram')),
  day date not null,
  followers int not null default 0,
  reach int not null default 0,
  primary key (school_id, platform, day)
);

-- Pausing one account (Running / Paused on the accounts page).
alter table public.meta_connections
  add column fb_paused boolean not null default false,
  add column ig_paused boolean not null default false,
  add column token_expires_at timestamptz;

drop function public.meta_status(uuid);
create function public.meta_status(p_school uuid)
returns table (page_id text, page_name text, ig_username text, connected_at timestamptz, last_error text, pages jsonb,
               fb_paused boolean, ig_paused boolean, token_expires_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select c.page_id, c.page_name, c.ig_username, c.connected_at, c.last_error,
         coalesce((select jsonb_agg(jsonb_build_object('id', p->>'id', 'name', p->>'name', 'ig', p->>'ig_username'))
                   from jsonb_array_elements(c.pages) p), '[]'::jsonb),
         c.fb_paused, c.ig_paused, c.token_expires_at
  from public.meta_connections c
  where c.school_id = p_school and public.is_member(p_school);
$$;
revoke execute on function public.meta_status(uuid) from public, anon;
grant execute on function public.meta_status(uuid) to authenticated;

create function public.set_account_paused(p_school uuid, p_platform text, p_paused boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_role(p_school, array['admin', 'comms_lead']::public.app_role[]) then
    raise exception 'only the admin or comms lead can pause an account';
  end if;
  if p_platform = 'facebook' then
    update public.meta_connections set fb_paused = p_paused where school_id = p_school;
  elsif p_platform = 'instagram' then
    update public.meta_connections set ig_paused = p_paused where school_id = p_school;
  end if;
  insert into public.audit_log (school_id, user_id, action, target, details)
  values (p_school, auth.uid(), case when p_paused then 'account.paused' else 'account.resumed' end, p_platform, '{}');
end;
$$;
revoke execute on function public.set_account_paused(uuid, text, boolean) from public, anon;
grant execute on function public.set_account_paused(uuid, text, boolean) to authenticated;

-- Photos uploaded on the website wait for the Mac's face check before they
-- can go into a post. Photos sent by the Mac are already checked.
alter table public.photos
  add column check_status text not null default 'ready' check (check_status in ('waiting', 'ready')),
  add column checked_at timestamptz,
  add column blur_boxes jsonb not null default '[]'::jsonb,
  add column topic text check (char_length(topic) <= 40),
  add column alt_ar text check (char_length(alt_ar) <= 400),
  add column alt_en text check (char_length(alt_en) <= 400),
  add column is_pick boolean not null default false;

create function public.photo_needs_check()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.source in ('staff', 'photographer') then
    new.check_status := 'waiting';
  end if;
  return new;
end;
$$;
create trigger photos_need_check before insert on public.photos
  for each row execute function public.photo_needs_check();

-- Events get a category and stay linked to the school calendar.
alter table public.events
  add column category_id uuid references public.categories (id) on delete set null,
  add column ends_on date,
  add column kind text not null default 'event' check (kind in ('event', 'occasion', 'holiday', 'exam'));

-- Student history: when they joined and left, and their class each year.
alter table public.students
  add column joined_on date,
  add column left_on date,
  add column history jsonb not null default '[]'::jsonb,
  add column active boolean not null default true;

-- Row level security for the new tables.
alter table public.categories enable row level security;
alter table public.time_slots enable row level security;
alter table public.frames enable row level security;
alter table public.snippets enable row level security;
alter table public.post_comments enable row level security;
alter table public.post_versions enable row level security;
alter table public.review_links enable row level security;
alter table public.approval_cover enable row level security;
alter table public.user_prefs enable row level security;
alter table public.post_metrics enable row level security;
alter table public.account_metrics enable row level security;

create policy "members read categories" on public.categories for select using (public.is_member(school_id));
create policy "comms manage categories" on public.categories for all
  using (public.has_role(school_id, array['admin', 'comms_lead']::public.app_role[]))
  with check (public.has_role(school_id, array['admin', 'comms_lead']::public.app_role[]));

create policy "members read slots" on public.time_slots for select using (public.is_member(school_id));
create policy "comms manage slots" on public.time_slots for all
  using (public.has_role(school_id, array['admin', 'comms_lead']::public.app_role[]))
  with check (public.has_role(school_id, array['admin', 'comms_lead']::public.app_role[]));

create policy "members read frames" on public.frames for select using (public.is_member(school_id));
create policy "comms manage frames" on public.frames for all
  using (public.has_role(school_id, array['admin', 'comms']::public.app_role[]))
  with check (public.has_role(school_id, array['admin', 'comms']::public.app_role[]));

create policy "members read snippets" on public.snippets for select using (public.is_member(school_id));
create policy "comms manage snippets" on public.snippets for all
  using (public.has_role(school_id, array['admin', 'comms']::public.app_role[]))
  with check (public.has_role(school_id, array['admin', 'comms']::public.app_role[]));

create policy "curators read comments" on public.post_comments for select
  using (public.has_role(school_id, array['admin', 'comms', 'principal']::public.app_role[]));
create policy "curators write comments" on public.post_comments for insert
  with check (public.has_role(school_id, array['admin', 'comms', 'principal']::public.app_role[]) and user_id = auth.uid());
create policy "authors delete their comments" on public.post_comments for delete
  using (user_id = auth.uid());

create policy "curators read versions" on public.post_versions for select
  using (public.has_role(school_id, array['admin', 'comms', 'principal']::public.app_role[]));

create policy "comms manage review links" on public.review_links for all
  using (public.has_role(school_id, array['admin', 'comms']::public.app_role[]))
  with check (public.has_role(school_id, array['admin', 'comms']::public.app_role[]));

create policy "members read cover" on public.approval_cover for select using (public.is_member(school_id));
create policy "approvers manage cover" on public.approval_cover for all
  using (public.has_role(school_id, array['admin', 'comms_lead', 'principal']::public.app_role[]) and (from_user = auth.uid() or public.has_role(school_id, array['admin']::public.app_role[])))
  with check (public.has_role(school_id, array['admin', 'comms_lead', 'principal']::public.app_role[]) and (from_user = auth.uid() or public.has_role(school_id, array['admin']::public.app_role[])));

create policy "people manage their own prefs" on public.user_prefs for all
  using (user_id = auth.uid() and public.is_member(school_id))
  with check (user_id = auth.uid() and public.is_member(school_id));

create policy "curators read post metrics" on public.post_metrics for select
  using (public.has_role(school_id, array['admin', 'comms', 'principal']::public.app_role[]));
create policy "curators read account metrics" on public.account_metrics for select
  using (public.has_role(school_id, array['admin', 'comms', 'principal']::public.app_role[]));

-- Keep a version of the captions every time they change.
create function public.keep_post_version()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.caption_ar is distinct from old.caption_ar
     or new.caption_en is distinct from old.caption_en
     or new.caption_ig is distinct from old.caption_ig
     or new.hashtags is distinct from old.hashtags then
    if coalesce(new.caption_ar, new.caption_en, new.caption_ig, new.hashtags) is not null then
      insert into public.post_versions (post_id, school_id, user_id, caption_ar, caption_en, caption_ig, hashtags)
      values (new.id, new.school_id, auth.uid(), new.caption_ar, new.caption_en, new.caption_ig, new.hashtags);
    end if;
  end if;
  return null;
end;
$$;
create trigger posts_keep_version after insert or update on public.posts
  for each row execute function public.keep_post_version();

-- Does this post need the extra approver?
create function public.needs_extra(p_post public.posts)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case s.extra_approval
    when 'all' then true
    when 'categories' then coalesce((select c.needs_extra_approval from public.categories c where c.id = p_post.category_id), false)
    when 'flagged' then p_post.sensitive
    else false
  end or (s.require_signoff)
  from public.schools s where s.id = p_post.school_id;
$$;

-- Is this user an extra approver for the school today (directly, as
-- principal/admin, or covering for one)?
create function public.is_extra_approver(p_school uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.schools s
    where s.id = p_school and (
      p_user = any (s.extra_approvers)
      or (cardinality(s.extra_approvers) = 0 and exists (
            select 1 from public.memberships m where m.school_id = p_school and m.user_id = p_user and m.active and m.role in ('admin', 'principal')))
      or exists (
            select 1 from public.approval_cover c
            where c.school_id = p_school and c.to_user = p_user and current_date between c.starts_on and c.ends_on
              and (c.from_user = any (s.extra_approvers)
                   or exists (select 1 from public.memberships m where m.school_id = p_school and m.user_id = c.from_user and m.role in ('admin', 'principal')))))
  );
$$;

-- Can this user give the comms approval?
create function public.is_comms_approver(p_school uuid, p_user uuid, p_author uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m join public.schools s on s.id = m.school_id
    where m.school_id = p_school and m.user_id = p_user and m.active and (
      m.role in ('admin', 'comms_lead')
      or (s.approve_by = 'any_other' and m.role = 'comms' and p_user is distinct from p_author)
    )
  ) or exists (
    select 1 from public.approval_cover c join public.memberships m on m.school_id = c.school_id and m.user_id = c.from_user
    where c.school_id = p_school and c.to_user = p_user and m.role in ('admin', 'comms_lead')
      and current_date between c.starts_on and c.ends_on
  );
$$;

-- Approval rules, enforced in the database so no screen can skip them:
--   draft / in_review -> waiting_extra or approved needs a comms approver
--   (the comms lead, or any other comms member if the school allows it; the
--   lead's own posts can skip this when the school allows it);
--   waiting_extra -> approved needs the extra approver;
--   changing the words of an approved post sends it back to comms review;
--   an urgent post by the admin or comms lead skips the extra approver.
create or replace function public.guard_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_changed boolean := false;
  v_extra boolean;
  v_lead boolean;
  v_self boolean;
begin
  new.updated_at := now();
  if v_uid is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.status in ('publishing', 'published') then
      raise exception 'published posts cannot be changed';
    end if;
    v_changed := new.caption_ar is distinct from old.caption_ar
      or new.caption_en is distinct from old.caption_en
      or new.caption_ig is distinct from old.caption_ig
      or new.hashtags is distinct from old.hashtags
      or new.sensitive is distinct from old.sensitive;
    if old.status in ('approved', 'scheduled', 'waiting_extra') and new.status = old.status and v_changed then
      new.status := 'in_review';
      new.approved_by := null;
      new.signed_off_by := null;
    end if;
  end if;

  if new.status in ('publishing', 'published')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    raise exception 'only the publisher can mark a post published';
  end if;

  v_extra := public.needs_extra(new);
  v_lead := public.has_role(new.school_id, array['admin', 'comms_lead']::public.app_role[]);
  select s.lead_self_publish into v_self from public.schools s where s.id = new.school_id;

  -- Comms approval: to waiting_extra, or straight to approved/scheduled.
  if new.status in ('waiting_extra', 'approved', 'scheduled')
     and (tg_op = 'INSERT' or old.status not in ('waiting_extra', 'approved', 'scheduled') or v_changed) then
    if not public.is_comms_approver(new.school_id, v_uid, new.created_by)
       and not (v_lead and v_self) then
      raise exception 'this post needs approval from the comms lead' using hint = 'comms';
    end if;
    if not v_self and v_uid = new.created_by
       and not public.has_role(new.school_id, array['admin']::public.app_role[]) then
      raise exception 'someone else in comms must approve your post' using hint = 'comms';
    end if;
    new.approved_by := v_uid;
    new.signed_off_by := null;
    if v_extra and not (new.urgent and v_lead) and new.status <> 'waiting_extra' then
      if public.is_extra_approver(new.school_id, v_uid) then
        new.signed_off_by := v_uid;
      else
        new.status := 'waiting_extra';
        new.sent_extra_at := now();
      end if;
    end if;
    if new.status = 'waiting_extra' then
      new.sent_extra_at := now();
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'waiting_extra' and new.status in ('approved', 'scheduled') then
    if not public.is_extra_approver(new.school_id, v_uid) then
      raise exception 'this post needs sign-off from the principal' using hint = 'signoff';
    end if;
    new.signed_off_by := v_uid;
  end if;

  if new.status = 'scheduled' and new.scheduled_at is null then
    new.scheduled_at := now();
  end if;

  return new;
end;
$$;

-- Extra approvers (the principal) see posts waiting for them and can answer
-- them; their policy above already covers reading posts.

-- What an approval link shows, and answering it, without an account.
create function public.get_review_link(p_token text)
returns table (school_name text, label text, caption_ar text, caption_en text, status public.post_status, usable boolean, photo_paths text[])
language sql stable security definer set search_path = ''
as $$
  select s.name, l.label, p.caption_ar, p.caption_en, p.status,
         l.expires_at > now() and l.answered_at is null,
         array(select coalesce(ph.edited_path, ph.storage_path) from public.post_photos pp join public.photos ph on ph.id = pp.photo_id
               where pp.post_id = p.id order by pp.position)
  from public.review_links l
  join public.posts p on p.id = l.post_id
  join public.schools s on s.id = l.school_id
  where l.token = p_token;
$$;
grant execute on function public.get_review_link(text) to anon, authenticated;

create function public.answer_review_link(p_token text, p_answer text, p_comment text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_link public.review_links%rowtype;
begin
  select * into v_link from public.review_links where token = p_token for update;
  if not found or v_link.answered_at is not null or v_link.expires_at < now() then
    raise exception 'this link can no longer be used';
  end if;
  if p_answer not in ('approved', 'changes') then
    raise exception 'unknown answer';
  end if;
  update public.review_links set answered_at = now(), answer = p_answer, comment = left(p_comment, 1000) where token = p_token;
  insert into public.post_comments (post_id, school_id, author_name, kind, body)
  values (v_link.post_id, v_link.school_id, v_link.label, 'review',
          case when p_answer = 'approved' then 'Approved by link' else 'Asked for changes' end
          || coalesce(': ' || nullif(trim(p_comment), ''), ''));
end;
$$;
grant execute on function public.answer_review_link(text, text, text) to anon, authenticated;

revoke execute on function public.keep_post_version() from public, anon, authenticated;
revoke execute on function public.photo_needs_check() from public, anon, authenticated;
revoke execute on function public.needs_extra(public.posts) from public, anon;
revoke execute on function public.is_extra_approver(uuid, uuid) from public, anon;
revoke execute on function public.is_comms_approver(uuid, uuid, uuid) from public, anon;
grant execute on function public.is_extra_approver(uuid, uuid) to authenticated;
grant execute on function public.is_comms_approver(uuid, uuid, uuid) to authenticated;

-- Ready-made school categories for every school that has none yet, and new
-- schools get them too.
create function public.seed_categories(p_school uuid)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.categories (school_id, name_ar, name_en, description, color, position)
  select p_school, v.ar, v.en, v.d, v.c, v.p
  from (values
    ('إنجازات', 'Achievements', 'Awards, competitions and results.', '#2f8f5b', 0),
    ('فعاليات', 'Events', 'Trips, celebrations, sports days and assemblies.', '#3b6cf6', 1),
    ('أكاديمي', 'Academics', 'Lessons, projects and learning in class.', '#7c4dcc', 2),
    ('من داخل المدرسة', 'Behind the scenes', 'A normal day at school.', '#c0582b', 3),
    ('معلمونا', 'Teacher spotlight', 'Thanking and introducing teachers.', '#b8860b', 4),
    ('أعمال الطلاب', 'Student work', 'Art, writing and projects by students.', '#d0457a', 5),
    ('إعلانات', 'Announcements', 'Holidays, dates and reminders.', '#4b5563', 6),
    ('القبول', 'Admissions', 'Open days and enrolment.', '#0e7490', 7),
    ('مناسبات', 'Occasions', 'National days, Ramadan, Eid and other occasions.', '#9a3412', 8)
  ) as v(ar, en, d, c, p)
  where not exists (select 1 from public.categories where school_id = p_school);
$$;
revoke execute on function public.seed_categories(uuid) from public, anon, authenticated;

select public.seed_categories(id) from public.schools;

create function public.seed_new_school()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.seed_categories(new.id);
  return null;
end;
$$;
revoke execute on function public.seed_new_school() from public, anon, authenticated;
create trigger schools_seed after insert on public.schools
  for each row execute function public.seed_new_school();

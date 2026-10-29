-- Website side of Mac app 0.4: school calendar holidays and no-posting
-- days, one language mode per category, library computers per plan, problem
-- reports, team-shared albums, team alerts (an import finished, a reminder),
-- Today layouts and set-up progress shared between the Mac and the website,
-- coverage numbers from the Mac, who is in each photo, yearbook review, and
-- calendar extras (photos expected, yearly repeats, countdown posts).

alter table public.schools
  add column holidays jsonb not null default '[]'::jsonb,
  add column no_post_days jsonb not null default '{}'::jsonb,
  add column computer_limit int not null default 2 check (computer_limit between 1 and 50),
  add column setup jsonb not null default '{}'::jsonb;

alter table public.categories
  add column language_mode text not null default 'both' check (language_mode in ('both', 'separate', 'ar', 'en'));

alter table public.user_prefs
  add column today_layout jsonb;

alter table public.photos
  add column people text[] not null default '{}';

alter table public.events
  add column photos_expected boolean not null default false,
  add column repeat_yearly boolean not null default false,
  add column shot_list jsonb not null default '[]'::jsonb;

alter table public.posts
  add column countdown_to date;

alter table public.students
  add column kind text not null default 'student' check (kind in ('student', 'teacher', 'staff', 'parent', 'visitor')),
  add column stage text check (char_length(stage) <= 40),
  add column grade text check (char_length(grade) <= 40),
  add column birthday date,
  add column clubs text[] not null default '{}',
  add column achievements jsonb not null default '[]'::jsonb,
  add column class_teacher text check (char_length(class_teacher) <= 120);

-- Library computers (Mac or Windows) signed in for a school. The plan sets
-- how many; a new computer over the limit is refused.
create table public.computers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  device_id text not null check (char_length(device_id) between 8 and 80),
  name text check (char_length(name) <= 80),
  platform text check (char_length(platform) <= 20),
  user_id uuid references auth.users (id) on delete set null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (school_id, device_id)
);

create function public.register_computer(p_school uuid, p_device text, p_name text, p_platform text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
  lim int;
begin
  if not public.has_role(p_school, array['admin', 'comms_lead', 'comms']::public.app_role[]) then
    return jsonb_build_object('error', 'role');
  end if;
  if exists (select 1 from public.computers where school_id = p_school and device_id = p_device) then
    update public.computers set last_seen_at = now(), user_id = auth.uid(), name = left(p_name, 80), platform = left(p_platform, 20)
    where school_id = p_school and device_id = p_device;
  else
    select count(*) into n from public.computers where school_id = p_school;
    select computer_limit into lim from public.schools where id = p_school;
    if n >= lim then
      return jsonb_build_object('error', 'computer-limit', 'limit', lim);
    end if;
    insert into public.computers (school_id, device_id, name, platform, user_id) values (p_school, p_device, left(p_name, 80), left(p_platform, 20), auth.uid());
  end if;
  select count(*) into n from public.computers where school_id = p_school;
  select computer_limit into lim from public.schools where id = p_school;
  return jsonb_build_object('computers', n, 'limit', lim);
end;
$$;
revoke execute on function public.register_computer(uuid, text, text, text) from public, anon;
grant execute on function public.register_computer(uuid, text, text, text) to authenticated;

-- "Report a problem" from the Mac app or the website.
create table public.problem_reports (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  log text check (char_length(log) <= 8000),
  screenshot text check (char_length(screenshot) <= 3000000),
  info text check (char_length(info) <= 200),
  status text not null default 'open' check (status in ('open', 'seen', 'fixed')),
  created_at timestamptz not null default now()
);

-- Albums made on the Mac and shared with the team on the website.
create table public.shared_albums (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  mac_id int not null,
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (school_id, created_by, mac_id)
);
create table public.shared_album_photos (
  album_id uuid not null references public.shared_albums (id) on delete cascade,
  photo_id uuid not null references public.photos (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  position int not null default 0,
  primary key (album_id, photo_id)
);

-- Alerts for the team: an import finished on the Mac, a reminder about a
-- post waiting for someone.
create table public.team_alerts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  kind text not null check (kind in ('import', 'remind', 'book')),
  to_user uuid references auth.users (id) on delete cascade,
  body jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  read_by uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index team_alerts_school_idx on public.team_alerts (school_id, created_at desc);

create function public.read_alert(p_alert uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.team_alerts set read_by = array_append(read_by, auth.uid())
  where id = p_alert and public.is_member(school_id) and not (auth.uid() = any (read_by));
$$;
revoke execute on function public.read_alert(uuid) from public, anon;
grant execute on function public.read_alert(uuid) to authenticated;

-- Coverage numbers worked out on the Mac (no faces, only counts), so
-- teachers can see their class on the phone.
create table public.student_coverage (
  school_id uuid not null references public.schools (id) on delete cascade,
  student_code text not null,
  class_name text,
  photos int not null default 0,
  posts int not null default 0,
  last_photo date,
  updated_at timestamptz not null default now(),
  primary key (school_id, student_code)
);

-- Yearbooks sent from the Mac for review: page pictures, locked pages and
-- versions; teachers check the names of their class on the phone.
create table public.books (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  mac_id text not null,
  title text not null check (char_length(title) <= 120),
  kind text not null default 'grade' check (kind in ('grade', 'class', 'student', 'graduation')),
  grade text,
  class_name text,
  version int not null default 1,
  pages jsonb not null default '[]'::jsonb,
  status text not null default 'review' check (status in ('review', 'approved', 'printing')),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (school_id, mac_id)
);
create table public.book_checks (
  book_id uuid not null references public.books (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  student_code text not null,
  ok boolean,
  fixed_name text check (char_length(fixed_name) <= 120),
  note text check (char_length(note) <= 500),
  checked_by uuid references auth.users (id) on delete set null,
  checked_at timestamptz not null default now(),
  primary key (book_id, student_code)
);
create table public.book_comments (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  page int not null,
  body text not null check (char_length(body) between 1 and 1000),
  user_id uuid references auth.users (id) on delete set null,
  author_name text,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

-- "Is this …?" checks for a class teacher's phone: the web copy of the
-- photo, where the face is, and the suggested student. The answer goes back
-- to the Mac, which names (or un-suggests) the face there.
create table public.face_checks (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  mac_id bigint not null,
  photo_id uuid not null references public.photos (id) on delete cascade,
  box jsonb not null,
  student_code text not null,
  class_name text,
  score real,
  answer boolean,
  answered_by uuid references auth.users (id) on delete set null,
  answered_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (school_id, mac_id)
);
alter table public.face_checks enable row level security;
create policy "members read face checks" on public.face_checks for select using (public.is_member(school_id));
create policy "comms send face checks" on public.face_checks for insert
  with check (public.has_role(school_id, array['admin', 'comms_lead', 'comms']::public.app_role[]));
create policy "comms clear face checks" on public.face_checks for delete
  using (public.has_role(school_id, array['admin', 'comms_lead', 'comms']::public.app_role[]));
-- Teachers answer only for the classes they teach (or any class for comms).
create function public.answer_face_check(p_check uuid, p_answer boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c public.face_checks;
begin
  select * into c from public.face_checks where id = p_check;
  if c.id is null or not public.is_member(c.school_id) then
    raise exception 'not allowed';
  end if;
  if not public.has_role(c.school_id, array['admin', 'comms_lead', 'comms']::public.app_role[])
     and not exists (select 1 from public.memberships m where m.school_id = c.school_id and m.user_id = auth.uid() and c.class_name = any (m.classes)) then
    raise exception 'not your class';
  end if;
  update public.face_checks set answer = p_answer, answered_by = auth.uid(), answered_at = now() where id = p_check;
end;
$$;
revoke execute on function public.answer_face_check(uuid, boolean) from public, anon;
grant execute on function public.answer_face_check(uuid, boolean) to authenticated;

alter table public.computers enable row level security;
alter table public.problem_reports enable row level security;
alter table public.shared_albums enable row level security;
alter table public.shared_album_photos enable row level security;
alter table public.team_alerts enable row level security;
alter table public.student_coverage enable row level security;
alter table public.books enable row level security;
alter table public.book_checks enable row level security;
alter table public.book_comments enable row level security;

create policy "members read computers" on public.computers for select using (public.is_member(school_id));
create policy "admins remove computers" on public.computers for delete using (public.has_role(school_id, array['admin']::public.app_role[]));

create policy "members send reports" on public.problem_reports for insert with check (public.is_member(school_id) and user_id = auth.uid());
create policy "admins read reports" on public.problem_reports for select using (public.has_role(school_id, array['admin']::public.app_role[]) or user_id = auth.uid());

create policy "members read shared albums" on public.shared_albums for select using (public.is_member(school_id));
create policy "comms manage shared albums" on public.shared_albums for all
  using (public.has_role(school_id, array['admin', 'comms_lead', 'comms']::public.app_role[]))
  with check (public.has_role(school_id, array['admin', 'comms_lead', 'comms']::public.app_role[]));
create policy "members read shared album photos" on public.shared_album_photos for select using (public.is_member(school_id));
create policy "comms manage shared album photos" on public.shared_album_photos for all
  using (public.has_role(school_id, array['admin', 'comms_lead', 'comms']::public.app_role[]))
  with check (public.has_role(school_id, array['admin', 'comms_lead', 'comms']::public.app_role[]));

create policy "members read alerts" on public.team_alerts for select using (public.is_member(school_id) and (to_user is null or to_user = auth.uid() or created_by = auth.uid()));
create policy "members send alerts" on public.team_alerts for insert with check (public.is_member(school_id) and created_by = auth.uid());

create policy "members read coverage" on public.student_coverage for select using (public.is_member(school_id));
create policy "comms write coverage" on public.student_coverage for all
  using (public.has_role(school_id, array['admin', 'comms_lead', 'comms']::public.app_role[]))
  with check (public.has_role(school_id, array['admin', 'comms_lead', 'comms']::public.app_role[]));

create policy "members read books" on public.books for select using (public.is_member(school_id));
create policy "comms manage books" on public.books for all
  using (public.has_role(school_id, array['admin', 'comms_lead', 'comms']::public.app_role[]))
  with check (public.has_role(school_id, array['admin', 'comms_lead', 'comms']::public.app_role[]));
create policy "members read book checks" on public.book_checks for select using (public.is_member(school_id));
create policy "members check names" on public.book_checks for all
  using (public.is_member(school_id))
  with check (public.is_member(school_id) and checked_by = auth.uid());
create policy "members read book comments" on public.book_comments for select using (public.is_member(school_id));
create policy "members comment on books" on public.book_comments for insert with check (public.is_member(school_id) and user_id = auth.uid());
create policy "comms resolve book comments" on public.book_comments for update
  using (public.has_role(school_id, array['admin', 'comms_lead', 'comms']::public.app_role[]));

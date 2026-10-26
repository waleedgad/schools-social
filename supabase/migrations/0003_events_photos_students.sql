-- Phase 2: events, photos and the student consent list.

create type public.consent as enum ('yes', 'no', 'unknown');

create table public.events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 120),
  event_date date not null default current_date,
  class_name text check (char_length(class_name) <= 60),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index events_school_date_idx on public.events (school_id, event_date desc);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  event_id uuid references public.events (id) on delete set null,
  uploaded_by uuid references auth.users (id) on delete set null,
  source text not null default 'staff' check (source in ('staff', 'photographer', 'desktop')),
  storage_path text not null unique,
  width int,
  height int,
  size_bytes int,
  note text check (char_length(note) <= 280),
  contains_opted_out boolean not null default false,
  created_at timestamptz not null default now()
);

create index photos_school_event_idx on public.photos (school_id, event_id, created_at desc);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 120),
  class_name text check (char_length(class_name) <= 60),
  parent_phone text check (char_length(parent_phone) <= 30),
  consent_social public.consent not null default 'unknown',
  created_at timestamptz not null default now()
);

create index students_school_class_idx on public.students (school_id, class_name, full_name);

alter table public.events enable row level security;
alter table public.photos enable row level security;
alter table public.students enable row level security;

-- Everyone in the school sees events so teachers can pick one when uploading.
create policy "members read events" on public.events
  for select using (public.is_member(school_id));
create policy "curators manage events" on public.events
  for all using (public.has_role(school_id, array['admin', 'comms', 'principal']::public.app_role[]))
  with check (public.has_role(school_id, array['admin', 'comms', 'principal']::public.app_role[]));

-- Teachers see only their own uploads; curators see the whole library.
create policy "curators and uploaders read photos" on public.photos
  for select using (
    public.has_role(school_id, array['admin', 'comms', 'principal']::public.app_role[])
    or (uploaded_by = auth.uid() and public.is_member(school_id))
  );
create policy "members upload photos" on public.photos
  for insert with check (public.is_member(school_id) and uploaded_by = auth.uid());
create policy "curators and uploaders change photos" on public.photos
  for update using (
    public.has_role(school_id, array['admin', 'comms', 'principal']::public.app_role[])
    or (uploaded_by = auth.uid() and public.is_member(school_id))
  );
create policy "curators and uploaders delete photos" on public.photos
  for delete using (
    public.has_role(school_id, array['admin', 'comms', 'principal']::public.app_role[])
    or (uploaded_by = auth.uid() and public.is_member(school_id))
  );

create policy "curators manage students" on public.students
  for all using (public.has_role(school_id, array['admin', 'comms', 'principal']::public.app_role[]))
  with check (public.has_role(school_id, array['admin', 'comms', 'principal']::public.app_role[]));

-- Private photo storage. Files live at <school_id>/<file>, and only the
-- school's own staff can reach them, through short-lived signed links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create function public.storage_school(p_name text)
returns uuid
language sql immutable
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 1)::uuid
  end;
$$;

create policy "members upload school photos" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'photos' and public.is_member(public.storage_school(name))
  );
create policy "curators and uploaders read school photos" on storage.objects
  for select to authenticated using (
    bucket_id = 'photos' and (
      public.has_role(public.storage_school(name), array['admin', 'comms', 'principal']::public.app_role[])
      or (owner_id = auth.uid()::text and public.is_member(public.storage_school(name)))
    )
  );
create policy "curators and uploaders delete school photos" on storage.objects
  for delete to authenticated using (
    bucket_id = 'photos' and (
      public.has_role(public.storage_school(name), array['admin', 'comms', 'principal']::public.app_role[])
      or (owner_id = auth.uid()::text and public.is_member(public.storage_school(name)))
    )
  );

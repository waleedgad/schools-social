-- Phase 1: schools, staff roles, invites and the audit log.
-- Every table carries a school_id, and row level security stops users
-- from reading or changing another school's rows.

create type public.app_role as enum ('admin', 'comms', 'principal', 'teacher');

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  default_locale text not null default 'ar' check (default_locale in ('ar', 'en')),
  timezone text not null default 'Africa/Cairo',
  created_at timestamptz not null default now()
);

create table public.memberships (
  school_id uuid not null references public.schools (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  full_name text not null check (char_length(full_name) between 2 and 120),
  created_at timestamptz not null default now(),
  primary key (school_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  role public.app_role not null,
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz
);

create index invites_school_id_idx on public.invites (school_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.schools (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  action text not null,
  target text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_school_id_idx on public.audit_log (school_id, created_at desc);

-- Helpers used by the policies. security definer so they can read
-- memberships without recursing into the memberships policies.

create function public.is_member(p_school uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.school_id = p_school and m.user_id = auth.uid()
  );
$$;

create function public.has_role(p_school uuid, p_roles public.app_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.school_id = p_school and m.user_id = auth.uid() and m.role = any (p_roles)
  );
$$;

alter table public.schools enable row level security;
alter table public.memberships enable row level security;
alter table public.invites enable row level security;
alter table public.audit_log enable row level security;

create policy "members read their school" on public.schools
  for select using (public.is_member(id));
create policy "admins update their school" on public.schools
  for update using (public.has_role(id, array['admin']::public.app_role[]));

create policy "members read colleagues" on public.memberships
  for select using (public.is_member(school_id));
create policy "admins change roles" on public.memberships
  for update using (public.has_role(school_id, array['admin']::public.app_role[]));
create policy "admins remove staff" on public.memberships
  for delete using (
    public.has_role(school_id, array['admin']::public.app_role[]) and user_id <> auth.uid()
  );

create policy "admins read invites" on public.invites
  for select using (public.has_role(school_id, array['admin']::public.app_role[]));
create policy "admins create invites" on public.invites
  for insert with check (
    public.has_role(school_id, array['admin']::public.app_role[]) and invited_by = auth.uid()
  );
create policy "admins revoke invites" on public.invites
  for delete using (public.has_role(school_id, array['admin']::public.app_role[]));

create policy "admins and principals read the audit log" on public.audit_log
  for select using (public.has_role(school_id, array['admin', 'principal']::public.app_role[]));
create policy "members write their own audit entries" on public.audit_log
  for insert with check (public.is_member(school_id) and user_id = auth.uid());

-- Creating a school makes the caller its first admin.
create function public.create_school(p_name text, p_full_name text, p_locale text default 'ar')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_school uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  insert into public.schools (name, default_locale)
  values (trim(p_name), coalesce(p_locale, 'ar'))
  returning id into v_school;

  insert into public.memberships (school_id, user_id, role, full_name)
  values (v_school, auth.uid(), 'admin', trim(p_full_name));

  insert into public.audit_log (school_id, user_id, action, target)
  values (v_school, auth.uid(), 'school.created', trim(p_name));

  return v_school;
end;
$$;

-- What an invite link shows before the person signs in.
create function public.get_invite(p_token text)
returns table (school_name text, role public.app_role, email text, expired boolean, accepted boolean)
language sql stable security definer set search_path = ''
as $$
  select s.name, i.role, i.email, i.expires_at < now(), i.accepted_at is not null
  from public.invites i
  join public.schools s on s.id = i.school_id
  where i.token = p_token;
$$;

-- Accepting adds the signed-in person to the school with the invited role.
-- The invite only works for the email address it was sent to.
create function public.accept_invite(p_token text, p_full_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_invite public.invites%rowtype;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select * into v_invite from public.invites where token = p_token for update;

  if not found then
    raise exception 'invite not found';
  elsif v_invite.accepted_at is not null then
    raise exception 'invite already used';
  elsif v_invite.expires_at < now() then
    raise exception 'invite expired';
  elsif lower(v_invite.email) <> v_email then
    raise exception 'invite is for another email';
  end if;

  insert into public.memberships (school_id, user_id, role, full_name)
  values (v_invite.school_id, auth.uid(), v_invite.role, trim(p_full_name))
  on conflict (school_id, user_id) do update set role = excluded.role;

  update public.invites set accepted_at = now() where id = v_invite.id;

  insert into public.audit_log (school_id, user_id, action, target, details)
  values (v_invite.school_id, auth.uid(), 'invite.accepted', v_invite.email,
          jsonb_build_object('role', v_invite.role));

  return v_invite.school_id;
end;
$$;

revoke execute on function public.create_school(text, text, text) from public, anon;
revoke execute on function public.accept_invite(text, text) from public, anon;
grant execute on function public.create_school(text, text, text) to authenticated;
grant execute on function public.accept_invite(text, text) to authenticated;
grant execute on function public.get_invite(text) to anon, authenticated;

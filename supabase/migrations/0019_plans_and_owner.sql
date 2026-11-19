-- Release 0.13, final plan Part 2: plans, payments, the owner page and the
-- Active / Read-only / Blocked states (spec approved by Waleed 18 Nov 2026).
--
-- A plan is two numbers: managing users (Admin, Comms lead, Comms) and
-- library computers. Teachers, staff, photographers and the principal are
-- free and never counted. Each school's state is worked out every time it is
-- asked, from "paid until": paid = Active, the 14 days after = Read-only,
-- after that = Blocked. The owner can force a state by hand. The database
-- refuses every change from a school that is not Active, and every new
-- managing user or computer over the plan, so no app can get around it.

-- Owners run every school. Nobody reads this table through the app.
create table public.owners (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.owners enable row level security;

create function public.is_owner()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.owners o where o.user_id = auth.uid());
$$;

-- Plans and prices. A school keeps the limits it was sold until its next
-- renewal (or until the owner applies a change now).
create table public.plans (
  id text primary key check (id ~ '^[a-z0-9_-]{2,30}$'),
  name_en text not null check (char_length(name_en) between 1 and 40),
  name_ar text not null check (char_length(name_ar) between 1 and 40),
  manager_limit int not null check (manager_limit between 1 and 500),
  computer_limit int not null check (computer_limit between 1 and 50),
  price_year numeric(12, 2) check (price_year >= 0),
  active boolean not null default true,
  sort int not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.plans (id, name_en, name_ar, manager_limit, computer_limit, sort) values
  ('small', 'Small', 'صغيرة', 2, 1, 1),
  ('standard', 'Standard', 'قياسية', 4, 2, 2),
  ('large', 'Large', 'كبيرة', 8, 4, 3);
alter table public.plans enable row level security;
create policy "members read plans" on public.plans for select using (auth.uid() is not null);

-- One row of owner settings: prices of extras, the renew contact shown to
-- schools, and whether people may still create a school by themselves
-- (off: only the owner creates schools).
create table public.owner_settings (
  id boolean primary key default true check (id),
  currency text not null default 'EGP' check (char_length(currency) between 3 and 3),
  extra_manager_price numeric(12, 2) check (extra_manager_price >= 0),
  extra_computer_price numeric(12, 2) check (extra_computer_price >= 0),
  contact text not null default '' check (char_length(contact) <= 300),
  self_signup boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.owner_settings (id) values (true);
alter table public.owner_settings enable row level security;

-- The school's plan. computer_limit already existed (0012) and stays, now
-- worked out from the plan, so everything that reads it keeps working.
alter table public.schools
  add column plan_id text not null default 'standard' references public.plans (id),
  add column plan_managers int not null default 4 check (plan_managers between 1 and 500),
  add column plan_computers int not null default 2 check (plan_computers between 1 and 50),
  add column extra_managers int not null default 0 check (extra_managers between 0 and 500),
  add column extra_computers int not null default 0 check (extra_computers between 0 and 50),
  add column paid_until date not null default ((now() at time zone 'Africa/Cairo')::date + 14),
  add column trial boolean not null default true,
  add column forced_state text check (forced_state in ('active', 'read_only', 'blocked')),
  add column forced_reason text check (char_length(forced_reason) <= 300),
  add column read_only_days int not null default 14 check (read_only_days between 0 and 60);

-- Schools already using the system start on Standard, paid for 30 more
-- days, so nobody is read-only on the day this ships; the owner then sets
-- each one's real "paid until". A school that had more computers keeps them
-- as extras.
update public.schools set
  plan_id = 'standard', plan_managers = 4, plan_computers = 2,
  extra_computers = greatest(computer_limit - 2, 0),
  paid_until = (now() at time zone 'Africa/Cairo')::date + 30,
  trial = false;
alter table public.schools drop column computer_limit;
alter table public.schools
  add column computer_limit int generated always as (plan_computers + extra_computers) stored,
  add column manager_limit int generated always as (plan_managers + extra_managers) stored;

-- The owner's private notes about a school (schools never read them).
create table public.owner_notes (
  school_id uuid primary key references public.schools (id) on delete cascade,
  notes text not null default '' check (char_length(notes) <= 4000),
  updated_at timestamptz not null default now()
);
alter table public.owner_notes enable row level security;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'EGP' check (char_length(currency) = 3),
  paid_on date not null,
  method text not null default 'transfer' check (method in ('transfer', 'cash', 'cheque', 'card', 'other')),
  covers_until date not null,
  note text check (char_length(note) <= 300),
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index payments_school_idx on public.payments (school_id, paid_on desc);
alter table public.payments enable row level security;

create table public.owner_log (
  id bigint generated always as identity primary key,
  owner_id uuid references auth.users (id) on delete set null,
  school_id uuid references public.schools (id) on delete set null,
  action text not null check (char_length(action) <= 40),
  reason text check (char_length(reason) <= 300),
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
create index owner_log_at_idx on public.owner_log (at desc);
create index owner_log_school_idx on public.owner_log (school_id, at desc);
alter table public.owner_log enable row level security;

-- Each school's key for the encrypted library on its Mac or Windows
-- computers. Nobody reads it; only licence() hands it out.
create table public.school_keys (
  school_id uuid primary key references public.schools (id) on delete cascade,
  secret bytea not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);
alter table public.school_keys enable row level security;

-- Owners read everything on the owner page.
create policy "owners read plans settings" on public.owner_settings for select using (public.is_owner());
create policy "owners read notes" on public.owner_notes for select using (public.is_owner());
create policy "owners read payments" on public.payments for select using (public.is_owner());
create policy "owners read the owner log" on public.owner_log for select using (public.is_owner());
create policy "owners read schools" on public.schools for select using (public.is_owner());
create policy "owners read memberships" on public.memberships for select using (public.is_owner());
create policy "owners read computers" on public.computers for select using (public.is_owner());
create policy "owners read invites" on public.invites for select using (public.is_owner());

-- ---------------------------------------------------------------------
-- The state of a school, worked out on every ask.

create function public.school_today(p_school uuid)
returns date
language sql stable security definer set search_path = ''
as $$
  select (now() at time zone coalesce((select s.timezone from public.schools s where s.id = p_school), 'Africa/Cairo'))::date;
$$;

create function public.school_state(p_school uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when s.id is null then 'blocked'
    when s.forced_state is not null then s.forced_state
    when s.paid_until >= (now() at time zone s.timezone)::date then 'active'
    when (now() at time zone s.timezone)::date - s.paid_until <= s.read_only_days then 'read_only'
    else 'blocked'
  end
  from (select 1) one
  left join public.schools s on s.id = p_school;
$$;

create function public.can_change(p_school uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.school_state(p_school) = 'active';
$$;

-- A person (signed in, or someone with a link) is changing a school that is
-- not active. The owner and the server's own jobs (service key, scheduled
-- work) are never stopped.
create function public.write_blocked(p_school uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (auth.uid() is not null or coalesce(auth.jwt() ->> 'role', '') = 'anon')
    and not public.is_owner()
    and public.school_state(p_school) <> 'active';
$$;

create function public.is_managing(p_role public.app_role)
returns boolean
language sql immutable set search_path = ''
as $$
  select p_role::text in ('admin', 'comms_lead', 'comms');
$$;

create function public.managers_used(p_school uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select count(*)::int from public.memberships m
  where m.school_id = p_school and m.active and public.is_managing(m.role);
$$;

-- Stops every insert, change and delete from a school that is not active.
create function public.guard_school_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_school uuid;
  v_state text;
begin
  if tg_table_name = 'schools' then
    -- A new school is governed by create_school / the owner page.
    if tg_op = 'INSERT' then
      return new;
    end if;
    v_school := coalesce(new.id, old.id);
  elsif tg_op = 'DELETE' then
    v_school := old.school_id;
  else
    v_school := new.school_id;
  end if;
  if public.write_blocked(v_school) then
    v_state := public.school_state(v_school);
    raise exception 'school-%', replace(v_state, '_', '-') using errcode = 'P0001', hint = 'plan';
  end if;
  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'approval_cover', 'book_checks', 'book_comments', 'book_texts', 'books', 'categories', 'events',
    'face_checks', 'frames', 'invites', 'meta_connections', 'photos', 'post_comments', 'post_photos',
    'post_versions', 'posts', 'review_links', 'school_integrations', 'shared_album_photos',
    'shared_albums', 'snippets', 'student_coverage', 'students', 'time_slots', 'upload_links', 'schools'
  ] loop
    execute format('create trigger guard_school_write before insert or update or delete on public.%I for each row execute function public.guard_school_write()', t);
  end loop;
end $$;

-- Library computers: a new one needs an active school and a free place on
-- the plan; "last seen" updates always work (the app still checks in when
-- read-only).
create function public.guard_computer()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.school_id = old.school_id and new.device_id = old.device_id then
    return new;
  end if;
  if public.write_blocked(coalesce(new.school_id, old.school_id)) then
    raise exception 'school-%', replace(public.school_state(coalesce(new.school_id, old.school_id)), '_', '-') using errcode = 'P0001', hint = 'plan';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger guard_computer before insert or update or delete on public.computers
  for each row execute function public.guard_computer();

-- People: joining, a role change, turning someone back on and removing
-- someone are changes; "last seen" is not. A managing role over the plan is
-- refused whoever asks.
create function public.guard_membership()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_school uuid := coalesce(new.school_id, old.school_id);
  v_limit int;
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'last_seen_at') = (to_jsonb(old) - 'last_seen_at') then
    return new;
  end if;
  if public.write_blocked(v_school) then
    raise exception 'school-%', replace(public.school_state(v_school), '_', '-') using errcode = 'P0001', hint = 'plan';
  end if;
  if tg_op <> 'DELETE' and new.active and public.is_managing(new.role)
     and (tg_op = 'INSERT' or not old.active or not public.is_managing(old.role)) then
    select manager_limit into v_limit from public.schools where id = v_school;
    if (select count(*) from public.memberships m
        where m.school_id = v_school and m.active and public.is_managing(m.role) and m.user_id <> new.user_id) >= v_limit then
      raise exception 'manager-limit' using errcode = 'P0001', hint = 'plan', detail = v_limit::text;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger guard_membership before insert or update or delete on public.memberships
  for each row execute function public.guard_membership();

-- An invite for a managing role when the plan is full is refused at once,
-- not only when it is accepted. Invites still waiting for a managing role
-- hold a place too.
create function public.guard_invite_limit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_limit int;
begin
  if public.is_managing(new.role) and new.accepted_at is null and (tg_op = 'INSERT' or not public.is_managing(old.role)) then
    select manager_limit into v_limit from public.schools where id = new.school_id;
    if public.managers_used(new.school_id) + (
         select count(*) from public.invites i
         where i.school_id = new.school_id and i.id <> new.id and i.accepted_at is null and i.expires_at > now() and public.is_managing(i.role)
       ) >= v_limit then
      raise exception 'manager-limit' using errcode = 'P0001', hint = 'plan', detail = v_limit::text;
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_invite_limit before insert or update on public.invites
  for each row execute function public.guard_invite_limit();

-- Uploads to storage for a school that is not active.
create policy "uploads only for active schools" on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'photos' or public.can_change(public.storage_school(name)) or public.is_owner());

-- ---------------------------------------------------------------------
-- What the school sees: its plan, what is used and its state.

create function public.school_status(p_school uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when not (public.is_member(p_school) or public.is_owner()) then null else jsonb_build_object(
    'state', public.school_state(s.id),
    'forced', s.forced_state is not null,
    'paid_until', s.paid_until,
    'today', (now() at time zone s.timezone)::date,
    'days_left', s.paid_until - (now() at time zone s.timezone)::date,
    'read_only_left', greatest(s.paid_until + s.read_only_days - (now() at time zone s.timezone)::date, 0),
    'trial', s.trial,
    'plan', jsonb_build_object('id', p.id, 'name_en', p.name_en, 'name_ar', p.name_ar),
    'managers', public.managers_used(s.id),
    'manager_limit', s.manager_limit,
    'computers', (select count(*) from public.computers c where c.school_id = s.id),
    'computer_limit', s.computer_limit,
    'contact', (select o.contact from public.owner_settings o where o.id)
  ) end
  from public.schools s join public.plans p on p.id = s.plan_id
  where s.id = p_school;
$$;

-- Whether a person without an invite may create a school (the sign-up
-- page shows "ask us for an account" when not).
create function public.signup_open()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_owner() or coalesce((select o.self_signup from public.owner_settings o where o.id), false);
$$;

-- Creating a school by oneself works only while the owner allows it
-- (owner settings, off by default). Otherwise only the owner creates
-- schools, from the owner page. A school made by oneself starts a 14-day
-- trial.
create or replace function public.create_school(p_name text, p_full_name text, p_locale text default 'ar')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_school uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if not public.is_owner() and not coalesce((select o.self_signup from public.owner_settings o where o.id), false) then
    raise exception 'signup-closed' using errcode = 'P0001', hint = 'plan';
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

-- Library computers keep their place on the plan; a new one over the plan
-- (or for a school that is not active) is refused with a clear reason.
create or replace function public.register_computer(p_school uuid, p_device text, p_name text, p_platform text)
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
  select computer_limit into lim from public.schools where id = p_school;
  if exists (select 1 from public.computers where school_id = p_school and device_id = p_device) then
    update public.computers set last_seen_at = now(), user_id = auth.uid(), name = left(p_name, 80), platform = left(p_platform, 20)
    where school_id = p_school and device_id = p_device;
  else
    if public.school_state(p_school) <> 'active' then
      return jsonb_build_object('error', 'school-' || replace(public.school_state(p_school), '_', '-'));
    end if;
    select count(*) into n from public.computers where school_id = p_school;
    if n >= lim then
      return jsonb_build_object('error', 'computer-limit', 'limit', lim);
    end if;
    insert into public.computers (school_id, device_id, name, platform, user_id) values (p_school, p_device, left(p_name, 80), left(p_platform, 20), auth.uid());
  end if;
  select count(*) into n from public.computers where school_id = p_school;
  return jsonb_build_object('computers', n, 'limit', lim);
end;
$$;

-- The Mac or Windows app's licence: the school's state, its limits and the
-- key for the encrypted library. Only a computer signed in to the school
-- gets it, and never for a blocked school. The app may work offline until
-- valid_until, then acts read-only until it reconnects.
create function public.licence(p_school uuid, p_device text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_state text;
  v_key bytea;
  v_status jsonb;
begin
  if not public.is_member(p_school) then
    return jsonb_build_object('error', 'role');
  end if;
  update public.computers set last_seen_at = now() where school_id = p_school and device_id = p_device;
  if not found then
    return jsonb_build_object('error', 'not-registered');
  end if;
  v_state := public.school_state(p_school);
  v_status := public.school_status(p_school);
  if v_state <> 'blocked' then
    select k.secret into v_key from public.school_keys k where k.school_id = p_school;
    if v_key is null then
      insert into public.school_keys (school_id, secret)
      values (p_school, decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'))
      on conflict (school_id) do nothing;
      select k.secret into v_key from public.school_keys k where k.school_id = p_school;
    end if;
  end if;
  return v_status || jsonb_build_object(
    'key', case when v_key is null then null else encode(v_key, 'base64') end,
    'checked_at', now(),
    'valid_until', now() + interval '10 days',
    'check_every_hours', 6
  );
end;
$$;

-- The publish job and the warnings read every school's state (server only).
create function public.all_school_states()
returns table (id uuid, state text)
language sql stable security definer set search_path = ''
as $$
  select s.id, public.school_state(s.id) from public.schools s;
$$;

-- In-app warnings to the Admin and Comms lead 14, 7 and 1 days before
-- "paid until", then every read-only day. Each is written once (the key),
-- and the new ones come back so the server can also email them.
alter table public.team_alerts drop constraint team_alerts_kind_check;
alter table public.team_alerts add constraint team_alerts_kind_check check (kind in ('import', 'remind', 'book', 'plan'));
alter table public.team_alerts add column key text check (char_length(key) <= 120);
create unique index team_alerts_key_idx on public.team_alerts (school_id, to_user, key) where key is not null;

create function public.plan_warnings()
returns table (school_id uuid, state text, days int, paid_until date)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select s.id, public.school_state(s.id) as st, s.paid_until as pu,
      (s.paid_until - (now() at time zone s.timezone)::date) as left_days,
      (now() at time zone s.timezone)::date as today,
      greatest(s.paid_until + s.read_only_days - (now() at time zone s.timezone)::date, 0) as ro_left
    from public.schools s
    where s.forced_state is null
  ), picked as (
    select d.id, d.st, case when d.st = 'active' then d.left_days else d.ro_left end as n, d.pu, d.today
    from due d
    where (d.st = 'active' and d.left_days in (14, 7, 1)) or d.st = 'read_only'
  ), made as (
    insert into public.team_alerts (school_id, kind, to_user, body, key)
    select p.id, 'plan', m.user_id,
      jsonb_build_object('state', p.st, 'days', p.n, 'paid_until', p.pu),
      'plan:' || p.pu || ':' || p.st || ':' || case when p.st = 'active' then p.n::text else p.today::text end
    from picked p
    join public.memberships m on m.school_id = p.id and m.active and m.role in ('admin', 'comms_lead')
    on conflict (school_id, to_user, key) where key is not null do nothing
    returning team_alerts.school_id
  )
  select distinct p.id, p.st, p.n, p.pu from picked p where p.id in (select made.school_id from made);
end;
$$;

-- ---------------------------------------------------------------------
-- The owner page. Every change is written to the owner log with a reason.

create function public.owner_guard()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'not-owner' using errcode = '42501';
  end if;
end;
$$;

create function public.owner_write_log(p_school uuid, p_action text, p_reason text, p_before jsonb, p_after jsonb)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.owner_log (owner_id, school_id, action, reason, before, after)
  values (auth.uid(), p_school, p_action, nullif(left(trim(coalesce(p_reason, '')), 300), ''), p_before, p_after);
$$;

create function public.owner_school_row(p_school uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('plan_id', s.plan_id, 'plan_managers', s.plan_managers, 'plan_computers', s.plan_computers,
    'extra_managers', s.extra_managers, 'extra_computers', s.extra_computers, 'paid_until', s.paid_until,
    'trial', s.trial, 'forced_state', s.forced_state, 'forced_reason', s.forced_reason, 'state', public.school_state(s.id))
  from public.schools s where s.id = p_school;
$$;

-- The Schools list: one row per school with what it uses.
create function public.owner_schools()
returns table (id uuid, name text, plan_id text, plan_en text, plan_ar text, state text, paid_until date, days_left int,
  trial boolean, managers int, manager_limit int, computers int, computer_limit int, price_year numeric,
  last_activity timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.owner_guard();
  return query
  select s.id, s.name, s.plan_id, p.name_en, p.name_ar, public.school_state(s.id), s.paid_until,
    (s.paid_until - (now() at time zone s.timezone)::date)::int, s.trial,
    public.managers_used(s.id), s.manager_limit,
    (select count(*)::int from public.computers c where c.school_id = s.id), s.computer_limit, p.price_year,
    greatest((select max(m.last_seen_at) from public.memberships m where m.school_id = s.id),
             (select max(c.last_seen_at) from public.computers c where c.school_id = s.id)),
    s.created_at
  from public.schools s join public.plans p on p.id = s.plan_id
  order by s.name;
end;
$$;

-- One school's people with their email (the owner page only).
create function public.owner_school_people(p_school uuid)
returns table (user_id uuid, full_name text, role public.app_role, active boolean, email text, last_seen_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.owner_guard();
  return query
  select m.user_id, m.full_name, m.role, m.active, u.email::text, m.last_seen_at
  from public.memberships m left join auth.users u on u.id = m.user_id
  where m.school_id = p_school
  order by public.is_managing(m.role) desc, m.full_name;
end;
$$;

-- New school: name, plan, first "paid until" (null = a 14-day trial) and
-- an invite for its Admin.
create function public.owner_create_school(p_name text, p_plan text, p_paid_until date, p_admin_email text, p_locale text default 'ar')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_school uuid;
  v_plan public.plans%rowtype;
  v_token text;
begin
  perform public.owner_guard();
  select * into v_plan from public.plans where id = p_plan;
  if not found then
    raise exception 'plan not found';
  end if;
  if char_length(trim(coalesce(p_admin_email, ''))) < 3 or position('@' in p_admin_email) < 2 then
    raise exception 'admin email needed';
  end if;
  insert into public.schools (name, default_locale, plan_id, plan_managers, plan_computers, paid_until, trial)
  values (trim(p_name), case when p_locale = 'en' then 'en' else 'ar' end, v_plan.id, v_plan.manager_limit, v_plan.computer_limit,
    coalesce(p_paid_until, (now() at time zone 'Africa/Cairo')::date + 14), p_paid_until is null)
  returning id into v_school;
  insert into public.invites (school_id, email, role, invited_by, expires_at)
  values (v_school, lower(trim(p_admin_email)), 'admin', auth.uid(), now() + interval '30 days')
  returning token into v_token;
  perform public.owner_write_log(v_school, 'school.created', null, null, public.owner_school_row(v_school) || jsonb_build_object('name', trim(p_name), 'admin', lower(trim(p_admin_email))));
  return jsonb_build_object('school_id', v_school, 'token', v_token);
end;
$$;

-- A new invite for a school's Admin (the first one ran out or went to the
-- wrong address).
create function public.owner_invite_admin(p_school uuid, p_email text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_token text;
begin
  perform public.owner_guard();
  insert into public.invites (school_id, email, role, invited_by, expires_at)
  values (p_school, lower(trim(p_email)), 'admin', auth.uid(), now() + interval '30 days')
  returning token into v_token;
  perform public.owner_write_log(p_school, 'admin.invited', null, null, jsonb_build_object('email', lower(trim(p_email))));
  return v_token;
end;
$$;

-- Plan and extras. Going down a plan never removes anyone: it is refused
-- while the school has more managing users or computers than the new plan
-- allows, so the school first picks who stays.
create function public.owner_set_plan(p_school uuid, p_plan text, p_extra_managers int, p_extra_computers int, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_before jsonb := public.owner_school_row(p_school);
  v_plan public.plans%rowtype;
  v_used int;
begin
  perform public.owner_guard();
  select * into v_plan from public.plans where id = p_plan;
  if not found then
    raise exception 'plan not found';
  end if;
  if public.managers_used(p_school) > v_plan.manager_limit + coalesce(p_extra_managers, 0) then
    return jsonb_build_object('error', 'too-many-managers', 'used', public.managers_used(p_school));
  end if;
  select count(*) into v_used from public.computers where school_id = p_school;
  if v_used > v_plan.computer_limit + coalesce(p_extra_computers, 0) then
    return jsonb_build_object('error', 'too-many-computers', 'used', v_used);
  end if;
  update public.schools set plan_id = v_plan.id, plan_managers = v_plan.manager_limit, plan_computers = v_plan.computer_limit,
    extra_managers = greatest(coalesce(p_extra_managers, 0), 0), extra_computers = greatest(coalesce(p_extra_computers, 0), 0)
  where id = p_school;
  perform public.owner_write_log(p_school, 'plan.changed', p_reason, v_before, public.owner_school_row(p_school));
  return jsonb_build_object('ok', true);
end;
$$;

-- A payment moves "paid until" and renews the plan's limits at today's
-- plan numbers. It ends a trial.
create function public.owner_record_payment(p_school uuid, p_amount numeric, p_currency text, p_paid_on date, p_method text, p_covers_until date, p_note text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_before jsonb := public.owner_school_row(p_school);
  v_id uuid;
begin
  perform public.owner_guard();
  insert into public.payments (school_id, amount, currency, paid_on, method, covers_until, note, recorded_by)
  values (p_school, p_amount, upper(coalesce(nullif(trim(p_currency), ''), 'EGP')), coalesce(p_paid_on, (now() at time zone 'Africa/Cairo')::date),
    coalesce(p_method, 'transfer'), p_covers_until, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;
  update public.schools s set paid_until = p_covers_until, trial = false,
    plan_managers = p.manager_limit, plan_computers = p.computer_limit
  from public.plans p where s.id = p_school and p.id = s.plan_id;
  perform public.owner_write_log(p_school, 'payment.recorded', p_note, v_before,
    public.owner_school_row(p_school) || jsonb_build_object('amount', p_amount, 'currency', upper(coalesce(nullif(trim(p_currency), ''), 'EGP'))));
  return v_id;
end;
$$;

-- "Paid until" by hand (a mistake, a free month), without a payment.
create function public.owner_set_paid_until(p_school uuid, p_paid_until date, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_before jsonb := public.owner_school_row(p_school);
begin
  perform public.owner_guard();
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'reason needed';
  end if;
  update public.schools set paid_until = p_paid_until where id = p_school;
  perform public.owner_write_log(p_school, 'paid_until.changed', p_reason, v_before, public.owner_school_row(p_school));
end;
$$;

-- Force a state (null goes back to "worked out from paid until").
create function public.owner_force_state(p_school uuid, p_state text, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_before jsonb := public.owner_school_row(p_school);
begin
  perform public.owner_guard();
  if p_state is not null and p_state not in ('active', 'read_only', 'blocked') then
    raise exception 'unknown state';
  end if;
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'reason needed';
  end if;
  update public.schools set forced_state = p_state, forced_reason = case when p_state is null then null else left(trim(p_reason), 300) end
  where id = p_school;
  perform public.owner_write_log(p_school, 'state.forced', p_reason, v_before, public.owner_school_row(p_school));
end;
$$;

create function public.owner_remove_computer(p_computer uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.computers%rowtype;
begin
  perform public.owner_guard();
  delete from public.computers where id = p_computer returning * into v_row;
  if found then
    perform public.owner_write_log(v_row.school_id, 'computer.removed', p_reason,
      jsonb_build_object('name', v_row.name, 'platform', v_row.platform, 'last_seen_at', v_row.last_seen_at), null);
  end if;
end;
$$;

create function public.owner_set_notes(p_school uuid, p_notes text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.owner_guard();
  insert into public.owner_notes (school_id, notes, updated_at) values (p_school, left(coalesce(p_notes, ''), 4000), now())
  on conflict (school_id) do update set notes = excluded.notes, updated_at = now();
end;
$$;

-- Plans and prices. A change reaches each school at its next payment,
-- unless apply_now also moves every school on that plan to the new limits
-- (never below what a school already uses).
create function public.owner_save_plan(p_id text, p_name_en text, p_name_ar text, p_managers int, p_computers int, p_price numeric, p_active boolean, p_apply_now boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_before jsonb;
  v_moved int := 0;
  v_kept int := 0;
begin
  perform public.owner_guard();
  select to_jsonb(p) into v_before from public.plans p where id = p_id;
  insert into public.plans (id, name_en, name_ar, manager_limit, computer_limit, price_year, active, sort)
  values (p_id, trim(p_name_en), trim(p_name_ar), p_managers, p_computers, p_price, coalesce(p_active, true),
    coalesce((select max(sort) + 1 from public.plans), 1))
  on conflict (id) do update set name_en = excluded.name_en, name_ar = excluded.name_ar, manager_limit = excluded.manager_limit,
    computer_limit = excluded.computer_limit, price_year = excluded.price_year, active = excluded.active, updated_at = now();
  if p_apply_now then
    update public.schools s set plan_managers = p_managers, plan_computers = p_computers
    where s.plan_id = p_id
      and public.managers_used(s.id) <= p_managers + s.extra_managers
      and (select count(*) from public.computers c where c.school_id = s.id) <= p_computers + s.extra_computers;
    get diagnostics v_moved = row_count;
    select count(*) into v_kept from public.schools s where s.plan_id = p_id and (s.plan_managers <> p_managers or s.plan_computers <> p_computers);
  end if;
  perform public.owner_write_log(null, 'plan.saved', null, v_before,
    (select to_jsonb(p) from public.plans p where id = p_id) || jsonb_build_object('apply_now', coalesce(p_apply_now, false), 'schools_moved', v_moved, 'schools_kept', v_kept));
  return jsonb_build_object('moved', v_moved, 'kept', v_kept);
end;
$$;

create function public.owner_save_settings(p_currency text, p_extra_manager_price numeric, p_extra_computer_price numeric, p_contact text, p_self_signup boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_before jsonb;
begin
  perform public.owner_guard();
  select to_jsonb(o) into v_before from public.owner_settings o where o.id;
  update public.owner_settings set currency = upper(coalesce(nullif(trim(p_currency), ''), 'EGP')),
    extra_manager_price = p_extra_manager_price, extra_computer_price = p_extra_computer_price,
    contact = left(trim(coalesce(p_contact, '')), 300), self_signup = coalesce(p_self_signup, false), updated_at = now()
  where id;
  perform public.owner_write_log(null, 'settings.saved', null, v_before, (select to_jsonb(o) from public.owner_settings o where o.id));
end;
$$;

-- ---------------------------------------------------------------------
-- Who may call what.

revoke execute on function public.guard_school_write() from public, anon, authenticated;
revoke execute on function public.guard_computer() from public, anon, authenticated;
revoke execute on function public.guard_membership() from public, anon, authenticated;
revoke execute on function public.guard_invite_limit() from public, anon, authenticated;
revoke execute on function public.all_school_states() from public, anon, authenticated;
revoke execute on function public.plan_warnings() from public, anon, authenticated;
revoke execute on function public.owner_write_log(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.owner_school_row(uuid) from public, anon, authenticated;
revoke execute on function public.owner_guard() from public, anon, authenticated;
grant execute on function public.all_school_states() to service_role;
grant execute on function public.plan_warnings() to service_role;

do $$
declare
  f text;
begin
  foreach f in array array[
    'is_owner()', 'school_today(uuid)', 'school_state(uuid)', 'can_change(uuid)', 'write_blocked(uuid)', 'managers_used(uuid)',
    'school_status(uuid)', 'licence(uuid, text)', 'signup_open()', 'owner_schools()', 'owner_school_people(uuid)',
    'owner_create_school(text, text, date, text, text)', 'owner_invite_admin(uuid, text)',
    'owner_set_plan(uuid, text, int, int, text)', 'owner_record_payment(uuid, numeric, text, date, text, date, text)',
    'owner_set_paid_until(uuid, date, text)', 'owner_force_state(uuid, text, text)', 'owner_remove_computer(uuid, text)',
    'owner_set_notes(uuid, text)', 'owner_save_plan(text, text, text, int, int, numeric, boolean, boolean)',
    'owner_save_settings(text, numeric, numeric, text, boolean)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
-- write_blocked runs inside the policies and triggers of link pages too.
grant execute on function public.write_blocked(uuid) to anon;
grant execute on function public.school_state(uuid) to anon;
grant execute on function public.is_owner() to anon;

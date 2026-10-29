-- 0.4, part 2: staff invited from a spreadsheet (by email or phone), the
-- stages a head of stage approves for, and the school's connections (Slack,
-- Teams, email alerts, WhatsApp photo intake).

-- Invites can now carry the person's name, phone and classes, and an invite
-- sent by WhatsApp may have only a phone number: the secret link is the key.
alter table public.invites
  alter column email drop not null,
  add column full_name text check (char_length(full_name) <= 120),
  add column phone text check (char_length(phone) <= 30),
  add column classes text[] not null default '{}';
alter table public.invites drop constraint invites_email_check;
alter table public.invites add constraint invites_contact_check
  check ((email is not null and position('@' in email) > 1) or (email is null and phone is not null));

drop function public.get_invite(text);
create function public.get_invite(p_token text)
returns table (school_name text, role public.app_role, email text, expired boolean, accepted boolean, full_name text)
language sql stable security definer set search_path = ''
as $$
  select s.name, i.role, i.email, i.expires_at < now(), i.accepted_at is not null, i.full_name
  from public.invites i
  join public.schools s on s.id = i.school_id
  where i.token = p_token;
$$;
grant execute on function public.get_invite(text) to anon, authenticated;

create or replace function public.accept_invite(p_token text, p_full_name text)
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
  elsif v_invite.email is not null and lower(v_invite.email) <> v_email then
    raise exception 'invite is for another email';
  end if;

  insert into public.memberships (school_id, user_id, role, full_name, phone, classes)
  values (v_invite.school_id, auth.uid(), v_invite.role, coalesce(nullif(trim(p_full_name), ''), v_invite.full_name, ''), v_invite.phone, v_invite.classes)
  on conflict (school_id, user_id) do update set role = excluded.role,
    phone = coalesce(excluded.phone, public.memberships.phone),
    classes = case when cardinality(excluded.classes) > 0 then excluded.classes else public.memberships.classes end;

  update public.invites set accepted_at = now() where id = v_invite.id;

  insert into public.audit_log (school_id, user_id, action, target, details)
  values (v_invite.school_id, auth.uid(), 'invite.accepted', coalesce(v_invite.email, v_invite.phone), jsonb_build_object('role', v_invite.role));

  return v_invite.school_id;
end;
$$;

-- A head of stage (or any extra approver) can be limited to some stages:
-- they then only see posts about classes in those stages, plus whole-school
-- posts.
alter table public.memberships
  add column stages text[] not null default '{}';

-- The school's connections. Webhook addresses and WhatsApp ids are only
-- for admins; the server reads them with the service key to send alerts.
create table public.school_integrations (
  school_id uuid primary key references public.schools (id) on delete cascade,
  slack_webhook text check (slack_webhook is null or slack_webhook like 'https://hooks.slack.com/%'),
  teams_webhook text check (teams_webhook is null or teams_webhook like 'https://%'),
  email_alerts boolean not null default false,
  alert_kinds text[] not null default '{approval,failed,import,comment}',
  whatsapp_phone_id text check (char_length(whatsapp_phone_id) <= 40),
  whatsapp_event uuid references public.events (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.school_integrations enable row level security;
create policy "admins manage connections" on public.school_integrations for all
  using (public.has_role(school_id, array['admin']::public.app_role[]))
  with check (public.has_role(school_id, array['admin']::public.app_role[]));

-- Photos sent to the school's WhatsApp number are uploads like any other:
-- they wait for the Mac check before they can be posted.
alter table public.photos drop constraint photos_source_check;
alter table public.photos add constraint photos_source_check check (source in ('staff', 'photographer', 'desktop', 'design', 'whatsapp'));
create or replace function public.photo_needs_check()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.source in ('staff', 'photographer', 'whatsapp') then
    new.check_status := 'waiting';
  end if;
  return new;
end;
$$;

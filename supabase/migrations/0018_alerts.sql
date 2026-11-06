-- Release 0.8, item 6: alerts outside the app (email, Slack, Teams).
-- Quiet hours for the school (in its own time zone): alerts made then wait
-- and go out when the quiet hours end. Every alert is written down once, so
-- the same alert is never sent twice, and the server can send the waiting
-- ones later.

alter table public.school_integrations
  add column quiet_from time default '21:00',
  add column quiet_to time default '07:00';

create table public.alert_outbox (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  kind text not null check (char_length(kind) <= 20),
  -- The same key is only ever sent once (for example the same post waiting
  -- for the same step, or one reminder for a post a day).
  key text check (char_length(key) <= 200),
  title text not null check (char_length(title) <= 200),
  body text not null check (char_length(body) <= 2000),
  link text check (char_length(link) <= 500),
  emails text[] not null default '{}',
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index alert_outbox_key_idx on public.alert_outbox (school_id, key) where key is not null;
create index alert_outbox_due_idx on public.alert_outbox (send_after) where sent_at is null;
-- Only the server (service key) reads and writes it: no policies.
alter table public.alert_outbox enable row level security;

-- The principal's weekly digest (Sunday morning) is one of the alert kinds,
-- on by default.
alter table public.school_integrations alter column alert_kinds set default '{approval,failed,import,comment,digest}';
update public.school_integrations set alert_kinds = array_append(alert_kinds, 'digest') where not ('digest' = any (alert_kinds));

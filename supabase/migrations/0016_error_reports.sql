-- Automatic error reports (quality plan, Phase 1): when the website or the
-- Mac app hits an error, a short report lands here so it can be fixed
-- without anyone sending screenshots. No outside service; stays free.
--
-- The same error is one row with a counter, so a loop can't fill the table.
-- Nobody reads it through the website: only the service key (the builder).

create table public.error_reports (
  id bigint generated always as identity primary key,
  hash text not null unique,
  source text not null check (source in ('web', 'web-server', 'mac', 'mac-window')),
  version text check (char_length(version) <= 40),
  message text not null check (char_length(message) <= 1000),
  stack text check (char_length(stack) <= 4000),
  place text check (char_length(place) <= 300),
  school_id uuid references public.schools (id) on delete set null,
  count integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index error_reports_last_seen on public.error_reports (last_seen desc);
create index error_reports_school_id_fk on public.error_reports (school_id);

alter table public.error_reports enable row level security;
-- No policies: nobody can read or change rows directly. Reports come in
-- through report_error() below.

create or replace function public.report_error(p_source text, p_version text, p_message text, p_stack text, p_place text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_school uuid;
begin
  if p_source not in ('web', 'web-server', 'mac', 'mac-window') or coalesce(trim(p_message), '') = '' then
    return;
  end if;
  -- Same place in the code = same error, whatever numbers are in the message.
  v_hash := md5(p_source || '|' || regexp_replace(left(p_message, 300), '[0-9]+', '#', 'g') || '|' || regexp_replace(left(coalesce(p_stack, ''), 600), '[0-9]+', '#', 'g'));
  if (select auth.uid()) is not null then
    select m.school_id into v_school from public.memberships m where m.user_id = (select auth.uid()) order by m.created_at limit 1;
  end if;
  update public.error_reports
     set count = count + 1, last_seen = now(), version = left(p_version, 40), school_id = coalesce(v_school, school_id)
   where hash = v_hash;
  if found then
    return;
  end if;
  -- A flood of different errors (or someone misusing this) stops at 5,000 kinds.
  if (select count(*) from public.error_reports) >= 5000 then
    return;
  end if;
  insert into public.error_reports (hash, source, version, message, stack, place, school_id)
  values (v_hash, p_source, left(p_version, 40), left(p_message, 1000), left(p_stack, 4000), left(p_place, 300), v_school)
  on conflict (hash) do update set count = public.error_reports.count + 1, last_seen = now();
end;
$$;

revoke all on function public.report_error(text, text, text, text, text) from public;
grant execute on function public.report_error(text, text, text, text, text) to anon, authenticated, service_role;

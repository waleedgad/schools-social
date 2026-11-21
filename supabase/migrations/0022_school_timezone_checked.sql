-- S-21N-02 (21 Nov 2026): schools.timezone had no database check. An Admin
-- could set it (through the API, not the website form) to a name Postgres
-- doesn't know. Then school_state() failed for that school, so
-- all_school_states() failed for every school, and the publishing job
-- treated every school as active (read-only and blocked schools' posts went
-- out; plan warnings stopped). Now: a bad name is refused, any bad name
-- already saved goes back to Cairo, and the state check falls back to Cairo
-- instead of failing. The website's publishing job also stops when the
-- states can't be read (code change in the same release).

create or replace function public.valid_timezone(p_tz text)
returns boolean
language plpgsql stable set search_path = ''
as $$
begin
  if p_tz is null or char_length(p_tz) > 64 then
    return false;
  end if;
  perform now() at time zone p_tz;
  return true;
exception when others then
  return false;
end $$;

-- The school's time zone, or Cairo if the saved one is not usable.
create or replace function public.school_tz(p_tz text)
returns text
language sql stable set search_path = ''
as $$
  select case when public.valid_timezone(p_tz) then p_tz else 'Africa/Cairo' end;
$$;

update public.schools set timezone = 'Africa/Cairo' where not public.valid_timezone(timezone);

create or replace function public.guard_school_timezone()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if not public.valid_timezone(new.timezone) then
    raise exception 'bad-timezone' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists guard_school_timezone on public.schools;
create trigger guard_school_timezone before insert or update of timezone on public.schools
  for each row execute function public.guard_school_timezone();

create or replace function public.school_today(p_school uuid)
returns date
language sql stable security definer set search_path = ''
as $$
  select (now() at time zone public.school_tz((select s.timezone from public.schools s where s.id = p_school)))::date;
$$;

create or replace function public.school_state(p_school uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when s.id is null then 'blocked'
    when s.forced_state is not null then s.forced_state
    when s.paid_until >= (now() at time zone public.school_tz(s.timezone))::date then 'active'
    when (now() at time zone public.school_tz(s.timezone))::date - s.paid_until <= s.read_only_days then 'read_only'
    else 'blocked'
  end
  from (select 1) one
  left join public.schools s on s.id = p_school;
$$;

revoke execute on function public.guard_school_timezone() from public, anon, authenticated;
grant execute on function public.valid_timezone(text) to anon, authenticated, service_role;
grant execute on function public.school_tz(text) to anon, authenticated, service_role;

-- S-21N-01 (21 Nov 2026): the "admins update their school" rule (0001) has no
-- column limits, so a school admin could change their own plan, paid-until
-- date, extras, trial, forced state and read-only days straight through the
-- database. Only the owner (owner_* functions) and the server's own jobs
-- (service key, scheduled work: no signed-in person) may change them.
create or replace function public.guard_school_plan()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (auth.uid() is not null or coalesce(auth.jwt() ->> 'role', '') in ('anon', 'authenticated'))
    and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
    and not public.is_owner()
    and (new.plan_id, new.plan_managers, new.plan_computers, new.extra_managers, new.extra_computers,
         new.paid_until, new.trial, new.forced_state, new.forced_reason, new.read_only_days)
      is distinct from
        (old.plan_id, old.plan_managers, old.plan_computers, old.extra_managers, old.extra_computers,
         old.paid_until, old.trial, old.forced_state, old.forced_reason, old.read_only_days)
  then
    raise exception 'owner-only' using errcode = '42501';
  end if;
  return new;
end $$;

revoke execute on function public.guard_school_plan() from public, anon, authenticated;

drop trigger if exists guard_school_plan on public.schools;
create trigger guard_school_plan before update on public.schools
  for each row execute function public.guard_school_plan();

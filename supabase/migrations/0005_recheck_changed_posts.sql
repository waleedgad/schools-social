-- Changing the words of an approved post while scheduling it must count as
-- a new approval, so a sensitive post still needs the principal or admin.

create or replace function public.guard_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_signoff boolean;
  v_changed boolean := false;
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
      or new.hashtags is distinct from old.hashtags
      or new.sensitive is distinct from old.sensitive;

    if old.status in ('approved', 'scheduled') and new.status = old.status and v_changed then
      new.status := 'in_review';
      new.approved_by := null;
      new.signed_off_by := null;
    end if;
  end if;

  if new.status in ('publishing', 'published')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    raise exception 'only the publisher can mark a post published';
  end if;

  if new.status in ('approved', 'scheduled')
     and (tg_op = 'INSERT' or old.status not in ('approved', 'scheduled') or v_changed) then
    select require_signoff into v_signoff from public.schools where id = new.school_id;
    if (new.sensitive or v_signoff)
       and not public.has_role(new.school_id, array['admin', 'principal']::public.app_role[]) then
      raise exception 'this post needs sign-off from the principal or admin' using hint = 'signoff';
    end if;
    new.approved_by := v_uid;
    new.signed_off_by := case when new.sensitive or v_signoff then v_uid end;
  end if;

  if new.status = 'scheduled' and new.scheduled_at is null then
    new.scheduled_at := now();
  end if;

  return new;
end;
$$;

-- Photos added to a post after it was approved also need a fresh review.
create function public.reset_post_on_photo_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    update public.posts
      set status = 'in_review', approved_by = null, signed_off_by = null
      where id = coalesce(new.post_id, old.post_id) and status in ('approved', 'scheduled');
  end if;
  return null;
end;
$$;

create trigger post_photos_reset after insert or delete on public.post_photos
  for each row execute function public.reset_post_on_photo_change();

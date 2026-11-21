-- Release 0.15 (final plan, "Also in the first build"):
-- 1. The principal approves a yearbook page by page. Each answer is for one
--    page of one version the Mac sent; when every page of that version is
--    approved the book is approved. The Mac reads the answers and locks the
--    approved pages.
-- 2. Saved replies for the inbox: a new kind of snippet.

create table public.book_page_approvals (
  book_id uuid not null references public.books (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  version int not null,
  page int not null check (page between 1 and 1000),
  page_id text check (char_length(page_id) <= 60),
  approved boolean not null,
  user_id uuid references auth.users (id) on delete set null,
  author_name text check (char_length(author_name) <= 120),
  at timestamptz not null default now(),
  primary key (book_id, version, page)
);
create index book_page_approvals_school on public.book_page_approvals (school_id);

alter table public.book_page_approvals enable row level security;
create policy "members read page approvals" on public.book_page_approvals for select using (public.is_member(school_id));
-- Written only through approve_book_page() below.

create trigger guard_school_write before insert or update or delete on public.book_page_approvals
  for each row execute function public.guard_school_write();

-- Approve (or take back) one page. The principal, the admin and the comms
-- team may; the answer is kept against the book's current version. Returns
-- the book's status afterwards.
create function public.approve_book_page(p_book uuid, p_page int, p_approved boolean)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_book public.books%rowtype;
  v_total int;
  v_ok int;
  v_page_id text;
  v_name text;
begin
  select * into v_book from public.books where id = p_book;
  if not found then raise exception 'not-found' using errcode = 'P0002'; end if;
  if not public.has_role(v_book.school_id, array['admin', 'comms_lead', 'comms', 'principal']::public.app_role[]) then
    raise exception 'not-allowed' using errcode = '42501';
  end if;
  v_total := jsonb_array_length(coalesce(v_book.pages, '[]'::jsonb));
  if p_page < 1 or p_page > v_total then raise exception 'no-such-page' using errcode = '22023'; end if;
  v_page_id := left(coalesce(v_book.pages -> (p_page - 1) ->> 'id', ''), 60);
  select left(coalesce(m.full_name, ''), 120) into v_name from public.memberships m where m.school_id = v_book.school_id and m.user_id = auth.uid() limit 1;

  insert into public.book_page_approvals (book_id, school_id, version, page, page_id, approved, user_id, author_name, at)
  values (v_book.id, v_book.school_id, v_book.version, p_page, nullif(v_page_id, ''), p_approved, auth.uid(), v_name, now())
  on conflict (book_id, version, page) do update set approved = excluded.approved, page_id = excluded.page_id, user_id = excluded.user_id, author_name = excluded.author_name, at = excluded.at;

  select count(*) into v_ok from public.book_page_approvals a where a.book_id = v_book.id and a.version = v_book.version and a.approved;
  if v_ok >= v_total and v_book.status <> 'approved' then
    update public.books set status = 'approved', updated_at = now() where id = v_book.id;
    return 'approved';
  elsif v_ok < v_total and v_book.status = 'approved' then
    update public.books set status = 'review', updated_at = now() where id = v_book.id;
    return 'review';
  end if;
  return v_book.status;
end;
$$;
revoke execute on function public.approve_book_page(uuid, int, boolean) from public, anon;
grant execute on function public.approve_book_page(uuid, int, boolean) to authenticated;

-- 2. Saved replies.
alter table public.snippets drop constraint if exists snippets_kind_check;
alter table public.snippets add constraint snippets_kind_check check (kind in ('text', 'hashtags', 'signoff', 'avoid', 'reply'));

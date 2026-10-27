-- The Mac app sends the class list with each school's own student ID, so a
-- second import updates students instead of adding them twice. The Arabic
-- name lets the privacy check catch a child's name in an Arabic caption.
alter table public.students
  add column student_code text check (char_length(student_code) <= 40),
  add column name_ar text check (char_length(name_ar) <= 120),
  add constraint students_school_code_unique unique (school_id, student_code);

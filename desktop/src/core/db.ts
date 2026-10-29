import { mkdirSync } from "node:fs";
import path from "node:path";
// Built into Electron's Node; no native module to compile for each Mac.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

// Everything the app knows about the library, kept on this computer:
// photos, students, faces and tags, picks and ratings. The photo files
// themselves are never changed.

const SCHEMA = `
create table if not exists photos (
  id integer primary key,
  path text not null unique,
  name text not null,
  ext text not null,
  size integer not null,
  mtime integer not null,
  hash text,
  width integer,
  height integer,
  taken_at text,
  year text,
  term text,
  event_key text,
  event_title text,
  event_date text,
  class_name text,
  is_raw integer not null default 0,
  pair_of integer,
  edited_of integer,
  dup_of integer,
  thumb integer not null default 0,
  faces_scanned integer not null default 0,
  face_count integer not null default 0,
  sharpness real,
  brightness real,
  quality real,
  dhash text,
  rating integer not null default 0,
  flag integer not null default 0,
  label text,
  remote_id text,
  missing integer not null default 0,
  added_at integer not null
);
create index if not exists photos_event on photos (event_key, taken_at);
create index if not exists photos_hash on photos (hash);
create index if not exists photos_year on photos (year, term);

create table if not exists students (
  id text primary key,
  name_en text,
  name_ar text,
  gender text,
  stage text,
  grade text,
  class_name text,
  can_post integer not null default 1,
  portrait text,
  remote_id text,
  added_at integer not null
);
create index if not exists students_class on students (class_name);

create table if not exists faces (
  id integer primary key,
  photo_id integer not null references photos (id) on delete cascade,
  x real not null, y real not null, w real not null, h real not null,
  score real not null default 1,
  embedding blob,
  student_id text references students (id) on delete set null,
  status text not null default 'unknown',
  suggest_id text,
  suggest_score real,
  rejected text not null default '',
  portrait integer not null default 0
);
create index if not exists faces_photo on faces (photo_id);
create index if not exists faces_student on faces (student_id, status);
create index if not exists faces_status on faces (status);

create table if not exists folders (
  path text primary key,
  skip integer not null default 0,
  archive integer not null default 0
);

create table if not exists albums (
  id integer primary key,
  name text not null,
  rule text,
  added_at integer not null
);

create table if not exists album_photos (
  album_id integer not null references albums (id) on delete cascade,
  photo_id integer not null references photos (id) on delete cascade,
  primary key (album_id, photo_id)
);

create table if not exists imports (
  id integer primary key,
  at integer not null,
  who text,
  source text,
  photographer text,
  category text,
  copied integer not null default 0,
  skipped integer not null default 0,
  folders text not null default '[]',
  report text,
  undone integer not null default 0
);

create table if not exists achievements (
  id integer primary key,
  student_id text not null references students (id) on delete cascade,
  title text not null,
  on_date text,
  added_at integer not null
);

create table if not exists groups (
  id integer primary key,
  name text not null,
  kind text not null default 'club',
  teacher_id text,
  added_at integer not null
);

create table if not exists group_members (
  group_id integer not null references groups (id) on delete cascade,
  student_id text not null references students (id) on delete cascade,
  primary key (group_id, student_id)
);

create table if not exists links (
  a text not null references students (id) on delete cascade,
  b text not null references students (id) on delete cascade,
  kind text not null,
  primary key (a, b, kind)
);

create table if not exists class_teachers (
  class_name text primary key,
  teacher_id text references students (id) on delete set null
);

create table if not exists school_history (
  student_id text not null references students (id) on delete cascade,
  year text not null,
  class_name text,
  campus text,
  primary key (student_id, year)
);

create table if not exists books (
  id integer primary key,
  spec text not null,
  pages text,
  locked text not null default '[]',
  versions text not null default '[]',
  updated_at integer not null
);

create table if not exists bin (
  photo_id integer primary key,
  from_path text not null,
  bin_path text,
  at integer not null,
  why text
);

create table if not exists history (
  id integer primary key,
  at integer not null,
  action text not null,
  detail text not null default '',
  undo text
);
`;

export type Db = InstanceType<typeof DatabaseSync>;

export function openDb(file: string): Db {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("pragma journal_mode = wal; pragma foreign_keys = on; pragma synchronous = normal;");
  db.exec(SCHEMA);
  // Columns added after 0.2.0.
  addColumn(db, "faces", "auto", "integer not null default 0");
  addColumn(db, "students", "main_face", "integer");
  // 0.4: which recogniser made the face numbers, and why a face is only background.
  addColumn(db, "faces", "model", "text not null default 'sface'");
  addColumn(db, "faces", "why", "text");
  addColumn(db, "faces", "named_by", "text");
  // 0.4: people who aren't students, and each student's time at the school.
  addColumn(db, "students", "kind", "text not null default 'student'");
  addColumn(db, "students", "birthday", "text");
  addColumn(db, "students", "joined", "text");
  addColumn(db, "students", "left_on", "text");
  addColumn(db, "students", "notes", "text");
  addColumn(db, "students", "campus", "text");
  addColumn(db, "students", "email", "text");
  addColumn(db, "students", "phone", "text");
  // 0.4: who took it, what kind of photo, hidden, and which import it came in.
  addColumn(db, "photos", "photographer", "text");
  addColumn(db, "photos", "category", "text");
  addColumn(db, "photos", "hidden", "integer not null default 0");
  addColumn(db, "photos", "import_id", "integer");
  addColumn(db, "photos", "camera", "text");
  addColumn(db, "photos", "posts", "integer not null default 0");
  addColumn(db, "photos", "words", "text");
  addColumn(db, "photos", "smile", "real");
  addColumn(db, "photos", "problems", "text");
  addColumn(db, "photos", "clip", "blob");
  addColumn(db, "faces", "smile", "real");
  addColumn(db, "albums", "shared", "integer not null default 0");
  addColumn(db, "albums", "remote_id", "text");
  addColumn(db, "history", "who", "text");
  addColumn(db, "history", "photos", "text");
  db.exec("create index if not exists students_kind on students (kind, class_name)");
  db.exec("create index if not exists faces_model on faces (model, status)");
  return db;
}

function addColumn(db: Db, table: string, column: string, type: string) {
  const cols = db.prepare(`pragma table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`alter table ${table} add column ${column} ${type}`);
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec("begin");
  try {
    const out = fn();
    db.exec("commit");
    return out;
  } catch (e) {
    db.exec("rollback");
    throw e;
  }
}

export const toBlob = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
export const fromBlob = (b: Uint8Array) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

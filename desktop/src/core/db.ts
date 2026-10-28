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

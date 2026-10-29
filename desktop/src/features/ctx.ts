import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrowserWindow } from "electron";
import type { Db } from "../core/db";
import type { Engine } from "../core/engine";
import type { JsonStore } from "../core/store";

// What the feature modules need from the app. main.ts builds one of these;
// each module returns its part of the window's API.
export type Ctx = {
  db: () => Db;
  settings: () => JsonStore<Record<string, unknown>> & { get(): any; set(v: Record<string, unknown>): void };
  engine: () => Engine | null;
  win: () => BrowserWindow | null;
  client: () => SupabaseClient | null;
  push: (what?: string) => void;
  remember: (action: string, detail: string, undo: unknown, photos?: number[]) => void;
  log: (m: string) => void;
  data: (name: string) => string;
  chooseFolder: (title: string) => Promise<string | null>;
  removeWebCopiesOf: (rows: { id: number; hash: string | null; remote_id: string | null }[]) => void;
  sendWin: (channel: string, ...args: unknown[]) => void;
  appApi: (action: string, payload?: Record<string, unknown>) => Promise<any>;
  message: (m: string) => void;
  // Any of the window's API calls (for features that build on main's).
  call: (name: string, ...args: unknown[]) => Promise<any>;
};

export type Api = Record<string, (...args: never[]) => unknown>;

export const marks = (n: number) => Array(n).fill("?").join(",");
export function q(ctx: Ctx) {
  const one = <T = Record<string, any>>(sql: string, ...args: unknown[]) => ctx.db().prepare(sql).get(...(args as never[])) as T | undefined;
  const all = <T = Record<string, any>>(sql: string, ...args: unknown[]) => ctx.db().prepare(sql).all(...(args as never[])) as T[];
  const run = (sql: string, ...args: unknown[]) => ctx.db().prepare(sql).run(...(args as never[]));
  return { one, all, run };
}

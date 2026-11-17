import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { editorPicker, isAtOrInside, isInside, isOutside, relInside } from "./paths";

const w = path.win32;
const x = path.posix;

test("Windows: a file on another drive is outside the library (archive drive, backup drive)", () => {
  assert.equal(relInside("D:\\School Photos", "E:\\Archive\\2024-2025\\a.jpg", w), null);
  assert.equal(isOutside("D:\\School Photos", "E:\\Archive\\a.jpg", w), true);
  // the old check took this for "inside"
  assert.equal(w.relative("D:\\School Photos", "E:\\Archive\\a.jpg").startsWith(".."), false);
});

test("Windows: drive letters and folder names are compared without case", () => {
  assert.equal(relInside("D:\\School Photos", "d:\\school photos\\2025-2026\\a.jpg", w), "2025-2026\\a.jpg");
  assert.equal(isInside("E:\\", "e:\\DCIM\\100CANON", w), true);
  assert.equal(isAtOrInside("E:\\", "E:\\", w), true);
  assert.equal(isInside("E:\\", "E:\\", w), false);
});

test("Windows: UNC network folders", () => {
  assert.equal(isInside("\\\\server\\photos", "\\\\server\\photos\\2025\\a.jpg", w), true);
  assert.equal(isOutside("\\\\server\\photos", "\\\\other\\photos\\a.jpg", w), true);
});

test("a folder whose name starts with two dots is inside; the parent folder is not", () => {
  for (const p of [w, x]) {
    const root = p === w ? "C:\\Lib" : "/Lib";
    assert.equal(isInside(root, p.join(root, "..notes", "a.jpg"), p), true);
    assert.equal(isOutside(root, p.join(root, ".."), p), true);
    assert.equal(isOutside(root, p.join(root, "..", "Other", "a.jpg"), p), true);
    assert.equal(relInside(root, root, p), "");
  }
});

test("Mac and Linux: same answers as before", () => {
  assert.equal(relInside("/Volumes/Photos", "/Volumes/Photos/2025/Sports Day/a.jpg", x), "2025/Sports Day/a.jpg");
  assert.equal(isOutside("/Volumes/Photos", "/Volumes/Archive/a.jpg", x), true);
  assert.equal(isOutside("/Volumes/Photos", "/Volumes/Photos Old/a.jpg", x), true);
});

test("the editing-app picker asks for a Windows program on Windows, a Mac app on a Mac", () => {
  const win = editorPicker("win32", { ProgramFiles: "C:\\Program Files" });
  assert.deepEqual(win.filters, [{ name: "Programs", extensions: ["exe"] }]);
  assert.equal(win.defaultPath, "C:\\Program Files");
  assert.deepEqual(editorPicker("darwin", {}).filters, [{ name: "Apps", extensions: ["app"] }]);
  assert.equal(editorPicker("linux", {}).filters, undefined);
});

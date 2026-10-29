import { cpSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Script } from "node:vm";

// The window's scripts are plain JavaScript, so a typo would only show when the app opens: stop the build instead.
for (const dir of ["src/renderer", "src/renderer/views"])
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".js"))) new Script(readFileSync(join(dir, f), "utf8"), { filename: join(dir, f) });
cpSync("src/renderer", "dist/renderer", { recursive: true, filter: (p) => !p.endsWith(".ts") });

import { cpSync } from "node:fs";
cpSync("src/renderer", "dist/renderer", { recursive: true, filter: (p) => !p.endsWith(".ts") });

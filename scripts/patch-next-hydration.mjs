// Bug B-25: Next.js starts React hydration as soon as its scripts load, even
// while the browser is still reading the page. On a slow phone or a busy
// computer React then compares against half-read HTML, reports "server HTML
// didn't match" (#418) and throws the page away to draw it again (a flash,
// buttons briefly dead). This makes Next wait until the page has been read
// (DOMContentLoaded) before hydrating. Runs after every npm install; it stops
// the install if a new Next.js version changed the code it expects.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve("next/package.json"));
const MARK = "/* B-25: hydrate after the page is read */";

for (const [file, call] of [
  ["dist/client/app-index.js", "_react.default.startTransition(()=>{\n            _client.default.hydrateRoot("],
  ["dist/esm/client/app-index.js", "React.startTransition(()=>{\n            ReactDOMClient.hydrateRoot("],
]) {
  const p = path.join(dist, file);
  let s = readFileSync(p, "utf8");
  if (s.includes(MARK)) continue;
  const start = s.indexOf(call);
  if (start < 0) throw new Error(`patch-next-hydration: ${file} changed; check bug B-25 against this Next.js version`);
  const end = s.indexOf("\n        });\n", start) + 1;
  if (end < 1) throw new Error(`patch-next-hydration: ${file}: end of hydrate call not found`);
  const block = s.slice(start, end + "        });\n".length);
  const wrapped = `${MARK}
        const hydrateNow = ()=>{
        ${block}        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hydrateNow, { once: true });
        else hydrateNow();
`;
  s = s.slice(0, start) + wrapped + s.slice(end + "        });\n".length);
  writeFileSync(p, s);
  console.log(`patch-next-hydration: patched ${file}`);
}

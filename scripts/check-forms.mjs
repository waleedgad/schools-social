// A form field called "id" hides the form's own id in the browser. React then
// puts the value of the pressed button (name + value, like answer=yes or
// intent=delete) on a form that doesn't exist, and the server never gets it.
// This fails the checks if a page has both.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const bad = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".tsx")) {
      const s = readFileSync(p, "utf8");
      if (/name="id"/.test(s) && /<(Button|button)\b[^>]*\bname=/.test(s)) bad.push(p);
    }
  }
};
walk("src");
if (bad.length) {
  console.error(`A form field named "id" next to buttons with a name/value (the pressed button's value gets lost). Rename the field in:\n  ${bad.join("\n  ")}`);
  process.exit(1);
}
console.log("Forms OK");

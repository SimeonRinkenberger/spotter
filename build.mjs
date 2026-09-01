// Generates docs/index.html (GitHub Pages) from the same template modules the edge
// function imports, so both copies are byte-identical. Run: node build.mjs
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "supabase/functions/spotter/";
const PARTS = [
  ["markup.ts", "MARKUP_HEAD"],
  ["style.ts", "STYLE"],
  ["markup.ts", "MARKUP_BODY"],
  ["app.ts", "APP"],
];

// Pulls the contents of `export const NAME = String.raw` ... ` ` out of a module.
function extract(file, name) {
  const src = readFileSync(SRC + file, "utf8");
  const open = "export const " + name + " = String.raw`";
  const start = src.indexOf(open);
  if (start < 0) throw new Error("could not find " + name + " in " + file);
  const from = start + open.length;
  const end = src.indexOf("`;", from);
  if (end < 0) throw new Error("unterminated template for " + name + " in " + file);
  const body = src.slice(from, end);
  // String.raw would swallow these as interpolations at runtime; fail loudly instead
  // of shipping a page that differs from what the function serves.
  if (body.includes("${")) throw new Error(name + " in " + file + ' contains "${" — remove it');
  return body;
}

const html = PARTS.map(([file, name]) => extract(file, name)).join("");
writeFileSync("docs/index.html", html);
console.log("docs/index.html written —", html.length.toLocaleString(), "bytes");

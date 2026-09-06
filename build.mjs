// Builds the page users actually download, from the three String.raw template modules
// the app is authored in. Those modules are ~30% comment by weight: the comments say why
// the code is the way it is, which is worth a lot to whoever opens the source and nothing
// at all to a phone on hotel wifi. So they stop here. JavaScript syntax is compacted,
// but names and multiline formatting remain readable in devtools; CSS and markup
// keep their existing formatting.
//
// The stripped page is produced ONCE and written to both places that serve it:
//   docs/index.html                        GitHub Pages
//   supabase/functions/spotter/page.gen.ts the edge function, as a JSON string literal
// One string, two writes — the two copies cannot drift. page.ts just re-exports the
// generated constant, so nothing imports the templates at runtime any more.
//
// Run from the repo root:  npm install   (once)   then   node build.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { transformSync } from "esbuild";

const SRC = "supabase/functions/spotter/";
const OUT_HTML = "docs/index.html";
const OUT_GEN = SRC + "page.gen.ts";

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
  // A backtick anywhere in the body ends the template early in TypeScript. This
  // extraction reads to the next "`;" so it can sail past one that the function
  // deploy then trips over — which is exactly what happened once. Same rule, same
  // loud failure, checked here where it is cheap. The stripping below cannot save
  // us from this: it runs on the text these two guards have already cleared.
  if (body.includes("`")) {
    const at = body.indexOf("`");
    const line = body.slice(0, at).split("\n").length;
    throw new Error(name + " in " + file + " contains a backtick at template line " + line + " — remove it");
  }
  return body;
}

// Elements whose contents are not markup. The first two get handed to esbuild; the rest
// are copied through untouched, because a "<!--" inside a textarea is text, not a comment.
const CODE = { script: "js", style: "css" };
const OPAQUE = ["textarea", "pre", "title"];

// A <script> only holds JavaScript if it says so or says nothing. A JSON island
// (type="application/ld+json") would be destroyed by the JS printer, so leave it.
function isJavaScript(openTag) {
  const m = /\stype\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(openTag);
  if (!m) return true;
  const type = (m[2] ?? m[3] ?? m[4] ?? "").trim().toLowerCase();
  return type === "" || type === "module" || type === "text/javascript" || type === "application/javascript";
}

// esbuild drops comments by parsing and re-printing, which is the whole point: a regex
// over JavaScript cannot tell a comment from the "//" in an https:// string or from a
// division sign next to a regex literal, and this file is full of both. Identifier and
// whitespace minification stay off for debugging; the es5 target
// matches the house rule for app.ts, so the printer keeps { a: a } rather than reaching
// for shorthand the target does not have.
function stripCode(source, loader, where) {
  const { code, warnings } = transformSync(source, {
    loader,
    minify: false,
    // Fold redundant syntax, retaining function/variable names and multiline
    // formatting for debugging. Measured separately from full minification.
    minifySyntax: loader === "js",
    legalComments: "none",
    target: loader === "js" ? "es5" : undefined,
  });
  for (const w of warnings) console.warn("  esbuild warning in " + where + ": " + w.text);
  // The printer re-escapes every string it prints. If it ever decided that "<\/script>"
  // was better written plainly, the page would end at that byte and take the app with
  // it — cheap to check, impossible to debug from a screenshot.
  const closer = loader === "js" ? "</script" : "</style";
  if (code.toLowerCase().includes(closer)) {
    throw new Error(where + " contains " + closer + " after stripping — it would close its own tag");
  }
  return code;
}

// Walks one template as markup: drops <!-- --> comments, hands <script>/<style> bodies to
// esbuild, and copies everything else byte for byte. Tag scanning honours quoted attribute
// values so a ">" inside an attribute cannot end a tag early.
function stripTemplate(raw, where) {
  let out = "";
  let i = 0;
  const n = raw.length;
  while (i < n) {
    const lt = raw.indexOf("<", i);
    if (lt < 0) { out += raw.slice(i); break; }
    out += raw.slice(i, lt);

    if (raw.startsWith("<!--", lt)) {
      const end = raw.indexOf("-->", lt + 4);
      if (end < 0) throw new Error("unterminated HTML comment in " + where);
      i = end + 3;
      // A comment that had a line to itself takes the line with it, rather than leaving a
      // blank one behind. A trailing comment on a line of markup just goes.
      const lineStart = out.lastIndexOf("\n") + 1;
      if (/^[ \t]*$/.test(out.slice(lineStart)) && raw[i] === "\n") {
        out = out.slice(0, lineStart);
        i += 1;
      }
      continue;
    }

    // "<" that does not open an element — "</head>", "<!DOCTYPE", a stray "<" in text.
    if (!/[a-zA-Z]/.test(raw[lt + 1] || "")) { out += "<"; i = lt + 1; continue; }

    let j = lt + 1;
    while (j < n && /[a-zA-Z0-9-]/.test(raw[j])) j++;
    const tag = raw.slice(lt + 1, j).toLowerCase();

    let k = j;
    let quote = "";
    while (k < n) {
      const c = raw[k];
      if (quote) { if (c === quote) quote = ""; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      k++;
    }
    if (k >= n) throw new Error("unterminated <" + tag + "> tag in " + where);
    const openTag = raw.slice(lt, k + 1);
    out += openTag;
    i = k + 1;

    const loader = CODE[tag];
    if (!loader && !OPAQUE.includes(tag)) continue;
    if (openTag.endsWith("/>")) continue;

    const close = new RegExp("</" + tag + "(?=[\\s/>])", "gi");
    close.lastIndex = i;
    const end = close.exec(raw);
    if (!end) throw new Error("unterminated <" + tag + "> element in " + where);
    const body = raw.slice(i, end.index);
    i = end.index;

    if (!loader || !body.trim() || (tag === "script" && !isJavaScript(openTag))) {
      out += body;
      continue;
    }
    // The body starts on its own line in the source; keep that so the opening tag does not
    // end up sharing a line with the first statement.
    const lead = /^[ \t]*\n/.test(body) ? "\n" : "";
    const code = stripCode(body, loader, where + " <" + tag + ">");
    out += lead + (code.endsWith("\n") ? code : code + "\n");
  }
  return out;
}

function kb(n) { return n.toLocaleString("en-US"); }
function row(label, before, after) {
  const pct = before ? ((1 - after / before) * 100).toFixed(1) : "0.0";
  return "  " + label.padEnd(12) + kb(before).padStart(9) + " -> " + kb(after).padStart(9) +
    "  (-" + pct + "%)";
}

const table = [];
const rawPieces = [];
const pieces = PARTS.map(([file, name]) => {
  const before = extract(file, name);
  const after = stripTemplate(before, name);
  rawPieces.push(before);
  table.push(row(name, Buffer.byteLength(before), Buffer.byteLength(after)));
  return after;
});

const raw = rawPieces.join("");
const html = pieces.join("");

// Cheap proof that the scanner did not eat something structural.
for (const anchor of ["<!DOCTYPE html>", "<style>", "</style>", "<script>", "</script>", "</html>"]) {
  if (!html.includes(anchor)) throw new Error("stripped page is missing " + anchor);
}

writeFileSync(OUT_HTML, html);

// A JSON string literal, so the generated module carries no backtick and no "${" no
// matter what the page contains, and Deno parses it as one constant with no template
// machinery. U+2028/U+2029 are legal inside a JS string but JSON.stringify leaves them
// raw; escape them so the module is safe to read with a JS parser of any vintage.
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const literal = JSON.stringify(html).split(LS).join("\\u2028").split(PS).join("\\u2029");
writeFileSync(
  OUT_GEN,
  "// GENERATED by build.mjs from markup.ts + style.ts + app.ts, comments stripped. Do not edit; run: node build.mjs\n" +
    "export const PAGE_HTML = " + literal + ";\n"
);

console.log("wrote " + OUT_HTML + " and " + OUT_GEN);
console.log(table.join("\n"));
console.log(row("page", Buffer.byteLength(raw), Buffer.byteLength(html)));
console.log(row("gzip", gzipSync(Buffer.from(raw)).length, gzipSync(Buffer.from(html)).length));

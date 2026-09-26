// Builds the page users actually download, from the three String.raw template modules
// the app is authored in. Those modules are ~30% comment by weight: the comments say why
// the code is the way it is, which is worth a lot to whoever opens the source and nothing
// at all to a phone on hotel wifi. So they stop here. JavaScript syntax is compacted,
// but names and multiline formatting remain readable in devtools; CSS and markup
// keep their existing formatting.
//
// The stripped page is written to web-dist/index.html, a build output that is NOT
// published and not committed. The web app is retired (native is the product), so the
// page is no longer served by GitHub Pages or by the edge function. It still matters:
// tools/ios/build.mjs cuts the native bundle out of it (the same bytes on both shells),
// and the harnesses and the browser pane test it. web-dist/ also gets the icon and the
// mascot art from docs/, so it can be served as it stands for local testing:
//   npx --yes serve -l 8000 web-dist
//
// docs/ is what GitHub Pages publishes: the small landing page that replaced the app
// (docs/index.html, hand-written), the kill-switch service worker and the static pages.
// The one thing this script does to it is keep the landing page's Content-Security-
// Policy in step with its inline script and style (see the end of this file).
//
// Run from the repo root:  npm install   (once)   then   node build.mjs
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { transformSync } from "esbuild";

const SRC = "supabase/functions/spotter/";
const OUT_DIR = "web-dist/";
const OUT_HTML = OUT_DIR + "index.html";

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
//
// The printer's indentation does go (B.2, ~80 KB, a tenth of the page): every line
// stays where it was, so a stack trace's line number still finds its line and Web
// Inspector's pretty-print restores the rest. It is safe on the printer's output and
// only there: esbuild never lets a token span a line (strings come back with \n
// escaped, comments are gone, and the es5 target has no template literals), so the
// start of a line is always between two tokens, where whitespace is only a separator.
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
  if (code.includes("`")) throw new Error(where + " has a backtick after stripping — its indentation cannot be dropped safely");
  return code.replace(/^[ \t]+/gm, "");
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
const built = pieces.join("");

// ---------- Content-Security-Policy ----------
//
// GitHub Pages cannot send response headers, so the policy is a <meta> written
// here, first in <head>, before any tag it has to govern. It lists exactly what
// the page loads and nothing else; tools/csp-check.mjs fails the build's CI if
// an origin the page uses is missing from it.
//
// Scripts: no 'unsafe-inline' and no 'unsafe-eval'. The app is one inline
// <script>, allowed by the sha256 of its exact built bytes, computed below on
// every build, so an edit to app.ts can never ship with a stale hash. The CDN is
// allowed by path, not by host: cdn.jsdelivr.net serves every npm package there
// is, so the host alone would let any of them run. supabase-js is additionally
// pinned by integrity (SRI) on its tag. The three identity/captcha providers are
// loaded on demand by loadScript() in app.ts.
//
// Styles keep 'unsafe-inline': the design lives in one inline <style> and the
// app sets style attributes throughout, and a style cannot run code.
//
// The policy is kept exactly as it was when this page was published, so the bytes
// the native bundle is cut from do not move. The native shell strips it
// (tools/ios/build.mjs): its WKWebView page is assembled differently and keeps its
// behaviour unchanged.
const SUPABASE = "https://mtzevoxxpsktmrbbuxva.supabase.co";
const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/";
const PAGES = "https://simeonrinkenberger.github.io";   // Pumpy artwork, from when the edge function served this page
function cspFor(page) {
  const hashes = [];
  const inline = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  for (let m; (m = inline.exec(page));) {
    if (/\ssrc\s*=/.test(m[1] ?? "")) continue;
    hashes.push("'sha256-" + createHash("sha256").update(m[2], "utf8").digest("base64") + "'");
  }
  if (!hashes.length) throw new Error("no inline script found to hash for the CSP");
  const policy = {
    "default-src": ["'self'"],
    "script-src": [...hashes, SUPABASE_JS, "https://challenges.cloudflare.com",
      "https://accounts.google.com/gsi/client", "https://appleid.cdn-apple.com/appleauth/"],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://api.fontshare.com",
      "https://accounts.google.com/gsi/style"],
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com", "https://cdn.fontshare.com"],
    "img-src": ["'self'", "data:", "blob:", SUPABASE, "https://i.ytimg.com", PAGES],
    "media-src": ["'self'", "blob:", SUPABASE, PAGES],
    "connect-src": ["'self'", "blob:", SUPABASE, SUPABASE.replace("https://", "wss://"),
      "https://accounts.google.com/gsi/"],
    "frame-src": ["https://www.tiktok.com", "https://www.instagram.com", "https://www.youtube.com",
      "https://www.youtube-nocookie.com", "https://challenges.cloudflare.com", "https://accounts.google.com/gsi/",
      "https://appleid.apple.com"],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
  return Object.entries(policy).map(([k, v]) => k + " " + v.join(" ")).join("; ");
}
const CHARSET = '<meta charset="utf-8">\n';
if (!built.includes(CHARSET)) throw new Error("page has no charset meta to put the CSP after");
const html = built.replace(CHARSET, CHARSET +
  '<meta http-equiv="Content-Security-Policy" content="' + cspFor(built) + '">\n');

// Cheap proof that the scanner did not eat something structural.
for (const anchor of ["<!DOCTYPE html>", "<style>", "</style>", "<script>", "</script>", "</html>"]) {
  if (!html.includes(anchor)) throw new Error("stripped page is missing " + anchor);
}

// Rebuilt from nothing each time, so a file that left docs/ cannot linger here.
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_HTML, html);
for (const path of ["assets", "icon.png"]) cpSync("docs/" + path, OUT_DIR + path, { recursive: true });

console.log("wrote " + OUT_HTML + " (not published)");
console.log(table.join("\n"));
console.log(row("page", Buffer.byteLength(raw), Buffer.byteLength(html)));
console.log(row("gzip", gzipSync(Buffer.from(raw)).length, gzipSync(Buffer.from(html)).length));

// ---------- the published landing page ----------
//
// docs/index.html is what https://simeonrinkenberger.github.io/spotter/ serves now
// that the web app is retired. It is written by hand, not built, but its policy is
// written here, for the same reason the app's was: a hash typed by hand goes stale
// the first time somebody edits the script, and a stale hash means the browser
// refuses the one script that clears an old Spotter session off the shared origin.
//
// The policy is the whole page's needs and nothing more: its one inline <style> and
// one inline <script> by sha256, its own icon, and no other host of any kind. No
// 'unsafe-inline' for styles either: the page has no style attributes to need it.
const LANDING = "docs/index.html";
{
  const src = readFileSync(LANDING, "utf8");
  const bare = src.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">\n/, "");
  // Comments are dropped for the scan only, so a tag named in one is never hashed.
  const scan = bare.replace(/<!--[\s\S]*?-->/g, "");
  const hash = (body) => "'sha256-" + createHash("sha256").update(body, "utf8").digest("base64") + "'";
  const sources = (tag) => {
    const found = [...scan.matchAll(new RegExp("<" + tag + "(\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "gi"))];
    if (found.some((m) => /\ssrc\s*=/.test(m[1] ?? ""))) throw new Error(LANDING + " loads a <" + tag + "> from elsewhere; it must stay self-contained");
    return found.length ? found.map((m) => hash(m[2])).join(" ") : "'none'";
  };
  const policy = [
    "default-src 'none'",
    "script-src " + sources("script"),
    "style-src " + sources("style"),
    "img-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  if (!bare.includes(CHARSET)) throw new Error(LANDING + " has no charset meta to put the CSP after");
  const out = bare.replace(CHARSET, CHARSET + '<meta http-equiv="Content-Security-Policy" content="' + policy + '">\n');
  if (out !== src) writeFileSync(LANDING, out);
  console.log((out !== src ? "wrote " : "kept ") + LANDING + " (published landing page; CSP " +
    (out !== src ? "refreshed" : "current") + ")");
}

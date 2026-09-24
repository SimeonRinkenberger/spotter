// Card-size covers for the thumbnails stored before storeThumb learned to make them.
//
// DRY RUN BY DEFAULT: it runs the function's own shrinkStoredCover on each object
// (imported from index.ts: the code /api/worker/cover runs for a new save, not a
// copy) against a store that reads the public cover and, in a dry run, writes
// nothing, then prints the object list with the bytes before and after. Nothing
// is written anywhere unless --apply is given, and --apply is the owner's call.
//
//   deno run --allow-read --allow-write --allow-env --allow-net tools/thumbs-backfill.ts \
//     [--names names.json] [--out dir] [--apply] [--env path/to/.env.local]
//
//   --names  a JSON array of object names in the `thumbs` bucket. Without it the
//            bucket is listed through the Storage API, which needs the service key.
//   --out    also write each small copy to this directory (for looking at them).
//   --apply  upload what the route would: the small copy where there is one, else
//            the same bytes if they lack the week's cache header, under the same name.
//            Needs PROJECT_REF and SERVICE_ROLE_KEY (read from --env, default the
//            repo's .env.local). Never printed.
//
// What it will not touch: web-* pictures (the detail shows those full width) and
// up-* (uploads). Same rule as storeThumb's COVER_PLATFORMS. A thumb_url never
// changes, so old builds and every row keep pointing at the same name.

// index.ts is an entrypoint (Deno.serve at the bottom); stubbing that and giving
// it an address that goes nowhere is what lets this import it without a port or a
// request of its own.
Deno.env.set("SUPABASE_URL", "https://import.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "import-not-a-jwt");
(Deno as unknown as { serve: unknown }).serve = () => ({
  finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {},
  addr: { transport: "tcp", hostname: "127.0.0.1", port: 0 },
});
const quiet = console.log; console.log = () => {};
const { shrinkStoredCover } = await import("../supabase/functions/spotter/index.ts");
type CoverStore = import("../supabase/functions/spotter/index.ts").CoverStore;
console.log = quiet;

const arg = (k: string) => { const i = Deno.args.indexOf("--" + k); return i >= 0 ? Deno.args[i + 1] : undefined; };
const APPLY = Deno.args.includes("--apply");
const OUT = arg("out");
// The repo's .env.local, found by walking up from here (a worktree sits inside the checkout).
function findEnv(): string {
  let dir = new URL(".", import.meta.url);
  for (let i = 0; i < 6; i++, dir = new URL("..", dir)) {
    try { const f = decodeURIComponent(new URL(".env.local", dir).pathname); Deno.statSync(f); return f; } catch { /* up */ }
  }
  throw new Error("no .env.local found; pass --env");
}
const ENV_ARG = arg("env");

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of Deno.readTextFileSync(ENV_ARG ?? findEnv()).split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("="); out[t.slice(0, i)] = t.slice(i + 1);
  }
  return out;
}
const PUBLIC_BASE = "https://mtzevoxxpsktmrbbuxva.supabase.co";
let secret: { base: string; key: string } | null = null;
function admin() {
  if (!secret) { const e = env(); secret = { base: `https://${e.PROJECT_REF}.supabase.co`, key: e.SERVICE_ROLE_KEY }; }
  const jwt = secret.key.split(".").length === 3;
  const headers: Record<string, string> = jwt ? { apikey: secret.key, authorization: `Bearer ${secret.key}` } : { apikey: secret.key };
  return { base: secret.base, headers };
}

async function listNames(): Promise<string[]> {
  const file = arg("names");
  if (file) return JSON.parse(Deno.readTextFileSync(file));
  const a = admin(), names: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const r = await fetch(`${a.base}/storage/v1/object/list/thumbs`, {
      method: "POST", headers: { ...a.headers, "content-type": "application/json" },
      body: JSON.stringify({ prefix: "", limit: 100, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!r.ok) throw new Error("list " + r.status + " " + await r.text());
    const page = await r.json() as { name: string; id: string | null }[];
    names.push(...page.filter((o) => o.id).map((o) => o.name));
    if (page.length < 100) return names;
  }
}

const names = await listNames();
if (OUT) Deno.mkdirSync(OUT, { recursive: true });
// Reads the public copy (no key needed for a dry run); writes only under --apply.
const store: CoverStore = {
  async read(name) {
    const r = await fetch(`${PUBLIC_BASE}/storage/v1/object/public/thumbs/${encodeURIComponent(name)}`);
    if (!r.ok) { await r.body?.cancel(); return null; }
    return { bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get("content-type") ?? "image/jpeg", cache: r.headers.get("cache-control") };
  },
  async write(name, bytes, type, cache) {
    if (OUT && type === "image/jpeg") Deno.writeFileSync(`${OUT}/${name}`, bytes);
    if (!APPLY) return true;
    const a = admin();
    const up = await fetch(`${a.base}/storage/v1/object/thumbs/${encodeURIComponent(name)}`, {
      method: "POST", headers: { ...a.headers, "content-type": type, "cache-control": cache, "x-upsert": "true" }, body: bytes,
    });
    await up.body?.cancel();
    return up.ok;
  },
};
const quietLog = console.log;
let before = 0, after = 0, shrunk = 0, kept = 0;
const rows: string[] = [];
for (const name of names) {
  console.log = () => {};
  const o = await shrinkStoredCover(name, store);
  console.log = quietLog;
  if (o.action === "missing" || o.action === "refused") { rows.push(`${name}\t${o.action}`); continue; }
  before += o.before; after += o.after;
  if (o.action === "shrunk") shrunk++; else kept++;
  const verb = APPLY ? "" : "would be ";
  rows.push(`${name}\t${o.size ?? "-"}\t${o.before}\t${o.after}\t${
    o.action === "shrunk" ? "shrink " + o.cpu_ms + "ms" : o.action === "failed" ? "UPLOAD FAILED" : /^(web|up)-/.test(name) ? "keep (full-width photo)" : "keep"}${
    o.recached ? " (" + verb + "made cacheable)" : ""}\t${o.cache_was}`);
}
console.log("name\tsize\tbytes_before\tbytes_after\taction\tcache_control_now");
for (const r of rows) console.log(r);
console.log(`\n${names.length} objects: ${shrunk} shrink, ${kept} keep. ${before} -> ${after} bytes (${
  before ? Math.round(100 * (before - after) / before) : 0}% less).${APPLY ? "" : " DRY RUN: nothing was written. Add --apply to upload."}`);

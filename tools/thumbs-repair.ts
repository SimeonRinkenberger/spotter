// Covers that are a platform's logo, proven by their bytes, and put right.
//
// Two cold Instagram saves on 24 Sept stored Instagram's generic og:image (its
// logo, a 4168x4168 PNG) as the cover, in video_cache, for everybody after them;
// an audit probe stored TikTok's logo under a name nothing references. index.ts
// no longer takes either (igGenericImage, ttGenericImage, platformLogo in
// storeThumb); this repairs what was written before it.
//
// DRY RUN BY DEFAULT. It reads every cover the cache points at, and every object
// in the `thumbs` bucket, hashes each one, and prints one line per object that IS
// a platform logo (PLATFORM_LOGO_SHA256 in index.ts, never a guess from a size or
// a name) with exactly what --apply would do to it:
//
//   REPLACE  a cache row names it and the post's real picture can be fetched again
//            (the fixed igMeta / ttMeta, the worker's own readers): the picture is
//            stored under the SAME name by storeThumb and shrinkStoredCover — the
//            worker's store path — so no row changes; every card sharing the URL
//            shows the real cover.
//   CLEAR    rows name it but no real picture is available: thumb_url is set to
//            null on the video_cache and workouts rows whose thumb_url is exactly
//            that URL (nothing else on them), then the object is deleted.
//   DELETE   nothing references it: the object is deleted.
//
// Nothing else is touched: a cover that is not a proven logo is never read twice,
// never written, and no row column other than thumb_url is ever written. --apply
// hashes each object again immediately before acting and skips it if it changed.
//
//   deno run --allow-read --allow-env --allow-net tools/thumbs-repair.ts \
//     [--apply] [--env path/to/.env.local] [--rows rows.json] [--objects names.json] [--refs refs.json]
//
//   --rows     video_cache rows as JSON [{shortcode, platform, kind, url, thumb_url}]
//   --objects  object names in the thumbs bucket as JSON ["a.jpg", …]
//   --refs     {"<thumb url>": {"cache": n, "workouts": n}} for every logo URL
//              With all three, a dry run needs no key (the covers are public).
//              Without them they are read with PROJECT_REF and SERVICE_ROLE_KEY
//              from --env (default: the repo's .env.local). Never printed.
//   --apply    make the changes. Always reads live rows (the three files are
//              refused with it) and needs the service key. The owner's call.

export type CacheRow = { shortcode: string; platform: string; kind: string | null; url: string; thumb_url: string | null };
export type Held = { bytes: Uint8Array<ArrayBuffer>; type: string };
export type Refs = { cache: number; workouts: number };
export type Probe = { ok: boolean; logo: string | null; size: string };

/** Everything that touches the network or the project, so the logic can be proved offline. */
export type Deps = {
  base: string;                                   // https://<ref>.supabase.co, where the public covers live
  rows(): Promise<CacheRow[]>;
  objects(): Promise<string[]>;
  read(name: string): Promise<Held | null>;       // the public object
  logo(bytes: Uint8Array<ArrayBuffer>): Promise<string | null>;
  refs(url: string): Promise<Refs>;
  refetch(row: CacheRow): Promise<string | null>; // the post's picture, read again the worker's way
  probe(src: string): Promise<Probe>;             // what that picture is, before anything is written
  store(row: CacheRow, src: string): Promise<boolean>;
  clearThumb(url: string): Promise<Refs>;         // thumb_url -> null where thumb_url = url, and nothing else
  remove(name: string): Promise<boolean>;
};

export type Action = {
  kind: "replace" | "clear" | "delete";
  name: string; url: string; logo: string; size: string; refs: Refs;
  row: CacheRow | null; src: string | null; srcSize: string | null; why: string;
};

const NAME = /^[A-Za-z0-9_-]{1,64}\.jpg$/;

/** The object a thumb_url names in our own bucket, or null for anything else. */
export function ownObject(base: string, url: string | null): string | null {
  const prefix = base + "/storage/v1/object/public/thumbs/";
  if (!url || !url.startsWith(prefix)) return null;
  const name = url.slice(prefix.length);
  return NAME.test(name) ? name : null;
}

/** "4168x4168 png 778568 B", from the header alone. */
export function describe(bytes: Uint8Array): string {
  const n = bytes.byteLength;
  if (n > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, n);
    return `${v.getUint32(16)}x${v.getUint32(20)} png ${n} B`;
  }
  if (n > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i + 9 < n;) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const m = bytes[i + 1];
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return `${(bytes[i + 7] << 8) | bytes[i + 8]}x${(bytes[i + 5] << 8) | bytes[i + 6]} jpeg ${n} B`;
      }
      i += 2 + len;
    }
    return `jpeg ${n} B`;
  }
  return `${n} B`;
}

/** What --apply would do, and to what. Reads only. */
export async function plan(d: Deps): Promise<{ actions: Action[]; hashed: number; missing: string[] }> {
  const actions: Action[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  let hashed = 0;
  const rows = await d.rows();
  const byName = new Map<string, CacheRow>();
  for (const r of rows) {
    const name = ownObject(d.base, r.thumb_url);
    if (name && !byName.has(name)) byName.set(name, r);
  }
  const names = [...byName.keys(), ...(await d.objects()).filter((n) => NAME.test(n) && !byName.has(n))];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    const held = await d.read(name);
    if (!held) { missing.push(name); continue; }
    hashed++;
    const logo = await d.logo(held.bytes);
    if (!logo) continue;
    const url = d.base + "/storage/v1/object/public/thumbs/" + name;
    const refs = await d.refs(url);
    const row = byName.get(name) ?? null;
    const size = describe(held.bytes);
    if (!row && !refs.cache && !refs.workouts) {
      actions.push({ kind: "delete", name, url, logo, size, refs, row, src: null, srcSize: null, why: "no row references it" });
      continue;
    }
    let src: string | null = null, srcSize: string | null = null, why = "";
    if (row) {
      try { src = await d.refetch(row); } catch (e) { why = "re-reading the post failed: " + String(e).slice(0, 120); }
      if (src) {
        const p = await d.probe(src);
        if (!p.ok) { why = "the post's picture did not download"; src = null; }
        else if (p.logo) { why = "the post still names the " + p.logo; src = null; }
        else srcSize = p.size;
      } else if (!why) why = "the post names no picture";
    } else why = "no cache row to re-read it from";
    actions.push(src
      ? { kind: "replace", name, url, logo, size, refs, row, src, srcSize, why: "" }
      : { kind: "clear", name, url, logo, size, refs, row, src: null, srcSize: null, why });
  }
  return { actions, hashed, missing };
}

/** The changes, each proved again first. Returns one line per action. */
export async function apply(d: Deps, actions: Action[]): Promise<string[]> {
  const out: string[] = [];
  for (const a of actions) {
    const held = await d.read(a.name);
    if (!held || await d.logo(held.bytes) !== a.logo) { out.push(a.name + "\tSKIPPED: it changed since the dry run"); continue; }
    if (a.kind === "replace") {
      const ok = await d.store(a.row!, a.src!);
      const now = ok ? await d.read(a.name) : null;
      const still = now ? await d.logo(now.bytes) : a.logo;
      out.push(a.name + (ok && !still ? "\treplaced: " + describe(now!.bytes) : "\tREPLACE FAILED, left as it was"));
    } else if (a.kind === "clear") {
      const n = await d.clearThumb(a.url);
      const gone = await d.remove(a.name);
      out.push(a.name + "\tcleared thumb_url on " + n.cache + " cache and " + n.workouts + " workouts row(s)" +
        (gone ? "; object deleted" : "; OBJECT DELETE FAILED"));
    } else {
      const r = await d.refs(a.url);
      if (r.cache || r.workouts) { out.push(a.name + "\tSKIPPED: a row references it now"); continue; }
      out.push(a.name + (await d.remove(a.name) ? "\tdeleted" : "\tDELETE FAILED"));
    }
  }
  return out;
}

/** The dry run's table. Signed CDN query strings are cut: they are long and say nothing. */
export function report(actions: Action[]): string[] {
  const short = (u: string | null) => u ? u.split("?")[0].slice(0, 100) : "-";
  return actions.map((a) => [
    a.name, a.row?.shortcode ?? "-", a.row?.platform ?? "-", a.logo, a.size,
    "cache " + a.refs.cache + " / workouts " + a.refs.workouts,
    a.kind === "replace" ? "REPLACE with " + short(a.src) + " (" + a.srcSize + "), same name, rows unchanged"
      : a.kind === "clear" ? "CLEAR thumb_url on those rows, delete the object — " + a.why
      : "DELETE the object — " + a.why,
  ].join("\t"));
}

// ---------- the command line ----------

async function main(): Promise<void> {
  const arg = (k: string) => { const i = Deno.args.indexOf("--" + k); return i >= 0 ? Deno.args[i + 1] : undefined; };
  const APPLY = Deno.args.includes("--apply");
  const files = { rows: arg("rows"), objects: arg("objects"), refs: arg("refs") };
  if (APPLY && (files.rows || files.objects || files.refs)) {
    console.error("--apply reads live rows; drop --rows/--objects/--refs."); Deno.exit(2);
  }
  const PUBLIC_BASE = "https://mtzevoxxpsktmrbbuxva.supabase.co";
  let secret: { base: string; key: string } | null = null;
  const admin = () => {
    if (!secret) {
      const e: Record<string, string> = {};
      let file = arg("env");
      if (!file) {
        let dir = new URL(".", import.meta.url);
        for (let i = 0; i < 6 && !file; i++, dir = new URL("..", dir)) {
          try { const f = decodeURIComponent(new URL(".env.local", dir).pathname); Deno.statSync(f); file = f; } catch { /* up */ }
        }
      }
      if (!file) throw new Error("no .env.local found; pass --env");
      for (const line of Deno.readTextFileSync(file).split("\n")) {
        const t = line.trim(); if (!t || t.startsWith("#") || !t.includes("=")) continue;
        e[t.slice(0, t.indexOf("="))] = t.slice(t.indexOf("=") + 1);
      }
      secret = { base: `https://${e.PROJECT_REF}.supabase.co`, key: e.SERVICE_ROLE_KEY };
    }
    const jwt = secret.key.split(".").length === 3;
    return { base: secret.base, key: secret.key,
      headers: (jwt ? { apikey: secret.key, authorization: `Bearer ${secret.key}` } : { apikey: secret.key }) as Record<string, string> };
  };

  // index.ts is an entrypoint (Deno.serve at the bottom). Stubbed as the backfill
  // stubs it. With --apply it is given the project's own address and key, so
  // storeThumb and shrinkStoredCover write where the worker writes; a dry run
  // gives it an address that goes nowhere, so nothing it does can write.
  const live = APPLY ? admin() : null;
  Deno.env.set("SUPABASE_URL", live ? live.base : "https://import.invalid");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", live ? live.key : "import-not-a-jwt");
  (Deno as unknown as { serve: unknown }).serve = () => ({
    finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {},
    addr: { transport: "tcp", hostname: "127.0.0.1", port: 0 },
  });
  const quiet = console.log; console.log = () => {};
  const S = await import("../supabase/functions/spotter/index.ts");
  console.log = quiet;

  const rest = async (path: string, init: RequestInit = {}) => {
    const a = admin();
    return await fetch(`${a.base}/rest/v1/${path}`, { ...init, headers: { ...a.headers, ...(init.headers ?? {}) } });
  };
  const count = async (table: string, url: string): Promise<number> => {
    const r = await rest(`${table}?thumb_url=eq.${encodeURIComponent(url)}&select=thumb_url`, { method: "HEAD", headers: { prefer: "count=exact" } });
    if (!r.ok) throw new Error(table + " count " + r.status);
    return Number(r.headers.get("content-range")?.split("/")[1] ?? "0");
  };
  const refsFile = files.refs ? JSON.parse(Deno.readTextFileSync(files.refs)) as Record<string, Refs> : null;

  const deps: Deps = {
    base: PUBLIC_BASE,
    async rows() {
      if (files.rows) return JSON.parse(Deno.readTextFileSync(files.rows));
      const r = await rest("video_cache?select=shortcode,platform,kind,url,thumb_url&thumb_url=not.is.null&limit=5000");
      if (!r.ok) throw new Error("video_cache " + r.status + " " + await r.text());
      return await r.json();
    },
    async objects() {
      if (files.objects) return JSON.parse(Deno.readTextFileSync(files.objects));
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
    },
    async read(name) {
      // Cache-busting query: the CDN may still hold the object as it was.
      const r = await fetch(`${PUBLIC_BASE}/storage/v1/object/public/thumbs/${encodeURIComponent(name)}?repair=${Date.now()}`);
      if (!r.ok) { await r.body?.cancel(); return null; }
      return { bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get("content-type") ?? "" };
    },
    logo: (b) => S.platformLogo(b),
    async refs(url) {
      if (refsFile) return refsFile[url] ?? { cache: 0, workouts: 0 };
      return { cache: await count("video_cache", url), workouts: await count("workouts", url) };
    },
    async refetch(row) {
      const p = { platform: row.platform, shortcode: row.shortcode, kind: row.kind ?? "video", clean: row.url };
      const quietLog = console.log; console.log = () => {};
      try {
        const meta = row.platform === "instagram" ? await S.igMeta(p as never)
          : row.platform === "tiktok" ? await S.ttMeta(p as never) : null;
        return meta?.thumb ?? null;
      } finally { console.log = quietLog; }
    },
    async probe(src) {
      try {
        const r = await fetch(src, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" } });
        if (!r.ok) { await r.body?.cancel(); return { ok: false, logo: null, size: "" }; }
        const b = new Uint8Array(await r.arrayBuffer());
        return { ok: b.byteLength >= 500, logo: await S.platformLogo(b), size: describe(b) };
      } catch { return { ok: false, logo: null, size: "" }; }
    },
    async store(row, src) {
      const url = await S.storeThumb(row.shortcode, src, row.platform);
      if (!url) return false;
      // storeThumb kicks /api/worker/cover for the card-size copy; there is no
      // worker secret here, so the same function that route runs is run directly.
      await S.shrinkStoredCover(row.shortcode + ".jpg");
      return true;
    },
    async clearThumb(url) {
      const patch = async (table: string) => {
        const r = await rest(`${table}?thumb_url=eq.${encodeURIComponent(url)}`, {
          method: "PATCH", headers: { "content-type": "application/json", prefer: "return=representation" },
          body: JSON.stringify({ thumb_url: null }),
        });
        if (!r.ok) throw new Error(table + " patch " + r.status + " " + await r.text());
        return (await r.json() as unknown[]).length;
      };
      return { cache: await patch("video_cache"), workouts: await patch("workouts") };
    },
    async remove(name) {
      const a = admin();
      const r = await fetch(`${a.base}/storage/v1/object/thumbs/${encodeURIComponent(name)}`, { method: "DELETE", headers: a.headers });
      await r.body?.cancel();
      return r.ok;
    },
  };

  const { actions, hashed, missing } = await plan(deps);
  console.log("name\tshortcode\tplatform\tproof (sha256)\tobject\trows sharing its URL\taction");
  for (const line of report(actions)) console.log(line);
  console.log(`\n${hashed} covers hashed, ${actions.length} proven platform logo(s): ` +
    ["replace", "clear", "delete"].map((k) => actions.filter((a) => a.kind === k).length + " " + k).join(", ") +
    (missing.length ? `. ${missing.length} named but missing: ${missing.join(", ")}` : "") + ".");
  if (!APPLY) { console.log("DRY RUN: nothing was written. Add --apply to make these changes."); return; }
  for (const line of await apply(deps, actions)) console.log(line);
}

if (import.meta.main) await main();

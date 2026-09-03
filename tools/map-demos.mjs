// Spotter — offline demonstration-media mapping.
//
// Nothing here runs at request time. The owner runs this once (and again whenever
// a new source is licensed); it produces two committed artefacts:
//
//   supabase/migrations/20260903200000_exercise_demos.sql   generated, idempotent
//   tools/demo-review.json                                  the human's to-do list
//
// and, with `run`, one side effect: the media bytes are copied into the public
// `demos` bucket so the app serves them from our own storage rather than hotlinking
// somebody else's CDN.
//
// Usage:
//   node tools/map-demos.mjs plan     match only — writes the review file, no network writes
//   node tools/map-demos.mjs run      plan, then upload the media and write the migration
//
// ---------- why the matching is this conservative ----------
//
// Only an EXACT normalized match on a catalog name or alias becomes a demo
// automatically. Token overlap is not used, because it is confidently wrong in
// exactly the cases that matter: "Plank" overlaps "Bodyweight Incline Side Plank",
// which is a different exercise, and a user who is shown the wrong movement while
// being told how to do the right one is worse off than a user shown nothing.
// Everything short of exact lands in tools/demo-review.json with up to three
// candidates and a score, for the owner to confirm in one sitting.
//
// The review file round-trips: set "confirm": true on the candidate you want (or
// "reject": true on the row to silence it), re-run, and the confirmed pairs join
// the automatic ones. Confirmations survive re-runs; the candidate lists are
// regenerated around them.
//
// ---------- adding a source later ----------
//
// SOURCES below is an ordered list of adapters. Each one returns items shaped
// { key, names[], frames[{url, ext}], credit, ai } and knows nothing about the
// catalog, storage or SQL. Earlier sources win a canonical id outright, so putting
// a purchased set ahead of wger fills the good rows with it and leaves wger as the
// gap-filler. Adding ExerciseDB when it is bought is one adapter and one line in
// SOURCES — the matching, the upload, the review file and the SQL do not change.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { canonicalize, CATALOG } from "../supabase/functions/spotter/catalog.ts";

const REVIEW = "tools/demo-review.json";
const OUT = "supabase/migrations/20260903200000_exercise_demos.sql";
const CACHE = ".demo-cache";                 // gitignored scratch for fetched JSON

// A candidate has to look like the same movement before a human is asked about it
// at all. Below this the list is noise — "Back Squat" against "Front Squats" scores
// 0.5 on shared words alone and is not worth a second of anyone's attention.
const REVIEW_FLOOR = 0.55;

const args = process.argv.slice(2);
const cmd = args[0] || "plan";
if (cmd !== "plan" && cmd !== "run") {
  console.error("usage: node tools/map-demos.mjs [plan|run]");
  process.exit(1);
}

// ---------- source adapters ----------

/**
 * wger.de — keyless, CC-BY-SA, and the only free source whose licence and author
 * travel WITH each image instead of being promised in a README. That is the whole
 * reason it is here: the attribution line under a demo is built from the row, so
 * it cannot drift away from what the licence actually requires.
 */
const wger = {
  id: "wger",
  label: "wger",
  async load() {
    const info = await cached("wger-exerciseinfo.json", async () => {
      let url = "https://wger.de/api/v2/exerciseinfo/?limit=100&format=json";
      const all = [];
      while (url) {
        const r = await fetch(url, { headers: { accept: "application/json" } });
        if (!r.ok) throw new Error("wger exerciseinfo HTTP " + r.status);
        const d = await r.json();
        all.push(...d.results);
        url = d.next;
      }
      return all;
    });
    const licenses = await cached("wger-licenses.json", async () => {
      const r = await fetch("https://wger.de/api/v2/license/?limit=50&format=json");
      if (!r.ok) throw new Error("wger license HTTP " + r.status);
      return (await r.json()).results;
    });
    // The API's short names are "CC-BY-SA 4"; the licence's own deed calls itself
    // "CC BY-SA 4.0", and the attribution has to name the licence the way the
    // licence names itself.
    const LIC = {
      "CC-BY-SA 3": "CC BY-SA 3.0", "CC-BY-SA 4": "CC BY-SA 4.0",
      "CC-BY 4": "CC BY 4.0", "CC0": "CC0 1.0", "ODbL": "ODbL",
    };
    const licName = new Map(licenses.map((l) => [l.id, LIC[l.short_name] || l.short_name]));

    const out = [];
    for (const e of info) {
      const tr = (e.translations || []).find((t) => t.language === 2);   // 2 = English
      if (!tr || !tr.name) continue;
      const all = (e.images || []).filter((i) => i.image);
      if (!all.length) continue;
      // 43 of wger's stills are AI-generated, and those are the one class of image
      // in this dataset that can be plausible and wrong at the same time — which is
      // the failure this whole feature exists to avoid. Prefer the drawn ones; an
      // exercise that has nothing else is still offered, but only through the
      // review file, where a person looks at it before it ships.
      const drawn = all.filter((i) => !i.is_ai_generated);
      const imgs = drawn.length ? drawn : all;
      imgs.sort((a, b) => (b.is_main ? 1 : 0) - (a.is_main ? 1 : 0) || a.id - b.id);
      const main = imgs[0];
      const authors = [
        ...(main.author_history || []),
        main.license_author, ...(e.author_history || []), e.license_author,
      ].filter(Boolean);
      // A handful of contributors signed with an email address. CC-BY-SA asks for
      // attribution "in any reasonable manner"; printing a live address into a
      // public page so it can be harvested is not one, and the name in front of
      // the @ credits them just as well.
      const who = [...new Set(authors.map((a) => String(a).replace(/@[^\s,]+/, "")))]
        .filter(Boolean).join(", ");
      const lic = licName.get(main.license) || "CC BY-SA 4.0";
      out.push({
        key: "wger-" + e.id,
        names: [tr.name, ...(tr.aliases || []).map((a) => a.alias).filter(Boolean)],
        // Two frames is a demonstration; three or more is a gallery, and the second
        // and later ones are usually the same position from another angle. Take the
        // main image and at most one partner.
        //
        // `alt` is wger's OWN 400x400 rendition of the same still, which the upload
        // step falls back to when the original is too heavy to put in front of a
        // phone — a handful of these stills are 6-8 MB PNGs. It is a file wger
        // published, copied unmodified, so it raises no adaptation question.
        frames: imgs.slice(0, 2).map((i) => ({
          url: i.image, ext: extOf(i.image),
          alt: (i.thumbnails && i.thumbnails.medium) || null,
        })),
        credit: who
          ? "Illustration: " + who + ", " + lic + " via wger"
          : "Illustration from wger, " + lic,
        ai: !drawn.length,
      });
    }
    return out;
  },
};

/**
 * ExerciseDB.io — not bought yet, so this adapter is deliberately inert. When the
 * Starter dataset is purchased it arrives as a folder of GIFs plus one JSON index;
 * point DEMO_EXERCISEDB_DIR at it and fill in the two lines below. Its licence
 * permits self-hosting and asks for no attribution, so credit stays null and the
 * frames are a single GIF each (kind 'image' — one file, already animated).
 */
const exercisedb = {
  id: "exercisedb",
  label: "ExerciseDB",
  async load() {
    const dir = process.env.DEMO_EXERCISEDB_DIR;
    if (!dir || !existsSync(dir)) return [];
    const index = JSON.parse(readFileSync(dir + "/exercises.json", "utf8"));
    return index.map((e) => ({
      key: "exercisedb-" + e.id,
      names: [e.name],
      frames: [{ url: "file://" + dir + "/gifs/" + e.id + ".gif", ext: "gif", alt: null }],
      credit: null,
      ai: false,
    }));
  },
};

// Order is precedence: the first source to win a canonical id keeps it.
const SOURCES = [exercisedb, wger];

// ---------- helpers ----------

function extOf(url) {
  const m = String(url).split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
  return (m ? m[1] : "png").toLowerCase();
}

async function cached(name, fetcher) {
  if (!existsSync(CACHE)) mkdirSync(CACHE);
  const path = CACHE + "/" + name;
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  const d = await fetcher();
  writeFileSync(path, JSON.stringify(d));
  return d;
}

// A crude bag-of-stems score, used ONLY to order the review list. It is not allowed
// to decide anything: the code below never promotes a candidate on this number, it
// only sorts the three a human is shown.
const STOP = new Set(["the", "a", "an", "and", "or", "of", "for", "with", "to", "on", "in", "at", "your", "exercise"]);
function stems(s) {
  return [...new Set(String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").split(" ")
    .map((w) => (w.length > 4 && w.endsWith("ies") ? w.slice(0, -3) + "y" : w.replace(/(s|e)+$/, "")))
    .filter((w) => w && !STOP.has(w)))];
}
function dice(a, b) {
  const B = new Set(b);
  let i = 0;
  for (const t of a) if (B.has(t)) i++;
  return a.length && b.length ? (2 * i) / (a.length + b.length) : 0;
}

// ---------- matching ----------

const items = [];
for (const src of SOURCES) {
  const loaded = await src.load();
  for (const it of loaded) items.push({ ...it, source: src.id, label: src.label });
  console.log(src.label + ": " + loaded.length + " items with media");
}

const prior = existsSync(REVIEW) ? JSON.parse(readFileSync(REVIEW, "utf8")) : { rows: [] };
const confirmed = new Map();     // canonical_id -> source item key, from the owner
const rejected = new Set();
for (const row of prior.rows || []) {
  if (row.reject) rejected.add(row.id);
  for (const c of row.candidates || []) if (c.confirm) confirmed.set(row.id, c.key);
}

const byKey = new Map(items.map((it) => [it.key, it]));
const picked = new Map();        // canonical_id -> { item, how }

// Pass 1: exact name or exact alias, automatically. canonicalize() is the same
// function the edge function uses on model output, run in the other direction;
// method "exact" means the normalized surface form IS a catalog name or alias.
// "key" (same stems, different inflection) and "fuzzy" (token overlap) are not
// taken here — they go to the review file instead.
for (const it of items) {
  if (it.ai) continue;                       // AI stills are only ever owner-confirmed
  for (const n of it.names) {
    const m = canonicalize(n);
    if (!m || m.method !== "exact") continue;
    const held = picked.get(m.id);
    // Earlier source wins; within a source, a two-frame demo beats a one-frame one,
    // then the lower key so a re-run produces the same file.
    if (!held) { picked.set(m.id, { item: it, how: "exact" }); continue; }
    if (held.item.source !== it.source) continue;
    const better = it.frames.length > held.item.frames.length ||
      (it.frames.length === held.item.frames.length && it.key < held.item.key);
    if (better) picked.set(m.id, { item: it, how: "exact" });
  }
}
const autoCount = picked.size;

// Pass 2: the owner's confirmations from the last review.
for (const [id, key] of confirmed) {
  const it = byKey.get(key);
  if (it && !picked.has(id)) picked.set(id, { item: it, how: "confirmed" });
}

// ---------- the review file ----------

const rows = [];
for (const c of CATALOG) {
  if (picked.has(c.id) || rejected.has(c.id)) continue;
  const mine = stems(c.name);
  const cands = [];
  for (const it of items) {
    let best = 0, via = "";
    for (const n of it.names) {
      const d = dice(mine, stems(n));
      if (d > best) { best = d; via = n; }
    }
    if (best < REVIEW_FLOOR) continue;
    // What the app's own matcher makes of it, which is the number that actually
    // means something: "key" is the same set of stems in another inflection
    // ("Kettlebell deadlifts" for "Kettlebell Deadlift") and is nearly always
    // right; "fuzzy" is token overlap and is the one to read carefully.
    const m = canonicalize(via);
    cands.push({
      key: it.key, source: it.source, name: via,
      score: Number(best.toFixed(3)),
      matcher: m && m.id === c.id ? m.method : "none",
      ai: it.ai,
      preview: it.frames[0].url,
      credit: it.credit,
      confirm: false,
    });
  }
  if (!cands.length) continue;
  const rank = (x) => (x.matcher === "exact" ? 2 : x.matcher === "key" ? 1 : 0);
  cands.sort((a, b) => rank(b) - rank(a) || b.score - a.score);
  rows.push({ id: c.id, name: c.name, reject: false, candidates: cands.slice(0, 3) });
}
// Carry the owner's decisions forward even for rows that now match automatically,
// so a confirmation is never silently thrown away by a re-run.
for (const row of rows) {
  const key = confirmed.get(row.id);
  if (key) for (const c of row.candidates) if (c.key === key) c.confirm = true;
}

writeFileSync(REVIEW, JSON.stringify({
  note: "Set confirm:true on the ONE candidate that really is this exercise, or " +
    "reject:true on the row if none of them are, then re-run node tools/map-demos.mjs run. " +
    "matcher:'key' means the same words in another inflection and is usually safe; " +
    "'fuzzy' is word overlap and is the one to look at; ai:true means the drawing " +
    "was generated rather than drawn, so check the form before you take it. " +
    "Open preview to see the image.",
  generated: new Date().toISOString().slice(0, 10),
  rows,
}, null, 1) + "\n");

const pairs = [...picked.values()].filter((p) => p.item.frames.length > 1).length;
console.log("automatic (exact name or alias): " + autoCount + "/" + CATALOG.length);
console.log("owner-confirmed from " + REVIEW + ": " + (picked.size - autoCount));
console.log("demos in total: " + picked.size + " (" + pairs + " two-frame)");
console.log("sent to review: " + rows.length + " rows -> " + REVIEW);

if (cmd === "plan") process.exit(0);

// ---------- storage ----------
//
// The bytes are copied unmodified. Any resize would be an adaptation under
// CC-BY-SA 4.0 3(b) and would have to be offered back under the same licence;
// keeping the original file avoids the question entirely, and wger's stills are
// small enough that there is nothing to gain by shrinking them.

const env = {};
for (const line of readFileSync("/Users/simeon/Desktop/CLAUDE COWORK/spotter/.env.local", "utf8").split("\n")) {
  const s = line.trim();
  if (s && !s.startsWith("#") && s.includes("=")) {
    const i = s.indexOf("=");
    env[s.slice(0, i)] = s.slice(i + 1);
  }
}
const SB = "https://" + env.PROJECT_REF + ".supabase.co";
const SVC = env.SERVICE_ROLE_KEY;
const auth = { apikey: SVC, authorization: "Bearer " + SVC };

// The bucket the migration creates. Made here too, with the same shape and the
// same on-conflict-do-nothing intent, so the upload can run before a migration is
// applied without the two ever disagreeing.
const mk = await fetch(SB + "/storage/v1/bucket", {
  method: "POST",
  headers: { ...auth, "content-type": "application/json" },
  body: JSON.stringify({ id: "demos", name: "demos", public: true }),
});
// The storage API answers a duplicate bucket with HTTP 400 and a 409 in the body,
// which is the one failure here that means everything is fine.
const mkBody = mk.ok ? "" : await mk.text();
if (!mk.ok && !mkBody.includes("BucketAlreadyExists")) throw new Error("bucket: " + mk.status + " " + mkBody);
console.log("bucket demos: " + (mk.ok ? "created" : "already there"));

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };
// Past this the still is too heavy to hand a phone on gym wifi, and wger's own
// 400x400 rendition of it is taken instead. wger's set includes several 6-8 MB
// PNGs; the median is 80 KB, so this catches the outliers and leaves the rest at
// full resolution.
const HEAVY = 400 * 1024;
let bytes = 0, uploaded = 0;

async function fetchFrame(frame) {
  if (frame.url.startsWith("file://")) return { buf: readFileSync(frame.url.slice(7)), ext: frame.ext };
  let url = frame.url, ext = frame.ext;
  if (frame.alt) {
    const head = await fetch(frame.url, { method: "HEAD" });
    if (Number(head.headers.get("content-length") || 0) > HEAVY) { url = frame.alt; ext = extOf(frame.alt); }
  }
  return { buf: Buffer.from(await (await fetch(url)).arrayBuffer()), ext };
}

async function put(objectKey, buf) {
  const r = await fetch(SB + "/storage/v1/object/demos/" + objectKey, {
    method: "POST",
    headers: { ...auth, "content-type": MIME[extOf(objectKey)] || "application/octet-stream", "x-upsert": "true" },
    body: buf,
  });
  if (!r.ok) throw new Error("upload " + objectKey + " failed " + r.status + " " + (await r.text()));
  bytes += buf.length;
  uploaded++;
  return SB + "/storage/v1/object/public/demos/" + objectKey;
}

const sqlRows = [];
const keep = new Set();
for (const [id, { item }] of [...picked.entries()].sort()) {
  const a = await fetchFrame(item.frames[0]);
  const aKey = id + "." + a.ext;
  const url = await put(aKey, a.buf);
  keep.add(aKey);
  let poster = null;
  if (item.frames[1]) {
    const b = await fetchFrame(item.frames[1]);
    const bKey = id + "-2." + b.ext;
    poster = await put(bKey, b.buf);
    keep.add(bKey);
  }
  sqlRows.push({ id, url, poster, kind: item.frames[1] ? "pair" : "image", credit: item.credit });
  process.stdout.write(".");
}
console.log("\nuploaded " + uploaded + " files, " + (bytes / 1024 / 1024).toFixed(2) + " MB");

// Everything in this bucket is generated by this script, so an object no run
// still points at is dead weight — and, on a re-run that changes a file's
// extension, an old file the app would never ask for again.
const listed = await fetch(SB + "/storage/v1/object/list/demos", {
  method: "POST",
  headers: { ...auth, "content-type": "application/json" },
  body: JSON.stringify({ limit: 2000, prefix: "" }),
});
const stale = (await listed.json()).filter((o) => o.name && !keep.has(o.name)).map((o) => o.name);
if (stale.length) {
  await fetch(SB + "/storage/v1/object/demos", {
    method: "DELETE",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ prefixes: stale }),
  });
  console.log("removed " + stale.length + " object(s) nothing points at any more");
}

// ---------- the migration ----------

const q = (s) => (s === null || s === undefined ? "null" : "'" + String(s).replace(/'/g, "''") + "'");
const values = sqlRows.map((r) =>
  "  (" + [q(r.id), q(r.url), q(r.kind), q(r.credit), q(r.poster)].join(", ") + ")").join(",\n");

const sql = `-- Spotter — exercise demonstration media.
--
-- GENERATED FILE. Source of truth is tools/map-demos.mjs; regenerate with:
--   node tools/map-demos.mjs run
--
-- Four columns on the catalog and one public bucket. Reference data, written by
-- the service role, read by every signed-in user through the "catalog readable"
-- policy that already exists — no new RLS.
--
-- demo_kind is 'image' for a single still and 'pair' when the source ships two
-- frames of the same movement; for a pair the SECOND frame lives in demo_poster,
-- which is otherwise the poster still of a video demo and is null for a single
-- image. The app cross-fades the two on a 1.6s cycle, and shows only the first
-- under prefers-reduced-motion.
--
-- demo_credit is the attribution line, built from the licence and author fields
-- the source ships alongside each image rather than written by hand. wger's
-- illustrations are CC-BY-SA, which requires that line to be shown; it is
-- rendered under the image in the Explain sheet, and Settings carries the
-- standing credit.
--
-- Idempotent: the columns are added only if missing, the bucket insert swallows
-- its own conflict, and the update is a no-op once the values match.

alter table public.exercise_catalog
  add column if not exists demo_url    text,
  add column if not exists demo_kind   text,
  add column if not exists demo_credit text,
  add column if not exists demo_poster text;

do $$ begin
  alter table public.exercise_catalog
    add constraint catalog_demo_kind_known check (demo_kind is null or demo_kind in ('image', 'pair', 'gif', 'video'));
exception when duplicate_object then null; end $$;

-- Public, like thumbs: these are illustrations, not anybody's data, and a signed
-- URL per image would be a round trip for every sheet that opens.
insert into storage.buckets (id, name, public) values ('demos', 'demos', true)
on conflict (id) do nothing;

update public.exercise_catalog as c
set demo_url = v.url, demo_kind = v.kind, demo_credit = v.credit,
    demo_poster = v.poster, updated_at = now()
from (values
${values}
) as v(id, url, kind, credit, poster)
where c.id = v.id and (
  c.demo_url is distinct from v.url or c.demo_kind is distinct from v.kind or
  c.demo_credit is distinct from v.credit or c.demo_poster is distinct from v.poster);
`;

writeFileSync(OUT, sql);
console.log(OUT + " written — " + sqlRows.length + " rows, " + sql.length.toLocaleString() + " bytes");

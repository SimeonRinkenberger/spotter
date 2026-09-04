// Spotter — the curated demonstration-clip seed.
//
// Nothing here runs at request time. The owner runs it when a creator is added or
// a library grows; it produces three committed artefacts:
//
//   tools/demo-videos/<slug>.json                                   the enumerations, frozen
//   tools/demo-videos-review.json                                   the human's to-do list
//   supabase/migrations/20260904020000_exercise_demo_videos_seed.sql generated, idempotent
//
// Usage:
//   node tools/demo-videos.mjs plan     enumerate + match + write the review file
//   node tools/demo-videos.mjs run      plan, then write the seed migration
//   ... --only=rp,catalyst              work on some sources only (the rest keep their snapshot)
//   ... --refresh                       ignore .demo-cache and re-fetch from YouTube
//   ... --offline                       never touch the network; use the committed snapshots
//
// ---------- why this exists at all ----------
//
// /api/demo-video used to answer the Explain sheet with whatever YouTube's
// search.list ranked first for "<name> exercise form". Since June 2026 that call
// is capped at 100 a day for the whole project, and what it returns is a lottery:
// a thumbnail of a man pointing at the word WRONG is not a demonstration. So the
// clips now come from an allow-list of creators who publish plain, per-exercise
// footage, matched to canonical catalog ids offline, once, by this file.
//
// ---------- why the matching is this conservative ----------
//
// A user shown the wrong movement while being told how to do the right one is
// worse off than a user shown nothing, so only two things become a clip without a
// human: the cleaned title IS a catalog name or alias, or a catalog name or alias
// appears in it as a whole phrase and everything left over is a word that cannot
// change which movement it is ("Standing Cable Crunch" -> cable-crunch). Anything
// else — "Wide Grip Bench Press", "Machine Glute Kickback" — lands in
// tools/demo-videos-review.json with up to three candidates and a score, for a
// person to confirm or reject in one sitting.
//
// The review file round-trips exactly like tools/demo-review.json: set
// "confirm": true on the candidate that really is that exercise, or "reject": true
// on the row, re-run, and those decisions survive while the candidate lists are
// regenerated around them.
//
// ---------- adding a creator ----------
//
// One entry in tools/demo-sources.json and one run. The adapters below only know
// how to enumerate a playlist; the catalog, the ranking and the SQL do not change.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { canonicalize, CATALOG } from "../supabase/functions/spotter/catalog.ts";

const SOURCES_FILE = "tools/demo-sources.json";
const SNAP_DIR = "tools/demo-videos";
const REVIEW = "tools/demo-videos-review.json";
const OUT = "supabase/migrations/20260904020000_exercise_demo_videos_seed.sql";
const CACHE = ".demo-cache";                 // gitignored scratch for raw enumerations

// A candidate has to look like the same movement before a human is asked about it
// at all. Below this the list is noise, exactly as in tools/map-demos.mjs.
const REVIEW_FLOOR = 0.55;
// Four clips is one to play and three alternates; a fifth would never be seen.
const MAX_PER_KEY = 4;
// More than three videos competing for one catalog id is the same decision three
// times over. The review file is meant to be finishable.
const REVIEW_PER_KEY = 3;
// Below this a clip is a fragment, not a demonstration, so it sorts last even
// though it is short.
const MIN_USEFUL_SECS = 6;

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith("-")) || "plan";
if (cmd !== "plan" && cmd !== "run") {
  console.error("usage: node tools/demo-videos.mjs [plan|run] [--only=slug,slug] [--refresh] [--offline]");
  process.exit(1);
}
const onlyArg = args.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? new Set(onlyArg.slice(7).split(",").map((s) => s.trim()).filter(Boolean)) : null;
const REFRESH = args.includes("--refresh");
const OFFLINE = args.includes("--offline");

const manifest = JSON.parse(readFileSync(SOURCES_FILE, "utf8"));
const SOURCES = manifest.sources;

// ---------- keyless YouTube enumeration ----------
//
// A port of the research session's yt.py. The watch and playlist pages answer a
// residential IP honestly and carry the whole list in ytInitialData; the rest of
// the list arrives through the same innertube continuation the page itself uses.
// This is why the tool is offline and the edge function is not: from Supabase's
// datacenter IP every one of these endpoints answers 429 or LOGIN_REQUIRED.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/128.0 Safari/537.36";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function pageOf(url) {
  // A page now and then comes back as the mobile shell or a redirect stub with no
  // ytInitialData in it at all. It is not worth a strategy — ask again.
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, {
      headers: {
        "user-agent": UA,
        "accept-language": "en-US,en;q=0.9",
        // Without a consent cookie the EU interstitial is served instead of the page,
        // and ytInitialData describes the consent dialog rather than the playlist.
        cookie: "CONSENT=YES+1; SOCS=CAI",
      },
    });
    if (!r.ok) { last = "HTTP " + r.status; await sleep(1500); continue; }
    const html = await r.text();
    if (html.includes("ytInitialData")) return html;
    last = "no ytInitialData in " + html.length + " bytes";
    await sleep(1500);
  }
  throw new Error(last + " for " + url);
}

// ytInitialData is assigned inside a <script>, so it cannot be parsed by finding
// the next "}" — brace-match through the string literals instead.
const DATA_MARKERS = ['ytInitialData = ', 'window["ytInitialData"] = ', 'var ytInitialData = ', '"ytInitialData":'];
function initialData(s) {
  for (const m of DATA_MARKERS) {
    const d = sliceJson(s, m);
    if (d) return d;
  }
  return null;
}

function sliceJson(s, marker) {
  const i = s.indexOf(marker);
  if (i < 0) return null;
  const j = s.indexOf("{", i);
  let depth = 0, instr = false, esc = false, k = j;
  for (; k < s.length; k++) {
    const c = s[k];
    if (instr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') instr = false;
    } else if (c === '"') instr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (!depth) break; }
  }
  return JSON.parse(s.slice(j, k + 1));
}

function walk(o, fn) {
  if (Array.isArray(o)) { for (const v of o) walk(v, fn); return; }
  if (o && typeof o === "object") { fn(o); for (const k in o) walk(o[k], fn); }
}

function textOf(t) {
  if (typeof t === "string") return t;
  if (!t || typeof t !== "object") return "";
  if (t.simpleText) return t.simpleText;
  if (t.content) return t.content;
  if (Array.isArray(t.runs)) return t.runs.map((r) => r.text || "").join("");
  return "";
}

function hms(t) {
  const m = /^(?:(\d+):)?(\d+):(\d\d)$/.exec(String(t).trim());
  if (!m) return 0;
  return (Number(m[1] || 0) * 3600) + (Number(m[2]) * 60) + Number(m[3]);
}

function innertubeCfg(html) {
  const key = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(html);
  const ver = /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/.exec(html);
  if (!key || !ver) throw new Error("no innertube config on the page");
  return { key: key[1], ver: ver[1] };
}

async function browse(cfgv, token) {
  const r = await fetch("https://www.youtube.com/youtubei/v1/browse?key=" + cfgv.key + "&prettyPrint=false", {
    method: "POST",
    headers: { "user-agent": UA, "content-type": "application/json", "accept-language": "en-US,en;q=0.9" },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: cfgv.ver, hl: "en", gl: "US" } },
      continuation: token,
    }),
  });
  if (!r.ok) throw new Error("innertube HTTP " + r.status);
  return await r.json();
}

// Two markups live side by side today: playlistVideoRenderer on the older shell
// and lockupViewModel on the new one, and which one a given playlist serves is
// not stable. Both are collected; the video id de-duplicates them.
function collect(node, into, tokens) {
  walk(node, (x) => {
    if (x.playlistVideoRenderer) {
      const v = x.playlistVideoRenderer;
      if (v.videoId) {
        into.push({
          id: v.videoId,
          title: textOf(v.title),
          secs: Number(v.lengthSeconds || 0) || hms(textOf(v.lengthText)),
        });
      }
    }
    if (x.lockupViewModel) {
      const l = x.lockupViewModel;
      const cid = l.contentId || "";
      if (cid.length === 11 && l.contentType !== "LOCKUP_CONTENT_TYPE_PLAYLIST") {
        const md = (l.metadata && l.metadata.lockupMetadataViewModel) || {};
        let secs = 0;
        walk(l.contentImage || {}, (b) => {
          if (b.thumbnailBadgeViewModel && b.thumbnailBadgeViewModel.text) {
            const n = hms(b.thumbnailBadgeViewModel.text);
            if (n) secs = n;
          }
        });
        into.push({ id: cid, title: textOf(md.title), secs });
      }
    }
    if (x.continuationItemRenderer) {
      const t = ((x.continuationItemRenderer.continuationEndpoint || {}).continuationCommand || {}).token;
      if (t) tokens.push(t);
    }
    if (x.continuationItemViewModel) {
      const c = x.continuationItemViewModel.continuationCommand || {};
      const t = ((c.innertubeCommand || {}).continuationCommand || {}).token;
      if (t) tokens.push(t);
    }
  });
}

async function fetchPlaylist(pid) {
  const html = await pageOf("https://www.youtube.com/playlist?list=" + pid);
  const cfgv = innertubeCfg(html);
  const data = initialData(html);
  if (!data) throw new Error("no ytInitialData for playlist " + pid);
  const out = [];
  let tokens = [];
  collect(data, out, tokens);
  let pages = 0;
  // 400 ms is what a person scrolling looks like, and 200 pages is 20,000 videos:
  // a runaway continuation loop stops rather than hammering.
  while (tokens.length && pages < 200) {
    const tok = tokens[0];
    tokens = [];
    pages++;
    const next = await browse(cfgv, tok);
    collect(next, out, tokens);
    await sleep(400);
    if (pages % 10 === 0) process.stdout.write(".");
  }
  const seen = new Set();
  return out.filter((v) => v.id && !seen.has(v.id) && seen.add(v.id));
}

async function fetchChannelPlaylists(channelId) {
  const html = await pageOf("https://www.youtube.com/channel/" + channelId + "/playlists");
  const cfgv = innertubeCfg(html);
  const data = initialData(html);
  if (!data) throw new Error("no ytInitialData for channel " + channelId);
  const out = new Map();
  const grab = (node, tokens) => walk(node, (x) => {
    if (x.lockupViewModel) {
      const l = x.lockupViewModel;
      const cid = l.contentId || "";
      if (cid.startsWith("PL") || cid.startsWith("UU")) {
        const md = (l.metadata && l.metadata.lockupMetadataViewModel) || {};
        out.set(cid, textOf(md.title));
      }
    }
    if (x.gridPlaylistRenderer && x.gridPlaylistRenderer.playlistId) {
      out.set(x.gridPlaylistRenderer.playlistId, textOf(x.gridPlaylistRenderer.title));
    }
    if (x.continuationItemRenderer) {
      const t = ((x.continuationItemRenderer.continuationEndpoint || {}).continuationCommand || {}).token;
      if (t) tokens.push(t);
    }
    if (x.continuationItemViewModel) {
      const c = x.continuationItemViewModel.continuationCommand || {};
      const t = ((c.innertubeCommand || {}).continuationCommand || {}).token;
      if (t) tokens.push(t);
    }
  });
  let tokens = [];
  grab(data, tokens);
  let pages = 0;
  while (tokens.length && pages < 40) {
    const tok = tokens[0];
    tokens = [];
    pages++;
    grab(await browse(cfgv, tok), tokens);
    await sleep(400);
  }
  return [...out.entries()].map(([id, title]) => ({ id, title }));
}

// The keyed path, for the day the project has quota to spare: playlistItems costs
// 1 unit per 50 videos against search.list's 100 per call, and videos.list another
// 1 per 50 for the durations. Same output shape, so nothing downstream notices.
async function apiPlaylist(pid, key) {
  const items = [];
  let page = "";
  do {
    const u = "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50" +
      "&playlistId=" + encodeURIComponent(pid) + "&key=" + key + (page ? "&pageToken=" + page : "");
    const r = await fetch(u);
    if (!r.ok) throw new Error("playlistItems HTTP " + r.status);
    const d = await r.json();
    for (const it of d.items || []) {
      const id = it.contentDetails && it.contentDetails.videoId;
      if (id) items.push({ id, title: (it.snippet && it.snippet.title) || "", secs: 0 });
    }
    page = d.nextPageToken || "";
  } while (page);
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50);
    const r = await fetch("https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=" +
      batch.map((v) => v.id).join(",") + "&key=" + key);
    if (!r.ok) throw new Error("videos HTTP " + r.status);
    const d = await r.json();
    const secs = new Map((d.items || []).map((v) => [v.id, iso8601(v.contentDetails.duration)]));
    for (const v of batch) v.secs = secs.get(v.id) || 0;
  }
  return items;
}

function iso8601(d) {
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(d || ""));
  if (!m) return 0;
  return Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0);
}

function cachePath(name) {
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
  return CACHE + "/" + name + ".json";
}

async function cachedPlaylist(pid) {
  const p = cachePath("pl-" + pid);
  if (!REFRESH && existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  const key = process.env.YOUTUBE_API_KEY;
  const v = key ? await apiPlaylist(pid, key) : await fetchPlaylist(pid);
  writeFileSync(p, JSON.stringify(v));
  return v;
}

async function playlistsOf(src) {
  if (src.uploads) return ["UU" + src.channel_id.slice(2)];
  if (src.playlists) return src.playlists.slice();
  if (src.playlists_tab) {
    const p = cachePath("tab-" + src.channel_id);
    let all;
    if (!REFRESH && existsSync(p)) all = JSON.parse(readFileSync(p, "utf8"));
    else {
      all = await fetchChannelPlaylists(src.channel_id);
      writeFileSync(p, JSON.stringify(all));
    }
    const re = new RegExp(src.playlists_tab);
    return all.filter((pl) => re.test(pl.title)).map((pl) => pl.id);
  }
  return [];
}

// ---------- the select gate ----------

function reOf(s, flags) { return s ? new RegExp(s, flags) : null; }

// "Reads like a bare exercise name": every word starts with a letter, nothing but
// letters, apostrophes and internal hyphens, and not too many of them. This is what
// separates "Cable Pull Through" from "Planks for Abs - Mostly a Waste" in a
// channel whose uploads are 95% talking-head shorts.
const PLAIN = /^[A-Za-z][A-Za-z'’]*(?:-[A-Za-z'’]+)*(?: [A-Za-z][A-Za-z'’]*(?:-[A-Za-z'’]+)*)*$/;

// A title that is selling something is not a demonstration of anything, and the
// clip behind it is a man pointing at a caption. Cheap, and it is the filter that
// keeps the automatic path honest.
const HOOK = /[?!]|\b(mistakes?|worst|best|never|stop|why|how|vs|versus|tips?|faults?|fix|fixes)\b/i;

function passes(src, v) {
  const sel = src.select || {};
  if (sel.title_re && !reOf(sel.title_re).test(v.title)) return false;
  const secs = Number(v.secs || 0);
  // An unknown duration on an uploads feed could be a 40-minute podcast; on a
  // hand-curated exercise playlist it is just a badge the page did not render.
  if (!secs && src.uploads) return false;
  if (secs && sel.max_secs && secs > sel.max_secs) return false;
  if (secs && sel.min_secs && secs < sel.min_secs) return false;
  const clean = cleanTitle(src, v.title);
  if (!clean) return false;
  if (sel.max_words && clean.split(/\s+/).length > sel.max_words) return false;
  if (sel.plain_title && !PLAIN.test(clean)) return false;
  // The hook test runs on the CLEANED title, because a house format can be a hook
  // word: every MuscleWiki demo is called "How to do a <thing>", and "how" is on
  // the list. What is left after the format is stripped is the claim the title is
  // actually making, and "Fix Your Squat" is still out.
  if (!src.no_hook_filter && HOOK.test(clean)) return false;
  return true;
}

function cleanTitle(src, title) {
  let t = String(title || "");
  for (const rx of src.strip || []) t = t.replace(reOf(rx, "i"), "");
  t = t.replace(/[\s|\-–—:]+$/, "").replace(/^[\s|\-–—:]+/, "").replace(/\s+/g, " ").trim();
  // What is left is a label under a video in the Explain sheet, and "How to do a
  // crunch" leaves "crunch". Only a title with no capital at all is touched, so
  // "GHD Sit-up" and "EZ Curl" keep the shape their creator gave them.
  if (t && !/[A-Z]/.test(t)) t = t.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return t;
}

// ---------- enumeration, with the snapshot as the offline floor ----------

async function loadSource(src) {
  const snap = SNAP_DIR + "/" + src.slug + ".json";
  if (src.manual) {
    if (!existsSync(src.manual)) return [];
    return JSON.parse(readFileSync(src.manual, "utf8")).filter((r) => r && r.video_id);
  }
  const mine = !ONLY || ONLY.has(src.slug);
  if (!mine || OFFLINE) {
    if (existsSync(snap)) return JSON.parse(readFileSync(snap, "utf8"));
    if (OFFLINE) { console.warn(src.slug + ": no snapshot and --offline, skipped"); return []; }
    return [];
  }
  let raw = null;
  try {
    const pids = await playlistsOf(src);
    raw = [];
    for (const pid of pids) raw.push(...await cachedPlaylist(pid));
  } catch (e) {
    // The snapshot is committed precisely so that a re-run without a network, or
    // from an IP YouTube does not like, still produces the same migration.
    if (!existsSync(snap)) throw e;
    console.warn(src.slug + ": enumeration failed (" + e.message + "), using the committed snapshot");
    return JSON.parse(readFileSync(snap, "utf8"));
  }
  const seen = new Set();
  const kept = [];
  for (const v of raw) {
    if (!v.id || seen.has(v.id)) continue;
    seen.add(v.id);
    if (!passes(src, v)) continue;
    kept.push({ id: v.id, secs: Number(v.secs || 0) || null, title: v.title });
  }
  kept.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!existsSync(SNAP_DIR)) mkdirSync(SNAP_DIR, { recursive: true });
  writeFileSync(snap, JSON.stringify(kept, null, 1) + "\n");
  console.log(src.slug + ": " + raw.length + " enumerated, " + kept.length + " pass the gate -> " + snap);
  return kept;
}

// ---------- text, copied from catalog.ts so the two cannot drift apart ----------
//
// normalizeText() and stem() are not exported, and exporting them would put a
// matching detail in the edge function's public surface for the sake of a tool
// that runs on a laptop. They are copied verbatim below, with the abbreviations
// a video title needs and the catalog's own model output does not: creators write
// "Pushup", "Flye" and "Skullcrusher" as one word.

const ABBREVIATIONS = {
  db: "dumbbell", dbs: "dumbbell", dumbell: "dumbbell", dumbells: "dumbbell",
  bb: "barbell", kb: "kettlebell", kbs: "kettlebell",
  bw: "bodyweight", bodywt: "bodyweight",
  ohp: "overhead press", rdl: "romanian deadlift", rdls: "romanian deadlift",
  sldl: "single leg deadlift", bss: "bulgarian split squat", dl: "deadlift",
  bp: "bench press", cgbp: "close grip bench press", rfe: "rear foot elevated",
  sl: "single leg", ttb: "toes to bar", t2b: "toes to bar",
  hspu: "handstand push up", tgu: "turkish get up", ghr: "glute ham raise",
  sdhp: "sumo deadlift high pull", mb: "medicine ball", wb: "wall ball",
  du: "double under", ohs: "overhead squat",
  // Added here, for titles rather than model output.
  flye: "fly", flyes: "fly", pushup: "push up", pushups: "push up",
  pullup: "pull up", pullups: "pull up", chinup: "chin up", chinups: "chin up",
  situp: "sit up", situps: "sit up", facepull: "face pull", facepulls: "face pull",
  skullcrusher: "skull crusher", skullcrushers: "skull crusher",
  triceps: "tricep", pulldown: "lat pulldown", pulldowns: "lat pulldown",
};
const ABBR_RE = new RegExp(
  "\\b(" + Object.keys(ABBREVIATIONS).sort((a, b) => b.length - a.length).join("|") + ")\\b",
  "g",
);

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "with", "to", "on", "in", "at",
  "into", "your", "you", "then", "from", "plus", "x", "ea", "each", "per",
  "rep", "reps", "set", "sets", "sec", "secs", "second", "seconds",
  "min", "mins", "minute", "minutes", "round", "rounds", "total",
  "exercise", "movement", "variation", "style",
]);

function normalizeText(s) {
  let t = " " + String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") + " ";
  t = t.replace(/\([^)]*\)/g, " ");
  t = t.replace(/\d+\s*[x×]\s*\d+/g, " ");
  t = t.replace(/\b\d+\s*(?:sec|secs|second|seconds|min|mins|minute|minutes|reps?|sets?)\b/g, " ");
  t = t.replace(/[^a-z0-9]+/g, " ");
  t = t.replace(/\b(?:1|one)\s+(arm|leg|side)\b/g, " single $1 ");
  t = t.replace(/\b(?:2|two)\s+(arm|leg)\b/g, " double $1 ");
  t = t.replace(/\b(?:each|per|every)\s+(?:side|leg|arm|hand)s?\b/g, " ");
  t = t.replace(/\bboth\s+sides?\b/g, " ");
  t = t.replace(/\b(?:alternating|alternate|alt)\b/g, " ");
  // "Lat Pulldown" would otherwise become "lat lat pulldown" once the expansion
  // below fires, so collapse it first and let the expansion put the lat back.
  t = t.replace(/\blat\s+pulldowns?\b/g, " pulldown ");
  // A title that ends in the muscle group is naming the muscle, not the movement:
  // MuscleWiki files "Standing Calves" where the catalog says "Calf Raise".
  t = t.replace(/\b(?:calves|claves)\s*$/g, " calf raise ");
  t = t.replace(ABBR_RE, (m) => " " + ABBREVIATIONS[m] + " ");
  return t.replace(/\s+/g, " ").trim();
}

function stem(w) {
  let t = w;
  if (t.length > 4 && t.endsWith("ies")) t = t.slice(0, -3) + "y";
  while (t.length > 3 && (t.endsWith("s") || t.endsWith("e"))) t = t.slice(0, -1);
  return t;
}

// Unlike catalog.ts's tokenize(), order and repeats are kept: containment asks
// whether a catalog phrase appears as a contiguous run, which a de-duplicated set
// cannot answer. Consecutive repeats are dropped, because an expansion can
// produce one and it is never meaningful.
function tokenSeq(s) {
  const out = [];
  for (const raw of normalizeText(s).split(" ")) {
    if (!raw || /^\d+$/.test(raw)) continue;
    if (STOPWORDS.has(raw)) continue;
    const t = stem(raw);
    if (t && out[out.length - 1] !== t) out.push(t);
  }
  return out;
}

// The bag-of-stems score from map-demos.mjs, used ONLY to order the review list.
// It never promotes anything on its own.
const SCORE_STOP = new Set(["the", "a", "an", "and", "or", "of", "for", "with", "to", "on", "in", "at", "your", "exercise"]);
function stems(s) {
  return [...new Set(String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").split(" ")
    .map((w) => (w.length > 4 && w.endsWith("ies") ? w.slice(0, -3) + "y" : w.replace(/(s|e)+$/, "")))
    .filter((w) => w && !SCORE_STOP.has(w)))];
}
function dice(a, b) {
  const B = new Set(b);
  let i = 0;
  for (const t of a) if (B.has(t)) i++;
  return a.length && b.length ? (2 * i) / (a.length + b.length) : 0;
}

// ---------- the catalog side of the index ----------

const BY_ID = new Map(CATALOG.map((e) => [e.id, e]));
const phraseIndex = new Map();       // "tok tok" -> Set(id)
const tokenEntries = new Map();      // tok -> Set(id), for the one-word rule
for (const e of CATALOG) {
  for (const s of [e.name, ...e.aliases]) {
    const seq = tokenSeq(s);
    if (!seq.length) continue;
    const k = seq.join(" ");
    if (!phraseIndex.has(k)) phraseIndex.set(k, new Set());
    phraseIndex.get(k).add(e.id);
    for (const t of seq) {
      if (!tokenEntries.has(t)) tokenEntries.set(t, new Set());
      tokenEntries.get(t).add(e.id);
    }
  }
}

// Words that cannot change which movement a title names. Stemmed, because that is
// what is left over after tokenSeq.
const NEUTRAL = new Set(["flat", "medium", "normal", "standard", "regular", "barbell", "dumbbell",
  "cable", "machine", "bodyweight", "seated", "standing", "bilateral"].map(stem));
// ... with one exception. "Machine Glute Kickback" is not "Donkey Kick" and
// "Barbell Hollow Hold" is not a hollow hold: a piece of equipment left over on a
// movement the catalog says needs none (or a different one) is the apparatus
// changing, not a synonym. Those go to review like any other variant.
const EQUIP_WORD = { barbell: "barbell", dumbbell: "dumbbells", cabl: "cables", machin: "machine" };

function containment(seq) {
  for (let len = seq.length; len >= 1; len--) {
    const ids = new Set();
    let matched = null;
    for (let i = 0; i + len <= seq.length; i++) {
      const run = seq.slice(i, i + len);
      const hit = phraseIndex.get(run.join(" "));
      if (!hit) continue;
      // A single word is a body part or a section header far more often than a
      // movement ("Legs", "Row", "Press"), so it only counts when the whole
      // catalog knows it from exactly one entry: "burpee", "clamshell", "shrug".
      if (len === 1 && (tokenEntries.get(run[0]) || new Set()).size !== 1) continue;
      for (const id of hit) ids.add(id);
      if (!matched) matched = { start: i, len };
    }
    if (!ids.size) continue;
    const leftover = seq.filter((_, i) => i < matched.start || i >= matched.start + matched.len);
    return { ids: [...ids], leftover };
  }
  return null;
}

function leftoverIsNeutral(id, leftover) {
  const entry = BY_ID.get(id);
  for (const t of leftover) {
    if (!NEUTRAL.has(t)) return false;
    const eq = EQUIP_WORD[t];
    if (eq && !(entry.equipment || []).includes(eq)) return false;
    if (t === "bodyweight" && (entry.equipment || []).length) return false;
  }
  return true;
}

// ---------- load every source ----------

const videos = [];       // { source, tier, label, channel_id, id, secs, title, clean, seq }
const counts = {};
for (const src of SOURCES) {
  const rows = await loadSource(src);
  counts[src.slug] = rows.length;
  for (const r of rows) {
    if (src.manual) {
      videos.push({
        src, source: src.slug, tier: src.tier, label: src.label, channel_id: src.channel_id,
        id: r.video_id, secs: r.secs || null, title: r.title || r.key, clean: r.title || r.key,
        manualKey: r.key, seq: [],
      });
      continue;
    }
    const clean = cleanTitle(src, r.title);
    videos.push({
      src, source: src.slug, tier: src.tier, label: src.label, channel_id: src.channel_id,
      id: r.id, secs: r.secs || null, title: r.title, clean, seq: tokenSeq(clean),
    });
  }
}

// ---------- the owner's standing decisions ----------

const prior = existsSync(REVIEW) ? JSON.parse(readFileSync(REVIEW, "utf8")) : { rows: [] };
const confirmed = new Map();     // video id -> catalog id
const rejected = new Set();      // video id
// A decided row is not regenerated — a confirmed video is no longer looking for a
// home, and a rejected one never reaches the candidate stage — so the file has to
// carry its own decisions forward or the second run would quietly forget them.
const decidedPrior = new Map();
for (const row of prior.rows || []) {
  if (row.reject) rejected.add(row.video_id);
  for (const c of row.candidates || []) if (c.confirm) confirmed.set(row.video_id, c.id);
  if (row.reject || (row.candidates || []).some((c) => c.confirm)) decidedPrior.set(row.video_id, row);
}

// ---------- matching ----------

const picks = new Map();         // catalog id -> [pick]
function add(key, v, method, leftover) {
  if (!BY_ID.has(key)) return false;
  if (!picks.has(key)) picks.set(key, []);
  picks.get(key).push({
    key, video_id: v.id, title: v.clean, channel: v.label, channel_id: v.channel_id,
    source: v.source, tier: v.tier, secs: v.secs, method, leftover: leftover ? leftover.length : 0,
  });
  return true;
}

const method = { exact: 0, contain: 0, confirmed: 0, manual: 0 };
const unmatched = [];            // videos with no automatic home
for (const v of videos) {
  if (v.manualKey) {
    if (add(v.manualKey, v, "manual", [])) method.manual++;
    else console.warn("manual.json: " + v.id + " names an unknown catalog id " + JSON.stringify(v.manualKey));
    continue;
  }
  if (rejected.has(v.id)) continue;
  const owner = confirmed.get(v.id);
  if (owner) { if (add(owner, v, "confirmed", [])) method.confirmed++; continue; }
  if (!v.src.review_only) {
    const m = canonicalize(v.clean);
    if (m && (m.method === "exact" || m.method === "key")) {
      if (add(m.id, v, "exact", [])) method.exact++;
      continue;
    }
    const c = containment(v.seq);
    if (c && c.ids.length === 1 && leftoverIsNeutral(c.ids[0], c.leftover)) {
      if (add(c.ids[0], v, "exact", c.leftover)) method.contain++;
      continue;
    }
  }
  unmatched.push(v);
}

// ---------- the review file ----------

const rows = [];
for (const v of unmatched) {
  const cands = [];
  const mine = stems(v.clean);
  const seen = new Set();
  // Containment already knows which entries the title literally names; those are
  // the candidates worth showing, and the score only orders them.
  const c = containment(v.seq);
  for (const id of (c ? c.ids : [])) seen.add(id);
  for (const e of CATALOG) {
    let best = 0, via = "";
    for (const n of [e.name, ...e.aliases]) {
      const d = dice(mine, stems(n));
      if (d > best) { best = d; via = n; }
    }
    if (best < REVIEW_FLOOR && !seen.has(e.id)) continue;
    cands.push({
      id: e.id, name: e.name, via,
      score: Number(best.toFixed(3)),
      why: seen.has(e.id) ? "names it, with " + (c.leftover.join(" ") || "nothing") + " left over" : "word overlap",
      confirm: false,
    });
  }
  if (!cands.length) continue;
  cands.sort((a, b) => (seen.has(b.id) ? 1 : 0) - (seen.has(a.id) ? 1 : 0) || b.score - a.score);
  rows.push({
    video_id: v.id, source: v.source, title: v.title, clean: v.clean, secs: v.secs,
    url: "https://www.youtube.com/watch?v=" + v.id,
    reject: false,
    candidates: cands.slice(0, 3),
  });
}
// One catalog id, three chances. Past that the file stops being finishable and a
// human stops finishing it, which is worse than a smaller file.
const perKey = new Map();
const trimmed = [];
for (const r of rows.sort((a, b) => b.candidates[0].score - a.candidates[0].score)) {
  const top = r.candidates[0].id;
  const n = perKey.get(top) || 0;
  // An id that already has its four clips does not need a human to find a fifth.
  if ((picks.get(top) || []).length >= MAX_PER_KEY) continue;
  if (n >= REVIEW_PER_KEY) continue;
  perKey.set(top, n + 1);
  trimmed.push(r);
}
trimmed.sort((a, b) => (a.candidates[0].id < b.candidates[0].id ? -1 : a.candidates[0].id > b.candidates[0].id ? 1 : 0) ||
  b.candidates[0].score - a.candidates[0].score);
// Decisions the owner already made survive even when the row no longer needs one.
for (const r of trimmed) {
  const id = confirmed.get(r.video_id);
  if (id) for (const c of r.candidates) if (c.id === id) c.confirm = true;
  if (rejected.has(r.video_id)) r.reject = true;
}
const open = trimmed.filter((r) => !decidedPrior.has(r.video_id));
const settled = [];
for (const [id, row] of decidedPrior) {
  const fresh = trimmed.find((r) => r.video_id === id);
  settled.push({ ...(fresh || row), done: true });
}
settled.sort((a, b) => {
  const ka = (a.candidates.find((c) => c.confirm) || {}).id || "";
  const kb = (b.candidates.find((c) => c.confirm) || {}).id || "";
  return (ka < kb ? -1 : ka > kb ? 1 : 0) || (a.video_id < b.video_id ? -1 : 1);
});

writeFileSync(REVIEW, JSON.stringify({
  note: "Set confirm:true on the ONE candidate that really is this exercise, or reject:true on " +
    "the row when none of them are, then re-run node tools/demo-videos.mjs run. Confirm only when " +
    "the clip shows the SAME movement: 'Medium Grip Bench Press' is a bench press, 'Wide Grip Bench " +
    "Press' is a different lift and belongs rejected. why:'names it' means the title literally " +
    "contains the catalog name and the words listed are what is left over; 'word overlap' is a " +
    "score and is the one to read carefully. Open url to watch the clip. Rows already decided are " +
    "kept at the end with done:true — that is how a decision survives the next run, so do not " +
    "delete them. Undecided rows come first; they are the to-do list.",
  generated: new Date().toISOString().slice(0, 10),
  open: open.length,
  decided: settled.length,
  rows: open.concat(settled),
}, null, 1) + "\n");

// ---------- ranking ----------

const RANK_METHOD = { exact: 0, manual: 0, confirmed: 1 };
const final = [];
for (const [key, list] of [...picks.entries()].sort()) {
  list.sort((a, b) =>
    a.tier - b.tier ||
    RANK_METHOD[a.method] - RANK_METHOD[b.method] ||
    a.leftover - b.leftover ||
    lenRank(a.secs) - lenRank(b.secs) ||
    (a.video_id < b.video_id ? -1 : a.video_id > b.video_id ? 1 : 0));
  const bySource = new Set();
  let rank = 0;
  for (const p of list) {
    // Two clips of the same movement from the same creator are the same clip
    // twice as far as a user is concerned; spend the four slots on four voices.
    if (bySource.has(p.source)) continue;
    bySource.add(p.source);
    if (rank >= MAX_PER_KEY) break;
    final.push({ ...p, rank: rank++ });
  }
}

function lenRank(secs) {
  // Shorter is better, but a four-second fragment is not a demonstration, so
  // anything under six seconds sorts behind every honest clip.
  if (!secs) return 1e6 + 1;
  return secs < MIN_USEFUL_SECS ? 1e6 + secs : secs;
}

// ---------- what the run found ----------

const covered = new Set(final.map((r) => r.key));
const bySource = {};
for (const r of final) bySource[r.source] = (bySource[r.source] || 0) + 1;
const keysBySource = {};
for (const r of final) {
  if (!keysBySource[r.source]) keysBySource[r.source] = new Set();
  keysBySource[r.source].add(r.key);
}

console.log("");
console.log("snapshots: " + SOURCES.map((s) => s.slug + " " + (counts[s.slug] || 0)).join(", "));
console.log("matched:   exact/alias " + method.exact + ", containment " + method.contain +
  ", owner-confirmed " + method.confirmed + ", manual " + method.manual);
console.log("coverage:  " + covered.size + " of " + CATALOG.length + " catalog ids have at least one clip");
console.log("by source: " + SOURCES.map((s) =>
  s.slug + " " + (bySource[s.slug] || 0) + " rows/" + ((keysBySource[s.slug] || new Set()).size) + " ids").join(", "));
console.log("rows:      " + final.length + " (max " + MAX_PER_KEY + " per id, one per source)");
console.log("review:    " + open.length + " open, " + settled.length + " decided -> " + REVIEW +
  " (" + confirmed.size + " confirmed, " + rejected.size + " rejected)");
const missing = CATALOG.filter((e) => !covered.has(e.id)).map((e) => e.id);
console.log("no clip (" + missing.length + "): " + missing.join(" "));

if (cmd === "plan") process.exit(0);

// ---------- the migration ----------

const q = (s) => (s === null || s === undefined ? "null" : "'" + String(s).replace(/'/g, "''") + "'");
const n = (v) => (v === null || v === undefined ? "null" : String(Math.round(Number(v))));

const blocks = [];
for (const src of SOURCES) {
  const mine = final.filter((r) => r.source === src.slug);
  if (!mine.length) {
    blocks.push("-- " + src.slug + ": nothing matched in this run.\n" +
      "delete from public.exercise_demo_videos where source = " + q(src.slug) + ";");
    continue;
  }
  const values = mine.map((r) => "  (" + [
    q(r.key), q(r.video_id), q(r.title), q(r.channel), q(r.channel_id), q(r.source),
    n(r.tier), n(r.secs), n(r.rank), q(r.method),
  ].join(", ") + ")").join(",\n");
  const pairs = mine.map((r) => "(" + q(r.key) + "," + q(r.video_id) + ")").join(", ");
  blocks.push("-- " + src.slug + " (" + src.label + "), tier " + src.tier + ": " +
    mine.length + " rows across " + new Set(mine.map((r) => r.key)).size + " exercises.\n" +
    "insert into public.exercise_demo_videos\n" +
    "  (key, video_id, title, channel, channel_id, source, tier, secs, rank, method)\n" +
    "values\n" + values + "\n" +
    "on conflict (key, video_id) do update set\n" +
    "  title = excluded.title, channel = excluded.channel, channel_id = excluded.channel_id,\n" +
    "  source = excluded.source, tier = excluded.tier, secs = excluded.secs,\n" +
    "  rank = excluded.rank, method = excluded.method;\n\n" +
    "delete from public.exercise_demo_videos\n" +
    " where source = " + q(src.slug) + " and (key, video_id) not in (\n  " + pairs + ");");
}

const sql = "-- Spotter — curated demonstration clips, seeded.\n" +
  "--\n" +
  "-- GENERATED FILE. Source of truth is tools/demo-videos.mjs plus the committed\n" +
  "-- snapshots in tools/demo-videos/; regenerate with:\n" +
  "--   node tools/demo-videos.mjs run\n" +
  "--\n" +
  "-- Every row is a clip from a creator on the allow-list in tools/demo-sources.json,\n" +
  "-- attached to a canonical exercise_catalog id offline. Nothing here was chosen by\n" +
  "-- YouTube search, and reading a row at request time costs no quota.\n" +
  "--\n" +
  "-- Snapshot sizes this run: " + SOURCES.map((s) => s.slug + " " + (counts[s.slug] || 0)).join(", ") + ".\n" +
  "-- How each row was matched: exact name or alias " + method.exact + ", catalog phrase with only\n" +
  "-- neutral words left over " + method.contain + ", owner-confirmed in tools/demo-videos-review.json " +
  method.confirmed + ",\n" +
  "-- hand-pasted " + method.manual + ". " + covered.size + " of " + CATALOG.length +
  " catalog ids have at least one clip.\n" +
  "--\n" +
  "-- Idempotent, and it converges: the insert upserts on (key, video_id), and the\n" +
  "-- delete after each block drops every row that source used to own and this run\n" +
  "-- did not produce. The prune is by (key, video_id) rather than by video_id alone\n" +
  "-- so a clip that moved from one exercise to another leaves no ghost behind.\n\n" +
  blocks.join("\n\n") + "\n";

writeFileSync(OUT, sql);
console.log("");
console.log(OUT + " written — " + final.length + " rows, " + sql.length.toLocaleString() + " bytes");

// Battery for the coach's half of the Video Context Pack.
//
// Run: deno run -A tools/pumpy-pack-harness.ts   — exits non-zero on failure.
//
// The owner watched Pumpy explain the close-grip push-ups out of @thewodfather's
// "Complex Fives" and said: "he reads the internet but does not reference the
// video with his explanation ... he does not reference how your hands should be
// on the kettlebell." Wave A put that on the card and in video_cache.pack; this
// wave puts it in front of the coach. What is checked here is the whole path from
// a stored row to the JSON the model reads — the shape of the slice, its ceiling,
// what it falls back to when nobody has read the video, that the static prompt is
// still byte-identical between turns, and that a borrowed exercise keeps the
// detail it was borrowed with.
//
// Nothing here calls a model or touches a network. `fetch` is replaced with a
// two-table in-memory PostgREST, so dbSelect — the real one, lifted out of
// index.ts — is exercised rather than stubbed past.
//
// The pack is DERIVED from briefs/vcp/golden-tt-7679960172495785246.json (copied
// into tools/fixtures/), hand-authored by the senior session from the real
// WebVTT and 1 fps frame strips. Its deltas are recomputed with the shipping
// deltaFrom rather than taken from the fixture's prose, because that is what
// assemblePack writes and this harness must measure what a real card costs.

import { deltaFrom, type Pack, PACK_V, secondsToMmss } from "../supabase/functions/spotter/pack.ts";

const ROOT = new URL("../", import.meta.url);
const SRC = await Deno.readTextFile(new URL("supabase/functions/spotter/index.ts", ROOT));

// ---------- lifting declarations out of index.ts ----------
//
// index.ts calls Deno.serve at the bottom and exports almost nothing, so the
// declarations under test are cut out of the source and imported as a module —
// the same walker tools/pack-harness.ts and tools/media-harness.ts use, with two
// extensions this file needed. It steps over an `export` keyword, because half of
// Pumpy's surface has one; and it no longer mistakes a brace in a RETURN TYPE for
// the opening brace of the body. `Promise<string | { error: string }>` is how
// every tool in this section says "or an error", and the old walker cut
// resolveHandle off at the end of its own signature.

/** Braces after these are type syntax, never a function body. */
const TYPE_BRACE = /[|&,:<]/;

function declEnd(src: string, from: number, isFunction: boolean): number {
  let depth = 0;
  let inBody = false;
  let openedParams = false;
  let closedParams = false;
  let prev = "";
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      prev = q;
      continue;
    }
    if (c === "/" && /[(,=:[!&|?{};+\-*%^~<>]/.test(prev)) {
      i++;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) break;
        i++;
      }
      prev = "/";
      continue;
    }
    if (c === "{" || c === "[" || c === "(") {
      if (c === "(" && depth === 0) openedParams = true;
      // The body opens after the parameter list has closed, and never where type
      // syntax is still being written.
      if (isFunction && c === "{" && depth === 0 && closedParams && !TYPE_BRACE.test(prev)) inBody = true;
      depth++;
    } else if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (c === ")" && depth === 0 && openedParams) closedParams = true;
      if (isFunction && inBody && depth === 0) return i + 1;
    } else if (!isFunction && c === ";" && depth === 0) return i + 1;
    if (!/\s/.test(c)) prev = c;
  }
  throw new Error("unterminated declaration at " + from);
}

const lifted = new Set<string>();

function lift(name: string): string {
  if (lifted.has(name)) return "";
  lifted.add(name);
  const re = new RegExp("^(export )?(?:async )?(function|const|let|type|class) " + name + "\\b", "m");
  const m = SRC.match(re);
  if (!m || m.index === undefined) {
    throw new Error("index.ts no longer declares " + name + " — this harness is out of date");
  }
  const text = SRC.slice(m.index, declEnd(SRC, m.index, m[2] === "function"));
  return text.startsWith("export ") ? text : "export " + text;
}

// The types the lifted code mentions and the two globals dbSelect reaches for.
// `rest` and `dbHeaders` are the seam the mock server is installed at: everything
// above them — the query strings, the owner scoping, the JSON — is the real code.
const STUBS = "import { applyCatalog as _ac, catalogById } from '" +
  new URL("supabase/functions/spotter/catalog.ts", ROOT).href + "';\n" +
  "import { normText } from '" + new URL("supabase/functions/spotter/evidence.ts", ROOT).href + "';\n" +
  "import { bestSeenFact, packInTimeOrder, sharesHeadNoun, secondsToMmss, PACK_V } from '" +
  new URL("supabase/functions/spotter/pack.ts", ROOT).href + "';\n" +
  "import { CATALOG } from '" + new URL("supabase/functions/spotter/catalog.ts", ROOT).href + "';\n" +
  "type Pack = Record<string, any>;\n" +
  "type PackExercise = Record<string, any>;\n" +
  "type Card = { blocks: { exercises: any[] }[] };\n" +
  "type Block = Record<string, any>;\n" +
  "type Exercise = Record<string, any>;\n" +
  "type Evidence = Record<string, unknown>;\n" +
  "type ExerciseSource = { workout_id: string; block_index: number; exercise_index: number };\n";

// Declaration order matters for the consts: PUMPY_STATIC is built at module
// evaluation out of the four vocabularies, the pain line and the catalog index.
const NAMES = [
  "CATEGORIES", "MUSCLES", "EQUIPMENT", "BLOCK_TYPES", "PAIN_NOTE", "CUE_MAX",
  "PUMPY_CATALOG_INDEX", "PUMPY_STATIC", "PUMPY_TOOL_STATUS",
  "PUMPY_CUE_CHARS", "PUMPY_DELTA_CHARS",
  "PUMPY_DETAIL_CHARS", "PUMPY_DETAIL_CUES", "PUMPY_DETAIL_SEEN", "PUMPY_QUOTE_CHARS",
  "PUMPY_MAX_REFS", "PUMPY_REF_CHARS", "WEEKDAYS",
  "utcMonday", "ymdUtc", "isUuid", "isHandle", "handleOf", "workoutIds", "resolveHandle",
  "deepCopy", "dbSelect",
  "matchPackExercise", "packEvidence", "applyPack",
  "pumpyShort", "compactExercise", "catalogMusclesOf", "toolGetWorkout",
  "pumpyPack", "pumpyVariant", "pumpyExerciseAt", "toolExerciseDetail", "pumpyFitDetail",
  "runPumpyTool",
  "pumpyExName", "pumpyFindInWorkout", "pumpyKeepsExercise", "pumpyFromHandle",
  "pumpyCitedInList", "pumpyAttachSources",
  "pumpyRefBlock", "pumpySystem",
];

// dbSelect's two collaborators, and the four sibling tools runPumpyTool can
// route to but that this file does not exercise — present so that a dispatch
// this harness did not expect fails loudly rather than silently returning
// undefined. Their absence from NAMES is what keeps the catalog search machinery
// out of a file about the pack.
const SHIM = "\n" +
  "globalThis.rest = function (t) { return 'https://db.test/rest/v1/' + t; };\n" +
  "globalThis.dbHeaders = {};\n" +
  // cleanTitle drags the whole title ladder behind it; the one behaviour the
  // citation walk needs from it is whitespace-collapsed trimming.
  "globalThis.cleanTitle = function (s) { return String(s || '').replace(/\\s+/g, ' ').trim(); };\n" +
  "for (const n of ['toolListLibrary', 'toolSearchCatalog', 'toolGetPlan', 'toolLogsSummary']) {\n" +
  "  globalThis[n] = function () { return { routed: n }; };\n" +
  "}\n";

const module = STUBS + SHIM + NAMES.map(lift).join("\n\n") + "\n";
const M = await import("data:application/typescript," + encodeURIComponent(module));

// ---------- the scoreboard ----------

let failures = 0;
let checks = 0;
function check(name: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) return;
  failures++;
  console.log("FAIL  " + name + (detail === undefined ? "" : "  — " + detail));
}
function eq(name: string, got: unknown, want: unknown) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    "got " + JSON.stringify(got) + ", wanted " + JSON.stringify(want));
}
/** The same four-characters-to-the-token rule index.ts prices its own prompts with. */
function tokens(v: unknown): number {
  return Math.ceil((typeof v === "string" ? v : JSON.stringify(v)).length / 4);
}

// ---------- the fixture, and the pack built from it ----------

type GoldenExercise = {
  i: number;
  name_said: string;
  name_shown: string;
  canonical_id: string;
  t0: number; t1: number;
  reps_seen: number | null;
  variant: Record<string, unknown>;
  setup: string;
  execution: string;
  creator_cues: { t: number; quote: string }[];
  seen_not_said: string[];
  provenance: Record<string, string>;
  confidence: number;
};
type Golden = {
  shortcode: string; platform: string; duration_s: number;
  session: Record<string, unknown>;
  transcript: { t0: number; t1: number; text: string }[];
  exercises: GoldenExercise[];
  card_expectations: { title: string; cues: string[] };
};

const FX = JSON.parse(
  await Deno.readTextFile(new URL("tools/fixtures/golden-tt-7679960172495785246.json", ROOT)),
) as Golden;

const PACK: Pack = {
  pack_v: PACK_V,
  shortcode: FX.shortcode,
  platform: FX.platform,
  duration_s: FX.duration_s,
  visual: "read",
  reader: "luna_sheets",
  session: { ...FX.session, load_seen: null } as Pack["session"],
  transcript_source: "tiktok_vtt",
  transcript: FX.transcript,
  on_screen: [],
  exercises: FX.exercises.map((e) => ({
    i: e.i,
    name_said: e.name_said,
    name_shown: e.name_shown,
    canonical_id: e.canonical_id,
    t0: e.t0,
    t1: e.t1,
    reps_seen: e.reps_seen,
    variant: e.variant,
    // The shipping rule, not the fixture's prose: "with kettlebell", not the
    // sentence a person wrote about it. A measurement of a card nobody ships is
    // not a measurement.
    delta_from_standard: deltaFrom(e.canonical_id, e.variant as never),
    setup: e.setup,
    execution: e.execution,
    creator_cues: e.creator_cues,
    seen_not_said: e.seen_not_said,
    provenance: e.provenance,
    confidence: e.confidence,
    needs_requery: false,
  })) as unknown as Pack["exercises"],
};

// ---------- the library the coach is reading ----------

const UID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const W_PACK = "11111111-aaaa-4aaa-8aaa-111111111111";
const W_BARE = "22222222-bbbb-4bbb-8bbb-222222222222";
const W_STAMPED = "33333333-cccc-4ccc-8ccc-333333333333";

/** The five movements as the creator named them, with the cues extraction should write. */
function wodfatherExercises(): any[] {
  return FX.exercises.map((e, i) => ({
    name: e.name_said.replace(/\b\w/g, (c) => c.toUpperCase()),
    canonical_id: e.canonical_id,
    sets: null, reps: "5", duration_seconds: null, rest_seconds: null,
    weight: null, equipment: "kettlebell",
    cue: FX.card_expectations.cues[i] ?? null,
    notes: FX.card_expectations.cues[i] ?? null,
    evidence: null,
  }));
}

/** One more ordinary exercise, so the card is the six the brief asks about. */
function sixth(): any {
  return {
    name: "Plank Hold", canonical_id: "plank", sets: 1, reps: null,
    duration_seconds: 60, rest_seconds: null, weight: null, equipment: null,
    cue: "Squeeze the glutes and do not let the hips sag. Elbows under the shoulders.",
    notes: "Squeeze the glutes and do not let the hips sag. Elbows under the shoulders.",
    evidence: null,
  };
}

const packCard = [{
  title: "Complex", type: "amrap", rounds: null, rest_seconds: null,
  exercises: [...wodfatherExercises(), sixth()],
}];

// A card from a video nobody has read: no overlay, but the one checked line
// packEvidence would have put there if a pack HAD been built. This is what most
// of the library looks like today.
const bareCard = [{
  title: null, type: "straight", rounds: null, rest_seconds: null,
  exercises: [{
    name: "Close Grip Pushups", canonical_id: "diamond-push-up",
    sets: 3, reps: "10", duration_seconds: null, rest_seconds: null,
    weight: null, equipment: null,
    cue: "Take these slow and controlled.",
    notes: "Take these slow and controlled.",
    evidence: {
      source: "transcript", line: null, offset: null,
      quote: "take these slow and controlled so that we get time under tension",
      t: 15, slide: null, verified: true,
    },
  }],
}];

// The same WODfather card as it looks after the ingest stamped it — what
// pumpyAttachSources reads when the coach cites this workout.
const stampedCard = JSON.parse(JSON.stringify(packCard));
M.applyPack({ blocks: stampedCard }, PACK);

const DB: Record<string, any[]> = {
  workouts: [
    {
      id: W_PACK, user_id: UID, title: "Complex Fives", author: "thewodfather", platform: "tiktok",
      shortcode: FX.shortcode, category: "Strength", muscle_groups: ["full body"], equipment: ["kettlebell"],
      duration_minutes: 15, favorite: true, notes: null, ingest_status: "ready", blocks: packCard,
    },
    {
      id: W_BARE, user_id: UID, title: "Old Save", author: "someone", platform: "instagram",
      shortcode: "ig-nopack", category: "Strength", muscle_groups: ["chest"], equipment: [],
      duration_minutes: 10, favorite: false, notes: null, ingest_status: "ready", blocks: bareCard,
    },
    {
      id: W_STAMPED, user_id: UID, title: "Complex Fives (stamped)", author: "thewodfather", platform: "tiktok",
      shortcode: "tt-stamped", category: "Strength", muscle_groups: ["full body"], equipment: ["kettlebell"],
      duration_minutes: 15, favorite: false, notes: null, ingest_status: "ready", blocks: stampedCard,
    },
  ],
  video_cache: [
    { shortcode: FX.shortcode, pack_v: PACK_V, pack: PACK, v: 1 },
    // The same clip at a shape this code cannot read. It must be invisible, not
    // half-read: a pack_v bump means the fields moved.
    { shortcode: "tt-futureshape", pack_v: PACK_V + 1, pack: PACK, v: 1 },
  ],
};

// ---------- a two-table PostgREST, in memory ----------

const queries: string[] = [];

function matchesFilter(row: any, key: string, spec: string): boolean {
  if (["select", "order", "limit", "offset"].includes(key)) return true;
  const val = row[key];
  if (spec.startsWith("eq.")) return String(val) === spec.slice(3);
  if (spec.startsWith("neq.")) return String(val) !== spec.slice(4);
  if (spec.startsWith("gte.")) return Number(val) >= Number(spec.slice(4));
  if (spec.startsWith("lte.")) return Number(val) <= Number(spec.slice(4));
  if (spec.startsWith("in.")) {
    return spec.slice(3).replace(/^\(|\)$/g, "").split(",").includes(String(val));
  }
  throw new Error("the mock server does not speak " + key + "=" + spec);
}

globalThis.fetch = ((input: string | URL | Request) => {
  const url = new URL(String(input));
  const table = url.pathname.split("/").filter(Boolean).pop() ?? "";
  queries.push(table + "?" + url.searchParams.toString());
  const rows = DB[table];
  if (!rows) return Promise.resolve(new Response("no such table " + table, { status: 404 }));
  const filters = [...url.searchParams.entries()];
  const hit = rows.filter((r) => filters.every(([k, v]) => matchesFilter(r, k, v)));
  return Promise.resolve(new Response(JSON.stringify(hit), {
    status: 200, headers: { "content-type": "application/json" },
  }));
}) as typeof fetch;

const H_PACK = M.handleOf(W_PACK);
const H_BARE = M.handleOf(W_BARE);
const H_STAMPED = M.handleOf(W_STAMPED);

// ---------- 1. what a card costs the coach now ----------
//
// The brief's ceiling: the cue and the delta together may add under 120 tokens to
// a six-exercise get_workout. The measurement is the real tool result against the
// same result with the two new keys removed, so it cannot drift from what ships.

const full = await M.toolGetWorkout(UID, H_PACK);

function withoutTheNewFields(card: any): any {
  const copy = JSON.parse(JSON.stringify(card));
  for (const b of copy.blocks) {
    for (const e of b.exercises) { delete e.cue; delete e.delta; }
  }
  return copy;
}

const beforeTok = tokens(withoutTheNewFields(full));
const afterTok = tokens(full);
const grew = afterTok - beforeTok;
console.log("get_workout on a 6-exercise card: " + beforeTok + " → " + afterTok +
  " tokens (+" + grew + ")");

check("a 6-exercise get_workout grows by under 120 tokens", grew < 120, "grew by " + grew);
eq("the card really is six exercises", full.blocks[0].exercises.length, 6);

{
  const exs = full.blocks[0].exercises;
  eq("the first exercise carries the creator's coaching point, one sentence of it",
    exs[0].cue, "Slow and controlled for time under tension, core tight.");
  // The pack read the hands off the frames; the card's own cue says it too, but
  // the delta is the part that says "this is not the movement in the book".
  eq("nothing on the card carries a null cue key",
    exs.filter((e: any) => "cue" in e && e.cue === null).length, 0);
  eq("an exercise with no delta has no delta key at all",
    exs.filter((e: any) => "delta" in e).length,
    exs.filter((e: any) => e.delta).length);
  eq("a two-sentence cue that already fits is left whole",
    exs[5].cue, "Squeeze the glutes and do not let the hips sag. Elbows under the shoulders.");
  // The second exercise's cue has no sentence end inside the budget, so it is cut
  // at the semicolon's clause instead of mid-word.
  eq("a cue with no sentence end inside the budget is cut at a clause",
    exs[1].cue, "Take your time so the legs do not add momentum");
  check("no cue on the card is cut mid-word",
    exs.every((e: any) => !e.cue || FX.card_expectations.cues.concat([sixth().cue])
      .some((c) => c.startsWith(e.cue))),
    JSON.stringify(exs.map((e: any) => e.cue)));
}

// The cutter itself, at the boundaries the card actually hits.
eq("a short cue is left exactly as it is", M.pumpyShort("Chest to the bell.", 78), "Chest to the bell.");
eq("an empty cue is null, not an empty string", M.pumpyShort("   ", 78), null);
eq("a cue with no punctuation inside the budget stops at a word",
  M.pumpyShort("drive the ground away from you and finish tall with the bell overhead", 30),
  "drive the ground away from");
eq("a cue whose first sentence is a stub does not become two words",
  M.pumpyShort("Go. Then brace the trunk hard and press the floor away from you slowly", 40),
  "Go. Then brace the trunk hard and press");

// ---------- 2. one exercise, in full ----------

const detail = await M.runPumpyTool(UID, "get_exercise_detail", { id: H_PACK, block: 0, index: 0 });

console.log("get_exercise_detail slice: " + JSON.stringify(detail).length + " chars, " +
  tokens(detail) + " tokens");

check("the slice stays inside its ~200-token ceiling", tokens(detail) <= 205, tokens(detail) + " tokens");
check("the slice stays inside its character cap",
  JSON.stringify(detail).length <= M.PUMPY_DETAIL_CHARS, JSON.stringify(detail).length + " chars");

eq("the slice names the movement", detail.name, "Close Grip Push Ups");
eq("the slice carries the catalog key", detail.canonical_id, "diamond-push-up");
eq("the slice names the creator", detail.author, "thewodfather");
eq("the slice names the card", detail.title, "Complex Fives");
eq("the slice names the platform", detail.source_platform, "tiktok");
eq("the slice says the video was read", detail.video_read, true);

// The owner's sentence, in one check: the hands are on the kettlebell.
check("the slice says where the hands were",
  /kettlebell handle/.test(String(detail.as_performed?.hand_placement)),
  JSON.stringify(detail.as_performed?.hand_placement));
eq("the slice carries the equipment the camera saw", detail.as_performed?.equipment, ["kettlebell"]);
check("the slice says how this differed from the standard version",
  /kettlebell/.test(String(detail.delta)), JSON.stringify(detail.delta));
check("an empty overlay field is absent rather than null",
  !("load_position" in (detail.as_performed ?? {})), JSON.stringify(detail.as_performed));

// The creator's own words, verbatim, with a clock on them.
eq("the first creator cue is the creator's, word for word",
  detail.creator_cues[0].quote, FX.exercises[0].creator_cues[0].quote);
eq("the cue carries the moment it was said, ready to print", detail.creator_cues[0].t, "0:15");
check("every quote in the slice is a substring of the video's own transcript",
  detail.creator_cues.every((c: any) =>
    FX.transcript.some((s) => s.text.toLowerCase().includes(String(c.quote).toLowerCase()))),
  JSON.stringify(detail.creator_cues));
check("the slice carries what the camera saw and nobody said",
  detail.seen_not_said.some((s: string) => /kettlebell handle|not the floor/.test(s)),
  JSON.stringify(detail.seen_not_said));
eq("the slice says when in the video this happens", [detail.t0, detail.t1], ["0:11", "0:25"]);

// What a full slice pays for, and in what order it gives things up. On this video
// the overlay alone is a third of the budget, so the prose goes: first the pack's
// own written-out setup and execution, then the card's paraphrase of a line that
// is still here verbatim. Nothing checked is ever traded for something written.
{
  eq("the pack's written-out execution is the first thing shed", detail.execution, null);
  eq("and its setup the second", detail.setup, null);
  eq("the card's paraphrase goes before a verbatim quote does", detail.cue, null);
  check("but the creator's own words survive", detail.creator_cues.length >= 1);
  check("and so does what the camera saw", detail.seen_not_said.length >= 1);

  // The same shedding on something that fits: nothing is given up at all.
  const roomy = M.pumpyFitDetail({
    name: "Plank Hold", canonical_id: "plank", as_performed: null, delta: null,
    cue: "Squeeze the glutes.", creator_cues: [{ t: "0:04", quote: "do not let the hips sag" }],
    seen_not_said: [], setup: "Elbows under the shoulders.", execution: "Hold.",
    t0: "0:04", t1: "1:04", author: "a", title: "b", source_platform: "tiktok", video_read: true,
  });
  eq("a slice that fits keeps every part of itself",
    [roomy.setup, roomy.execution, roomy.cue],
    ["Elbows under the shoulders.", "Hold.", "Squeeze the glutes."]);
}

// Every exercise of the card answers, not only the one the brief names.
for (let i = 0; i < 5; i++) {
  const d = await M.toolExerciseDetail(UID, { id: H_PACK, block: 0, index: i });
  check("exercise " + i + " of the pack card answers with the video read", d.video_read === true,
    JSON.stringify(d.error ?? d.video_read));
  check("exercise " + i + "'s slice stays inside the ceiling", tokens(d) <= 205, tokens(d) + " tokens");
}
{
  // The sixth has no segment in the pack — it is not in the video at all — and
  // must say so rather than borrow the nearest one.
  const d = await M.toolExerciseDetail(UID, { id: H_PACK, block: 0, index: 5 });
  eq("an exercise the camera never saw does not claim a reading", d.video_read, false);
  eq("and does not borrow another movement's overlay", d.as_performed, null);
  eq("but still carries its own cue", d.cue, "Squeeze the glutes and do not let the hips sag. Elbows under the shoulders.");
}

// ---------- 3. the fallback: a card from a video nobody read ----------

const bare = await M.runPumpyTool(UID, "get_exercise_detail", { id: H_BARE, block: 0, index: 0 });

eq("with no pack the slice says the video was not read", bare.video_read, false);
eq("with no pack there is no overlay to show", bare.as_performed, null);
eq("with no pack there is no delta to claim", bare.delta, null);
eq("the card's own cue still comes back", bare.cue, "Take these slow and controlled.");
eq("the one checked line the card carries is still quoted",
  bare.creator_cues[0].quote, "take these slow and controlled so that we get time under tension");
eq("and still carries the moment it was said", bare.creator_cues[0].t, "0:15");
eq("the slice still names the creator and the card", [bare.author, bare.title], ["someone", "Old Save"]);
check("the fallback slice is well under the ceiling", tokens(bare) <= 205, tokens(bare) + " tokens");

{
  // A pack written at a shape this code does not know is not a pack it may read.
  const future = await M.pumpyPack("tt-futureshape");
  eq("a pack from a newer shape is invisible", future, null);
  eq("a shortcode nobody has read is null", await M.pumpyPack("tt-never-seen"), null);
}

// ---------- 4. addressing, and owner scoping ----------

{
  const byName = await M.toolExerciseDetail(UID, { id: H_PACK, name: "kettlebell swings" });
  eq("a model that spells the movement instead of counting still gets it",
    byName.name, "Kettlebell Swings");

  const wrong = await M.toolExerciseDetail(UID, { id: H_PACK, block: 4, index: 9 });
  check("a position that is not there says where the exercises are",
    /block 0 has 6/.test(String(wrong.error)), JSON.stringify(wrong.error));

  const notMine = await M.toolExerciseDetail(OTHER, { id: H_PACK, block: 0, index: 0 });
  check("another user's workout is not in this library", !!notMine.error, JSON.stringify(notMine));

  const nonsense = await M.toolExerciseDetail(UID, { id: "not-an-id", block: 0, index: 0 });
  check("a made-up id is refused rather than guessed at", !!nonsense.error, JSON.stringify(nonsense));

  // Every query this tool sent carried the owner in it, or carried no user at all
  // because it was the global cache.
  const mine = queries.filter((q) => q.startsWith("workouts?"));
  check("every workouts read is scoped to a user",
    mine.every((q) => q.includes("user_id=eq.")), mine.find((q) => !q.includes("user_id=eq.")) ?? "");
  check("the pack is read from the global cache by shortcode alone",
    queries.some((q) => q.startsWith("video_cache?shortcode=eq.")), queries.join(" | "));
}

// ---------- 5. the routing ----------

eq("the coach can reach the new tool by name",
  typeof (await M.runPumpyTool(UID, "get_exercise_detail", { id: H_PACK, block: 0, index: 0 })).name,
  "string");
check("an unknown tool name lists the new one among the real ones",
  /get_exercise_detail/.test(String((await M.runPumpyTool(UID, "nope", {})).error)),
  String((await M.runPumpyTool(UID, "nope", {})).error));
check("the user is told what the coach is doing while it runs",
  typeof M.PUMPY_TOOL_STATUS.get_exercise_detail === "string" &&
  !/loading/i.test(M.PUMPY_TOOL_STATUS.get_exercise_detail),
  JSON.stringify(M.PUMPY_TOOL_STATUS.get_exercise_detail));

// ---------- 6. the static prompt is still static ----------
//
// The whole cache argument rests on this: OpenAI caches the longest common prefix
// of a request, so the moment a date or a row appears above the fence, every turn
// pays full price for everything below it. Two turns, a day and a library apart.

{
  const a = M.pumpySystem(new Date("2026-09-15T09:00:00Z"), [], "LIBRARY — empty; nothing saved yet.");
  const b = M.pumpySystem(new Date("2026-11-02T22:10:00Z"), [DB.workouts[0]], "LIBRARY (1 ready)\nh111111 | Complex Fives");
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common++;
  check("two turns a month apart share a prefix at least as long as the static half",
    common >= M.PUMPY_STATIC.length, common + " characters shared, static is " + M.PUMPY_STATIC.length);
  eq("and that prefix is the static half exactly", a.slice(0, M.PUMPY_STATIC.length), M.PUMPY_STATIC);

  check("the static half is past OpenAI's 1,024-token cache minimum",
    tokens(M.PUMPY_STATIC) >= 1024, tokens(M.PUMPY_STATIC) + " tokens");
  check("nothing dated leaked into the static half",
    !/Today is|\d{4}-\d{2}-\d{2}/.test(M.PUMPY_STATIC),
    (M.PUMPY_STATIC.match(/Today is|\d{4}-\d{2}-\d{2}/) ?? [""])[0]);
  check("the tool is declared to the model",
    M.PUMPY_STATIC.includes("- get_exercise_detail {id, block, index}"));
  check("and the rule that makes it fire is there, in the owner's terms",
    M.PUMPY_STATIC.includes("call get_exercise_detail first") &&
    M.PUMPY_STATIC.includes("Never describe equipment or hand placement the detail does not contain"));
  check("the rule tells the coach to say when the video did not show something",
    M.PUMPY_STATIC.includes("say plainly when the video did not show something"));
  console.log("PUMPY_STATIC: " + M.PUMPY_STATIC.length + " chars, " + tokens(M.PUMPY_STATIC) + " tokens");
}

// ---------- 7. a borrowed exercise keeps what it was borrowed with ----------
//
// "If Pumpy uses one of the videos in his workout that that person has saved,
// then I want Pumpy to cite that video." The citation already carried the quote.
// What it did not carry was the reason the owner asked for any of this: a push
// press lifted out of a kettlebell complex is THAT push press — two hands on one
// bell, from the goblet position — and a card that kept the footnote and dropped
// the hand placement puts the coach straight back where it started.

{
  const written = [
    { name: "Push Press", from: H_STAMPED, sets: 3, reps: "5" },
    { name: "Goblet Squats", from: H_STAMPED, sets: 3, reps: "10", cue: "Sit between the heels." },
    { name: "Turkish Get-Up", from: H_STAMPED, sets: 2, reps: "3" },
  ];
  const blocks = [{
    title: null, type: "straight", rounds: null, rest_seconds: null,
    exercises: written.map((e) => ({
      name: e.name, canonical_id: e.name === "Push Press" ? "push-press" : e.name === "Goblet Squats" ? "goblet-squat" : null,
      sets: e.sets, reps: e.reps, duration_seconds: null, rest_seconds: null,
      weight: null, equipment: null, cue: e.cue ?? null, notes: e.cue ?? null, evidence: null,
    })),
  }];
  await M.pumpyAttachSources(UID, blocks, M.pumpyCitedInList(written));
  const [press, squat, getup] = blocks[0].exercises;

  eq("the citation resolved to the workout it named", press.source?.workout_id, W_STAMPED);
  check("the borrowed exercise keeps the creator's evidence", !!press.evidence, JSON.stringify(press.evidence));
  check("and the hand placement the camera saw comes with it",
    /goblet|both hands|two/i.test(JSON.stringify(press.as_performed)), JSON.stringify(press.as_performed));
  eq("and the moment of the video it was lifted from",
    [press.t0, press.t1], [FX.exercises[4].t0, FX.exercises[4].t1]);
  eq("a borrowed exercise with no line of its own takes the creator's cue",
    press.cue, FX.card_expectations.cues[4]);
  eq("but a line the coach wrote itself is left alone", squat.cue, "Sit between the heels.");
  check("and the squat still gains the overlay it did not have",
    !!squat.as_performed, JSON.stringify(squat.as_performed));
  eq("a movement that is not in the cited workout loses its citation, not its place",
    [getup.source ?? null, getup.name], [null, "Turkish Get-Up"]);
  eq("and gains nothing it was not owed", [getup.as_performed ?? null, getup.delta ?? null], [null, null]);
}

// ---------- done ----------

console.log((failures ? "FAILED " : "ok ") + (checks - failures) + "/" + checks + " checks");
if (failures) Deno.exit(1);

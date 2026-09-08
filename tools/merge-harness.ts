// Battery for the reprocess merge — the promise that tapping ↻ can only ever make
// a card better.
//
// Run: deno run --allow-read tools/merge-harness.ts   — exits non-zero on failure.
//
// The incident this exists to stop from coming back (function logs, 2026-09-06
// 03:04 UTC, a nine-slide TikTok):
//
//   vision: reading 9 of 9 slide(s) — caption gave 0 exercise(s), 0 without a dose
//   vision: merged → exercises 0/4, doses filled 0, matched 0
//
// The stored card had SEVEN exercises, five of them with reps. That re-read's
// caption pass returned nothing at all (model variance, not a quota), the slides
// gave four, and `mergeNoDowngrade` only protected the card when the re-run came
// back COMPLETELY empty — so four overwrote seven and three movements the user
// already had were deleted by a retry button. Nothing in the logs said so.
//
// So what is asserted here is the merge as an exercise-level guarantee:
//
//   1. THE INVARIANT. Never fewer exercises than the stored card had, and every
//      stored movement still present afterwards — over the live 7/4 case, a
//      re-read that found more, a block that vanished, an empty re-read, and a few
//      hundred generated pairs.
//   2. PRECEDENCE. The fresh read wins field by field wherever it has a value; the
//      stored card fills only what the fresh read left empty. Both directions are
//      checked, because either one alone is a rule that loses data.
//   3. MATCHING. The catalog id first (so "BSS" and "Rear Foot Elevated Split
//      Squat" are one movement), then `nameKey` for the case, punctuation and
//      plural the catalog does not know, then one claim per fresh row so a card
//      that really did have the same movement twice keeps both.
//   4. POSITION. A kept exercise stays in its own block, between the same
//      neighbours; an exercise whose block is gone lands in the block that now
//      holds its position, and that block does not inherit the dead one's rounds.
//   5. THE LOG LINE, verbatim, because it is the whole reason the next one of
//      these is diagnosable.
//   6. THE SCORE. A merge that pulled rows forward may not lower the number
//      attached to the card either.
//
// The functions are lifted OUT OF index.ts rather than copied in — a copy would
// pass forever after the shipping code broke, which is the one failure mode a
// harness must not have. `lift`/`declEnd` are the same pair tools/vision-harness.ts
// and tools/media-harness.ts use, and for the same reason: index.ts calls
// Deno.serve at the bottom and exports almost nothing, so the named top-level
// declarations are pulled out, assembled into one module with stubs for the paid
// and database edges, and imported as a data: URL, which Deno type-strips like any
// other TypeScript. The catalog and the confidence merge are imported for real:
// both are pure, and both are half of what is being tested.

const ROOT = new URL("../", import.meta.url);
const SRC = await Deno.readTextFile(new URL("supabase/functions/spotter/index.ts", ROOT));
const CATALOG = new URL("supabase/functions/spotter/catalog.ts", ROOT).href;
const EVIDENCE = new URL("supabase/functions/spotter/evidence.ts", ROOT).href;

// ---------- lifting declarations out of index.ts ----------

/**
 * Where the top-level declaration starting at `from` ends.
 *
 * A brace counter that did not know about strings would stop early on every
 * template literal and regex in the source, so this walks the characters
 * properly: quotes, template literals, both comment shapes, and regex literals
 * (told from division by the character before the slash, the standard heuristic).
 *
 * A function ends at the brace that closes its body; everything else ends at the
 * semicolon at depth zero. A brace at depth zero that follows a colon opens a
 * RETURN TYPE, not a body — `function f(): { a: 1 } {` would otherwise be cut off
 * at the end of its own annotation, and the result parses.
 */
function declEnd(src: string, from: number, isFunction: boolean): number {
  let depth = 0;
  let inBody = false;
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
      if (isFunction && c === "{" && depth === 0 && prev !== ":") inBody = true;
      depth++;
    } else if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (isFunction && inBody && depth === 0) return i + 1;
    } else if (!isFunction && c === ";" && depth === 0) return i + 1;
    if (!/\s/.test(c)) prev = c;
  }
  throw new Error("unterminated declaration at " + from);
}

const lifted = new Set<string>();

/** One named top-level declaration, verbatim, exported. */
function lift(name: string): string {
  if (lifted.has(name)) return "";
  lifted.add(name);
  const re = new RegExp("^(?:async )?(function|const|let|type|class) " + name + "\\b", "m");
  const m = SRC.match(re);
  if (!m || m.index === undefined) {
    throw new Error("index.ts no longer declares " + name + " — this harness is out of date");
  }
  return "export " + SRC.slice(m.index, declEnd(SRC, m.index, m[1] === "function"));
}

// ---------- the edges the lifted code is not allowed to have ----------
//
// Everything around the merge that would drag in the extraction ladder, the
// catalog pass or the scorer. `harness.score` is the dial the confidence tests
// turn: what the re-score of the merged card would have said.

const STUBS = "import { canonicalize } from " + JSON.stringify(CATALOG) + ";\n" +
  "import { mergeConfidence } from " + JSON.stringify(EVIDENCE) + ";\n" + `
export { canonicalize };

type Chapter = unknown;
type Evidence = { source: string };
type Confidence = { score: number; parts: Record<string, number | boolean>; notes: string[] };

export const harness = {
  // what the re-score of the merged card comes back with
  score: 0.4,
  parts: {} as Record<string, number | boolean>,
  // proof that the catalog pass still runs after the merge and not before it
  catalogSawNames: [] as string[],
};

function applyCatalog(card: any): any {
  harness.catalogSawNames = (card.blocks ?? [])
    .flatMap((b: any) => (b.exercises ?? []).map((e: any) => e.name));
  return card;
}
function heuristicCard(_meta: any, _platform: string, _title: string): any {
  return { blocks: [] };
}
function scoreAndStamp(card: any, _meta: any, _platform: string, _heuristic: number): Confidence {
  card.confidence = harness.score;
  card.confidence_parts = { ...harness.parts };
  card.confidence_notes = [];
  return { score: harness.score, parts: { ...harness.parts }, notes: [] };
}
`;

const NAMES = [
  // types
  "ExerciseSource", "Exercise", "Block", "Card", "Meta", "Rescue",
  // the shared helpers the merge reuses
  "countExercises", "nameKey", "fillEmptyDose",
  // the merge itself
  "storedExercise", "storedBlocks", "doseOf", "homeFor", "keepWhatTheReRunDropped",
  "bothExtractors", "mergeNoDowngrade",
];

// ---------- what the assembled module is allowed to be asked for ----------
//
// A data: URL import has no types of its own, so this is where the shapes are
// stated. It is not decoration: writing them out is what lets `deno check
// tools/merge-harness.ts` catch a call this file gets wrong.

type Ex = {
  name: string;
  canonical_id: string | null;
  sets: number | null;
  reps: string | null;
  duration_seconds: number | null;
  rest_seconds: number | null;
  weight: string | null;
  equipment: string | null;
  notes: string | null;
  evidence?: { source: string } | null;
};
type Blk = {
  title: string | null; type: string;
  rounds: number | null; rest_seconds: number | null; exercises: Ex[];
};
type Crd = {
  title: string; category: string; muscle_groups: string[]; equipment: string[];
  difficulty: string | null; duration_minutes: number | null; calories: number | null;
  tags: string[]; has_full_workout: boolean; blocks: Blk[];
  confidence?: number | null;
  confidence_parts?: Record<string, number | boolean>;
  confidence_notes?: string[];
  extracted_by?: string | null;
};

type Lifted = {
  canonicalize(name: string): { id: string } | null;
  harness: { score: number; parts: Record<string, number | boolean>; catalogSawNames: string[] };
  nameKey(name: string): string;
  countExercises(card: Crd): number;
  mergeNoDowngrade(old: unknown, next: Crd, meta: unknown, platform: string): Crd;
};

const module = STUBS + "\n" + NAMES.map(lift).join("\n\n") + "\n";
const M = await import("data:application/typescript," + encodeURIComponent(module)) as Lifted;

// ---------- the scoreboard ----------

const say = console.log.bind(console);
let failures = 0;
let checks = 0;
function check(name: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) return;
  failures++;
  say("FAIL  " + name + (detail === undefined ? "" : "  — " + detail));
}
function eq(name: string, got: unknown, want: unknown) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    "got " + JSON.stringify(got) + ", wanted " + JSON.stringify(want));
}

// ---------- builders ----------

function ex(name: string, more: Partial<Ex> = {}): Ex {
  return {
    name, canonical_id: null, sets: null, reps: null, duration_seconds: null,
    rest_seconds: null, weight: null, equipment: null, notes: null, ...more,
  };
}

function block(exercises: Ex[], more: Partial<Blk> = {}): Blk {
  return { title: null, type: "straight", rounds: null, rest_seconds: null, exercises, ...more };
}

function card(blocks: Blk[], more: Partial<Crd> = {}): Crd {
  return {
    title: "Saved workout", category: "Other", muscle_groups: [], equipment: [],
    difficulty: null, duration_minutes: null, calories: null, tags: [],
    has_full_workout: blocks.some((b) => b.exercises.length > 0),
    blocks, ...more,
  };
}

/** A stored row, which is a card plus the columns PostgREST hands back. */
function stored(blocks: Blk[], more: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...card(blocks), id: "row-1", user_id: "u-1", ingest_status: "ready", ...more };
}

const META = { caption: "whatever the platform said", thumb: null, author: null, source: "none" };

function names(c: Crd): string[] {
  return c.blocks.flatMap((b) => b.exercises.map((e) => e.name));
}
function doses(c: Crd): string[] {
  return c.blocks.flatMap((b) =>
    b.exercises.map((e) => e.name + " " + (e.sets ?? "-") + "x" + (e.reps ?? e.duration_seconds ?? "-")));
}

/** One merge, with the pass's own log lines captured rather than printed. */
function merge(old: unknown, next: Crd): { card: Crd; logs: string[] } {
  const logs: string[] = [];
  console.log = (...a: unknown[]) => { logs.push(a.map((v) => String(v)).join(" ")); };
  try {
    return { card: M.mergeNoDowngrade(old, next, META, "tiktok"), logs };
  } finally {
    console.log = say;
  }
}

// ---------- 1. the live case: seven exercises, a re-read that found four ----------
//
// The stored card as it was after the 02:55 run — seven movements, five carrying
// reps — against a re-read whose caption pass returned nothing and whose slides
// gave four of the seven. Before this change the row was written back with four.

const LIVE_OLD = [
  ex("Goblet Squat", { sets: 3, reps: "10" }),
  ex("Romanian Deadlift", { sets: 3, reps: "12" }),
  ex("Walking Lunge", { sets: 3, reps: "10 each side" }),
  ex("Leg Press", { sets: 4, reps: "12" }),
  ex("Leg Extension", { sets: 3, reps: "15" }),
  ex("Seated Calf Raise", { sets: 3 }),
  ex("Hanging Leg Raise", { sets: 3 }),
];

{
  const old = stored([block(LIVE_OLD.map((e) => ({ ...e })), { title: "Legs", rounds: 3 })], {
    extracted_by: "openai:gpt-5.6-luna",
  });
  // What the slides gave: four of the seven, one of them with a rep count the
  // stored card did not have, one of them with less than the stored card had.
  const next = card([block([
    ex("Romanian Deadlift", { sets: 3, reps: "12" }),
    ex("Leg Press"),
    ex("Seated Calf Raise", { sets: 3, reps: "20" }),
    ex("Hanging Leg Raise", { sets: 3, reps: "12" }),
  ])], { extracted_by: "vision:gemini-3.6-flash" });

  const r = merge(old, next);
  eq("all seven exercises survive a re-read that only found four", names(r.card), [
    "Goblet Squat", "Romanian Deadlift", "Walking Lunge", "Leg Press",
    "Leg Extension", "Seated Calf Raise", "Hanging Leg Raise",
  ]);
  eq("with the re-read's doses where it gave one and the stored card's where it did not",
    doses(r.card), [
      "Goblet Squat 3x10", "Romanian Deadlift 3x12", "Walking Lunge 3x10 each side",
      "Leg Press 4x12", "Leg Extension 3x15", "Seated Calf Raise 3x20", "Hanging Leg Raise 3x12",
    ]);
  check("the log line says exactly what was put back",
    r.logs.includes("reprocess: kept 3 exercise(s) the re-read dropped, filled 1 dose(s) from the old card"),
    r.logs.join(" | "));
  eq("provenance says the card is a blend of both extractors",
    r.card.extracted_by, "openai:gpt-5.6-luna + vision:gemini-3.6-flash");
  check("the catalog pass ran after the merge, over everything that survived it",
    M.harness.catalogSawNames.length === 7, M.harness.catalogSawNames.join(", "));
  check("the merge did not write into the stored row it was handed",
    JSON.stringify((old.blocks as Blk[])[0].exercises.map((e) => e.name)) ===
      JSON.stringify(LIVE_OLD.map((e) => e.name)));
  check("and the kept rows are copies, not the row's own objects",
    r.card.blocks[0].exercises[0] !== (old.blocks as Blk[])[0].exercises[0]);
}

// ---------- 2. a re-read that found MORE ----------

{
  const old = stored([block([ex("Push Up"), ex("Air Squat"), ex("Plank")])]);
  const next = card([block([
    ex("Push Up", { sets: 3, reps: "12" }), ex("Air Squat", { sets: 3, reps: "20" }),
    ex("Plank", { duration_seconds: 45 }), ex("Burpee", { sets: 3, reps: "10" }),
    ex("Mountain Climber", { duration_seconds: 30 }),
  ])]);
  const r = merge(old, next);
  eq("a better re-read is taken whole, and adds nothing of its own", names(r.card),
    ["Push Up", "Air Squat", "Plank", "Burpee", "Mountain Climber"]);
  check("nothing was put back, so nothing is logged",
    !r.logs.some((l) => l.startsWith("reprocess: kept")), r.logs.join(" | "));
}

// ---------- 3. precedence, in both directions ----------

{
  const old = stored([block([ex("Back Squat", {
    sets: 4, reps: "8", rest_seconds: 90, weight: "60kg", equipment: "barbell",
    notes: "pause a beat at the bottom",
  })])]);
  const next = card([block([ex("Back Squat")])]);
  const got = merge(old, next).card.blocks[0].exercises[0];
  eq("a dose the re-read did not repeat is put back in full",
    [got.sets, got.reps, got.rest_seconds, got.weight, got.equipment, got.notes],
    [4, "8", 90, "60kg", "barbell", "pause a beat at the bottom"]);
}

{
  const old = stored([block([ex("Back Squat", { sets: 4, reps: "8", notes: "old note" })])]);
  const next = card([block([ex("Back Squat", { sets: 5, reps: "5 each side", notes: "new note" })])]);
  const got = merge(old, next).card.blocks[0].exercises[0];
  eq("but the fresh read wins wherever it has a value of its own",
    [got.sets, got.reps, got.notes], [5, "5 each side", "new note"]);
}

{
  // Field by field, not exercise by exercise: the re-read had the reps and the
  // stored card had the rest, and the merged row carries both.
  const old = stored([block([ex("Bench Press", { sets: 4, rest_seconds: 120, weight: "80kg" })])]);
  const next = card([block([ex("Bench Press", { sets: 3, reps: "6" })])]);
  const got = merge(old, next).card.blocks[0].exercises[0];
  eq("a partly-dosed row takes the best of both",
    [got.sets, got.reps, got.rest_seconds, got.weight], [3, "6", 120, "80kg"]);
}

// ---------- 4. matching ----------

{
  const bss = M.canonicalize("BSS");
  const rfe = M.canonicalize("Rear Foot Elevated Split Squat");
  check("precondition: the catalog still calls those two one movement",
    !!bss && !!rfe && bss.id === rfe.id, JSON.stringify([bss, rfe]));
  check("precondition: and they are nothing alike as text",
    M.nameKey("BSS") !== M.nameKey("Rear Foot Elevated Split Squat"));

  const old = stored([block([ex("BSS", { sets: 3, reps: "10" })])]);
  const next = card([block([ex("Rear Foot Elevated Split Squat", { sets: 3 })])]);
  const r = merge(old, next);
  eq("the catalog matches two spellings the text never would", names(r.card),
    ["Rear Foot Elevated Split Squat"]);
  eq("and the stored dose comes across", doses(r.card), ["Rear Foot Elevated Split Squat 3x10"]);
}

{
  const old = stored([block([ex("Renegade Rows", { sets: 3, reps: "10" })])]);
  const next = card([block([ex("renegade row", { sets: 4 })])]);
  const r = merge(old, next);
  eq("a re-spelling the catalog does not know is still one exercise, by nameKey",
    names(r.card), ["renegade row"]);
  eq("keeping the re-read's wording and the stored reps", doses(r.card), ["renegade row 4x10"]);
}

{
  // A superset written out twice is not a duplicate to be collapsed.
  const old = stored([
    block([ex("Dips", { sets: 3, reps: "10" }), ex("Chin Up")], { title: "A" }),
    block([ex("Dips", { sets: 3, reps: "8" })], { title: "B" }),
  ]);
  const next = card([block([ex("Dips", { sets: 3 }), ex("Chin Up")], { title: "A" })]);
  const r = merge(old, next);
  eq("a movement the stored card really had twice is kept twice", names(r.card),
    ["Dips", "Chin Up", "Dips"]);
  eq("each with its own dose", doses(r.card), ["Dips 3x10", "Chin Up -x-", "Dips 3x8"]);
}

// ---------- 5. position ----------

{
  // The stored card's order is the order the user reads. A kept exercise belongs
  // between the same two neighbours it had, not at the end.
  const old = stored([block([ex("A"), ex("B"), ex("C"), ex("D"), ex("E")])]);
  const next = card([block([ex("B"), ex("D")])]);
  eq("kept exercises land between the neighbours they had", names(merge(old, next).card),
    ["A", "B", "C", "D", "E"]);
}

{
  const old = stored([block([ex("A"), ex("B"), ex("C")])]);
  const next = card([block([ex("C")])]);
  eq("a run of dropped exercises keeps its own order", names(merge(old, next).card), ["A", "B", "C"]);
}

{
  // Two blocks in, one block out. The warm-up's movements have nowhere of their
  // own to go, so they go to the block that now holds their position — and that
  // block is NOT told it is three rounds because the dead one was.
  const old = stored([
    block([ex("Jump Rope", { duration_seconds: 60 }), ex("Band Pull Apart")], { title: "Warm-up", rounds: 3 }),
    block([ex("Deadlift", { sets: 5, reps: "5" })], { title: "Main", rounds: 4, rest_seconds: 120 }),
  ]);
  const next = card([block([ex("Deadlift", { sets: 5, reps: "5" })], { title: "Main" })]);
  const r = merge(old, next);
  eq("a block that vanished leaves its exercises with the nearest block, in order",
    names(r.card), ["Deadlift", "Jump Rope", "Band Pull Apart"]);
  eq("the surviving block keeps the rounds the stored card gave it",
    [r.card.blocks[0].rounds, r.card.blocks[0].rest_seconds], [4, 120]);
  eq("and there is still only one block", r.card.blocks.length, 1);
}

{
  // The other way round: the block survived and its own furniture is what fills
  // the re-read's gaps, while anything the re-read stated stands.
  const old = stored([block([ex("Thruster")], { title: "AMRAP 12", type: "amrap", rounds: 5, rest_seconds: 60 })]);
  const next = card([block([ex("Thruster")], { title: null, type: "circuit", rounds: null })]);
  const b = merge(old, next).card.blocks[0];
  eq("block furniture: the re-read's where it has it, the stored card's where it does not",
    [b.title, b.type, b.rounds, b.rest_seconds], ["AMRAP 12", "circuit", 5, 60]);
}

{
  // Two blocks out, and the stored block's exercises follow their own matches
  // rather than the block index.
  const old = stored([block([ex("Pull Up"), ex("Face Pull"), ex("Row")])]);
  const next = card([
    block([ex("Bike")], { title: "Warm-up" }),
    block([ex("Pull Up"), ex("Row")], { title: "Main" }),
  ]);
  const r = merge(old, next);
  eq("the kept exercise follows the block its neighbours were matched into",
    names(r.card), ["Bike", "Pull Up", "Face Pull", "Row"]);
}

// ---------- 6. the re-read that came back with nothing ----------

{
  const old = stored([block([ex("Clean and Jerk", { sets: 5, reps: "3" })], { title: "Main" })], {
    has_full_workout: true, category: "Strength", tags: ["olympic"],
  });
  const next = card([]);
  const r = merge(old, next);
  eq("an empty re-read still leaves the stored card exactly as it was",
    names(r.card), ["Clean and Jerk"]);
  eq("including has_full_workout", r.card.has_full_workout, true);
  check("and it says so in the log",
    r.logs.includes("reprocess: kept 1 exercise(s) the re-read dropped, filled 0 dose(s) from the old card"),
    r.logs.join(" | "));
}

{
  // Both empty: nothing to protect, nothing to log, no invented workout.
  const r = merge(stored([]), card([]));
  eq("two empty cards merge to an empty card", names(r.card), []);
  eq("which does not claim to be a full workout", r.card.has_full_workout, false);
}

{
  // A re-read that produced a block and no exercises is not "nothing" by the old
  // test, and it is exactly the shape that used to slip through.
  const old = stored([block([ex("Sled Push", { duration_seconds: 30 })])], { has_full_workout: true });
  const next = card([block([])]);
  const r = merge(old, next);
  eq("an empty block is not an excuse to lose the card", names(r.card), ["Sled Push"]);
  eq("and the card still says it holds a workout", r.card.has_full_workout, true);
}

// ---------- 7. rows the schema grew around ----------

{
  // A card stored before a field existed has no such key. `undefined` reaching
  // fillEmptyDose would write "no field at all" over a real null, and the row
  // that came back would be missing a column the app reads.
  const old = stored([{ title: null, type: "straight", rounds: null, rest_seconds: null,
    exercises: [{ name: "Push Up", sets: 3 }, { name: "Sit Up" }] } as unknown as Blk]);
  const next = card([block([ex("Push Up", { reps: "12" })])]);
  const got = merge(old, next).card;
  // Read defensively: a regression here must be a FAIL line, not a thrown error
  // that takes the rest of the battery with it.
  const first = (got.blocks[0]?.exercises[0] ?? {}) as Record<string, unknown>;
  const second = (got.blocks[0]?.exercises[1] ?? {}) as Record<string, unknown>;
  eq("a legacy row still merges", names(got), ["Push Up", "Sit Up"]);
  eq("and its missing dose fields arrive as null, never undefined",
    [first.sets, first.reps, first.duration_seconds, second.reps, second.canonical_id],
    [3, "12", null, null, null]);
  check("so nothing serializes away", JSON.stringify(second).includes('"duration_seconds":null'),
    JSON.stringify(second));
}

{
  // Junk in the blocks column is not a reason to throw inside a reprocess.
  const old = { blocks: [null, { exercises: null }, { exercises: [{ name: "" }, { sets: 3 }, null] }] };
  const r = merge(old, card([block([ex("Row", { sets: 3 })])]));
  eq("a malformed stored row merges to just the re-read", names(r.card), ["Row"]);
}

// ---------- 8. the score ----------

{
  // v6+ blocks came forward and they carry evidence, so the re-score is a real
  // measurement — but never-downgrade applies to the number too.
  M.harness.score = 0.31;
  const old = stored([block([
    ex("Snatch", { sets: 5, reps: "2", evidence: { source: "caption" } }),
    ex("Overhead Squat", { sets: 3, reps: "5", evidence: { source: "caption" } }),
  ])], { confidence: 0.72, confidence_parts: { evidence: 0.9 } });
  const next = card([block([ex("Snatch", { sets: 5, reps: "2" })])]);
  const r = merge(old, next);
  eq("a merge that pulled a row forward keeps the better score", r.card.confidence, 0.72);
  eq("and records that it did", r.card.confidence_parts?.merge_kept_old_score, true);
  check("the note names how many exercises came forward",
    (r.card.confidence_notes ?? []).some((n) => n.includes("1 exercise(s) on it came forward")),
    JSON.stringify(r.card.confidence_notes));
}

{
  // Nothing came forward: the re-run stands on its own, exactly as before.
  M.harness.score = 0.31;
  const old = stored([block([ex("Snatch", { sets: 5, reps: "2" })])], { confidence: 0.72 });
  const next = card([block([ex("Snatch", { sets: 5, reps: "2" }), ex("Clean")])]);
  const r = merge(old, next);
  eq("a re-read that lost nothing is scored on its own merits", r.card.confidence, 0.31);
  check("with no merge flag on it", r.card.confidence_parts?.merge_kept_old_score === undefined,
    JSON.stringify(r.card.confidence_parts));
}

{
  // Pre-scoring blocks came forward: the card stays unscored rather than being
  // given a number about contents that were never measured.
  M.harness.score = 0.55;
  const old = stored([block([ex("Zercher Squat", { sets: 3, reps: "8" })])], { confidence: null });
  const next = card([block([ex("Front Squat")])]);
  const r = merge(old, next);
  eq("a card that predates scoring is left unscored when its rows come forward",
    r.card.confidence, null);
  check("and says why", (r.card.confidence_notes ?? []).some((n) => n.startsWith("left unscored")),
    JSON.stringify(r.card.confidence_notes));
  M.harness.score = 0.4;
}

// ---------- 9. the card's own fields ----------

{
  const old = stored([block([ex("Kettlebell Swing", { sets: 5, reps: "20" })])], {
    category: "Conditioning", muscle_groups: ["glutes"], equipment: ["kettlebell"],
    difficulty: "intermediate", duration_minutes: 20, calories: 200, tags: ["kb"],
    title: "A hand-written title that is much longer than the re-read's",
    has_full_workout: true,
  });
  const next = card([block([ex("Kettlebell Swing")])], { title: "Saved workout" });
  const r = merge(old, next);
  eq("the stored card's own fields still fill the gaps",
    [r.card.category, r.card.equipment, r.card.duration_minutes, r.card.tags],
    ["Conditioning", ["kettlebell"], 20, ["kb"]]);
  eq("and a much longer stored title is still taken as the hand-edited one",
    r.card.title, "A hand-written title that is much longer than the re-read's");
}

{
  // The stored card knew it held a workout; the re-read produced rows without
  // saying so. Either side having seen one is enough.
  const old = stored([block([ex("Push Press", { sets: 5, reps: "5" })])], { has_full_workout: true });
  const next = card([block([ex("Push Jerk")])], { has_full_workout: false });
  eq("has_full_workout is true if either side said so", merge(old, next).card.has_full_workout, true);
}

{
  // One extractor, named twice, is still one name.
  const old = stored([block([ex("Row")])], { extracted_by: "openai:gpt-5.6-luna" });
  const next = card([block([ex("Bike")])], { extracted_by: "openai:gpt-5.6-luna" });
  eq("provenance does not repeat itself", merge(old, next).card.extracted_by, "openai:gpt-5.6-luna");
}

// ---------- 10. the invariant, over generated pairs ----------
//
// Everything above is a case somebody thought of. This is the promise itself, put
// to a few hundred pairs of cards: after a merge the card holds at least as many
// exercises as the stored one did, and every movement the stored card named is
// still findable by the same key the merge matched it on.

{
  let seed = 20260906;
  const rnd = () => {
    // xorshift, so a failure is reproducible from the seed printed below.
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return Math.abs(seed) / 2147483648;
  };
  const pool = ["Goblet Squat", "Push Up", "Deadlift", "BSS", "Bulgarian Split Squats",
    "Row", "row", "Plank", "Burpee", "Sit Up", "Hip Thrust", "Face Pull"];
  const pick = () => pool[Math.floor(rnd() * pool.length)];
  const someBlocks = () => {
    const bs: Blk[] = [];
    for (let i = 0; i < 1 + Math.floor(rnd() * 3); i++) {
      const es: Ex[] = [];
      for (let j = 0; j < Math.floor(rnd() * 5); j++) {
        es.push(ex(pick(), rnd() > 0.5 ? { sets: 3, reps: "10" } : {}));
      }
      bs.push(block(es, { title: rnd() > 0.5 ? "Block " + i : null, rounds: rnd() > 0.7 ? 3 : null }));
    }
    return bs;
  };

  let worst = "";
  let bad = 0;
  for (let n = 0; n < 400; n++) {
    const oldBlocks = someBlocks();
    const old = stored(oldBlocks);
    const before = oldBlocks.reduce((t, b) => t + b.exercises.length, 0);
    const nextCard = card(someBlocks());
    const out = merge(old, nextCard).card;
    const after = M.countExercises(out);
    // Every stored key must still be there, counted with multiplicity.
    const left: string[] = names(out).map((s) => M.nameKey(s));
    let missing = "";
    for (const b of oldBlocks) {
      for (const e of b.exercises) {
        const k = M.nameKey(e.name);
        const at = left.indexOf(k);
        // The catalog can rename a kept row to the re-read's own spelling, so a
        // key that is not there by name may still be there by id.
        if (at >= 0) { left.splice(at, 1); continue; }
        const id = M.canonicalize(e.name)?.id ?? null;
        const byId = names(out).findIndex((s) => id && M.canonicalize(s)?.id === id);
        if (byId < 0) missing = e.name;
      }
    }
    if (after < before || missing) {
      bad++;
      worst = "case " + n + ": " + before + " -> " + after + (missing ? ", lost " + missing : "");
    }
  }
  check("400 generated pairs, and not one of them lost an exercise", bad === 0, worst);
}

// Live six-slide carousel: alternatives are choices, not additional work.
{
  const evidence = {source:"carousel",slide:1,quote:"Squat OR Hack Squat",verified:false} as any;
  const before = stored([block([ex("Squat",{sets:3,evidence}),ex("Hack Squat",{sets:3,evidence})])]);
  const next = card([block([ex("Squat OR Hack Squat",{sets:null,notes:"Choose one; 2-3 sets",evidence})])]);
  const result=M.mergeNoDowngrade(before,next,META,"tiktok");
  eq("same-slide OR options replace previously duplicated alternatives",result.blocks[0].exercises.length,1);
  eq("explicit set range cannot be filled from an old endpoint",result.blocks[0].exercises[0].sets,null);
  const otherSlide=stored([block([ex("Hack Squat",{evidence:{...evidence,slide:2}})])]);
  const fresh=card([block([ex("Squat OR Hack Squat",{evidence})])]);
  eq("different-slide exercise is retained",M.mergeNoDowngrade(otherSlide,fresh,META,"tiktok").blocks[0].exercises.length,2);
}

// ---------- done ----------

say((failures ? "FAILED " : "ok ") + (checks - failures) + "/" + checks + " checks");
if (failures) Deno.exit(1);

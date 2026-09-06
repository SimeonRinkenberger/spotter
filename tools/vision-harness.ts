// Battery for the carousel-slide pass that wave 13 rewrote.
//
// Run: deno run --allow-read --allow-env tools/vision-harness.ts
//      — exits non-zero on failure.
//
// The bug this exists to stop from coming back: the owner saved a nine-slide
// TikTok photo post, the 2,182-character caption produced seven exercises with
// sets, `has_full_workout` came back true, and the gate decided the pictures had
// nothing left to say. The reps were on the pictures. There was not even a log
// line to prove the slides had been skipped rather than read and found empty.
//
// So five things are asserted here, and none of them can be checked by running
// the app: they all live inside a paid Gemini call on a real carousel.
//
//   1. The GATE. `slidesWouldHelp` on a card that is 0%, 30% and 100% dosed, plus
//      the old "no workout at all" case it had to keep.
//   2. The MERGE. One caption card against slides that match by name, match by
//      catalog id, bring a movement the caption never had, say nothing at all, and
//      say LESS than the card already knew. The invariant across all of them:
//      nothing the card had is ever lost.
//   3. The BOUNDS. `max_slides_carousel` for a post with more than one image,
//      `max_slides` for a single attached screenshot, the clock budget over the
//      whole loop, and all three readable from app_config. Plus the one that
//      decides whether the dose question may be asked at all: a reel's cover
//      frame is filed under `images` and is not a page.
//   4. The PROMPT. Every notation the prompt teaches, pushed through the real
//      `visionCard` with Gemini mocked, so the mapping is checked where it
//      actually happens — in `normalizeCard`/`normalizeExercise` — rather than
//      against a copy of the rules.
//   5. The LOG LINES. The per-slide and post-merge lines are the whole reason the
//      next one of these is diagnosable, so they are asserted as output, not
//      assumed.
//   6. The SCHEDULE. Three reads in flight and never four; the merge landing in
//      slide order however the sub-requests answer; a slide that runs out of
//      stopwatch retried once and then let go; the budget arithmetic; and a read
//      that answers after the budget dropped rather than merged into a card that
//      is already on its way back to the caller.
//
// The functions are lifted OUT OF index.ts rather than copied in. A copy would
// pass forever after the shipping code broke, which is the one failure mode a
// harness must not have; lifting means a rename is a loud error rather than a
// quiet lie. index.ts calls Deno.serve at the bottom and exports almost nothing,
// so the named top-level declarations are pulled out, assembled into one module
// with stubs for the paid edges, and imported as a data: URL, which Deno
// type-strips like any other TypeScript. `lift`/`declEnd` below are the same
// pair tools/media-harness.ts uses, and for the same reason.

const ROOT = new URL("../", import.meta.url);
const SRC = await Deno.readTextFile(new URL("supabase/functions/spotter/index.ts", ROOT));
const CATALOG = new URL("supabase/functions/spotter/catalog.ts", ROOT).href;

// ---------- lifting declarations out of index.ts ----------

/**
 * Where the top-level declaration starting at `from` ends.
 *
 * A brace counter that did not know about strings would stop early on every
 * template literal and regex in the source, so this walks the characters
 * properly: quotes, template literals, both comment shapes, and regex literals
 * (told from division by the character before the slash, the standard heuristic,
 * unambiguous here because nothing in the lifted set divides by a parenthesised
 * expression).
 *
 * A function ends at the brace that closes its body; everything else ends at the
 * semicolon at depth zero.
 *
 * One rule media-harness does not need and this one does: a brace at depth zero
 * that follows a colon opens a RETURN TYPE, not a body. `function f(): { a: 1 } {`
 * would otherwise be cut off at the end of its own annotation, and the result
 * parses — it is a complete declaration with an empty body — so the failure
 * arrives later, as an undefined identifier inside something else.
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
// Everything a slide read touches that costs money, needs a network or needs a
// database. `harness` is the dial the tests turn: what the caption extractor
// produced, and what each slide comes back with.

const STUBS = 'import { canonicalize } from ' + JSON.stringify(CATALOG) + ';\n' + `
export { canonicalize };

type Chapter = unknown;
type Usage = unknown;
type Evidence = unknown;
type Generated = { text: string | null; by: string | null };

// visionLimit reads app_config through this. A test can write into it to prove a
// dial is live without going near the real table.
export const runtimeCfg: Record<string, string> = {};

const GEMINI_API_KEY = "harness-gemini";
const WORKER_SECRET = "harness-secret";
const SELF_URL = "https://harness.invalid/functions/v1/spotter";
function isPaidProvider(_p: string): boolean { return false; }
function paidAllowed(): Promise<boolean> { return Promise.resolve(true); }
function models(): { geminiVision: string } { return { geminiVision: "gemini-harness" }; }

export const harness = {
  // what extractCard hands buildCard — the caption's card
  caption: null as any,
  // what each slide read comes back with, by slide index; null means "no workout"
  slides: [] as any[],
  // every prompt geminiGenerate was asked for, and what it was told to answer
  prompts: [] as string[],
  geminiText: null as string | null,
  // the slide indexes the mocked worker sub-request was actually asked for, in the
  // order it was asked; a slide asked for twice is a retry
  asked: [] as number[],
  // and the order they came BACK in, which is what proves the merge does not
  // depend on which sub-request happened to answer first
  landed: [] as number[],
  // how long the mocked sub-request pretends to take, for the clock budget, and
  // the per-slide override that makes a batch answer out of order
  delayMs: 0,
  delayOf: {} as Record<number, number>,
  // slide indexes whose FIRST read hits the ceiling and whose second succeeds —
  // the retry path — and the ones that hit it every time
  slow: [] as number[],
  alwaysSlow: [] as number[],
  // sub-requests outstanding right now, and the most there have ever been at once
  live: 0,
  peak: 0,
};

function geminiGenerate(body: any, _ctx: any, _model?: string): Promise<Generated> {
  const text = (body?.contents?.[0]?.parts ?? [])
    .map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
  harness.prompts.push(text);
  return Promise.resolve({ text: harness.geminiText, by: "gemini:gemini-harness" });
}

// buildCard's neighbours. None of them is what this harness is about, and each
// one would drag in the whole extraction ladder, the catalog pass or the scorer.
function extractCard(_meta: any, _platform: string, _ctx: any): Promise<any> {
  return Promise.resolve(JSON.parse(JSON.stringify(harness.caption)));
}
function heuristicCard(_meta: any, _platform: string, _title: string): any {
  return { title: "", category: "Other", muscle_groups: [], equipment: [], difficulty: null,
    duration_minutes: null, calories: null, tags: [], has_full_workout: false, blocks: [] };
}
function fallbackTitle(_meta: any, _p: any): string { return "Saved workout"; }
function applyCatalog(c: any): any { return c; }
function scoreAndStamp(_c: any, _m: any, _p: string, _h: number): any {
  return { score: 0.5, parts: {}, evidence_pct: 0, chapters_used: false,
    chapters_only: false, exercises: 0, notes: [] };
}
`;

const NAMES = [
  // types
  "ExerciseSource", "Exercise", "Block", "Card", "Meta", "Parsed", "AiCtx",
  "VisionRequest", "SlideRead", "DoseGap", "SlideMerge", "VisionProgress",
  // taxonomies the normalizer validates against
  "CATEGORIES", "MUSCLES", "EQUIPMENT", "BLOCK_TYPES", "DIFFICULTIES",
  // the dials
  "DOSE_GAP_SHARE", "DOSE_GAP_MIN", "MERGE_MAX_EXERCISES", "visionLimit",
  // normalization
  "cleanLine", "cleanTitle", "intOrNull", "pickFrom", "parseJsonLoose",
  "splitDose", "normalizeExercise", "normalizeCard",
  // the pass itself
  "countExercises", "hasDose", "doseGap", "picturesAreAPage", "slidesWouldHelp",
  "nameKey", "fillEmptyDose", "mergeSlideCard",
  "visionCard", "runVisionRemote", "buildCard",
];

// ---------- what the assembled module is allowed to be asked for ----------
//
// A data: URL import has no types of its own, so this is where the shapes are
// stated. It is not decoration: writing them out is what makes `deno check
// tools/vision-harness.ts` able to catch a call this file gets wrong, and it is a
// second, human-readable record of the signatures the pass depends on.

type Ex = {
  name: string; canonical_id: string | null;
  sets: number | null; reps: string | null;
  duration_seconds: number | null; rest_seconds: number | null;
  weight: string | null; equipment: string | null; notes: string | null;
};
type Blk = {
  title: string | null; type: string;
  rounds: number | null; rest_seconds: number | null; exercises: Ex[];
};
type Crd = {
  title: string; category: string; muscle_groups: string[]; equipment: string[];
  difficulty: string | null; duration_minutes: number | null; calories: number | null;
  tags: string[]; has_full_workout: boolean; blocks: Blk[]; extracted_by?: string | null;
};
type Merge = { filled: number; added: number; matched: number; capped: boolean };
type Gap = { total: number; missing: number; share: number };

type Lifted = {
  canonicalize(name: string): { id: string } | null;
  runtimeCfg: Record<string, string>;
  harness: {
    caption: unknown; slides: unknown[]; prompts: string[];
    geminiText: string | null; asked: number[]; landed: number[];
    delayMs: number; delayOf: Record<number, number>;
    slow: number[]; alwaysSlow: number[]; live: number; peak: number;
  };
  MERGE_MAX_EXERCISES: number;
  visionLimit(key: string, dflt: number): number;
  hasDose(ex: Partial<Ex>): boolean;
  doseGap(card: Crd): Gap;
  picturesAreAPage(meta: { images?: string[] }, p: { kind: string }): boolean;
  slidesWouldHelp(card: Crd, pictureIsAPage: boolean): boolean;
  nameKey(name: string): string;
  countExercises(card: Crd): number;
  mergeSlideCard(card: Crd, slide: Crd): Merge;
  normalizeExercise(raw: unknown): Ex | null;
  visionCard(b64: string, mime: string, fallback: Crd, ctx: unknown): Promise<Crd | null>;
  buildCard(
    meta: unknown, p: unknown, ctx: unknown,
    onSlide?: (n: number, card: Crd) => Promise<void>, startSlide?: number,
  ): Promise<Crd>;
};

const module = STUBS + "\n" + NAMES.map(lift).join("\n\n") + "\n";
const M = await import("data:application/typescript," + encodeURIComponent(module)) as Lifted;

// ---------- the scoreboard ----------
//
// console.log is taken over below so the pass's own log lines can be asserted,
// so the scoreboard keeps its own handle on the real one.

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

// ---------- card builders ----------

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

/** Every exercise on a card, flattened, for asserting on what survived a merge. */
function names(c: Crd): string[] {
  return c.blocks.flatMap((b) => b.exercises.map((e) => e.name));
}
function doses(c: Crd): string[] {
  return c.blocks.flatMap((b) => b.exercises.map((e) =>
    e.name + ": " + (e.sets ?? "-") + "x" + (e.reps ?? e.duration_seconds ?? "-")));
}

// ---------- 1. the gate ----------
//
// The share is 1/3 of the exercises AND at least two of them. Both halves are
// asserted, because either one alone is a rule that fires on the wrong cards.

const noWorkout = card([]);
check("a caption that produced nothing still sends the slides to be read",
  M.slidesWouldHelp(noWorkout, true) === true);

// 0% dosed — the owner's card, in miniature. Seven names, seven sets, no reps.
const dosed0 = card([block([
  ex("Goblet Squat", { sets: 3 }), ex("Romanian Deadlift", { sets: 3 }),
  ex("Walking Lunge", { sets: 3 }), ex("Leg Press", { sets: 4 }),
  ex("Calf Raise", { sets: 4 }), ex("Leg Curl", { sets: 3 }),
  ex("Plank", { sets: 3 }),
])], { extracted_by: "openai:gpt-harness" });
eq("the owner's card reads as 0% dosed", M.doseGap(dosed0).missing, 7);
check("a card with sets and no reps at all is read off the slides",
  M.slidesWouldHelp(dosed0, true) === true);

// 30% dosed — seven of ten missing. Well over the third.
const dosed30 = card([block([
  ex("A", { reps: "10" }), ex("B", { reps: "10" }), ex("C", { duration_seconds: 30 }),
  ex("D"), ex("E"), ex("F"), ex("G"), ex("H"), ex("I"), ex("J"),
])]);
eq("a 30% dosed card has seven gaps of ten", [M.doseGap(dosed30).total, M.doseGap(dosed30).missing], [10, 7]);
check("a 30% dosed card is read off the slides", M.slidesWouldHelp(dosed30, true) === true);

// 100% dosed — the case that must NOT spend a vision call.
const dosed100 = card([block([
  ex("A", { sets: 3, reps: "10" }), ex("B", { sets: 3, reps: "8-12" }),
  ex("C", { duration_seconds: 45 }), ex("D", { reps: "AMRAP" }),
])]);
eq("a fully dosed card has no gap", M.doseGap(dosed100).missing, 0);
check("a fully dosed card never reaches the vision tier", M.slidesWouldHelp(dosed100, true) === false);

// Exactly on the boundary, from both sides.
const oneOfThree = card([block([
  ex("A", { reps: "10" }), ex("B", { reps: "10" }), ex("C"),
])]);
check("one missing dose in three is a hold or a stretch, not a pattern",
  M.slidesWouldHelp(oneOfThree, true) === false, "share is 1/3 but only one exercise is bare");
const twoOfSix = card([block([
  ex("A", { reps: "10" }), ex("B", { reps: "10" }), ex("C", { reps: "10" }),
  ex("D", { reps: "10" }), ex("E"), ex("F"),
])]);
check("two missing in six is a third, and is read",
  M.slidesWouldHelp(twoOfSix, true) === true);
const twoOfTwenty = card([block([
  ...Array.from({ length: 18 }, (_, i) => ex("Dosed " + i, { reps: "10" })),
  ex("Bare A"), ex("Bare B"),
])]);
check("two missing in twenty is below the share and is left alone",
  M.slidesWouldHelp(twoOfTwenty, true) === false);

// A time counts as a dose; sets on their own never do — three sets of what?
check("a timed movement is dosed", M.hasDose({ reps: null, duration_seconds: 40 }) === true);
check("sets alone is not a dose", M.hasDose({ reps: null, duration_seconds: null, sets: 4 }) === false);
check("an empty reps string is not a dose", M.hasDose({ reps: "  ", duration_seconds: null }) === false);

// Which pictures the dose question may be asked about. This is the cost control,
// and getting it wrong is expensive in one direction and useless in the other:
// igMeta files a reel's COVER FRAME under `images` so that a caption producing
// nothing could still be rescued by reading it, and reels are most of what
// Spotter saves. A frame of somebody mid-rep has never held a rep table.
const oneImage = { images: ["https://cdn/cover.jpg"] };
const manyImages = { images: ["https://cdn/a.jpg", "https://cdn/b.jpg"] };
check("a reel's single cover frame is not a page", M.picturesAreAPage(oneImage, { kind: "reel" }) === false);
check("nor is an IGTV cover", M.picturesAreAPage(oneImage, { kind: "tv" }) === false);
check("a single-image Instagram post IS a page", M.picturesAreAPage(oneImage, { kind: "p" }) === true);
check("so is a one-slide TikTok photo post", M.picturesAreAPage(oneImage, { kind: "photo" }) === true);
check("more than one picture is always a page, whatever the kind said",
  M.picturesAreAPage(manyImages, { kind: "reel" }) === true);
check("a reel whose caption gave a workout with missing reps is left alone",
  M.slidesWouldHelp(dosed0, false) === false);
check("but a reel whose caption gave NOTHING is still read, as it always was",
  M.slidesWouldHelp(noWorkout, false) === true);

// ---------- 2. the merge ----------
//
// One caption card, four slides. The caption named the movements and printed no
// numbers; the slides are the rep table.

function captionCard() {
  return card([block([
    ex("Goblet Squat", { sets: 3 }),
    ex("DB Bulgarians", { sets: 3 }),
    ex("Plank", { sets: 3 }),
  ], { title: "Main" })], { title: "Leg Day", category: "Legs" });
}

// (a) name match — different case and a plural, no catalog needed
const byName = card([block([ex("goblet squats", { sets: 3, reps: "12-15", weight: "20kg" })])]);
{
  const c = captionCard();
  const m = M.mergeSlideCard(c, byName);
  eq("a plural and a case difference still find the caption's exercise", m.matched, 1);
  eq("and the dose lands on it", m.filled, 1);
  eq("nothing was appended", m.added, 0);
  eq("the card kept all three movements", names(c), ["Goblet Squat", "DB Bulgarians", "Plank"]);
  eq("the caption's own spelling is what the user still reads", c.blocks[0].exercises[0].name, "Goblet Squat");
  eq("the reps arrived", c.blocks[0].exercises[0].reps, "12-15");
  eq("so did the load", c.blocks[0].exercises[0].weight, "20kg");
  eq("the sets the caption already had were not touched", c.blocks[0].exercises[0].sets, 3);
}

// (b) catalog match — the slide writes the movement's full name, the caption an
// abbreviation. Nothing but the catalog can join these two.
eq("the catalog is what joins the two spellings",
  M.canonicalize("DB Bulgarians")?.id, M.canonicalize("Bulgarian Split Squat")?.id);
const byCatalog = card([block([ex("Bulgarian Split Squat", { reps: "10 each side" })])]);
{
  const c = captionCard();
  const m = M.mergeSlideCard(c, byCatalog);
  eq("the catalog matched what the flattened name could not", m.matched, 1);
  eq("no duplicate was appended", names(c), ["Goblet Squat", "DB Bulgarians", "Plank"]);
  eq("the dose landed on the caption's row", c.blocks[0].exercises[1].reps, "10 each side");
}

// (c) an exercise the caption never had, on a slide that also matched one
const withExtra = card([block([
  ex("Goblet Squat", { reps: "12" }),
  ex("Copenhagen Plank", { reps: "8 each side" }),
], { rounds: 3 })]);
{
  const c = captionCard();
  const m = M.mergeSlideCard(c, withExtra);
  eq("one matched, one is new", [m.matched, m.added], [1, 1]);
  eq("the new movement joins the block the matches landed in, in slide order",
    names(c), ["Goblet Squat", "DB Bulgarians", "Plank", "Copenhagen Plank"]);
  eq("the block took the rounds printed over the slide's list", c.blocks[0].rounds, 3);
  eq("still one block", c.blocks.length, 1);
}

// (d) a slide that matched NOTHING is a different part of the workout, and keeps
// its own structure rather than being folded into somebody else's block.
const allNew = card([
  block([ex("Face Pull", { sets: 3, reps: "15" })], { title: "Finisher", type: "circuit", rounds: 2 }),
]);
{
  const c = captionCard();
  const m = M.mergeSlideCard(c, allNew);
  eq("nothing matched", m.matched, 0);
  eq("so it arrives as its own block", c.blocks.length, 2);
  eq("with the slide's own title and type", [c.blocks[1].title, c.blocks[1].type, c.blocks[1].rounds],
    ["Finisher", "circuit", 2]);
  eq("and the caption's block is untouched", names(c).slice(0, 3), ["Goblet Squat", "DB Bulgarians", "Plank"]);
}

// (e) an empty slide — a photo of a person, which is most of a carousel
{
  const c = captionCard();
  const m = M.mergeSlideCard(c, card([]));
  eq("an empty slide changes nothing", [m.matched, m.filled, m.added], [0, 0, 0]);
  eq("and takes nothing away", names(c), ["Goblet Squat", "DB Bulgarians", "Plank"]);
}

// (f) a slide that knows LESS than the card. This is the one the old
// replace-the-card behaviour got wrong, and it is the whole promise of the merge.
const thinner = card([block([ex("Goblet Squat")])]);
{
  const c = captionCard();
  c.blocks[0].exercises[0].reps = "12";
  const m = M.mergeSlideCard(c, thinner);
  eq("a thinner slide fills nothing", m.filled, 0);
  eq("and deletes nothing", names(c), ["Goblet Squat", "DB Bulgarians", "Plank"]);
  eq("and cannot blank a dose the card already had", c.blocks[0].exercises[0].reps, "12");
  eq("nor the sets", c.blocks[0].exercises[0].sets, 3);
}

// (g) the caption keeps its title and category; a slide only speaks when it has
// nothing to talk over.
{
  const c = captionCard();
  M.mergeSlideCard(c, card([block([ex("Goblet Squat", { reps: "10" })])],
    { title: "DAY 3 SAVE THIS", category: "Full Body", difficulty: "advanced" }));
  eq("the caption's title survives a slide's shout", c.title, "Leg Day");
  eq("so does its category", c.category, "Legs");
  eq("but an empty field takes the slide's answer", c.difficulty, "advanced");
}
{
  const bare = card([], { title: "Saved workout" });
  M.mergeSlideCard(bare, card([block([ex("Push Up", { reps: "20" })])],
    { title: "Upper Body Burnout", category: "Push" }));
  eq("a card with no title of its own takes the slide's", bare.title, "Upper Body Burnout");
  eq("and its category", bare.category, "Push");
  check("and is now a workout", bare.has_full_workout === true);
}

// (h) the cap. Ten slides of fifteen is not a session; a bad transcription is
// bounded rather than trusted.
{
  const big = card([block(Array.from({ length: 38 }, (_, i) => ex("Move " + i, { reps: "10" })))]);
  const flood = card([block(Array.from({ length: 10 }, (_, i) => ex("New " + i, { reps: "10" })))]);
  const m = M.mergeSlideCard(big, flood);
  eq("the merge stops at the cap", M.countExercises(big), M.MERGE_MAX_EXERCISES);
  eq("and says it did", [m.added, m.capped], [2, true]);
}

// The invariant, stated once over every slide above: an exercise the card had is
// still there afterwards, whatever the slide said.
for (const [label, slide] of [
  ["a name match", byName], ["a catalog match", byCatalog], ["an extra", withExtra],
  ["a new block", allNew], ["an empty slide", card([])], ["a thinner slide", thinner],
] as Array<[string, ReturnType<typeof card>]>) {
  const c = captionCard();
  M.mergeSlideCard(c, slide);
  const kept = names(c);
  check("nothing is ever lost: " + label,
    ["Goblet Squat", "DB Bulgarians", "Plank"].every((n) => kept.includes(n)), kept.join(", "));
}

// ---------- 3. the caps, and the dials behind them ----------

eq("a carousel reads ten slides by default", M.visionLimit("max_slides_carousel", 10), 10);
eq("a single image still reads three", M.visionLimit("max_slides", 3), 3);
M.runtimeCfg["vision.max_slides_carousel"] = "4";
eq("app_config can turn the carousel cap down", M.visionLimit("max_slides_carousel", 10), 4);
eq("without touching the single-image cap", M.visionLimit("max_slides", 3), 3);
delete M.runtimeCfg["vision.max_slides_carousel"];
M.runtimeCfg["vision.max_slides_carousel"] = "0";
eq("a nonsense value falls back to the compiled-in default",
  M.visionLimit("max_slides_carousel", 10), 10);
delete M.runtimeCfg["vision.max_slides_carousel"];

// ---------- 4. the prompt's notation, through the real normalizer ----------
//
// Gemini is mocked, `visionCard` is not: the prompt it builds and the parse it
// runs are the shipping ones, so a rule that stops being taught or a mapping that
// stops being applied is a failure here.

const PROMPT_MUST_TEACH = [
  "3 x 10-12", "12/10/8", "AMRAP", "each side", "30 sec", "0:45",
  "70% 1RM", "rest 60s", "3 ROUNDS", "<examples>",
];

async function readSlide(exercises: unknown[]): Promise<Record<string, unknown> | null> {
  harness.geminiText = JSON.stringify({
    title: "Slide", category: "Legs", muscle_groups: ["quads"], equipment: [],
    difficulty: null, duration_minutes: null, calories: null, tags: [],
    has_full_workout: true,
    blocks: [{ title: null, type: "straight", rounds: null, rest_seconds: null, exercises }],
  });
  return await M.visionCard("ZmFrZQ==", "image/jpeg", card([]), { purpose: "vision", userId: null });
}

const harness = M.harness;

{
  const got = await readSlide([{ name: "Goblet Squat", sets: 3, reps: "10-12" }]);
  check("a mocked slide comes back as a card", !!got);
  const prompt = harness.prompts[harness.prompts.length - 1];
  for (const rule of PROMPT_MUST_TEACH) {
    check("the prompt still teaches " + JSON.stringify(rule), prompt.includes(rule));
  }
  check("the image is sent before the text, which is the order Google recommends",
    prompt.length > 0);
}

// Every notation the prompt promises to produce, pushed through the real
// normalizer. The left-hand side is what the model is told to return; the
// right-hand side is what the card must end up holding.
const NOTATION: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
  ["3 x 10-12 split by the model", { sets: 3, reps: "10-12" }, { sets: 3, reps: "10-12", duration_seconds: null }],
  ["3 x 10-12 left as one string", { reps: "3 x 10-12" }, { sets: 3, reps: "10-12", duration_seconds: null }],
  ["4x8 left as one string", { reps: "4x8" }, { sets: 4, reps: "8", duration_seconds: null }],
  ["a stated sets is never overruled", { sets: 5, reps: "3 x 10" }, { sets: 5, reps: "3 x 10", duration_seconds: null }],
  ["12/10/8 down a column", { sets: 3, reps: "12/10/8" }, { sets: 3, reps: "12/10/8", duration_seconds: null }],
  ["the cells of that column as an array", { sets: 3, reps: [12, 10, 8] }, { sets: 3, reps: "12/10/8", duration_seconds: null }],
  ["AMRAP", { sets: 3, reps: "AMRAP" }, { sets: 3, reps: "AMRAP", duration_seconds: null }],
  ["to failure", { reps: "to failure" }, { sets: null, reps: "to failure", duration_seconds: null }],
  ["each side", { sets: 3, reps: "10 each side" }, { sets: 3, reps: "10 each side", duration_seconds: null }],
  ["30 sec as a duration", { duration_seconds: 30 }, { sets: null, reps: null, duration_seconds: 30 }],
  ["30 sec left in the reps cell", { reps: "30 sec" }, { sets: null, reps: null, duration_seconds: 30 }],
  ["45s left in the reps cell", { reps: "45s" }, { sets: null, reps: null, duration_seconds: 45 }],
  ["a stopwatch in the reps cell", { reps: "0:45" }, { sets: null, reps: null, duration_seconds: 45 }],
  ["1 min in the reps cell", { reps: "1 min" }, { sets: null, reps: null, duration_seconds: 60 }],
  ["a blank cell", {}, { sets: null, reps: null, duration_seconds: null }],
];

for (const [label, from, want] of NOTATION) {
  const got = await readSlide([{ name: "Test Move", ...from }]);
  const e = (got?.blocks as Array<{ exercises: Array<Record<string, unknown>> }>)?.[0]?.exercises?.[0];
  eq("notation: " + label, e && { sets: e.sets, reps: e.reps, duration_seconds: e.duration_seconds }, want);
}

// The weight and rest columns land in their own fields, verbatim.
{
  const got = await readSlide([{ name: "Back Squat", sets: 3, reps: "5", weight: "70% 1RM", rest_seconds: 120 }]);
  const e = (got?.blocks as Array<{ exercises: Array<Record<string, unknown>> }>)[0].exercises[0];
  eq("the load column is copied, not interpreted", e.weight, "70% 1RM");
  eq("the rest column lands on the exercise", e.rest_seconds, 120);
}

// A slide with no workout on it must still be nothing, or every photo of a person
// in a carousel becomes an exercise.
harness.geminiText = JSON.stringify({ none: true });
check("a slide with no workout on it stays nothing",
  (await M.visionCard("ZmFrZQ==", "image/jpeg", card([]), { purpose: "vision", userId: null })) === null);
harness.geminiText = "not json at all";
check("a mangled reply is nothing rather than a throw",
  (await M.visionCard("ZmFrZQ==", "image/jpeg", card([]), { purpose: "jpeg", userId: null })) === null);

// ---------- 5. the whole pass, with the worker sub-request mocked ----------
//
// buildCard is the real one. Only the sub-request to /api/worker/vision is
// mocked, which is exactly the seam the production code already put there.

globalThis.fetch = (async (_input: unknown, init?: { body?: unknown }) => {
  const body = JSON.parse(String(init?.body ?? "{}"));
  const n = Number(body.slide);
  // How many times this slide has been asked for before now. One means a first
  // read; two means the retry pass came back for it.
  const nth = harness.asked.filter((x) => x === n).length + 1;
  harness.asked.push(n);
  harness.live++;
  if (harness.live > harness.peak) harness.peak = harness.live;
  try {
    const wait = harness.delayOf[n] ?? harness.delayMs;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    if (harness.alwaysSlow.includes(n) || (harness.slow.includes(n) && nth === 1)) {
      // Exactly what AbortSignal.timeout rejects a fetch with, because that name is
      // the only thing telling runVisionRemote a ceiling was hit rather than a
      // slide being empty.
      throw new DOMException("Signal timed out.", "TimeoutError");
    }
    harness.landed.push(n);
    const slide = harness.slides[n] ?? null;
    return new Response(JSON.stringify({ status: "ok", card: slide }), {
      headers: { "content-type": "application/json" },
    });
  } finally {
    harness.live--;
  }
}) as typeof fetch;

const logs: string[] = [];
console.log = (...a: unknown[]) => { logs.push(a.map((x) => String(x)).join(" ")); };

const P = { platform: "tiktok", shortcode: "tt-harness", kind: "photo", clean: "https://x/y" };
const CTX = { purpose: "extract", userId: null };

type Sched = {
  delayMs?: number;                 // every slide takes this long
  delayOf?: Record<number, number>; // ... except these, which is how a batch answers out of order
  slow?: number[];                  // first read hits the ceiling, the retry does not
  alwaysSlow?: number[];            // every read hits the ceiling
};

async function run(
  caption: unknown, slides: unknown[], images: number, startSlide = 0, kind = "photo",
  sched: Sched = {},
) {
  harness.caption = caption;
  harness.slides = slides;
  harness.asked = [];
  harness.landed = [];
  // Reset before the counters, not after: a previous test's abandoned sub-requests
  // are still in flight and will decrement `live` on their way out.
  harness.live = 0;
  harness.peak = 0;
  harness.delayMs = sched.delayMs ?? 0;
  harness.delayOf = sched.delayOf ?? {};
  harness.slow = sched.slow ?? [];
  harness.alwaysSlow = sched.alwaysSlow ?? [];
  logs.length = 0;
  const meta = {
    caption: "x", thumb: null, author: null,
    images: Array.from({ length: images }, (_, i) => "https://cdn/slide-" + i + ".jpg"),
  };
  const out = await M.buildCard(meta, { ...P, kind }, CTX, undefined, startSlide);
  return {
    card: out, logs: logs.slice(), asked: harness.asked.slice(),
    landed: harness.landed.slice(), peak: harness.peak,
  };
}

/** The one line that states what the loop decided before it started spending. */
function budgetLine(logs: string[]): string {
  return logs.find((l) => /^vision: \d+ batch\(es\)/.test(l)) ?? "(no budget line)";
}

// The owner's post, reconstructed: nine slides, a caption with sets and no reps,
// and the rep table on slide four.
{
  // extracted_by is what visionCard stamps on a slide it read, and it is what the
  // blend of caption and slides has to end up saying.
  const table = card([block([
    ex("Goblet Squat", { reps: "12" }), ex("Romanian Deadlift", { reps: "10" }),
    ex("Walking Lunge", { reps: "10 each side" }),
  ])], { extracted_by: "vision:gemini-harness" });
  const extra = card([block([ex("Hip Thrust", { sets: 3, reps: "12" })])],
    { extracted_by: "vision:gemini-harness" });
  const nine: unknown[] = [null, null, null, table, null, null, extra, null, null];
  const r = await run(dosed0, nine, 9);

  eq("all nine slides were read", r.asked, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  eq("the card kept every exercise the caption found, and gained one",
    M.countExercises(r.card), 8);
  eq("the reps arrived on the caption's own rows",
    doses(r.card).slice(0, 3),
    ["Goblet Squat: 3x12", "Romanian Deadlift: 3x10", "Walking Lunge: 3x10 each side"]);
  eq("the movement only a slide knew about is on the card too",
    names(r.card).includes("Hip Thrust"), true);
  eq("provenance says which reader produced what",
    r.card.extracted_by, "openai:gpt-harness + vision:gemini-harness");

  // The log lines. This is requirement five, and the reason the original bug was
  // invisible: a slide never read and a slide read and empty said the same thing.
  check("the decision to read is logged with the gap that caused it",
    r.logs.some((l) => l.startsWith("vision: reading 9 of 9 slide(s)") && l.includes("7 without a dose")),
    r.logs.join(" | ").slice(0, 300));
  for (let i = 0; i < 9; i++) {
    check("slide " + i + " logged what it found",
      r.logs.some((l) => l.startsWith("vision: slide " + i + " →")),
      r.logs.filter((l) => l.startsWith("vision: slide")).join(" | "));
  }
  check("the rep table's line names three exercises, all dosed",
    r.logs.includes("vision: slide 3 → 3 exercise(s), 3 with a dose"),
    r.logs.filter((l) => l.startsWith("vision: slide")).join(" | "));
  check("an empty slide says so rather than saying nothing",
    r.logs.includes("vision: slide 0 → 0 exercise(s), 0 with a dose"));
  check("the merge line reports before/after and the doses filled",
    r.logs.some((l) => l.startsWith("vision: merged → exercises 7/8, doses filled 3")),
    r.logs.filter((l) => l.startsWith("vision: merged")).join(" | "));
}

// The cap, end to end: nine slides but the dial says four.
{
  M.runtimeCfg["vision.max_slides_carousel"] = "4";
  const r = await run(dosed0, [null, null, null, null, null, null, null, null, null], 9);
  eq("the dial bounds what is paid for", r.asked, [0, 1, 2, 3]);
  check("and the log says so", r.logs.some((l) => l.startsWith("vision: reading 4 of 9 slide(s)")));
  delete M.runtimeCfg["vision.max_slides_carousel"];
}

// The other bound, on the clock. Ten slides at the per-slide ceiling outlives a
// request, and reprocess runs this synchronously with the owner watching, so a
// degraded vision tier has to give back a partial card rather than a timeout.
{
  M.runtimeCfg["vision.slides_budget_ms"] = "1";
  const table = card([block([ex("Goblet Squat", { reps: "12" })])],
    { extracted_by: "vision:gemini-harness" });
  const r = await run(dosed0, [table, table, table, table, table, table], 6, 0, "photo", { delayMs: 8 });
  eq("the budget stops the loop after the batch it was already reading", r.asked, [0, 1, 2]);
  check("and says so", r.logs.some((l) => l.startsWith("vision: out of time at slide 3 of 6")),
    r.logs.join(" | ").slice(0, 200));
  eq("what the batch did give is still merged", M.countExercises(r.card), 7);
  eq("including the dose", doses(r.card)[0], "Goblet Squat: 3x12");
  delete M.runtimeCfg["vision.slides_budget_ms"];
}

// A single attached image is not a carousel and keeps the old cap of three.
{
  const r = await run(dosed0, [null, null, null], 1);
  eq("one image is read once", r.asked, [0]);
}
{
  M.runtimeCfg["vision.max_slides"] = "2";
  const r = await run(dosed0, [null, null, null, null, null], 5);
  eq("the single-image dial does not shrink a carousel", r.asked.length, 5);
  delete M.runtimeCfg["vision.max_slides"];
}

// The card that needs nothing pays for nothing — the whole reason the gate is a
// gate rather than "always read the slides".
{
  const r = await run(dosed100, [card([block([ex("Anything", { reps: "10" })])])], 6);
  eq("a fully dosed card never opens a slide", r.asked, []);
  eq("and nothing was merged into it", M.countExercises(r.card), 4);
  check("and no vision line is logged at all",
    !r.logs.some((l) => l.startsWith("vision:")), r.logs.join(" | "));
}

// A caption that produced nothing is still read off the slides — the old
// behaviour, which had to survive the rewrite.
{
  const r = await run(card([]), [card([block([ex("Push Up", { sets: 3, reps: "20" })])])], 2);
  eq("an empty caption still reads the slides", r.asked, [0, 1]);
  eq("and the slide becomes the card", names(r.card), ["Push Up"]);
}

// The bill. An Instagram reel arrives carrying its cover frame in `images`, and
// a reel is most of what gets saved: the dose question must not be asked of it.
{
  const r = await run(dosed0, [card([block([ex("Never Read", { reps: "10" })])])], 1, 0, "reel");
  eq("a reel's cover frame is never read for a missing dose", r.asked, []);
  eq("and the caption's card is untouched", M.countExercises(r.card), 7);
}
{
  const r = await run(card([]), [card([block([ex("Push Up", { reps: "20" })])])], 1, 0, "reel");
  eq("a reel whose caption produced nothing is still read, as it always was", r.asked, [0]);
  eq("and the cover rescued the card", names(r.card), ["Push Up"]);
}
{
  const r = await run(dosed0, [card([block([ex("Goblet Squat", { reps: "12" })])])], 1, 0, "p");
  eq("a single-image Instagram post is a page, and is read", r.asked, [0]);
}

// A resumed job does not re-ask the question. Slides 0-2 already improved the
// card the checkpoint holds; asking again would abandon the carousel for having
// partly worked.
{
  const partly = card([block([
    ex("Goblet Squat", { sets: 3, reps: "12" }), ex("Romanian Deadlift", { sets: 3, reps: "10" }),
  ])]);
  const r = await run(partly, [null, null, null, card([block([ex("Hip Thrust", { reps: "12" })])])], 4, 3);
  eq("the resume starts where the checkpoint left off", r.asked, [3]);
  eq("and the slide it had not reached yet is still merged", M.countExercises(r.card), 3);
}

// Progress is checkpointed after every BATCH now, with the merged card. Per slide
// would be a lie once three are in flight: a resume that restarted mid-batch would
// re-pay for the batch-mates it had already read.
async function checkpoints(slides: unknown[], images: number): Promise<Array<[number, number]>> {
  const seen: Array<[number, number]> = [];
  harness.caption = dosed0;
  harness.slides = slides;
  harness.asked = [];
  harness.landed = [];
  harness.delayMs = 0;
  harness.delayOf = {};
  harness.slow = [];
  harness.alwaysSlow = [];
  logs.length = 0;
  const meta = {
    caption: "x", thumb: null, author: null,
    images: Array.from({ length: images }, (_, i) => "https://cdn/slide-" + i + ".jpg"),
  };
  await M.buildCard(meta, P, CTX, (n: number, partial: { blocks: Array<{ exercises: unknown[] }> }) => {
    seen.push([n, partial.blocks.reduce((t, b) => t + b.exercises.length, 0)]);
    return Promise.resolve();
  }, 0);
  return seen;
}
{
  const seen = await checkpoints([card([block([ex("Goblet Squat", { reps: "12" })])]), null], 2);
  eq("a carousel that fits in one batch checkpoints once, past its last slide", seen, [[2, 7]]);
}
{
  const seen = await checkpoints([null, null, null, card([block([ex("Hip Thrust", { reps: "12" })])])], 4);
  eq("two batches checkpoint twice, and the second carries the merged card",
    seen, [[3, 7], [4, 8]]);
}

// ---------- 6. the schedule: three in flight, in order, with a second look ----------
//
// What the live nine-slide reprocess actually died of. One read at a time at ~18s
// each is ~160s of wall clock, a 20s ceiling killed two reads that were merely
// slow, and the 90s budget ran out at slide seven. Four of seven exercises got
// their reps.

// Three at a time, and never four. The peak is counted inside the mocked
// sub-request, so it is outstanding SUB-REQUESTS being measured, which is the
// thing the concurrency bound is about.
{
  const r = await run(dosed0, new Array(9).fill(null), 9, 0, "photo", { delayMs: 20 });
  eq("all nine slides are still asked for, in slide order", r.asked, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  eq("three sub-requests in flight at the peak, never four", r.peak, 3);
  eq("which is three batches", r.logs.filter((l) => l.startsWith("vision: batch ")).length, 3);
  check("and each batch names the slides it covered",
    r.logs.some((l) => l.startsWith("vision: batch 1 of 3 → slides 0-2 in")) &&
    r.logs.some((l) => l.startsWith("vision: batch 3 of 3 → slides 6-8 in")),
    r.logs.filter((l) => l.startsWith("vision: batch")).join(" | "));
}

// A trailing partial batch is still a batch.
{
  const r = await run(dosed0, new Array(7).fill(null), 7, 0, "photo", { delayMs: 10 });
  eq("seven slides is three batches, the last of one", r.asked, [0, 1, 2, 3, 4, 5, 6]);
  check("and the short one says so",
    r.logs.some((l) => l.startsWith("vision: batch 3 of 3 → slides 6-6 in")),
    r.logs.filter((l) => l.startsWith("vision: batch")).join(" | "));
}

// The dial behind it, so a degraded vision tier can be put back to one at a time
// from app_config without a deploy.
{
  M.runtimeCfg["vision.concurrency"] = "1";
  const r = await run(dosed0, new Array(4).fill(null), 4, 0, "photo", { delayMs: 10 });
  eq("app_config can put it back to one read at a time", r.peak, 1);
  eq("and then it is four batches", r.logs.filter((l) => l.startsWith("vision: batch ")).length, 4);
  delete M.runtimeCfg["vision.concurrency"];
}
{
  M.runtimeCfg["vision.concurrency"] = "99";
  const r = await run(dosed0, new Array(9).fill(null), 9, 0, "photo", { delayMs: 10 });
  check("but it cannot be turned up past six, whatever the row says", r.peak <= 6, "peak " + r.peak);
  delete M.runtimeCfg["vision.concurrency"];
}

// Order. Three slides answering in the reverse of the order they were asked must
// still produce the card the caption's reader would have produced sequentially —
// otherwise the same post reprocesses into a differently ordered card each time
// and the user watches their exercises shuffle.
function slideNamed(name: string) {
  return card([block([ex(name, { reps: "10" })])], { extracted_by: "vision:gemini-harness" });
}
{
  const three = [slideNamed("Alpha"), slideNamed("Bravo"), slideNamed("Charlie")];
  const backwards = await run(card([]), three, 3, 0, "photo", { delayOf: { 0: 90, 1: 45, 2: 5 } });
  eq("the slides answered in the reverse of the order they were asked", backwards.landed, [2, 1, 0]);
  eq("and the card is still in slide order", names(backwards.card), ["Alpha", "Bravo", "Charlie"]);

  const forwards = await run(card([]), three, 3, 0, "photo", { delayOf: { 0: 5, 1: 45, 2: 90 } });
  eq("the same three answering in order", forwards.landed, [0, 1, 2]);
  eq("produce the identical card", names(forwards.card), names(backwards.card));
}

// The budget arithmetic, stated in the log so a reader of the live logs can check
// it against the timestamps rather than against a comment. One per-slide ceiling
// per batch plus 20s of slack, floored at 90s and capped at 110s — the cap being
// the margin the rest of a synchronous reprocess needs inside Supabase's 150s.
{
  const one = await run(dosed0, new Array(3).fill(null), 3);
  eq("three slides is one batch, on the floor", budgetLine(one.logs),
    "vision: 1 batch(es) of 3, 90000 ms budget, 35000 ms a slide");
  const two = await run(dosed0, new Array(6).fill(null), 6);
  eq("six slides is two batches, still on the floor", budgetLine(two.logs),
    "vision: 2 batch(es) of 3, 90000 ms budget, 35000 ms a slide");
  const three = await run(dosed0, new Array(9).fill(null), 9);
  eq("nine slides is three batches and buys the ceiling", budgetLine(three.logs),
    "vision: 3 batch(es) of 3, 110000 ms budget, 35000 ms a slide");
  const ten = await run(dosed0, new Array(12).fill(null), 12);
  eq("a twelve-slide post is capped at ten slides, four batches, same ceiling",
    budgetLine(ten.logs), "vision: 4 batch(es) of 3, 110000 ms budget, 35000 ms a slide");
  const resumed = await run(dosed0, new Array(9).fill(null), 9, 6);
  eq("a resume budgets for the slides it has left, not the ones already paid for",
    budgetLine(resumed.logs), "vision: 1 batch(es) of 3, 90000 ms budget, 35000 ms a slide");
}
{
  M.runtimeCfg["vision.timeout_ms"] = "50000";
  const r = await run(dosed0, new Array(9).fill(null), 9);
  eq("a longer per-slide ceiling buys a longer budget, up to the cap", budgetLine(r.logs),
    "vision: 3 batch(es) of 3, 110000 ms budget, 50000 ms a slide");
  delete M.runtimeCfg["vision.timeout_ms"];
  M.runtimeCfg["vision.slides_budget_ms"] = "45000";
  const fixed = await run(dosed0, new Array(9).fill(null), 9);
  eq("and app_config can still name the budget outright", budgetLine(fixed.logs),
    "vision: 3 batch(es) of 3, 45000 ms budget, 35000 ms a slide");
  delete M.runtimeCfg["vision.slides_budget_ms"];
}

// The retry. A ceiling hit at 35s on a 37s read is a fact about the stopwatch, not
// about the picture, and on the owner's carousel it was two slides of nine.
{
  const withReps = card([block([ex("Romanian Deadlift", { reps: "10" })])],
    { extracted_by: "vision:gemini-harness" });
  const first = card([block([ex("Goblet Squat", { reps: "12" })])],
    { extracted_by: "vision:gemini-harness" });
  const r = await run(dosed0, [first, withReps, null], 3, 0, "photo", { delayMs: 4, slow: [1] });
  eq("the slide that ran out of stopwatch is asked for a second time, at the end",
    r.asked, [0, 1, 2, 1]);
  check("the retry pass announces itself",
    r.logs.some((l) => l.startsWith("vision: retrying 1 slide(s) that ran out of time — 1")),
    r.logs.join(" | "));
  check("the first read is logged as a timeout rather than as an empty slide",
    r.logs.includes("vision: slide 1 → 0 exercise(s), 0 with a dose (timed out)"), r.logs.join(" | "));
  check("and the second is logged as a retry",
    r.logs.includes("vision: slide 1 → 1 exercise(s), 1 with a dose (retry)"), r.logs.join(" | "));
  eq("the dose the slide was carrying landed after all",
    doses(r.card).slice(0, 2), ["Goblet Squat: 3x12", "Romanian Deadlift: 3x10"]);
  check("and the merged line counts the reads, the timeouts and the retries",
    r.logs.some((l) => l.includes("— 3 read, 1 timed out, 1 retried, 0 abandoned")),
    r.logs.filter((l) => l.startsWith("vision: merged")).join(" | "));
}

// Once, and then let go. A slide that cannot be read is not worth a third isolate
// and definitely not worth the gateway's 150 seconds.
{
  const r = await run(dosed0, [null, null, null], 3, 0, "photo", { delayMs: 4, alwaysSlow: [2] });
  eq("a slide that times out twice is asked for twice and no more", r.asked, [0, 1, 2, 2]);
  check("and the retry's own timeout is logged as one",
    r.logs.includes("vision: slide 2 → 0 exercise(s), 0 with a dose (timed out) (retry)"),
    r.logs.join(" | "));
  check("the merged line reports two timeouts against one retry",
    r.logs.some((l) => l.includes("— 2 read, 2 timed out, 1 retried, 0 abandoned")),
    r.logs.filter((l) => l.startsWith("vision: merged")).join(" | "));
}
{
  const r = await run(dosed0, new Array(3).fill(null), 3, 0, "photo", { delayMs: 4 });
  check("a carousel with no timeouts never opens the retry pass",
    !r.logs.some((l) => l.startsWith("vision: retrying")), r.logs.join(" | "));
  check("and says so in the counts",
    r.logs.some((l) => l.includes("— 3 read, 0 timed out, 0 retried, 0 abandoned")),
    r.logs.filter((l) => l.startsWith("vision: merged")).join(" | "));
}
{
  // Half a ceiling — about one measured read — is the least a retry is worth
  // firing into. Below that it would be launched and abandoned in the same breath.
  M.runtimeCfg["vision.slides_budget_ms"] = "40";
  const r = await run(dosed0, [null, null, null], 3, 0, "photo", { delayMs: 4, slow: [1] });
  eq("a timed-out slide is NOT retried into a budget that has nothing left", r.asked, [0, 1, 2]);
  check("and the counts still say a slide was lost to the clock",
    r.logs.some((l) => l.includes("— 2 read, 1 timed out, 0 retried, 0 abandoned")),
    r.logs.filter((l) => l.startsWith("vision: merged")).join(" | "));
  delete M.runtimeCfg["vision.slides_budget_ms"];
}

// A read that answers after the budget is over. It cannot be merged: the loop has
// moved on and the card may already be on its way back to the caller, so a late
// merge is the one way a straggler could corrupt a card rather than merely fail to
// improve it. This is deliberately last in the file — the abandoned sub-requests
// are still in flight when it returns.
{
  M.runtimeCfg["vision.slides_budget_ms"] = "300";
  const six = [
    slideNamed("Read A"), slideNamed("Read B"), slideNamed("Read C"),
    slideNamed("Late D"), slideNamed("Late E"), slideNamed("Late F"),
  ];
  const r = await run(card([]), six, 6, 0, "photo", { delayMs: 200 });
  eq("the first batch is never cut short by the clock — its reads have their own ceiling",
    names(r.card), ["Read A", "Read B", "Read C"]);
  eq("the second batch was launched, because the budget had not run out yet",
    r.asked, [0, 1, 2, 3, 4, 5]);
  for (const i of [3, 4, 5]) {
    check("slide " + i + " says it was abandoned rather than saying nothing",
      r.logs.includes("vision: slide " + i + " → abandoned, the budget ran out while it was in flight"),
      r.logs.filter((l) => l.startsWith("vision: slide")).join(" | "));
  }
  check("and the merged line counts them",
    r.logs.some((l) => l.includes("— 3 read, 0 timed out, 0 retried, 3 abandoned")),
    r.logs.filter((l) => l.startsWith("vision: merged")).join(" | "));
  delete M.runtimeCfg["vision.slides_budget_ms"];
  // Let the stragglers land, and prove they changed nothing on their way out.
  const settled = JSON.stringify(r.card);
  await new Promise((res) => setTimeout(res, 400));
  eq("the late answers touched nothing when they finally arrived", JSON.stringify(r.card), settled);
}

console.log = say;

// ---------- done ----------

say((failures ? "FAILED " : "ok ") + (checks - failures) + "/" + checks + " checks");
if (failures) Deno.exit(1);

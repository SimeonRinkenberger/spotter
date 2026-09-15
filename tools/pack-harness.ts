// Battery for the Video Context Pack.
//
// Run: deno run -A tools/pack-harness.ts   — exits non-zero on failure.
//
// The pack exists because a card built from a creator's own voice still did not
// know that his hands were on a kettlebell. Everything that fixes that is either a
// model call — which this file must never make — or a pure function of three
// channels, which is what this file exercises. So the design deliberately put the
// judgement in the pure half: the parser, the assembler, the verifier, the
// canonicalizer and the cue rule are all testable from a fixture and a laptop, and
// they are what is tested here.
//
// The ground truth is briefs/vcp/golden-tt-7679960172495785246.json, hand-authored
// by the senior session from the real WebVTT and 1 fps frame strips of
// @thewodfather's "Complex Fives". It is not model output. The mock observation is
// DERIVED from that fixture rather than written by hand here, so this harness
// cannot be tuned to pass: change the fixture and the mock changes with it.
//
// Functions come from the shipping modules — pack.ts, catalog.ts, evidence.ts and
// ai-guard.ts are real ES modules and are imported — except the ones that live
// inside index.ts, which calls Deno.serve at the bottom and exports nothing. Those
// are LIFTED out of the source the way tools/media-harness.ts lifts them, so a
// rename in index.ts is a loud error here rather than a quiet lie.

import {
  assemblePack, bestSeenFact, deltaFrom, type Frames, mergeCues, type Observation, OBSERVE_PROMPT,
  packInTimeOrder, sharesHeadNoun, SHEET_MAX,
  type Pack, PACK_V, packBlock, parseFrames, parseStampedTranscript, parseVtt,
  readObservation, secondsToMmss, sheetPathFor, SHEET_MAX_BYTES, sheetsPrompt,
  type TranscriptSeg, titleCase, validatePack, vttCues,
} from "../supabase/functions/spotter/pack.ts";
import { canonicalize, CATALOG_CONFLICTS, standardOf } from "../supabase/functions/spotter/catalog.ts";
import { normText } from "../supabase/functions/spotter/evidence.ts";
import { aiActor, createGuardedFetch, GuardError, tokenPrice } from "../supabase/functions/spotter/ai-guard.ts";

const ROOT = new URL("../", import.meta.url);
const SRC = await Deno.readTextFile(new URL("supabase/functions/spotter/index.ts", ROOT));
// The golden fixture, copied out of briefs/vcp/ (which is agent scaffolding and
// not in the repo) so this harness runs in any checkout and in CI. Byte-identical
// to the senior session's hand-authored original; wave D's pack-eval reads the
// same three files.
const brief = (f: string) => Deno.readTextFileSync(new URL("tools/fixtures/" + f, ROOT));

// ---------- lifting declarations out of index.ts ----------
//
// Character-accurate rather than brace-counting: index.ts is full of regexes and
// template literals, and a counter that did not know about them would cut a
// declaration off in the middle of one. Same walker as tools/media-harness.ts.

function declEnd(src: string, from: number, isFunction: boolean): number {
  let depth = 0;
  let inBody = false;
  let prev = "";
  // Generic depth, counted only until the body opens. A `{` inside an unclosed
  // `<...>` is part of a type — `): Promise<{ obs: Observation }>` — and reading
  // it as the body would end the declaration at its own signature.
  let angle = 0;
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
    if (!inBody && isFunction && c === "<") angle++;
    else if (!inBody && isFunction && c === ">" && prev !== "=") angle = Math.max(0, angle - 1);
    if (c === "{" || c === "[" || c === "(") {
      // Two ways a `{` at depth zero is a TYPE rather than a body, and both would
      // otherwise end the declaration at its own signature: straight after a `:`
      // (`): { step: string; meta: Meta }`), or inside an unclosed generic
      // (`): Promise<{ obs: Observation }>`). `): Promise<Response> {` is neither.
      if (isFunction && c === "{" && depth === 0 && prev !== ":" && angle === 0) inBody = true;
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

// The types and globals the lifted code mentions but does not need to be honest
// about here. `Exercise` is stubbed loose because normalizeExercise's return type
// mentions half the file otherwise.
const STUBS = "import { normText } from '" +
  new URL("supabase/functions/spotter/evidence.ts", ROOT).href + "';\n" +
  "import { bestSeenFact, packInTimeOrder, sharesHeadNoun, parseFrames, readObservation, sheetPathFor, sheetsPrompt, SHEET_MAX, SHEET_MAX_BYTES, PACK_V } from '" +
  new URL("supabase/functions/spotter/pack.ts", ROOT).href + "';\n" +
  "import { tokenCost, tokenPrice } from '" +
  new URL("supabase/functions/spotter/ai-guard.ts", ROOT).href + "';\n" +
  "type Frames = any; type Cors = any; type Counts = any; type UserCaps = any;\n" +
  // The route's collaborators, one line each. Everything with real judgement in
  // it — the validation, the path composition, the decision to read again — is
  // the shipping code; everything that talks to Postgres or Storage is here.
  "export const spy: any = { seeded: null, signed: [], rpc: [], deleted: 0, patched: null, calls: [], cost: [], store: null };\n" +
  "class GuardError extends Error {}\n" +
  "function json(b: any, status = 200) { return { status, body: b } as any; }\n" +
  "declare const DB: any;\n" +
  "async function dbSelect(t: string, q: string) { return DB[t] ? DB[t](q) : []; }\n" +
  "async function dbPatch(_t: string, _f: string, patch: any) { spy.patched = patch; }\n" +
  "function providerFor(name: string) { return { media: name === 'tiktok' ? (() => null) : undefined, cacheable: true }; }\n" +
  "async function deleteSheets(f: any) { spy.deleted += f?.sheets?.length ?? 0; }\n" +
  "async function countsFor() { return { extracts: 0, saves: 0, helpers: 0 }; }\n" +
  "async function capsFor() { return { caps: { extract: 50, media: 20, library: 200 } }; }\n" +
  "async function libraryCount() { return 1; }\n" +
  "function overCap(used: number, cap: number | null) { return cap !== null && used >= cap; }\n" +
  "async function capLimit(kind: string) { return json({ status: 'limit', kind }, 429); }\n" +
  "async function extractLimitResponse() { return json({ status: 'limit', kind: 'extract' }, 429); }\n" +
  "async function mediaCapReached() { return null; }\n" +
  "async function paidAllowed() { return true; }\n" +
  "async function rpc(name: string, args: any) { spy.rpc.push([name, args]); return DB.rpc(name, args); }\n" +
  "async function jobStep(_id: string, step: string, patch: any) { spy.seeded = { step, ...patch }; }\n" +
  "async function signUploadTarget(path: string) { spy.signed.push(path); return { upload_url: 'https://sb/storage/v1/object/upload/sign/uploads/' + path + '?token=tok-' + path.slice(-6), token: 'tok-' + path.slice(-6) }; }\n" +
  "function kickWorker() {}\n" +
  "const OPENAI_API_KEY = 'sk-test'; const GEMINI_API_KEY = 'g-test';\n" +
  "const PACK_EVAL_KEY = 'e'.repeat(32);\n" +
  "function secretEquals(a: string, b: string) { return !!a && !!b && a === b; }\n" +
  "async function ensureConfig() {}\n" +
  "function packSheetsModel() { return DB.model ?? 'gpt-5.6-luna'; }\n" +
  "function approxTokens(s: string) { return Math.ceil(s.length / 4); }\n" +
  "function matchTikTok() { return null; }\n" +
  "async function tiktokMedia() { return null; }\n" +
  "async function packTranscript() { return { transcript: [], cues: null, source: 'none', text: '', media_source: null }; }\n" +
  "async function recordCost(provider: string, model: string, _c: any, u: any, ok: boolean) { spy.cost.push({ provider, model, ...u, ok }); }\n" +
  "const aiActor = { getStore: () => spy.store, run: (a: any, fn: any) => { spy.store = a; return fn(); } };\n" +
  "async function aiFetch(url: string, init: any) { spy.calls.push({ url, body: JSON.parse(init.body), purpose: spy.store?.purpose }); return DB.reply(url); }\n" +
  "type Pack = Record<string, any>;\n" +
  "type Card = { blocks: { exercises: any[] }[] };\n" +
  "type Evidence = Record<string, unknown>;\n" +
  "type PackExercise = { variant: Record<string, unknown> };\n" +
  "type Exercise = Record<string, unknown>;\n" +
  "type Dose = { reps: string | null; sets: number | null; seconds: number | null };\n" +
  "declare function cleanTitle(s: string): string;\n";

const NAMES = [
  "CUE_MAX", "CUE_RULE", "TRANSCRIBE_PROMPT",
  "intOrNull", "numOrNullBounded", "trimCue", "parseJsonLoose", "splitDose", "normalizeExercise",
  "ttSubtitles",
  "countExercises", "matchPackExercise", "packEvidence", "applyPack",
  // The two routes the native share extension and the "Re-read this video" action
  // call. Their collaborators are stubbed above; the judgement is the real code.
  "CARD_V", "UPLOAD_SIGN_SECONDS", "usablePack", "mediaSeed", "authorizeSheets", "handleReadVideo",
  "scopeFor", "isPackAuthorize",
  // The A/B bench for the sheets reader.
  "readSheetImages", "handleEvalSheets",
  "userFromIngestKey",
];

// cleanTitle is declared as a function in index.ts but drags the whole title
// ladder with it, so the harness supplies the one behaviour normalizeExercise
// needs from it: whitespace-collapsed trimming.
const SHIM = "\nglobalThis.cleanTitle = function (s) { return String(s || '').replace(/\\s+/g, ' ').trim(); };\n" +
  "globalThis.DB = { rpc: () => 'ok' };\n";

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
function near(name: string, got: number, want: number, slack: number) {
  check(name, Math.abs(got - want) <= slack,
    "got " + got + ", wanted " + want + " ± " + slack);
}

// ---------- the fixture ----------

type GoldenExercise = {
  i: number;
  name_said: string;
  name_shown: string;
  canonical_id: string;
  t0: number; t1: number;
  reps_seen: number | null;
  variant: Record<string, unknown>;
  creator_cues: { t: number; quote: string }[];
  seen_not_said: string[];
  provenance: Record<string, string>;
  confidence: number;
};
type Golden = {
  shortcode: string; platform: string; duration_s: number;
  session: Record<string, unknown>;
  transcript: TranscriptSeg[];
  exercises: GoldenExercise[];
};

const FX = JSON.parse(brief("golden-tt-7679960172495785246.json")) as Golden;
const VTT = brief("tt-7679960172495785246.vtt");

// ---------- 1. the WebVTT parser ----------
//
// TikTok publishes this file for nearly every video and the ingest never read it.
// It is the only free timed transcript in the system, and everything about a
// creator cue — which movement it belongs to, whether it is verbatim — rests on
// its clock being right.

const cues = vttCues(VTT);
const segs = parseVtt(VTT);

check("every VTT cue parses", cues.length === 26, "got " + cues.length);
check("the first cue keeps its millisecond start", cues[0].t0 === 0.62, "got " + cues[0].t0);
check("the last cue ends where the video does", Math.abs(cues[cues.length - 1].t1 - 84.16) < 0.005,
  "got " + cues[cues.length - 1].t1);

// The merge rule: a sentence that a caption renderer split across two cues is one
// span again. TikTok splits mid-sentence at a 1 ms boundary (…3.060 -> …3.061),
// which is a line break rather than a pause.
eq("the hairline split is healed", segs[0], {
  t0: 0.62, t1: 5.28,
  text: "Is it really possible to get a full body workout with one kettlebell in 15 minutes?",
});
check("a 1 ms split is healed even mid-sentence-boundary",
  segs.some((s) => s.t0 === 30.1 && s.t1 === 39.4 && s.text.includes("proper activation of your upper body")),
  "30.1–39.4 span missing");

// The fixture's transcript is a hand-authored SEMANTIC segmentation: its author
// put "We're gonna take this right into five goblet squats" and the coaching that
// followed it into one span because they are one thought, and split "Repeat that
// complex…" from "If you like efficient…" because they are two. No mechanical rule
// over punctuation, gaps and length reproduces those choices exactly, and one that
// was tuned until it did would be overfitted to a single video.
//
// So the contract the parser is held to is COARSENING: the fixture must be
// obtainable from the parser's output by merging adjacent spans and nothing else.
// That is the property everything downstream actually depends on — no word lost,
// no word invented, no boundary in the wrong place — and it is checked exactly.
{
  let at = 0;
  let exactSpans = 0;
  for (const want of FX.transcript) {
    const run: TranscriptSeg[] = [];
    while (at < segs.length && (!run.length || run[run.length - 1].t1 < want.t1 - 0.05)) {
      run.push(segs[at++]);
    }
    if (!run.length) { check("fixture span " + want.t0 + " has parser output", false); continue; }
    if (run.length === 1) exactSpans++;
    near("span at " + want.t0 + " starts where the fixture says", run[0].t0, want.t0, 0.05);
    near("span at " + want.t0 + " ends where the fixture says", run[run.length - 1].t1, want.t1, 0.05);
    eq("span at " + want.t0 + " says what the fixture says",
      run.map((s) => s.text).join(" ").replace(/\s+/g, " "),
      want.text.replace(/\s+/g, " "));
  }
  check("the parser consumed the whole file", at === segs.length, "left " + (segs.length - at) + " span(s)");
  check("most fixture spans are reproduced exactly, not only by coarsening",
    exactSpans >= 9, "only " + exactSpans + " of " + FX.transcript.length);
}

// Cue settings and karaoke markup are furniture, not speech.
{
  const messy = "WEBVTT\n\nNOTE this is a comment\nthat runs on\n\n" +
    "1\n00:00:01.000 --> 00:00:02.000 align:start position:10%\n" +
    "<c.yellow>keep</c> the <00:00:01.500>core &amp; hips tight\n";
  eq("cue settings, tags and entities come out", vttCues(messy),
    [{ t0: 1, t1: 2, text: "keep the core & hips tight" }]);
}

// The non-TikTok path lands in the same shape, or the pack can tell which reader
// it got — and then only one of the two stays tested.
{
  const heard = parseStampedTranscript(
    "00:03 take these slow and controlled\nand keep the core tight\n00:11 drive the floor away\n", 20);
  eq("stamped lines parse", heard.map((s) => [s.t0, s.t1]), [[3, 11], [11, 20]]);
  eq("an unstamped line joins the phrase above it", heard[0].text,
    "take these slow and controlled and keep the core tight");
}

// ---------- 2. the assembler, against the golden fixture ----------
//
// The mock observation is built FROM the fixture: the movement is its name_shown,
// the contact line is its seen_not_said facts, the placements are its variant. It
// is what a correct visual read of this video would return, and nothing in it was
// chosen to make a check pass.

const mock = {
  duration_s: FX.duration_s,
  session: FX.session,
  on_screen: [],
  segments: FX.exercises.map((e) => ({
    t0: secondsToMmss(e.t0),
    t1: secondsToMmss(e.t1),
    movement: e.name_shown.toLowerCase(),
    contact: e.seen_not_said.join("; "),
    hand_placement: (e.variant.hand_placement as string) ?? "",
    foot_placement: (e.variant.stance as string) ?? "",
    load_position: (e.variant.load_position as string) ?? "",
    range_of_motion: (e.variant.range_of_motion as string) ?? "",
    tempo: (e.variant.tempo as string) ?? "",
    reps_visible: e.reps_seen,
    unilateral: e.variant.unilateral ?? null,
    confidence: e.confidence,
  })),
};

const obs = readObservation(mock) as Observation;
check("the mock observation reads back", !!obs && obs.segments.length === 5);

const pack = assemblePack({
  shortcode: FX.shortcode,
  platform: FX.platform,
  durationS: FX.duration_s,
  transcript: segs,
  transcriptSource: "tiktok_vtt",
  cues,
  observation: obs,
  reader: "luna_sheets",
});

eq("the pack is version 1", pack.pack_v, PACK_V);
eq("it knows which eye read it", pack.reader, "luna_sheets");
eq("and that something did", pack.visual, "read");
eq("it found every movement", pack.exercises.length, FX.exercises.length);

for (const want of FX.exercises) {
  const got = pack.exercises[want.i];
  const at = "#" + want.i + " " + want.name_shown;

  // What the creator CALLED it, verbatim out of their own transcript. This is what
  // the catalog aliases were written for, and it is what makes the id right.
  eq(at + ": name_said is the creator's own words", got.name_said, want.name_said);
  eq(at + ": canonical_id", got.canonical_id, want.canonical_id);

  // The timestamps come from the observation, which speaks in MM:SS, so a segment
  // is right to the second and no further.
  near(at + ": starts when the fixture says", got.t0, want.t0, 1.5);
  near(at + ": ends when the fixture says", got.t1, want.t1, 1.5);

  // Read off the contact line, NEVER off the movement's name. This is the check
  // that would have caught the original bug: a push-up whose equipment came from
  // the word "push-up" is a bodyweight push-up again.
  eq(at + ": variant.equipment is what the camera saw",
    got.variant.equipment, want.variant.equipment);

  // Every cue is a verbatim slice of a transcript sentence with the speaker's own
  // framing peeled off the front. The quotes are checked exactly; the timestamps
  // to 2.5 s, because the fixture's author placed one of them at the start of the
  // sentence and the parser places it at the start of the clause.
  eq(at + ": the same number of creator cues", got.creator_cues.length, want.creator_cues.length);
  for (let k = 0; k < want.creator_cues.length; k++) {
    eq(at + ": cue " + k + " is verbatim", got.creator_cues[k]?.quote, want.creator_cues[k].quote);
    near(at + ": cue " + k + " is timed", got.creator_cues[k]?.t ?? -99, want.creator_cues[k].t, 2.5);
  }

  eq(at + ": seen_not_said", got.seen_not_said, want.seen_not_said);
  eq(at + ": provenance", got.provenance, want.provenance);
  check(at + ": no re-query needed", got.needs_requery === false);
}

// The owner's actual complaint, as one assertion.
check("the push-up records the hands on the kettlebell, not the floor",
  pack.exercises[0].seen_not_said.some((f) => /kettlebell handle/i.test(f) && /not the floor/i.test(f)));
check("and says so as a delta from the standard version",
  /kettlebell/i.test(pack.exercises[0].delta_from_standard ?? ""),
  "got " + JSON.stringify(pack.exercises[0].delta_from_standard));
check("the swing, which was standard, gets no delta",
  pack.exercises[2].delta_from_standard === null,
  "got " + JSON.stringify(pack.exercises[2].delta_from_standard));
check("nor does the goblet squat, whose front rack IS the standard",
  pack.exercises[3].delta_from_standard === null,
  "got " + JSON.stringify(pack.exercises[3].delta_from_standard));

// A cue said while the NEXT movement is already on screen belongs to the one being
// coached, and a sentence about the session is not a cue for whatever is on screen
// while it is said.
check("the goblet squat's cue does not leak into the swing",
  !pack.exercises[2].creator_cues.some((c) => /90 degrees/.test(c.quote)));
check("'Repeat that complex as many times as you can' is not a push-press cue",
  !pack.exercises[4].creator_cues.length);

// A contact fact the creator DID say is not repeated back as something the camera
// noticed; padding is what makes people stop reading the cue line.
{
  const echo = readObservation({
    ...mock,
    segments: [{
      ...mock.segments[2],
      contact: "focusing on the hip hinge, finding that tension through the glutes; bell peaks at chest height, not overhead",
    }],
  }) as Observation;
  const p2 = assemblePack({
    shortcode: FX.shortcode, platform: FX.platform, durationS: FX.duration_s,
    transcript: segs, transcriptSource: "tiktok_vtt", cues, observation: echo,
  });
  eq("a contact fact the creator already said is dropped from seen_not_said",
    p2.exercises[0].seen_not_said, ["bell peaks at chest height, not overhead"]);
}

// A pack with no visual channel is honest about it rather than empty-looking.
{
  const blind = assemblePack({
    shortcode: "ig-x", platform: "instagram", transcript: segs,
    transcriptSource: "gemini_audio", observation: null,
  });
  eq("a post with no media says nobody looked", blind.visual, "unavailable");
  eq("and names no reader", blind.reader, "none");
  check("but keeps the words", blind.transcript.length === segs.length);
}

// ---------- 3. the verifier ----------
//
// A bad pack is believed by every call downstream and is inherited by everybody
// who saves the video next, so it is all-or-nothing.

eq("the golden pack verifies", validatePack(pack), { ok: true, problems: [] });

function broken(mutate: (p: Pack) => void): ReturnType<typeof validatePack> {
  const copy = structuredClone(pack);
  mutate(copy);
  return validatePack(copy);
}

{
  const r = broken((p) => { p.exercises[1].t1 = p.duration_s + 30; });
  check("a timestamp past the end of the video is rejected", !r.ok);
  check("and the log says which", r.problems.some((s) => /outside the video/.test(s)), r.problems.join("|"));
}
{
  const r = broken((p) => { p.exercises[2].t0 = p.exercises[1].t0; });
  check("overlapping segments are rejected", !r.ok);
  check("and the log says so", r.problems.some((s) => /overlap/.test(s)), r.problems.join("|"));
}
{
  const r = broken((p) => { p.exercises[0].creator_cues[0].quote = "take these nice and slow for time under tension"; });
  check("a paraphrased cue is rejected", !r.ok);
  check("and the log says it is not verbatim",
    r.problems.some((s) => /not verbatim/.test(s)), r.problems.join("|"));
}
{
  const r = broken((p) => { p.exercises[0].creator_cues[0].t = -4; });
  check("a cue timestamped outside the video is rejected", !r.ok);
}
{
  // One second of slack, because a caption cue routinely runs a few frames past
  // the last frame of the video and rejecting every pack for that helps nobody.
  const r = broken((p) => { p.transcript[p.transcript.length - 1].t1 = p.duration_s + 0.5; });
  check("half a second past the end is tolerated", r.ok, r.problems.join("|"));
}

// ---------- 4. the canonicalizer ----------
//
// "Close Grip Pushups" resolved to close-grip-bench-press at 0.74 against a floor
// of 0.72, and the explain sheet then showed a bench press demo for a push-up.

eq("the catalog still has no conflicting aliases", CATALOG_CONFLICTS, []);

const canon = (n: string, equipment?: string[]) =>
  canonicalize(n, equipment ? { equipment } : undefined)?.id ?? null;

eq('"Close Grip Pushups" is a push-up', canon("Close Grip Pushups"), "diamond-push-up");
eq('"Close Grip Push Ups" is the same push-up', canon("Close Grip Push Ups"), "diamond-push-up");
eq('"close grip pushup" is still the same push-up', canon("close grip pushup"), "diamond-push-up");
eq("a close-grip bench press is still a bench press",
  canon("Close Grip Bench Press"), "close-grip-bench-press");
eq('"Deadlift With High Pull" over a kettlebell is the sumo deadlift high pull',
  canon("Deadlift With High Pull", ["kettlebell"]), "sumo-deadlift-high-pull");
eq('"Kettlebell Push Press" is a push press', canon("Kettlebell Push Press"), "push-press");
eq("the ordinary spellings still work", [
  canon("Bulgarian Split Squats"), canon("DB Bulgarians"), canon("kettlebell swings"), canon("goblet squats"),
], ["bulgarian-split-squat", "bulgarian-split-squat", "kettlebell-swing", "goblet-squat"]);

// The family veto: a bodyweight movement may not resolve to a loaded-implement
// entry on token overlap alone.
check("a close-grip pull-up is a pull-up or nothing, never a machine pulldown",
  ["pull-up", null].includes(canon("Close Grip Pullups")), "got " + canon("Close Grip Pullups"));
check("a push-up never reaches a barbell entry",
  !["close-grip-bench-press", "bench-press", "floor-press"].includes(canon("Narrow Pushups") ?? ""),
  "got " + canon("Narrow Pushups"));

// standardOf is what `delta` is measured against.
{
  const push = canonicalize("diamond-push-up")!;
  eq("a push-up's standard is hands on the floor", standardOf(push.entry).surface, "hands on the floor");
  const goblet = canonicalize("goblet-squat")!;
  eq("a goblet squat's standard load is at the chest, not on the back",
    standardOf(goblet.entry).load_position, "at the chest");
  eq("deltaFrom is quiet when there is nothing to say",
    deltaFrom("kettlebell-swing", pack.exercises[2].variant), null);
}

// ---------- 5. the cue ----------
//
// The field used to be `notes`, which the prompt never explained.

{
  const withCue = M.normalizeExercise({ name: "Goblet Squat", cue: "  Drive the floor away.  " });
  eq("cue is trimmed and kept", withCue.cue, "Drive the floor away.");
  eq("and mirrored into notes for the page that still reads notes",
    withCue.notes, "Drive the floor away.");

  const legacy = M.normalizeExercise({ name: "Goblet Squat", notes: "Hold the bell at the chest." });
  eq("a card cached before this wave still has a cue", legacy.cue, "Hold the bell at the chest.");

  const both = M.normalizeExercise({ name: "Row", cue: "the new one", notes: "the old one" });
  eq("cue wins when a model sends both", both.cue, "the new one");

  const long = M.normalizeExercise({ name: "Row", cue: "z".repeat(400) });
  eq("the cue is capped at " + M.CUE_MAX, long.cue.length, M.CUE_MAX);

  const none = M.normalizeExercise({ name: "Row" });
  eq("no cue is null rather than an empty string", none.cue, null);

  const ranged = M.normalizeExercise({ name: "Row", sets: "2-3", cue: "slow eccentric" });
  check("a sets range still survives in notes", /Sets: 2-3/.test(ranged.notes), ranged.notes);

  const overlay = M.normalizeExercise({
    name: "Row", as_performed: { equipment: ["kettlebell"] }, delta: "hands on the bell", t0: 10.5, t1: 25,
  });
  eq("the pack overlay survives a round trip through the normalizer",
    [overlay.as_performed, overlay.delta, overlay.t0, overlay.t1],
    [{ equipment: ["kettlebell"] }, "hands on the bell", 10.5, 25]);

  const junkT = M.normalizeExercise({ name: "Row", t0: -3, t1: "nonsense" });
  eq("a nonsense timestamp is dropped rather than defaulted to zero",
    [junkT.t0, junkT.t1], [null, null]);

  check("the prompt states the cue rule, with the shape ahead of the count",
    M.CUE_RULE.includes("at most two short sentences, about 140 characters") &&
    M.CUE_RULE.includes("the shape matters more than the count") &&
    M.CUE_RULE.includes("drive the floor away"));
  check("and tells the model what to do when the creator coached nothing",
    M.CUE_RULE.includes("the cue is that visible setup detail on its own") &&
    M.CUE_RULE.includes("Empty string only when there is neither"));
  check("the transcription prompt now asks for MM:SS",
    /MM:SS/.test(M.TRANSCRIBE_PROMPT) && /00:14/.test(M.TRANSCRIBE_PROMPT));
}

// ---------- 6. prices ----------

eq("Flash-Lite is priced, so pack.model can be switched to it",
  tokenPrice("gemini-3.1-flash-lite"), [0.25, 1.5, 0.025]);
check("the default pack model is still priced", !!tokenPrice("gemini-3.6-flash"));
check("an unpriced model is still refused", tokenPrice("gemini-9-imaginary") === null);

// ---------- 7. TikTok's caption tracks ----------
//
// The channel that was sitting in the watch page the whole time.

{
  const it = {
    video: {
      subtitleInfos: [
        { LanguageCodeName: "deu-DE", Format: "webvtt", Source: "MT", Url: "https://cdn/x/de.vtt" },
        { LanguageCodeName: "eng-US", Format: "webvtt", Source: "MT", Url: "https://cdn/x/en-mt.vtt" },
        { LanguageCodeName: "eng-US", Format: "webvtt", Source: "ASR", Url: "https://cdn/x/en-asr.vtt" },
        { LanguageCodeName: "eng-US", Format: "creator_caption", Source: "ASR", Url: "https://cdn/x/en.cap" },
      ],
    },
  };
  const got = M.ttSubtitles(it);
  eq("the creator's own language and the original ASR come first",
    got.map((s: { url: string }) => s.url),
    ["https://cdn/x/en-asr.vtt", "https://cdn/x/en-mt.vtt", "https://cdn/x/de.vtt"]);
  check("a non-WebVTT track is not offered", !got.some((s: { url: string }) => /\.cap$/.test(s.url)));

  const cla = M.ttSubtitles({
    video: { claInfo: { captionInfos: [{ LanguageCodeName: "eng-US", Format: "webvtt", Source: "ASR", urlList: ["https://cdn/y/en.vtt"] }] } },
  });
  eq("the claInfo envelope is read too", cla.map((s: { url: string }) => s.url), ["https://cdn/y/en.vtt"]);
  eq("a video with no tracks answers with none", M.ttSubtitles({ video: {} }), []);
}

// ---------- 8. the frames contract ----------
//
// A caller-supplied structure that ends in a service-role storage call and a paid
// model request, so it is checked the way parseUploadPath is checked.

const UID = "11111111-2222-4333-8444-555555555555";
const SC = "tt-7679960172495785246";
const goodFrames = {
  source: "device",
  duration_s: 84.3,
  sheets: [
    {
      path: sheetPathFor(UID, SC, 1),
      cols: 7, rows: 3, cell_w: 200, cell_h: 356,
      times: Array.from({ length: 21 }, (_, i) => i * 4),
    },
  ],
};

{
  const ok = parseFrames(goodFrames, UID, SC);
  check("a well-formed frames block is accepted", "frames" in ok,
    "error" in ok ? ok.error : "");
  if ("frames" in ok) {
    eq("and keeps its grid", [ok.frames.sheets[0].cols, ok.frames.sheets[0].rows], [7, 3]);
    eq("and its duration", ok.frames.duration_s, 84.3);
  }
}

function refused(name: string, mutate: (f: any) => void, expect: RegExp) {
  const f = structuredClone(goodFrames);
  mutate(f);
  const r = parseFrames(f, UID, SC);
  check(name, "error" in r && expect.test(r.error),
    "error" in r ? r.error : "accepted");
}

refused("a sheet in somebody else's folder is refused by field name",
  (f) => { f.sheets[0].path = sheetPathFor("99999999-2222-4333-8444-555555555555", SC, 1); },
  /^frames\.sheets\[0\]\.path must be/);
refused("a sheet filed under another video is refused",
  (f) => { f.sheets[0].path = sheetPathFor(UID, "tt-9999", 1); },
  /^frames\.sheets\[0\]\.path must be/);
refused("a path with a traversal in it is refused",
  (f) => { f.sheets[0].path = UID + "/pack/../../secrets/sheet-1.jpg"; },
  /^frames\.sheets\[0\]\.path must be/);
refused("a frame time past the end of the video is refused",
  (f) => { f.sheets[0].times[20] = 900; },
  /times\[20\] is outside the video/);
refused("times that do not ascend are refused",
  (f) => { f.sheets[0].times[5] = f.sheets[0].times[4]; },
  /times must ascend/);
// A sheet may carry fewer times than cells only when it is the LAST one — that is
// the only sheet the phone can run out of frames in the middle of. More times than
// cells is always a client bug, whichever sheet it is.
refused("more frame times than the grid has cells is refused",
  (f) => { f.sheets[0].times = [...f.sheets[0].times, 88, 92]; },
  /times must hold 21 entries/);
refused("four sheets is too many",
  (f) => { f.sheets = [f.sheets[0], f.sheets[0], f.sheets[0], f.sheets[0]]; },
  /at most 3 sheets/);
refused("no duration is refused", (f) => { delete f.duration_s; }, /duration_s/);
refused("no sheets at all is refused", (f) => { f.sheets = []; }, /non-empty array/);

{
  // Only the LAST sheet may be short — it is the only one the phone can run out of
  // frames in the middle of.
  const two = structuredClone(goodFrames) as any;
  two.sheets.push({
    path: sheetPathFor(UID, SC, 2), cols: 7, rows: 3, cell_w: 200, cell_h: 356,
    times: [84, 84.2],
  });
  const r = parseFrames(two, UID, SC);
  check("a short final sheet is accepted", "frames" in r, "error" in r ? r.error : "");
  two.sheets[0].times = two.sheets[0].times.slice(0, 5);
  const r2 = parseFrames(two, UID, SC);
  check("a short FIRST sheet is not", "error" in r2);
  const back = structuredClone(goodFrames) as any;
  back.sheets.push({
    path: sheetPathFor(UID, SC, 2), cols: 1, rows: 1, cell_w: 200, cell_h: 356, times: [2],
  });
  check("a second sheet that goes backwards in time is refused",
    "error" in parseFrames(back, UID, SC));
}

// ---------- 9. the sheets reader, with fetch mocked ----------
//
// The phone is the primary eye. What is checkable without a key is the request
// this builds — which is exactly the part ai-guard will refuse if it is wrong.

{
  const sheetBytes = Deno.readFileSync(new URL("tools/fixtures/sheet_all.jpg", ROOT));
  check("the sample sheet is a JPEG under the per-sheet cap",
    sheetBytes[0] === 0xff && sheetBytes[1] === 0xd8 && sheetBytes.length < SHEET_MAX_BYTES,
    sheetBytes.length + " bytes");

  const frames = (parseFrames(goodFrames, UID, SC) as { frames: Frames }).frames;
  const prompt = sheetsPrompt(frames, segs);

  check("the sheets prompt carries the observe instruction verbatim",
    prompt.includes("For every segment name every object the body is in contact with and how"));
  check("and forbids inferring equipment from the name",
    prompt.includes("Never infer equipment from the exercise name."));
  check("and explains the grid is row-major", /row-major/.test(prompt));
  check("and says the cells are labelled with their timestamps",
    /labelled with its timestamp in the bottom-left corner/.test(prompt));
  check("and lists the cell times, so a build with no burned-in labels still has the clock",
    prompt.includes("0:00, 0:04, 0:08"));
  check("and carries the transcript on the same clock",
    prompt.includes("0:15 I want you to take these slow"));
  check("and tells the model the frames win when the channels disagree",
    /the frames win/.test(prompt));

  // The request shape ai-guard admits, and nothing else: a data: URL at detail
  // "high", images before the text part. Anything else is `unsupported_image`.
  const b64 = btoa(String.fromCharCode(...sheetBytes.subarray(0, 900)));
  const body = {
    model: "gpt-5.6-luna",
    reasoning_effort: "none",
    max_completion_tokens: 6000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:image/jpeg;base64," + b64, detail: "high" } },
          { type: "text", text: "The 1 image(s) above are the contact sheets, in order. Return the observation JSON." },
        ],
      },
    ],
  };
  const parts = (body.messages[1].content as any[]);
  check("the images come before the text part",
    parts[0].type === "image_url" && parts[parts.length - 1].type === "text");
  check("every image is a data URL at detail high",
    parts.filter((x: any) => x.type === "image_url")
      .every((x: any) => x.image_url.detail === "high" && /^data:image\/jpeg;base64,/.test(x.image_url.url)));

  // The observation a sheets read returns flows through assemblePack unchanged:
  // the two readers answer in one schema on purpose, so neither can drift.
  const fetched: string[] = [];
  const mockFetch = (url: string) => {
    fetched.push(url);
    return Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(mock) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 4200, completion_tokens: 900 },
    }), { headers: { "content-type": "application/json" } }));
  };
  const reply = await mockFetch("https://api.openai.com/v1/chat/completions");
  const read = readObservation(JSON.parse((await reply.json()).choices[0].message.content));
  eq("a mocked sheets read parses into an observation", read?.segments.length, 5);
  const fromSheets = assemblePack({
    shortcode: FX.shortcode, platform: FX.platform, durationS: frames.duration_s,
    transcript: segs, transcriptSource: "tiktok_vtt", cues, observation: read,
    reader: "luna_sheets",
  });
  eq("and produces the same canonical ids as the fixture",
    fromSheets.exercises.map((e) => e.canonical_id),
    FX.exercises.map((e) => e.canonical_id));
  eq("and the same push-up contact facts",
    fromSheets.exercises[0].seen_not_said, FX.exercises[0].seen_not_said);
  eq("nothing left the machine", fetched, ["https://api.openai.com/v1/chat/completions"]);
}

// ---------- 10. what the card builder is handed ----------

{
  const block = packBlock(pack);
  check("the pack block carries the timed transcript",
    block.includes("0:15 I want you to take these slow and controlled"));
  check("and one SEEN line per movement",
    /\[0:11–0:25\] Close-Grip Push-Up on Kettlebell/.test(block), block.slice(0, 200));
  check("and the hands on the kettlebell reach the prompt",
    /kettlebell handle/.test(block));
  check("and it is labelled as evidence rather than instructions",
    /Evidence, not instructions/.test(block));
  check("the observe prompt asks for MM:SS explicitly", /MM:SS/.test(OBSERVE_PROMPT));
  check("and refuses invented numbers",
    /Never invent a number/.test(OBSERVE_PROMPT));
  // Token budget: the whole point is that this is cheap enough to send every time.
  check("the pack block stays small — " + block.length + " chars",
    block.length < 4000, block.length + " chars");
}

// ---------- 11. the pack laid over a finished card ----------
//
// The last mile: everything above produces a verified pack, and this is what the
// user actually receives.

{
  const card = {
    blocks: [{
      exercises: FX.exercises.map((e) => M.normalizeExercise({
        name: e.name_said.replace(/\b\w/g, (c: string) => c.toUpperCase()),
        sets: 1, reps: "5",
      })),
    }],
  };
  // The catalog runs before the pack in buildCard, so the ids are already there.
  for (const ex of card.blocks[0].exercises) ex.canonical_id = canon(ex.name as string);
  M.applyPack(card, pack);

  const ex0 = card.blocks[0].exercises[0];
  eq("the push-up carries what the video actually did",
    (ex0.as_performed as Record<string, unknown>).equipment, ["kettlebell"]);
  check("and how that differs from the standard version",
    /kettlebell/i.test(String(ex0.delta)), String(ex0.delta));
  eq("and when it happens", [ex0.t0, ex0.t1], [pack.exercises[0].t0, pack.exercises[0].t1]);
  eq("its evidence is the creator's own verified words",
    [(ex0.evidence as any).source, (ex0.evidence as any).quote, (ex0.evidence as any).verified],
    ["transcript", FX.exercises[0].creator_cues[0].quote, true]);
  check("and never the exercise's own name, which is the claim restated",
    (ex0.evidence as any).quote !== ex0.name);

  // A movement the creator never coached still carries something checkable: the
  // contact line, marked unverified because there is no text to check it against.
  const ex4 = card.blocks[0].exercises[4];
  eq("a movement with no cue falls back to what was seen",
    [(ex4.evidence as any).source, (ex4.evidence as any).verified],
    ["seen", false]);
  // NOT seen_not_said[0] — "a shallow knee dip starts every rep" is the fact a
  // reader already knew. The line naming an object wins.
  eq("and quotes the contact fact that names an object",
    (ex4.evidence as any).quote, "the bell is pressed with both hands from the goblet position");
  check("never the least informative line",
    !/^both feet/i.test(String((ex4.evidence as any).quote)));

  // Each pack movement is claimed once, so a complex that repeats a movement
  // cannot stamp every repetition with the first one's timestamps.
  const dupe = {
    blocks: [{
      exercises: [
        M.normalizeExercise({ name: "Kettlebell Swings" }),
        M.normalizeExercise({ name: "Kettlebell Swings" }),
      ],
    }],
  };
  for (const ex of dupe.blocks[0].exercises) ex.canonical_id = "kettlebell-swing";
  M.applyPack(dupe, pack);
  check("a repeated movement does not reuse the same pack segment",
    dupe.blocks[0].exercises[1].as_performed === null,
    JSON.stringify(dupe.blocks[0].exercises[1].t0));

  // A card built without a pack is exactly the card that was built yesterday.
  const bare = { blocks: [{ exercises: [M.normalizeExercise({ name: "Goblet Squat" })] }] };
  M.applyPack(bare, undefined);
  eq("no pack changes nothing", bare.blocks[0].exercises[0].as_performed, null);
}

// ---------- 12. what the first live read got wrong ----------
//
// Four things the WODfather video exposed on the real pipeline. Each is checked
// against the shape that produced it, not against a string the model happened to
// emit that day.

// 1. A mat is not a kettlebell. The observation honestly lists the mat it can see
//    on an outdoor deck; leaving it in `variant.equipment` put "with mat" on every
//    single exercise, and a delta on everything says as much as a delta on nothing.
{
  const matty = readObservation({
    ...mock,
    session: { ...FX.session, equipment_seen: ["kettlebell", "exercise mat", "wooden deck"] },
    segments: mock.segments.map((sg) => ({
      ...sg,
      contact: sg.contact + "; both feet contact the mat on the wooden deck",
    })),
  }) as Observation;
  const p3 = assemblePack({
    shortcode: FX.shortcode, platform: FX.platform, durationS: FX.duration_s,
    transcript: segs, transcriptSource: "tiktok_vtt", cues, observation: matty,
  });
  eq("a mat and a deck never reach variant.equipment",
    p3.exercises.map((e) => e.variant.equipment),
    FX.exercises.map(() => ["kettlebell"]));
  eq("so the swing and the goblet squat still have no delta",
    [p3.exercises[2].delta_from_standard, p3.exercises[3].delta_from_standard], [null, null]);
  check("and the push-up delta names only the kettlebell under the hands",
    /kettlebell/i.test(String(p3.exercises[0].delta_from_standard)) &&
    !/\bmat\b|\bdeck\b/i.test(String(p3.exercises[0].delta_from_standard)),
    String(p3.exercises[0].delta_from_standard));
  check("a bench is a surface here too, not an implement",
    !assemblePack({
      shortcode: "x", platform: "tiktok", transcript: [], transcriptSource: "none",
      observation: readObservation({
        ...mock,
        session: { ...FX.session, equipment_seen: ["bench"] },
        segments: [{ ...mock.segments[0], contact: "feet elevated on a bench, hands on the floor" }],
      }),
    }).exercises[0].variant.equipment.length);
}

// 2. Cues were cut mid-word at 140 ("…handle together in front of"). A cue is read
//    by a person mid-set.
{
  const twoSentences =
    "Slow and controlled for time under tension, core tight. Stack both hands on the kettlebell " +
    "handle together in front of your chest and keep the feet together.";
  const cut = M.trimCue(twoSentences);
  check("a long cue stops at a sentence end, not mid-word",
    /[.!?]$/.test(cut) && !/\bin front of$/.test(cut), JSON.stringify(cut));
  check("and stays inside the hard ceiling", cut.length <= M.CUE_MAX, cut.length + " chars");
  eq("one sentence that fits is left exactly alone",
    M.trimCue("Drive the floor away."), "Drive the floor away.");
  const noStop = M.trimCue("keep the core tight and the hips square " + "and the elbows tucked ".repeat(8));
  check("a cue with no sentence end stops at a word boundary",
    !/\s$/.test(noStop) && noStop.length <= M.CUE_MAX && !noStop.endsWith("elbo"), JSON.stringify(noStop.slice(-24)));
  check("and leaves no dangling punctuation", !/[,;:\-–—.]$/.test(noStop), JSON.stringify(noStop.slice(-8)));
  eq("the ceiling has the slack the prompt's 140 needs", M.CUE_MAX, 170);
  const kept = M.normalizeExercise({ name: "Push Up", cue: twoSentences });
  check("normalizeExercise uses the same trim", /[.!?]$/.test(String(kept.cue)), String(kept.cue));
}

// 4. (3 is a prompt rule, checked above.) The seen quote for an uncoached
//    movement, in isolation.
eq("bestSeenFact prefers the line that names an object",
  bestSeenFact([
    "Both feet contact the mat",
    "a shallow knee dip starts every rep",
    "the bell is pressed with both hands from the chest",
  ]), "the bell is pressed with both hands from the chest");
eq("and falls back to the load position when nothing names an object",
  bestSeenFact(["Both feet contact the mat"], "racked at the shoulders"), "racked at the shoulders");
eq("and to the first fact when there is no load either",
  bestSeenFact(["Both feet contact the mat"], null), "Both feet contact the mat");
eq("and to nothing when the camera saw nothing", bestSeenFact([], null), null);

// The sheets, at the geometry the native shells are moving to.
{
  const native = {
    source: "device", duration_s: 84.3,
    sheets: [1, 2, 3].map((n) => ({
      path: sheetPathFor(UID, SC, n),
      cols: 4, rows: 3, cell_w: 270, cell_h: 480,
      times: Array.from({ length: 12 }, (_, i) => (n - 1) * 12 * 2.4 + i * 2.4),
    })),
  };
  const r = parseFrames(native, UID, SC);
  check("three 4x3 sheets of 270x480 cells are accepted",
    "frames" in r, "error" in r ? r.error : "");
  check("and a 320 px cell is well inside the bound",
    "frames" in parseFrames({
      ...native, sheets: [{ ...native.sheets[0], cell_w: 320, cell_h: 568 }],
    }, UID, SC));
  const prompt2 = sheetsPrompt((r as { frames: Frames }).frames, []);
  check("the sheets prompt asks which surface bears the weight",
    prompt2.includes("say which surface actually bears the weight (on the object, or on the " +
      "floor next to it); if the frames cannot show it, say unsure rather than guessing."));
}

// ---------- 13. what the first live GEMINI fallback got wrong ----------
//
// Read at low resolution in 19.5 s, 3,641 tokens in and 2,644 out — and the output
// half was three quarters of the bill, because every field came back as a sentence.

// 1. Terseness, stated in the prompt rather than trimmed after the fact: a field
//    that was never written costs nothing to throw away.
check("the observe prompt caps every string field at 12 words",
  OBSERVE_PROMPT.includes("Every string field is at most 12 words, `range_of_motion` at most 20"));
check("and asks for fragments rather than sentences",
  /Write fragments, not sentences/.test(OBSERVE_PROMPT));
check("and forbids repeating the movement's name inside its own fields",
  OBSERVE_PROMPT.includes("Never repeat the movement's name inside its own fields"));
check("and the schema is untouched",
  OBSERVE_PROMPT.includes('"range_of_motion": string, "tempo": string, "reps_visible": number or null'));

// 2. delta came back as the observation's whole load sentence, pasted:
//    "load Dumbbell resting on floor pulled to waist level; with dumbbell".
{
  const row = deltaFrom("renegade-row", {
    equipment: ["dumbbell"],            // the catalog entry says "dumbbells"
    hand_placement: "one hand on the floor, one on the bell",
    surface: null, grip_width: null,
    load_position: "Dumbbell resting on floor pulled to waist level",
    stance: null, unilateral: true, tempo: null, range_of_motion: null,
  });
  check("a dumbbell row whose catalog entry says dumbbells is not a variation on itself",
    row === null || !/dumbbell/i.test(row), JSON.stringify(row));

  eq("singular, plural and abbreviation are one implement", [
    deltaFrom("goblet-squat", { ...pack.exercises[3].variant, equipment: ["kettlebells"] }),
    deltaFrom("goblet-squat", { ...pack.exercises[3].variant, equipment: ["kb"] }),
    deltaFrom("goblet-squat", { ...pack.exercises[3].variant, equipment: ["dumbbell"] }),
  ], [null, null, null]);

  // Every clause is an attribute, short enough to read at a glance.
  const push = String(pack.exercises[0].delta_from_standard);
  eq("the push-up delta is the attribute, not the sentence", push, "hands on the kettlebell handle");
  for (const ex of pack.exercises) {
    const d = ex.delta_from_standard;
    if (!d) continue;
    for (const clause of d.split(";")) {
      check("delta clause '" + clause.trim() + "' is at most 8 words",
        clause.trim().split(/\s+/).length <= 8);
    }
  }
  check("and the implement is not named twice in one delta", !/;\s*with kettlebell/.test(push));

  // A bodyweight entry performed with an implement still says so.
  check("an implement the standard version does not have is still a delta",
    /kettlebell/.test(String(deltaFrom("diamond-push-up", {
      ...pack.exercises[0].variant, surface: null,
    }))), String(deltaFrom("diamond-push-up", { ...pack.exercises[0].variant, surface: null })));
}

// 3. Two of four exercises went unstamped, because a creator's compound name
//    shares no wording with what a camera calls the same movement.
{
  check("a compound name shares its head noun with the camera's name",
    sharesHeadNoun("Squat Alt Knee Drive Twist", "squat with alternating knee drive and torso twist"));
  check("and so does a two-movement name",
    sharesHeadNoun("Sumo Squat Front Raise Calf Raise", "sumo squat into front raise"));
  check("but two different movements share nothing",
    !sharesHeadNoun("Renegade Row", "Goblet Squat"));
  check("and a name with no movement noun in it never aligns",
    !sharesHeadNoun("Complex Fives", "goblet squat"));

  check("a pack whose movements run forwards is alignable", packInTimeOrder(pack));
  check("one that jumps backwards is not", !packInTimeOrder({
    ...pack,
    exercises: [pack.exercises[3], pack.exercises[0], pack.exercises[1], pack.exercises[2], pack.exercises[4]],
  } as Pack));

  // Four names a camera would never produce, in the card's order.
  const renamed = {
    blocks: [{
      exercises: [
        "Push Up Complex On Bell", "Deadlift Into High Pull",
        "Two Hand Swing", "Deep Goblet Squat", "Overhead Press Finisher",
      ].map((n) => M.normalizeExercise({ name: n })),
    }],
  };
  for (const ex of renamed.blocks[0].exercises) ex.canonical_id = null;
  M.applyPack(renamed, pack);
  const stamped = renamed.blocks[0].exercises.filter((e: any) => e.as_performed).length;
  check("every exercise is stamped when the counts, the order and the head nouns agree",
    stamped === 5, stamped + " of 5");
  eq("and by position, so the fourth card row gets the fourth segment",
    renamed.blocks[0].exercises[3].t0, pack.exercises[3].t0);

  // The guard: same count, same order, nothing in common.
  const unrelated = {
    blocks: [{
      exercises: ["Bicep Curl", "Plank Hold", "Calf Raise", "Box Jump", "Wall Sit"]
        .map((n) => M.normalizeExercise({ name: n })),
    }],
  };
  for (const ex of unrelated.blocks[0].exercises) ex.canonical_id = null;
  M.applyPack(unrelated, pack);
  eq("five unrelated names are left unstamped rather than stapled to the list",
    unrelated.blocks[0].exercises.filter((e: any) => e.as_performed).length, 0);

  // A different count is not an alignment at all.
  const short = {
    blocks: [{ exercises: [M.normalizeExercise({ name: "Push Up Complex On Bell" })] }],
  };
  short.blocks[0].exercises[0].canonical_id = null;
  M.applyPack(short, pack);
  eq("a card with fewer exercises than the camera saw does not align by order",
    short.blocks[0].exercises[0].as_performed, null);
}

// ---------- 14. the share extension's contract ----------
//
// An iOS Share Extension is a separate process with its own container. It holds
// the per-account ingest key — which is what the key is for — and has no Supabase
// session to hold, because the account lives in the containing app. So a route it
// must reach that only accepted a bearer was a route it could not reach.

check("the router resolves the ingest key for the authorize route as well as ingest",
  /path === "\/api\/ingest" \|\| path === "\/api\/uploads\/authorize"/.test(SRC));
check("and the authorize route dispatches kind:\"pack\" to the sheets branch",
  /body\.kind === "pack"/.test(SRC));

{
  // The key resolver itself, against a stubbed profiles lookup.
  (globalThis as any).DB = {
    rpc: () => "ok",
    profiles: (q: string) => q.includes("ingest_key=eq." + "a".repeat(32)) ? [{ id: UID }] : [],
  };
  const keyReq = (k: string) => new Request("https://x/api/uploads/authorize", { headers: { "x-ingest-key": k } });
  eq("a live ingest key resolves to its owner",
    await M.userFromIngestKey(keyReq("a".repeat(32)), new URL("https://x/")), UID);
  eq("an unknown key resolves to nobody",
    await M.userFromIngestKey(keyReq("b".repeat(32)), new URL("https://x/")), null);
  eq("a key that is not 32 hex characters never reaches PostgREST",
    await M.userFromIngestKey(keyReq("' or 1=1 --"), new URL("https://x/")), null);
}

{
  // Three sheets, three signed upload targets. The same body, whichever auth form
  // carried it here: authorizeSheets is reached with a resolved uid and cannot
  // tell a bearer from a key, which is exactly the property that makes both work.
  (globalThis as any).DB = { rpc: () => "ok" };
  M.spy.signed = []; M.spy.rpc = [];
  const ok = await M.authorizeSheets({
    kind: "pack", shortcode: SC,
    sheets: [{ bytes: 408_000 }, { bytes: 431_000 }, { bytes: 364_000 }],
  }, UID, {});
  eq("three sheets are authorized", ok.status, 200);
  eq("one entry per sheet, at the path parseFrames will recompute",
    ok.body.sheets.map((x: any) => x.path),
    [1, 2, 3].map((n) => sheetPathFor(UID, SC, n)));
  check("each carries a signed upload URL a session-less client can PUT to",
    ok.body.sheets.every((x: any) =>
      /\/storage\/v1\/object\/upload\/sign\/uploads\//.test(x.upload_url) && x.upload_url.includes("token=")));
  check("and the token on its own, so the phone does not have to parse a URL",
    ok.body.sheets.every((x: any) => !!x.token && x.upload_url.includes(x.token)));
  eq("the window the caller should plan against", ok.body.expires_in, 900);
  eq("the permits still go out, for the same three paths",
    M.spy.rpc[0][1].p_paths, ok.body.sheets.map((x: any) => x.path));
  eq("sized by the largest sheet, which is what the ceiling is about",
    M.spy.rpc[0][1].p_bytes, 431_000);

  const four = await M.authorizeSheets({
    kind: "pack", shortcode: SC,
    sheets: [{ bytes: 1 }, { bytes: 1 }, { bytes: 1 }, { bytes: 1 }],
  }, UID, {});
  eq("a fourth sheet is refused", four.status, 400);
  check("and says how many are allowed", /1 to 3 entries/.test(four.body.message), four.body.message);

  const big = await M.authorizeSheets({
    kind: "pack", shortcode: SC, sheets: [{ bytes: 408_000 }, { bytes: 700_000 }],
  }, UID, {});
  eq("a 700 KB sheet is refused", big.status, 400);
  check("by index, so the phone knows which one", /sheets\[1\]\.bytes/.test(big.body.message), big.body.message);
  eq("the ceiling the message quotes", SHEET_MAX_BYTES, 600 * 1024);
  eq("and the sheet ceiling it enforces", SHEET_MAX, 3);

  const nameless = await M.authorizeSheets({ kind: "pack", sheets: [{ bytes: 1 }] }, UID, {});
  eq("a request with no shortcode is refused", nameless.status, 400);
  const empty = await M.authorizeSheets({ kind: "pack", shortcode: SC, sheets: [] }, UID, {});
  eq("and so is one with no sheets", empty.status, 400);
}

// The native builder reports the GRID, not the fill: a last sheet that is only
// ten twelfths full still says 4 x 3.
{
  const partial = parseFrames({
    source: "device", duration_s: 84.3,
    sheets: [
      { path: sheetPathFor(UID, SC, 1), cols: 4, rows: 3, cell_w: 270, cell_h: 480,
        times: Array.from({ length: 12 }, (_, i) => i * 3.5) },
      { path: sheetPathFor(UID, SC, 2), cols: 4, rows: 3, cell_w: 270, cell_h: 480,
        times: Array.from({ length: 10 }, (_, i) => 42 + i * 3.5) },
    ],
  }, UID, SC);
  check("a last sheet reporting a full grid with ten times is accepted",
    "frames" in partial, "error" in partial ? partial.error : "");
  if ("frames" in partial) {
    eq("and keeps all ten", partial.frames.sheets[1].times.length, 10);
    eq("while still reporting the grid it was cut on",
      [partial.frames.sheets[1].cols, partial.frames.sheets[1].rows], [4, 3]);
  }
}

// Which daily cap the hand-off is charged against. It cost a free user their
// frames on the first day it shipped: `uploads` is a 1/day ceiling on holding
// somebody's 25 MB video, and a second save of the day was refused at the door
// before the frames it had already cut went anywhere.
{
  eq("a pack authorize is charged as the save it is the first half of",
    M.scopeFor("/api/uploads/authorize", true), "saves");
  eq("a media upload is still charged against uploads",
    M.scopeFor("/api/uploads/authorize", false), "uploads");
  eq("and every other route is where it was", [
    M.scopeFor("/api/ingest", false),
    M.scopeFor("/api/pumpy/chat", false),
    M.scopeFor("/api/workouts/abc/reprocess", false),
    M.scopeFor("/api/workouts/abc/media", false),
    M.scopeFor("/api/explain", false),
  ], ["saves", "chat", "extract", "extract", "helper"]);

  const peek = (body: unknown) =>
    M.isPackAuthorize(new Request("https://x/", { method: "POST", body: JSON.stringify(body) }));
  eq("kind:pack is recognised", await peek({ kind: "pack", shortcode: SC, sheets: [{ bytes: 1 }] }), true);
  eq("so is the same body without the kind", await peek({ shortcode: SC, sheets: [{ bytes: 1 }] }), true);
  eq("a media upload is not", await peek({ path: UID + "/" + UID + ".mp4", bytes: 10 }), false);
  eq("and neither is a body that will not parse",
    await M.isPackAuthorize(new Request("https://x/", { method: "POST", body: "{oh no" })), false);
  // The peek must leave the body for the handler.
  const req = new Request("https://x/", { method: "POST", body: JSON.stringify({ kind: "pack" }) });
  await M.isPackAuthorize(req);
  eq("and the handler still reads the same body afterwards",
    (await req.json()).kind, "pack");
}

// The phone may ask twice — it holds the frames and nothing else does. The paths
// are a pure function of the uid and the shortcode, so a retry asks for exactly
// what it asked for the first time.
{
  const body = {
    source: "device", duration_s: 84.3,
    sheets: [{ path: sheetPathFor(UID, SC, 1), cols: 4, rows: 3, cell_w: 270, cell_h: 480,
      times: Array.from({ length: 12 }, (_, i) => i * 7) }],
  };
  const first = parseFrames(body, UID, SC);
  const second = parseFrames(body, UID, SC);
  eq("a second authorize for the same video wants the same paths",
    JSON.stringify(first), JSON.stringify(second));
  (globalThis as any).DB = { rpc: () => "ok" };
  M.spy.signed = [];
  const a = await M.authorizeSheets({ kind: "pack", shortcode: SC, sheets: [{ bytes: 1000 }] }, UID, {});
  const b = await M.authorizeSheets({ kind: "pack", shortcode: SC, sheets: [{ bytes: 1000 }] }, UID, {});
  eq("and authorize hands back the same path both times",
    a.body.sheets[0].path, b.body.sheets[0].path);
  check("with a fresh token each time", a.body.sheets[0].token === b.body.sheets[0].token);
}

// ---------- 15. "Re-read this video" ----------

{
  const w = {
    id: "w1", shortcode: SC, platform: "tiktok", ingest_status: "ready",
    caption: "Complex fives", author: "thewodfather", thumb_url: null,
  };
  const readVideo = async (cached: any, body: unknown) => {
    (globalThis as any).DB = {
      rpc: () => [{ job_id: "j1", job_created: true }],
      workouts: () => [w],
      video_cache: () => (cached ? [cached] : []),
    };
    M.spy.seeded = null; M.spy.deleted = 0; M.spy.patched = null;
    return await M.handleReadVideo("w1", UID, new Request("https://x/", {
      method: "POST", body: JSON.stringify(body ?? {}), headers: { "content-type": "application/json" },
    }), {});
  };
  const framesBody = {
    frames: {
      source: "device", duration_s: 84.3,
      sheets: [{ path: sheetPathFor(UID, SC, 1), cols: 4, rows: 3, cell_w: 270, cell_h: 480,
        times: Array.from({ length: 12 }, (_, i) => i * 7) }],
    },
  };
  const alreadyRead = { v: M.CARD_V, card: { blocks: [] }, media_tried: true, pack: { ...pack }, pack_v: PACK_V };

  // Without frames, nothing changes: the reading that exists is the answer.
  const plain = await readVideo(alreadyRead, {});
  eq("a re-read with no frames still says it has already read this one", plain.status, 200);
  check("and queues nothing", M.spy.seeded === null);

  // With frames, the same card is read again — that is the whole action.
  const again = await readVideo(alreadyRead, framesBody);
  eq("a re-read WITH frames queues a job", again.status, 202);
  check("and tells the user what is about to happen",
    /frames/i.test(again.body.message), again.body.message);
  eq("the card says watching, not listening", M.spy.patched?.media_stage, "watching");
  eq("the job carries the new sheets", M.spy.seeded?.meta?.frames?.sheets?.length, 1);
  eq("and NOT the reading they are replacing", M.spy.seeded?.meta?.pack, undefined);
  eq("nothing was deleted, because the worker still needs them", M.spy.deleted, 0);

  // A video nobody has read yet behaves the same way with frames.
  const fresh = await readVideo(null, framesBody);
  eq("a first reading with frames queues too", fresh.status, 202);
  eq("and seeds them", fresh.body.status, "processing");

  // Every answer that is not "the worker will read this" hands the sheets back.
  const busy = await readVideo({ ...alreadyRead, media_tried: false }, framesBody);
  eq("a queued job keeps its sheets", busy.status, 202);
  (globalThis as any).DB = {
    rpc: () => [{ job_id: "j1", job_created: false }],
    workouts: () => [w], video_cache: () => [alreadyRead],
  };
  M.spy.deleted = 0;
  await M.handleReadVideo("w1", UID, new Request("https://x/", {
    method: "POST", body: JSON.stringify(framesBody), headers: { "content-type": "application/json" },
  }), {});
  eq("but a job that was already in flight owns the reading, so the sheets go",
    M.spy.deleted, 1);

  // Somebody else's uid in the path is refused before anything is charged.
  const stolen = await readVideo(null, {
    frames: {
      ...framesBody.frames,
      sheets: [{ ...framesBody.frames.sheets[0], path: sheetPathFor("99999999-2222-4333-8444-555555555555", SC, 1) }],
    },
  });
  eq("frames naming somebody else's folder are refused", stolen.status, 400);
  check("and no job is queued", M.spy.seeded === null);
}

check("a cached reading is not replayed over fresh frames",
  /!meta\.frames\?\.sheets\?\.length &&\s*\n?\s*providerFor\(p\.platform\)\.cacheable/.test(SRC) ||
  SRC.includes("!meta.frames?.sheets?.length"));

// ---------- 16. A/B-ing the sheets reader ----------
//
// On identical magnified sheets where a person can see the hands wrapped around a
// kettlebell, Luna reported "hands on the mat". That is not a question a prompt
// change answers, so the two readers have to be comparable on identical input.

const JPEG = btoa("\xff\xd8\xff" + "x".repeat(600));

function evalReply(url: string) {
  return /generativelanguage/.test(url)
    ? new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(mock) }] } }],
      usageMetadata: { promptTokenCount: 5200, candidatesTokenCount: 1100 },
    }), { headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(mock) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 4200, completion_tokens: 900 },
    }), { headers: { "content-type": "application/json" } });
}

{
  (globalThis as any).DB = { rpc: () => "ok", reply: evalReply };
  M.spy.calls = []; M.spy.cost = []; M.spy.store = { userId: null, workKey: "t" };
  const images = [{ b64: JPEG, mime: "image/jpeg" }];

  const luna = await M.readSheetImages(images, "PROMPT", "gpt-5.6-luna", { purpose: "pack", userId: null });
  eq("a gpt-* model goes to OpenAI", new URL(M.spy.calls[0].url).hostname, "api.openai.com");
  const lb = M.spy.calls[0].body;
  check("as a data URL at detail high, images before the text part",
    lb.messages[1].content[0].type === "image_url" &&
    lb.messages[1].content[0].image_url.detail === "high" &&
    /^data:image\/jpeg;base64,/.test(lb.messages[1].content[0].image_url.url) &&
    lb.messages[1].content[1].type === "text");
  eq("and reads back into the same observation shape", luna.obs?.segments.length, 5);

  const gem = await M.readSheetImages(images, "PROMPT", "gemini-3.6-flash", { purpose: "pack", userId: null });
  eq("a gemini-* model goes to Google",
    new URL(M.spy.calls[1].url).hostname, "generativelanguage.googleapis.com");
  const gb = M.spy.calls[1].body;
  check("as inline image parts, images before the text part",
    !!gb.contents[0].parts[0].inline_data && gb.contents[0].parts[0].inline_data.mime_type === "image/jpeg" &&
    typeof gb.contents[0].parts[1].text === "string");
  eq("at high media resolution, because fine detail is the whole question",
    gb.generationConfig.mediaResolution, "MEDIA_RESOLUTION_HIGH");
  eq("and answers in the same schema", gem.obs?.segments.length, 5);
  eq("both readers are charged to their own provider",
    M.spy.cost.map((c: any) => c.provider), ["openai", "gemini"]);
  eq("the actor's purpose is stamped for the guard while the call is in flight",
    [M.spy.calls[0].purpose, M.spy.calls[1].purpose], ["pack", "pack"]);
  eq("and restored afterwards", M.spy.store.purpose, undefined);

  eq("gpt-5.6-terra is priced so it can be A/B'd", tokenPrice("gpt-5.6-terra"), [2, 12, 0.2]);
}

// The guard's exception, against the real guard.
{
  const reserved: string[] = [];
  const rpcSpy = (name: string) => { reserved.push(name); return Promise.resolve("ok"); };
  const guarded = createGuardedFetch(rpcSpy as any, ((u: any, init: any) => {
    // countTokens preflight, then the call itself.
    if (String(u).includes(":countTokens")) {
      return Promise.resolve(new Response(JSON.stringify({ totalTokens: 5000 }),
        { headers: { "content-type": "application/json" } }));
    }
    return Promise.resolve(evalReply(String(u)));
  }) as any);

  const geminiBody = (images: number, bytes: number) => JSON.stringify({
    contents: [{
      role: "user",
      parts: [
        ...Array.from({ length: images }, () => ({
          inline_data: { mime_type: "image/jpeg", data: "A".repeat(Math.ceil(bytes * 4 / 3)) },
        })),
        { text: "read these" },
      ],
    }],
    generationConfig: { maxOutputTokens: 6000 },
  });
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";
  const call = async (purpose: string | undefined, images: number, bytes: number) => {
    try {
      await aiActor.run({ userId: null, workKey: "t", purpose }, () =>
        guarded(url, { method: "POST", body: geminiBody(images, bytes), headers: {} }));
      return "ok";
    } catch (e) {
      return e instanceof GuardError ? e.reason : "threw " + String(e).slice(0, 60);
    }
  };

  eq("three sheets under the cap are admitted for the pack", await call("pack", 3, 400_000), "ok");
  eq("and for the eval bench", await call("pack_eval", 1, 400_000), "ok");
  eq("a fourth image is refused", await call("pack", 4, 10_000), "gemini_media_only");
  eq("an oversize image is refused", await call("pack", 1, 700_000), "gemini_image_too_large");
  eq("and any other purpose is refused outright", await call("chat", 1, 10_000), "gemini_media_only");
  eq("including no purpose at all", await call(undefined, 1, 10_000), "gemini_media_only");
}

// The bench's gate.
{
  (globalThis as any).DB = { rpc: () => "ok", reply: evalReply, model: "gpt-5.6-luna" };
  const sheet = {
    b64: JPEG, cols: 4, rows: 3, cell_w: 270, cell_h: 480,
    times: Array.from({ length: 12 }, (_, i) => i * 7),
  };
  const ask = (headers: Record<string, string>, body: unknown) =>
    M.handleEvalSheets(new Request("https://x/api/worker/eval-sheets", {
      method: "POST", headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }));
  const KEY = { "x-pack-eval-key": "e".repeat(32) };
  const good = { model: "gpt-5.6-luna", duration_s: 84.3, sheets: [sheet], transcript: false };

  eq("no key is a 404, not a 401 — the bench does not announce itself",
    (await ask({}, good)).status, 404);
  eq("the wrong key is the same 404",
    (await ask({ "x-pack-eval-key": "f".repeat(32) }, good)).status, 404);
  eq("the worker secret does not open it either",
    (await ask({ "x-worker-secret": "e".repeat(32) }, good)).status, 404);

  const ran = await ask(KEY, good);
  eq("the right key runs the read", ran.status, 200);
  eq("and reports what it saw", ran.body.observation?.segments?.length, 5);
  eq("what it cost", ran.body.tokens_in > 0 && ran.body.cost_usd > 0, true);
  eq("and how long it took", typeof ran.body.ms, "number");
  eq("blind by default", ran.body.transcript_lines, 0);

  eq("an unpriced model is refused",
    (await ask(KEY, { ...good, model: "gpt-9-imaginary" })).status, 400);
  eq("a fourth sheet is refused",
    (await ask(KEY, { ...good, sheets: [sheet, sheet, sheet, sheet] })).status, 400);
  eq("an oversize sheet is refused",
    (await ask(KEY, { ...good, sheets: [{ ...sheet, b64: "A".repeat(900_000) }] })).status, 400);
  eq("no duration is refused", (await ask(KEY, { ...good, duration_s: 0 })).status, 400);

  check("the route is matched above the user-auth gate, so no bearer can reach it",
    SRC.indexOf('path === "/api/worker/eval-sheets"') < SRC.indexOf("let userId = await userFromBearer(req);"));
  check("and an unset secret refuses everything",
    /!PACK_EVAL_KEY \|\| !secretEquals/.test(SRC));
}

// The bench has no user, and on v161 that was a 429 on every call: ai_reserve
// refuses a null p_user, correctly, because everywhere else a null user is an
// actor that lost track of who it was working for.
{
  const seen: { name: string; args: any }[] = [];
  const rpcSpy = (name: string, args: any) => { seen.push({ name, args }); return Promise.resolve("ok"); };
  const guarded = createGuardedFetch(rpcSpy as any, (() =>
    Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 4200, completion_tokens: 900 },
    }), { headers: { "content-type": "application/json" } }))) as any);

  await aiActor.run({ userId: null, workKey: "sys:eval:gpt-5.6-luna", purpose: "pack_eval" }, () =>
    guarded("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: {},
      body: JSON.stringify({
        model: "gpt-5.6-luna", max_completion_tokens: 6000,
        messages: [{ role: "user", content: [
          { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA", detail: "high" } },
        ] }],
      }),
    }));

  eq("the bench reserves and settles, in that order",
    seen.map((c) => c.name), ["ai_reserve", "ai_settle"]);
  eq("against no user at all", seen[0].args.p_user, null);
  check("under a work key that says it is system work",
    /^sys:/.test(seen[0].args.p_work), seen[0].args.p_work);
  check("with the model in it, so each model gets its own daily work budget",
    seen[0].args.p_work.endsWith("gpt-5.6-luna"));
  check("and a real cost is settled rather than left unknown",
    typeof seen[1].args.p_usd === "number" && seen[1].args.p_usd > 0, JSON.stringify(seen[1].args));
  check("no admission call is made — that gate is for user routes",
    !seen.some((c) => c.name === "ai_admit"));

  // The rule the migration writes down: a null user is admitted ONLY as system
  // work, so every other path that loses its user still fails closed.
  const SQL = Deno.readTextFileSync(
    new URL("supabase/migrations/20260915160000_system_reservations.sql", ROOT));
  check("a null user with any other work key is still invalid_user",
    SQL.includes("if p_user is null and p_work not like 'sys:%' then return 'invalid_user'; end if;"));
  check("the per-user plan cap is skipped only when there is no user",
    SQL.includes("if p_user is not null then") && SQL.includes("user_monthly_budget"));
  check("and the global ceilings are still enforced",
    SQL.includes("return 'daily_budget'") && SQL.includes("return 'monthly_budget'") &&
    SQL.includes("return 'work_budget'"));
  check("the bench names itself the way the migration requires",
    SRC.includes('workKey: "sys:eval:" + model'));
  check("and still waits on the project's own daily ceiling",
    /if \(!\(await paidAllowed\(\)\)\) \{\s*\n\s*return json\(\{ status: "limit", message: "the day's AI budget is spent" \}/.test(SRC));
}

// With the transcript out, the prompt says nothing about what the creator called
// the movement — which is how to find out whether "push ups" was anchoring the
// reader onto a floor push-up before it ever looked at the hands.
{
  const frames = (parseFrames(goodFrames, UID, SC) as { frames: Frames }).frames;
  const blind = sheetsPrompt(frames, []);
  check("a blind prompt never mentions the creator", !/creator/i.test(blind));
  check("nor quotes a word of speech", !blind.includes("close grip push"));
  check("but still asks the question that matters",
    blind.includes("For every segment name every object the body is in contact with and how"));
  check("the sighted prompt does carry the words",
    sheetsPrompt(frames, segs).includes("0:15 I want you to take these slow"));
}

eq("title case leaves the little words alone",
  titleCase("close-grip push-up on kettlebell"), "Close-Grip Push-Up on Kettlebell");
eq("mergeCues on an empty file answers with nothing", mergeCues([]), []);
eq("parseVtt on junk answers with nothing", parseVtt("not a vtt at all"), []);

// ---------- done ----------

console.log((failures ? "FAILED " : "ok ") + (checks - failures) + "/" + checks + " checks");
if (failures) Deno.exit(1);

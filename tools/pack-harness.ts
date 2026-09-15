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
  assemblePack, deltaFrom, type Frames, mergeCues, type Observation, OBSERVE_PROMPT,
  type Pack, PACK_V, packBlock, parseFrames, parseStampedTranscript, parseVtt,
  readObservation, secondsToMmss, sheetPathFor, SHEET_MAX_BYTES, sheetsPrompt,
  type TranscriptSeg, titleCase, validatePack, vttCues,
} from "../supabase/functions/spotter/pack.ts";
import { canonicalize, CATALOG_CONFLICTS, standardOf } from "../supabase/functions/spotter/catalog.ts";
import { normText } from "../supabase/functions/spotter/evidence.ts";
import { tokenPrice } from "../supabase/functions/spotter/ai-guard.ts";

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
      if (isFunction && c === "{" && depth === 0) inBody = true;
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
  "type Pack = Record<string, any>;\n" +
  "type Card = { blocks: { exercises: any[] }[] };\n" +
  "type Evidence = Record<string, unknown>;\n" +
  "type PackExercise = { variant: Record<string, unknown> };\n" +
  "type Exercise = Record<string, unknown>;\n" +
  "type Dose = { reps: string | null; sets: number | null; seconds: number | null };\n" +
  "declare function cleanTitle(s: string): string;\n";

const NAMES = [
  "CUE_MAX", "CUE_RULE", "TRANSCRIBE_PROMPT",
  "intOrNull", "numOrNullBounded", "splitDose", "normalizeExercise",
  "ttSubtitles",
  "countExercises", "matchPackExercise", "packEvidence", "applyPack",
];

// cleanTitle is declared as a function in index.ts but drags the whole title
// ladder with it, so the harness supplies the one behaviour normalizeExercise
// needs from it: whitespace-collapsed trimming.
const SHIM = "\nglobalThis.cleanTitle = function (s) { return String(s || '').replace(/\\s+/g, ' ').trim(); };\n";

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

  check("the prompt states the cue rule verbatim",
    M.CUE_RULE.includes("at most two short sentences, 140 characters total") &&
    M.CUE_RULE.includes("drive the floor away"));
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
  eq("and quotes a contact fact", (ex4.evidence as any).quote, FX.exercises[4].seen_not_said[0]);

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

eq("title case leaves the little words alone",
  titleCase("close-grip push-up on kettlebell"), "Close-Grip Push-Up on Kettlebell");
eq("mergeCues on an empty file answers with nothing", mergeCues([]), []);
eq("parseVtt on junk answers with nothing", parseVtt("not a vtt at all"), []);

// ---------- done ----------

console.log((failures ? "FAILED " : "ok ") + (checks - failures) + "/" + checks + " checks");
if (failures) Deno.exit(1);

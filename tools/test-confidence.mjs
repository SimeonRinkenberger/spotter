// Battery for evidence attachment, chapter parsing and the confidence score.
// Run: node tools/test-confidence.mjs   — exits non-zero on any failure.
//
// The point of these cases is the ordering, not the absolute numbers: a rich
// caption whose sets and reps are all present must outscore a thin one, and a bare
// chapter list must land below the gate however plausible it reads.
import {
  attachEvidence, chapterExerciseCount, indexSource, locate,
  parseChapters, scoreCard, estimateSeconds, carouselEvidence, correctUnitErrors,
  isChapterJunkExercise, dropChapterJunk, mergeConfidence,
} from "../supabase/functions/spotter/evidence.ts";
import { catalogById } from "../supabase/functions/spotter/catalog.ts";

// Exactly what index.ts passes: the catalog's own aliases for whatever the
// exercise normalized to. Synonymy lives in the catalog and nowhere else.
function aliases(ex) {
  const e = catalogById(ex.canonical_id);
  return e ? [e.name, ...e.aliases] : [];
}

let failures = 0;
let checks = 0;
function check(name, cond, detail) {
  checks++;
  if (cond) return;
  failures++;
  console.log("FAIL  " + name + (detail === undefined ? "" : "  — " + detail));
}
function near(name, got, lo, hi) {
  check(name, got >= lo && got <= hi, "got " + got + ", wanted " + lo + "…" + hi);
}

// ---------- chapter parsing ----------

const YT_DESC = [
  "20 MINUTE FULL BODY DUMBBELL WORKOUT",
  "Grab a pair of dumbbells and follow along.",
  "",
  "0:00 Intro",
  "0:45 Warm Up",
  "2:30 Goblet Squat",
  "4:10 Dumbbell Romanian Deadlift",
  "6:00 Bent Over Row",
  "8:15 Overhead Press",
  "10:30 Cool Down",
  "12:00 Outro",
  "",
  "Follow me on Instagram @someone",
].join("\n");

const ch = parseChapters(YT_DESC);
check("chapters: found all 8", ch.length === 8, "got " + ch.length);
check("chapters: first is 0s Intro", ch[0].t === 0 && ch[0].label === "Intro");
check("chapters: 2:30 is 150s", ch[2].t === 150 && ch[2].label === "Goblet Squat");
check("chapters: junk filtered", chapterExerciseCount(ch) === 4,
  "got " + chapterExerciseCount(ch) + " (" + ch.filter((c) => true).map((c) => c.label).join("|") + ")");

check("chapters: a lone timestamp is not a list", parseChapters("Ready in 3:00 go").length === 0);
check("chapters: out-of-order timestamps rejected",
  parseChapters("5:00 Later\n1:00 Earlier").length === 0);
check("chapters: trailing timestamps parse",
  parseChapters("Warm Up - 0:00\nGoblet Squat - 1:30").length === 2);

// ---------- locating claims ----------

const IG_CAPTION = [
  "FULL BODY DUMBBELL FINISHER 🔥",
  "3 rounds, 60s rest between rounds",
  "▶️ Goblet Squat 3x12",
  "▶️ DB Bulgarians 3x10 each side",
  "▶️ Renegade Row 3x8",
  "▶️ Plank 45 sec",
  "Save this for later 💪 #fitness",
].join("\n");

const src = indexSource(IG_CAPTION, "caption");
check("locate: exact name", locate(src, "Goblet Squat")?.i === 2);
check("locate: emoji-prefixed line", locate(src, "Renegade Row")?.i === 4);
// Synonymy comes from the catalog, not from fuzzier matching here: the card says
// "Bulgarian Split Squat", the caption says "DB Bulgarians", and the catalog is what
// knows those are the same lift.
const bss = aliases({ canonical_id: "bulgarian-split-squat" });
check("locate: catalog alias finds the caption line",
  locate(src, ["Bulgarian Split Squat", ...bss])?.i === 3,
  "got line " + locate(src, ["Bulgarian Split Squat", ...bss])?.i);
check("locate: the name alone does not match a different wording",
  locate(src, "Bulgarian Split Squat") === null);
check("locate: absent name returns null", locate(src, "Barbell Hip Thrust") === null,
  "got " + JSON.stringify(locate(src, "Barbell Hip Thrust")?.raw));

// ---------- a rich caption ----------

const richCard = {
  duration_minutes: 18,
  blocks: [{
    rounds: 3, rest_seconds: 60,
    exercises: [
      { name: "Goblet Squat", canonical_id: "goblet-squat", sets: 3, reps: "12", duration_seconds: null, rest_seconds: null },
      { name: "Bulgarian Split Squat", canonical_id: "bulgarian-split-squat", sets: 3, reps: "10", duration_seconds: null, rest_seconds: null },
      { name: "Renegade Row", canonical_id: "renegade-row", sets: 3, reps: "8", duration_seconds: null, rest_seconds: null },
      { name: "Plank", canonical_id: "plank", sets: null, reps: null, duration_seconds: 45, rest_seconds: null },
    ],
  }],
};
attachEvidence(richCard, src, aliases);
const rich = scoreCard(richCard, { src, heuristicCount: 4, mediaSeconds: null });

const evs = richCard.blocks[0].exercises.map((e) => e.evidence);
check("rich: every exercise carries evidence", evs.every((e) => e && e.source !== "none"));
check("rich: every evidence is verified", evs.every((e) => e.verified));
check("rich: evidence records a line and an offset",
  evs.every((e) => typeof e.line === "number" && typeof e.offset === "number"));
check("rich: evidence source is the caption", evs.every((e) => e.source === "caption"));
check("rich: offsets point at the right text",
  IG_CAPTION.slice(evs[0].offset, evs[0].offset + 40).includes("Goblet Squat"),
  JSON.stringify(IG_CAPTION.slice(evs[0].offset, evs[0].offset + 20)));
check("rich: evidence_pct is 100", rich.evidence_pct === 100, "got " + rich.evidence_pct);
near("rich: score is high", rich.score, 0.85, 1.0);
check("rich: no chapters involved", rich.chapters_used === false);

// ---------- a thin caption ----------
//
// A caption that names nothing and prescribes nothing, against a card the model
// filled in anyway. Every number here is invented; none of them is in the text.

const THIN = "New workout dropped 🔥🔥 link in bio #gym #fitfam";
const thinSrc = indexSource(THIN, "caption");
const thinCard = {
  duration_minutes: 45,
  blocks: [{
    rounds: null, rest_seconds: null,
    exercises: [
      { name: "Bench Press", canonical_id: "bench-press", sets: 4, reps: "8", duration_seconds: null, rest_seconds: null },
      { name: "Incline Press", canonical_id: null, sets: 3, reps: "12", duration_seconds: null, rest_seconds: null },
    ],
  }],
};
attachEvidence(thinCard, thinSrc, aliases);
const thin = scoreCard(thinCard, { src: thinSrc, heuristicCount: 0, mediaSeconds: null });
check("thin: no evidence located", thin.evidence_pct === 0, "got " + thin.evidence_pct);
check("thin: capped for having nothing traceable", thin.score <= 0.35, "got " + thin.score);
check("thin: scores below rich", thin.score < rich.score);
check("thin: says why", thin.notes.some((n) => n.includes("located")), JSON.stringify(thin.notes));

// ---------- chapters only: the trap ----------
//
// The exact failure the handoff warns about. Every component looks fine — the
// labels are real, they are traceable, the count agrees with itself — and the card
// is worthless. It must land below any reasonable gate.
//
// This is the scorer on its own: in the pipeline the headings here are deleted
// first (see "chapter headings listed as exercises" below), and the cap is what is
// left protecting the real movements that trace only to chapter timestamps.

const ytSrc = indexSource(YT_DESC, "description");
const chapterCard = {
  duration_minutes: 20,
  blocks: [{
    rounds: null, rest_seconds: null,
    exercises: [
      { name: "Warm Up", canonical_id: null, sets: null, reps: null, duration_seconds: null, rest_seconds: null },
      { name: "Goblet Squat", canonical_id: "goblet-squat", sets: null, reps: null, duration_seconds: null, rest_seconds: null },
      { name: "Cool Down", canonical_id: null, sets: null, reps: null, duration_seconds: null, rest_seconds: null },
      { name: "Outro", canonical_id: null, sets: null, reps: null, duration_seconds: null, rest_seconds: null },
    ],
  }],
};
attachEvidence(chapterCard, ytSrc, aliases);
const chapters = scoreCard(chapterCard, { src: ytSrc, heuristicCount: 0, chapterCount: 4, mediaSeconds: 1200 });
const cev = chapterCard.blocks[0].exercises.map((e) => e.evidence);
check("chapters: evidence source is chapters", cev.every((e) => e.source === "chapters"),
  JSON.stringify(cev.map((e) => e.source)));
check("chapters: timestamps recorded", cev[1].t === 150, "got " + cev[1].t);
check("chapters: flagged chapters_only", chapters.chapters_only === true);
check("chapters: capped below the gate", chapters.score <= 0.45, "got " + chapters.score);
check("chapters: scores below rich", chapters.score < rich.score);

// A chapter list PLUS a real written workout in the same description must not be
// capped — the cap is for cards with nothing else behind them.
const MIXED = YT_DESC + "\n\nTHE WORKOUT\nGoblet Squat 4x12\nBent Over Row 4x10\n";
const mixedSrc = indexSource(MIXED, "description");
const mixedCard = {
  duration_minutes: 20,
  blocks: [{
    rounds: null, rest_seconds: null,
    exercises: [
      { name: "Goblet Squat", canonical_id: "goblet-squat", sets: 4, reps: "12", duration_seconds: null, rest_seconds: null },
      { name: "Bent Over Row", canonical_id: "bent-over-row", sets: 4, reps: "10", duration_seconds: null, rest_seconds: null },
    ],
  }],
};
attachEvidence(mixedCard, mixedSrc, aliases);
const mixed = scoreCard(mixedCard, { src: mixedSrc, heuristicCount: 2, chapterCount: 4, mediaSeconds: 1200 });
check("mixed: not flagged chapters_only", mixed.chapters_only === false,
  JSON.stringify(mixedCard.blocks[0].exercises.map((e) => e.evidence.source)));
check("mixed: outscores the chapter-only card", mixed.score > chapters.score,
  mixed.score + " vs " + chapters.score);

// ---------- chapter headings listed as exercises ----------
//
// The other half of the chapters trap. The cap says "do not trust this card"; it
// does not stop the card telling someone to perform "Warm up", "Workout" and
// "Cool down" in sequence. Those are deleted, and the conditions are narrow enough
// that a real movement — or a real instruction that happens to be named like a
// heading — cannot fall through them.
//
// This mirrors what index.ts does after attachEvidence: drop, then score.
function stampJunk(card, source) {
  attachEvidence(card, source, aliases);
  const dropped = dropChapterJunk(card);
  const c = scoreCard(card, { src: source, heuristicCount: 0, chapterCount: 0, mediaSeconds: null });
  const parts = { ...c.parts };
  if (dropped.length) parts.dropped_chapter_junk = dropped.length;
  return { dropped, parts, score: c.score };
}

const JUNK_DESC = [
  "20 MINUTE FULL BODY SESSION",
  "",
  "0:00 Warm up",
  "3:00 Workout",
  "17:00 Cool down",
].join("\n");
const junkSrc = indexSource(JUNK_DESC, "description");
const junkCard = {
  duration_minutes: 20,
  blocks: [{
    rounds: null, rest_seconds: null,
    exercises: [
      { name: "Warm up", canonical_id: null, sets: null, reps: null, duration_seconds: null, rest_seconds: null },
      { name: "Workout", canonical_id: null, sets: null, reps: null, duration_seconds: null, rest_seconds: null },
      { name: "Cool down", canonical_id: null, sets: null, reps: null, duration_seconds: null, rest_seconds: null },
    ],
  }],
};
const junkRun = stampJunk(junkCard, junkSrc);
check("junk: all three headings dropped", junkRun.dropped.length === 3,
  JSON.stringify(junkRun.dropped));
check("junk: counted into the components", junkRun.parts.dropped_chapter_junk === 3,
  JSON.stringify(junkRun.parts));
check("junk: no exercises left", junkCard.blocks.reduce((n, b) => n + b.exercises.length, 0) === 0);
check("junk: the emptied block is removed too", junkCard.blocks.length === 0,
  JSON.stringify(junkCard.blocks));

// The same card under the title YouTube actually ships. ytMeta hands over
// `title + "\n\n" + description`, so line 0 is the video's own name — and a video
// called "20 MINUTE WORKOUT" gives the heading "Workout" an exact written match
// there, which outranks the chapter line it really came from. A title is not a
// prescription, so on a chapter card that match is worth no more than the chapter
// line: all three still go.
const TITLED_DESC = ["20 MINUTE WORKOUT", "", "0:00 Warm up", "3:00 Workout", "17:00 Cool down"].join("\n");
const titledCard = {
  duration_minutes: 20,
  blocks: [{
    rounds: null, rest_seconds: null,
    exercises: [
      { name: "Warm up", canonical_id: null, sets: null, reps: null, duration_seconds: null, rest_seconds: null },
      { name: "Workout", canonical_id: null, sets: null, reps: null, duration_seconds: null, rest_seconds: null },
      { name: "Cool down", canonical_id: null, sets: null, reps: null, duration_seconds: null, rest_seconds: null },
    ],
  }],
};
const titledSrc = indexSource(TITLED_DESC, "description");
check("junk: 'Workout' really does match the title line, not the chapter line",
  locate(titledSrc, "Workout")?.i === 0, "matched line " + locate(titledSrc, "Workout")?.i);
const titledRun = stampJunk(titledCard, titledSrc);
check("junk: a heading matching only the video's title drops with the rest",
  titledRun.dropped.length === 3, JSON.stringify(titledRun.dropped));
check("junk: nothing survives that card", titledCard.blocks.length === 0,
  JSON.stringify(titledCard.blocks));

// The control for that rule. Same title, but the description also writes the
// workout out. What is prescribed in the body is kept — the title line is the only
// written line that counts for nothing, and only for names that carry no dose.
const BODY_DESC = [
  "20 MINUTE WORKOUT",
  "",
  "Workout: 3 rounds of 10 goblet squats",
  "",
  "0:00 Warm up",
  "3:00 Workout",
  "17:00 Cool down",
].join("\n");
const bodyCard = {
  duration_minutes: 20,
  blocks: [{
    rounds: 3, rest_seconds: null,
    exercises: [
      { name: "Warm up", canonical_id: null, sets: null, reps: null, duration_seconds: null, rest_seconds: null },
      { name: "Goblet Squat", canonical_id: "goblet-squat", sets: 3, reps: "10", duration_seconds: null, rest_seconds: null },
      { name: "Workout", canonical_id: null, sets: 3, reps: "10", duration_seconds: null, rest_seconds: null },
    ],
  }],
};
const bodyRun = stampJunk(bodyCard, indexSource(BODY_DESC, "description"));
const bodyLeft = bodyCard.blocks[0].exercises;
check("junk: the goblet squat written out in the body is kept",
  bodyLeft.some((e) => e.name === "Goblet Squat" && e.sets === 3 && e.reps === "10"),
  JSON.stringify(bodyLeft.map((e) => e.name)));
check("junk: a furniture name is kept when it carries a dose of its own",
  bodyLeft.some((e) => e.name === "Workout"), JSON.stringify(bodyLeft.map((e) => e.name)));
check("junk: only the dose-less heading goes", bodyRun.dropped.length === 1 &&
  bodyRun.dropped[0] === "Warm up", JSON.stringify(bodyRun.dropped));

// A chapter list of real movements is a chapter list of real movements. It is
// still capped, and nothing is deleted.
const REAL_DESC = [
  "FULL BODY KETTLEBELL",
  "",
  "0:00 Intro",
  "1:00 Goblet Squat",
  "6:00 Kettlebell Swing",
].join("\n");
const realSrc = indexSource(REAL_DESC, "description");
const realChapterCard = {
  duration_minutes: 12,
  blocks: [{
    rounds: null, rest_seconds: null,
    exercises: [
      { name: "Goblet Squat", canonical_id: "goblet-squat", sets: null, reps: null, duration_seconds: null, rest_seconds: null },
      { name: "Kettlebell Swing", canonical_id: "kettlebell-swing", sets: null, reps: null, duration_seconds: null, rest_seconds: null },
    ],
  }],
};
const realRun = stampJunk(realChapterCard, realSrc);
check("junk: real movements on chapter lines are kept", realRun.dropped.length === 0,
  JSON.stringify(realRun.dropped));
check("junk: nothing counted when nothing was dropped",
  realRun.parts.dropped_chapter_junk === undefined);
check("junk: both exercises survive", realChapterCard.blocks[0].exercises.length === 2);

// A caption that literally prescribes "Warm up set 3x10" is an instruction the
// creator gave. It is written text, it carries a dose, and it stays.
const WARM_CAPTION = ["UPPER BODY", "Warm up set 3x10", "Bench Press 4x8"].join("\n");
const warmSrc = indexSource(WARM_CAPTION, "caption");
const warmCard = {
  duration_minutes: null,
  blocks: [{
    rounds: null, rest_seconds: null,
    exercises: [
      { name: "Warm up set", canonical_id: null, sets: 3, reps: "10", duration_seconds: null, rest_seconds: null },
      { name: "Bench Press", canonical_id: "bench-press", sets: 4, reps: "8", duration_seconds: null, rest_seconds: null },
    ],
  }],
};
const warmRun = stampJunk(warmCard, warmSrc);
check("junk: a caption-verified 'Warm up set' with sets and reps is kept",
  warmRun.dropped.length === 0, JSON.stringify(warmRun.dropped));
check("junk: its evidence is verified caption text",
  warmCard.blocks[0].exercises[0].evidence.source === "caption" &&
  warmCard.blocks[0].exercises[0].evidence.verified === true,
  JSON.stringify(warmCard.blocks[0].exercises[0].evidence));

// A dose is a dose whatever the name. A chapter's span is never copied into
// duration_seconds, so a duration here came from written text.
check("junk: a 'Cool down' with a real duration is not junk",
  isChapterJunkExercise(
    { name: "Cool down", duration_seconds: 300, evidence: { source: "chapters", line: 4, offset: 0, quote: "17:00 Cool down", t: 1020, slide: null, verified: true } },
    ["chapters"],
  ) === false);
check("junk: the same name with no dose is junk",
  isChapterJunkExercise(
    { name: "Cool down", duration_seconds: null, evidence: { source: "chapters", line: 4, offset: 0, quote: "17:00 Cool down", t: 1020, slide: null, verified: true } },
    ["chapters"],
  ) === true);
check("junk: caption evidence is never touched",
  isChapterJunkExercise(
    { name: "Stretching", evidence: { source: "caption", line: 1, offset: 0, quote: "stretching", t: null, slide: null, verified: true } },
    ["caption", "chapters"],
  ) === false);
check("junk: nothing located, on a card with no chapters at all, is kept",
  isChapterJunkExercise({ name: "Warm up", evidence: { source: "none", line: null, offset: null, quote: null, t: null, slide: null, verified: false } },
    ["caption"]) === false);
check("junk: nothing located, on a card that used chapters, is junk",
  isChapterJunkExercise({ name: "Warm up", evidence: { source: "none", line: null, offset: null, quote: null, t: null, slide: null, verified: false } },
    ["chapters", "none"]) === true);
// The title-line rule, directly. Line 0 is the video's own name; every other
// written line is the creator saying something.
const onLine = (line, sources) => isChapterJunkExercise(
  { name: "Workout", evidence: { source: "description", line, offset: 0, quote: "20 MINUTE WORKOUT", t: null, slide: null, verified: true } },
  sources,
);
check("junk: the title line does not shelter a heading on a chapter card",
  onLine(0, ["chapters", "description"]) === true);
check("junk: any other written line does", onLine(3, ["chapters", "description"]) === false);
check("junk: and the title line is untouched when the card used no chapters",
  onLine(0, ["description"]) === false);
check("junk: a title-line match with a dose is kept even on a chapter card",
  isChapterJunkExercise(
    { name: "Workout", sets: 3, reps: "10", evidence: { source: "description", line: 0, offset: 0, quote: "20 MINUTE WORKOUT", t: null, slide: null, verified: true } },
    ["chapters", "description"],
  ) === false);

check("junk: a real movement is never junk however it was traced",
  isChapterJunkExercise({ name: "Goblet Squat", evidence: { source: "chapters", line: 3, offset: 0, quote: "1:00 Goblet Squat", t: 60, slide: null, verified: true } },
    ["chapters"]) === false);

// ---------- which score survives a reprocess merge ----------
//
// mergeNoDowngrade pulls blocks back from the stored card when a re-run comes back
// thinner. Blocks written before evidence existed carry none, so re-scoring them
// measures the schema they were saved under rather than the card, and the user's
// number would fall on a reprocess where nothing got worse.

const RESCORED_LOW = { score: 0.3, parts: { evidence: 0, numbers: 0.5, agreement: 1, catalog: 1, duration: 0.5 } };
const RESCORED_HIGH = { score: 0.7, parts: { evidence: 1, numbers: 0.8, agreement: 1, catalog: 1, duration: 1 } };

const keptOld = mergeConfidence(0.8, null, RESCORED_LOW, true, false);
check("merge: an unevidenced old card keeps its stored score", keptOld.score === 0.8,
  "got " + keptOld.score);
check("merge: and says so", keptOld.parts.merge_kept_old_score === true,
  JSON.stringify(keptOld.parts));

const preScoring = mergeConfidence(null, null, RESCORED_LOW, true, false);
check("merge: a pre-scoring row stays unscored rather than getting a number",
  preScoring.score === null, String(preScoring.score));

const rescoreWins = mergeConfidence(0.6, null, RESCORED_HIGH, true, true);
check("merge: evidenced old blocks are re-scored, and the better number wins",
  rescoreWins.score === 0.7, "got " + rescoreWins.score);
check("merge: records that the re-score won",
  rescoreWins.parts.merge_kept_old_score === false, JSON.stringify(rescoreWins.parts));

const oldWins = mergeConfidence(0.9, null, RESCORED_HIGH, true, true);
check("merge: no downgrade — a better stored score survives the re-score",
  oldWins.score === 0.9 && oldWins.parts.merge_kept_old_score === true,
  JSON.stringify(oldWins));

const noMerge = mergeConfidence(0.9, null, RESCORED_LOW, false, false);
check("merge: nothing pulled back means the re-run stands on its own",
  noMerge.score === 0.3 && noMerge.parts.merge_kept_old_score === undefined,
  JSON.stringify(noMerge));

const keptWithDrop = mergeConfidence(0.8, { evidence: 1, numbers: 1, agreement: 1, catalog: 1, duration: 1 },
  { score: 0.3, parts: { ...RESCORED_LOW.parts, dropped_chapter_junk: 2 } }, true, false);
check("merge: the old components are kept verbatim",
  keptWithDrop.parts.evidence === 1 && keptWithDrop.parts.numbers === 1,
  JSON.stringify(keptWithDrop.parts));
check("merge: except a deletion this pass made, which is not a score component",
  keptWithDrop.parts.dropped_chapter_junk === 2, JSON.stringify(keptWithDrop.parts));

// ---------- invented numbers ----------
//
// Same caption, same exercises, but the doses are fabricated. Only the `numbers`
// component should move, and it should move down.

const fakeDoseCard = JSON.parse(JSON.stringify(richCard));
for (const ex of fakeDoseCard.blocks[0].exercises) { ex.sets = 7; ex.reps = "23"; ex.duration_seconds = null; delete ex.evidence; }
attachEvidence(fakeDoseCard, src, aliases);
const fakeDose = scoreCard(fakeDoseCard, { src, heuristicCount: 4, mediaSeconds: null });
check("fabricated doses: numbers component drops",
  fakeDose.parts.numbers < rich.parts.numbers,
  fakeDose.parts.numbers + " vs " + rich.parts.numbers);
check("fabricated doses: still traceable by name", fakeDose.evidence_pct === 100);
check("fabricated doses: total score drops", fakeDose.score < rich.score,
  fakeDose.score + " vs " + rich.score);

// ---------- the minutes/seconds unit error ----------
//
// Straight from the first real save: the caption said "45 secs" and the model
// returned duration_seconds: 2700. The evidence line is the authority, so the
// value is corrected rather than trusted or clamped.

const SECS = [
  "FULL BODY CIRCUIT",
  "\u25b6\ufe0fgoblet squats 45 secs",
  "\u25b6\ufe0fbent over rows 45 secs",
  "\u25b6\ufe0fplank 90 secs",
].join("\n");
const secsSrc = indexSource(SECS, "caption");
const unitCard = {
  duration_minutes: 15,
  blocks: [{ rounds: 3, rest_seconds: 60, exercises: [
    { name: "Goblet Squats", canonical_id: "goblet-squat", sets: null, reps: null, duration_seconds: 2700, rest_seconds: null },
    { name: "Bent Over Rows", canonical_id: "bent-over-row", sets: null, reps: null, duration_seconds: 2700, rest_seconds: null },
    { name: "Plank", canonical_id: "plank", sets: null, reps: null, duration_seconds: 90, rest_seconds: null },
  ] }],
};
attachEvidence(unitCard, secsSrc, aliases);
const repairs = correctUnitErrors(unitCard, secsSrc);
const durs = unitCard.blocks[0].exercises.map((e) => e.duration_seconds);
check("units: 2700s corrected to 45s where the source says seconds",
  durs[0] === 45 && durs[1] === 45, JSON.stringify(durs));
check("units: a plausible 90s is left alone", durs[2] === 90);
check("units: the correction is reported", repairs.length === 2, JSON.stringify(repairs));

// An implausible duration the source does NOT explain is dropped, not clamped:
// a smaller wrong number is still wrong.
const unexplained = {
  duration_minutes: null,
  blocks: [{ rounds: null, rest_seconds: null, exercises: [
    { name: "Plank", canonical_id: "plank", sets: null, reps: null, duration_seconds: 5400, rest_seconds: null },
  ] }],
};
attachEvidence(unexplained, indexSource("Plank hold", "caption"), aliases);
correctUnitErrors(unexplained, indexSource("Plank hold", "caption"));
check("units: an unexplained 90 minutes becomes null, not 1800",
  unexplained.blocks[0].exercises[0].duration_seconds === null,
  String(unexplained.blocks[0].exercises[0].duration_seconds));

// And the scorer must not credit the minutes reading when the source said seconds.
const uncorrected = {
  duration_minutes: 15,
  blocks: [{ rounds: null, rest_seconds: null, exercises: [
    { name: "Goblet Squats", canonical_id: "goblet-squat", sets: null, reps: null, duration_seconds: 2700, rest_seconds: null },
  ] }],
};
attachEvidence(uncorrected, secsSrc, aliases);
const uncorrectedScore = scoreCard(uncorrected, { src: secsSrc, heuristicCount: 3 });
check("units: 2700 scores zero on numbers against a caption saying 45 secs",
  uncorrectedScore.parts.numbers === 0, "got " + uncorrectedScore.parts.numbers);

// ---------- carousel OCR ----------

const noCaptionSrc = indexSource("", "caption");
const visionCard = {
  duration_minutes: 30,
  blocks: [{
    rounds: null, rest_seconds: null,
    exercises: [
      { name: "Back Squat", canonical_id: "back-squat", sets: 5, reps: "5", duration_seconds: null, rest_seconds: 120, evidence: carouselEvidence(1, "Back Squat 5x5") },
      { name: "Bench Press", canonical_id: "bench-press", sets: 5, reps: "5", duration_seconds: null, rest_seconds: 120, evidence: carouselEvidence(1, "Bench Press 5x5") },
    ],
  }],
};
attachEvidence(visionCard, noCaptionSrc, aliases);
const vision = scoreCard(visionCard, { src: noCaptionSrc, heuristicCount: 0, mediaSeconds: null });
check("carousel: evidence preserved, slide recorded",
  visionCard.blocks[0].exercises[0].evidence.slide === 1);
check("carousel: never marked verified",
  visionCard.blocks[0].exercises.every((e) => e.evidence.verified === false));
check("carousel: scores below a verified caption", vision.score < rich.score,
  vision.score + " vs " + rich.score);
check("carousel: still beats a card with nothing at all", vision.score > thin.score,
  vision.score + " vs " + thin.score);

// ---------- empty ----------

const emptyScore = scoreCard({ duration_minutes: null, blocks: [] }, { src, heuristicCount: 0 });
check("empty: scores zero", emptyScore.score === 0);
check("empty: says why", emptyScore.notes[0].includes("no exercises"));

// ---------- duration plausibility ----------

near("estimate: 3 rounds of 4 exercises is minutes not seconds",
  estimateSeconds(richCard), 400, 2400);

const absurd = {
  duration_minutes: 60,
  blocks: [{ rounds: null, rest_seconds: null, exercises: [
    { name: "Plank", canonical_id: "plank", sets: 1, reps: null, duration_seconds: 30, rest_seconds: null },
  ] }],
};
attachEvidence(absurd, indexSource("Plank 30 sec", "caption"));
const absurdScore = scoreCard(absurd, { src: indexSource("Plank 30 sec", "caption"), heuristicCount: 1 });
check("duration: 30 seconds of work billed as an hour is implausible",
  absurdScore.parts.duration === 0, "got " + absurdScore.parts.duration);

// ---------- report ----------

console.log("");
console.log("scores  rich " + rich.score + "  mixed " + mixed.score + "  carousel " + vision.score +
  "  fabricated-doses " + fakeDose.score + "  chapters-only " + chapters.score + "  thin " + thin.score);
console.log("rich parts     " + JSON.stringify(rich.parts));
console.log("chapters parts " + JSON.stringify(chapters.parts) + "  " + JSON.stringify(chapters.notes));
console.log("chapter junk   dropped " + JSON.stringify(junkRun.dropped) +
  "  parts " + JSON.stringify(junkRun.parts) +
  "  kept on a real chapter list " + JSON.stringify(realChapterCard.blocks[0].exercises.map((e) => e.name)));
console.log("merge scores   unevidenced-old " + keptOld.score + "  pre-scoring " + preScoring.score +
  "  rescore-wins " + rescoreWins.score + "  old-wins " + oldWins.score + "  no-merge " + noMerge.score);
console.log("");
if (failures) { console.log(failures + " FAILURE(S) of " + checks + " checks"); process.exit(1); }
console.log("all " + checks + " confidence checks passed");

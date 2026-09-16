// Spotter — the scorer's own test.
//
//   deno run --allow-read tools/pack-eval/score-test.ts     (npm run eval:test)
//
// tools/pack-eval/offline.ts proves the pipeline still passes the golden set. It
// cannot prove that the golden set would CATCH anything, and a green eval that
// cannot fail is worse than no eval — it is a green light somebody trusts.
//
// So this file takes one small correct pack and breaks it, one failure class at a
// time, and asserts that the scorer notices each break and says which one it is.
// Every case below corresponds to something that has actually gone wrong in this
// project: a movement dropped from a card, a bench press matched to a push-up, a
// cue cut off mid-word, a delta that restated an exercise's own definition, a
// timestamp landing a creator's words under the wrong movement, a load nobody
// stated, and a card claiming to have watched a video that was never fetched.
//
// The last case is the opposite check and matters just as much: the correct pack
// must produce no problems at all, or every one of the others is meaningless.

import {
  type EvalCard, exitCodeFor, EXIT, type Fixture, type FixtureExercise, score,
} from "./score.ts";
import type { Pack } from "../../supabase/functions/spotter/pack.ts";

// ---------- scoreboard ----------

let failures = 0;
let checks = 0;
function check(name: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) return;
  failures++;
  console.log("FAIL  " + name + (detail === undefined ? "" : "  — " + detail));
}

/** Whether the report complained, and about the right thing. */
function complains(name: string, report: ReturnType<typeof score>, needle: RegExp) {
  check(name, report.problems.some((p) => needle.test(p)),
    "problems were " + JSON.stringify(report.problems));
}

function silent(name: string, report: ReturnType<typeof score>, needle: RegExp) {
  check(name, !report.problems.some((p) => needle.test(p)),
    "problems were " + JSON.stringify(report.problems));
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// ---------- one small correct read ----------
//
// Two movements of the WODfather complex, cut down to what the scorer looks at.
// Small on purpose: a failure here should point at one line of score.ts, not send
// somebody through a five-exercise fixture looking for the difference.

const variant = (over: Record<string, unknown> = {}) => ({
  equipment: ["kettlebell"],
  hand_placement: "both hands stacked on the kettlebell handle",
  surface: "hands elevated on the bell, feet on the mat",
  grip_width: "narrow",
  load_position: null,
  stance: "feet together",
  unilateral: false,
  tempo: "slow eccentric",
  range_of_motion: "chest lowers to the bell",
  ...over,
});

const FIXTURE: Fixture = {
  fixture_v: 1,
  shortcode: "tt-test",
  platform: "tiktok",
  duration_s: 40,
  visual: "read",
  reader: "luna_sheets",
  exercises: [
    {
      i: 0,
      observed: true,
      name_said: "close grip push ups",
      name_shown: "Close-Grip Push-Up on Kettlebell",
      canonical_id: "diamond-push-up",
      t0: 10, t1: 25,
      reps_seen: 5,
      variant: variant(),
      creator_cues: [{ t: 15, quote: "take these slow and controlled so that we get time under tension" }],
      seen_not_said: ["both hands are on the kettlebell handle, not the floor"],
      provenance: { name: "said", reps: "said", variant: "seen", cues: "said" },
      confidence: 0.9,
    },
    {
      i: 1,
      observed: true,
      name_said: "kettlebell swings",
      name_shown: "Kettlebell Swing",
      canonical_id: "kettlebell-swing",
      t0: 25, t1: 40,
      reps_seen: 5,
      variant: variant({
        hand_placement: "two hands on the handle",
        surface: null,
        load_position: "hangs between the legs",
        stance: "shoulder width",
      }),
      creator_cues: [{ t: 30, quote: "focusing on the hip hinge, finding that tension through the glutes" }],
      seen_not_said: ["bell peaks at chest height, not overhead"],
      provenance: { name: "said", reps: "said", variant: "seen", cues: "said" },
      confidence: 0.95,
    },
  ] as FixtureExercise[],
  card_expectations: {
    stamped: 2,
    cues: [
      "Slow and controlled for time under tension. Both hands stacked on the kettlebell handle.",
      "Hip hinge, tension through the glutes. Two hands, bell to chest height.",
    ],
    canonical_ids: ["diamond-push-up", "kettlebell-swing"],
    deltas: { values: ["hands on the kettlebell handle", null] },
    must_not: [
      { never: "bench press", why: "the bug that started the wave" },
      { field: "weight", why: "no load is stated or visible" },
    ],
  },
};

const PACK: Pack = {
  pack_v: 1,
  shortcode: "tt-test",
  platform: "tiktok",
  duration_s: 40,
  visual: "read",
  reader: "luna_sheets",
  session: {
    format: "complex", scheme: "5 reps", equipment_seen: ["kettlebell"],
    equipment_count: { kettlebell: 1 }, setting: "outdoor deck", load_seen: null,
  },
  transcript_source: "tiktok_vtt",
  transcript: [
    { t0: 15, t1: 22, text: "I want you to take these slow and controlled so that we get time under tension." },
    { t0: 30, t1: 38, text: "As always focusing on the hip hinge, finding that tension through the glutes." },
  ],
  on_screen: [],
  exercises: [
    {
      i: 0,
      name_said: "close grip push ups",
      name_shown: "Close-Grip Push-Up on Kettlebell",
      canonical_id: "diamond-push-up",
      t0: 10, t1: 25,
      reps_seen: 5,
      variant: variant(),
      delta_from_standard: "hands on the kettlebell handle",
      creator_cues: [{ t: 15, quote: "take these slow and controlled so that we get time under tension" }],
      seen_not_said: ["both hands are on the kettlebell handle, not the floor"],
      provenance: { name: "said", reps: "said", variant: "seen", cues: "said" },
      confidence: 0.9,
      needs_requery: false,
    },
    {
      i: 1,
      name_said: "kettlebell swings",
      name_shown: "Kettlebell Swing",
      canonical_id: "kettlebell-swing",
      t0: 25, t1: 40,
      reps_seen: 5,
      variant: variant({
        hand_placement: "two hands on the handle",
        surface: null,
        load_position: "hangs between the legs",
        stance: "shoulder width",
      }),
      delta_from_standard: null,
      creator_cues: [{ t: 30, quote: "focusing on the hip hinge, finding that tension through the glutes" }],
      seen_not_said: ["bell peaks at chest height, not overhead"],
      provenance: { name: "said", reps: "said", variant: "seen", cues: "said" },
      confidence: 0.95,
      needs_requery: false,
    },
  ],
} as unknown as Pack;

const CARD: EvalCard = {
  title: "Complex Fives",
  blocks: [{
    title: "Complex",
    type: "amrap",
    rounds: null,
    rest_seconds: null,
    exercises: [
      {
        name: "Close Grip Push Ups",
        canonical_id: "diamond-push-up",
        sets: null, reps: "5", duration_seconds: null, rest_seconds: null,
        weight: null, equipment: "kettlebell",
        cue: "Slow and controlled for time under tension. Both hands stacked on the kettlebell handle.",
        delta: "hands on the kettlebell handle",
        t0: 10, t1: 25,
        as_performed: variant(),
      },
      {
        name: "Kettlebell Swings",
        canonical_id: "kettlebell-swing",
        sets: null, reps: "5", duration_seconds: null, rest_seconds: null,
        weight: null, equipment: "kettlebell",
        cue: "Hip hinge, tension through the glutes. Two hands, bell to chest height.",
        delta: null,
        t0: 25, t1: 40,
        as_performed: variant({ hand_placement: "two hands on the handle" }),
      },
    ],
  }],
};

// ---------- 0. the correct read is clean ----------

{
  const r = score(FIXTURE, clone(PACK), clone(CARD));
  check("the correct pack has no problems", r.ok, JSON.stringify(r.problems));
  check("both movements matched", r.counts.matched === 2, "got " + r.counts.matched);
  check("both quote the creator", r.cues.quotes_creator === 2, "got " + r.cues.quotes_creator);
  check("timestamps are exact", r.timestamps.max_dt === 0, "got " + r.timestamps.max_dt);
  check("the correct pack exits 0", exitCodeFor(r) === EXIT.ok, "got " + exitCodeFor(r));
}

// ---------- 1. a movement the card lost ----------
//
// The failure the whole eval is named after. A pack that drops the swing is not a
// pack with four right answers; it is a workout the user cannot do.

{
  const pack = clone(PACK);
  pack.exercises = [pack.exercises[0]];
  const r = score(FIXTURE, pack, clone(CARD));
  complains("a dropped movement is reported missing", r, /^missing exercise: Kettlebell Swing/);
  check("missing is counted", r.counts.missing === 1, "got " + r.counts.missing);
  check("a missing movement exits 3", exitCodeFor(r) === EXIT.missing, "got " + exitCodeFor(r));
}

// ---------- 2. a movement nobody performed ----------

{
  const pack = clone(PACK);
  pack.exercises.push({ ...clone(pack.exercises[1]), i: 2, name_shown: "Barbell Bench Press", canonical_id: "bench-press" });
  const r = score(FIXTURE, pack, clone(CARD));
  complains("an invented movement is reported extra", r, /extra exercise not in the fixture: Barbell Bench Press/);
  check("extra is counted", r.counts.extra === 1, "got " + r.counts.extra);
}

// ---------- 3. the wrong exercise behind the right name ----------
//
// "Close Grip Pushups" fuzzy-matched close-grip-bench-press at 0.74 against a
// floor of 0.72, and the explain sheet then showed a bench press. The id is the
// thing every downstream call groups by, so it is checked exactly.

{
  const pack = clone(PACK);
  pack.exercises[0].canonical_id = "close-grip-bench-press";
  const card = clone(CARD);
  card.blocks[0].exercises[0].canonical_id = "close-grip-bench-press";
  const r = score(FIXTURE, pack, card);
  complains("a wrong catalog id on the pack is caught", r, /canonical_id "close-grip-bench-press"/);
  complains("and on the card", r, /card exercise 0 canonical_id "close-grip-bench-press"/);
}

// ---------- 4. the creator's words under the wrong movement ----------

{
  const pack = clone(PACK);
  pack.exercises[1].t0 = 31;
  const r = score(FIXTURE, pack, clone(CARD));
  complains("a drifted timestamp is caught", r, /t0 is 6 s from the fixture/);
  check("and the drift is in the numbers", (r.timestamps.max_dt ?? 0) === 6, "got " + r.timestamps.max_dt);
}

// ---------- 5. equipment read off the name instead of the frame ----------
//
// Not fatal — the report prints it — because a variant attribute is prose and a
// build that breaks on prose gets switched off. It must still show up as a number.

{
  const pack = clone(PACK);
  pack.exercises[0].variant.equipment = [];
  const r = score(FIXTURE, pack, clone(CARD));
  check("equipment that went missing is scored wrong",
    r.attributes.equipment_exact === 1 && r.attributes.equipment_checked === 2,
    r.attributes.equipment_exact + "/" + r.attributes.equipment_checked);
  check("and the movement's own row says so", r.exercises[0].equipment_ok === false);
}

// ---------- 6. a cue that does not fit on a card ----------

{
  const card = clone(CARD);
  card.blocks[0].exercises[0].cue = "Slow and controlled for time under tension so that the chest and " +
    "the triceps do the work rather than the shoulders, keeping the core tight throughout the whole set. " +
    "Both hands stacked on the kettlebell handle.";
  const r = score(FIXTURE, PACK, card);
  complains("an over-long cue is caught", r, /cue 0 .* characters, over 170/);
}

// ---------- 7. a cue that is a paragraph ----------

{
  const card = clone(CARD);
  card.blocks[0].exercises[0].cue = "Go slow. Keep the core tight. Hands on the bell.";
  const r = score(FIXTURE, PACK, card);
  complains("a three-sentence cue is caught", r, /cue 0 .* 3 sentences, over 2/);
}

// ---------- 8. a quotation the creator never said ----------
//
// The rule the pack was built around: a paraphrase attributed to a creator is a
// fabrication with their name on it.

{
  const card = clone(CARD);
  card.blocks[0].exercises[0].cue = "Really focus on squeezing your pecs at the top of every single rep.";
  const r = score(FIXTURE, PACK, card);
  complains("a cue that quotes nobody is caught", r, /cue 0 .* quotes nothing the creator said/);
}

// ---------- 8b. and a movement the creator never coached is not asked for one ----------

{
  const fixture = clone(FIXTURE);
  fixture.exercises[0].creator_cues = [];
  const card = clone(CARD);
  card.blocks[0].exercises[0].cue = "Stack both hands on the kettlebell handle and lower the chest to the bell.";
  const r = score(fixture, PACK, card);
  silent("a movement with no creator cue is not asked to quote one", r, /quotes nothing/);
}

// ---------- 9. a delta on a movement that was standard ----------
//
// The first live read put "load Dumbbell resting on floor pulled to waist level"
// on a renegade row, which is that exercise's own definition. A delta on every
// exercise says exactly as much as a delta on none.

{
  const card = clone(CARD);
  card.blocks[0].exercises[1].delta = "load hangs between the legs";
  const r = score(FIXTURE, PACK, card);
  complains("a delta where the fixture expects none is caught", r, /card exercise 1 has delta .* where the fixture expects none/);
}

// ---------- 10. a delta that went missing ----------

{
  const card = clone(CARD);
  card.blocks[0].exercises[0].delta = null;
  const r = score(FIXTURE, PACK, card);
  complains("a missing delta is caught", r, /card exercise 0 has no delta/);
}

// ---------- 11. a delta about the wrong thing ----------

{
  const card = clone(CARD);
  card.blocks[0].exercises[0].delta = "feet elevated on a bench";
  const r = score(FIXTURE, PACK, card);
  complains("a delta about something else is caught", r, /card exercise 0 delta .* shares 0% of/);
}

// ---------- 12. a phrase the fixture forbids ----------

{
  const card = clone(CARD);
  card.blocks[0].exercises[0].as_performed = variant({ hand_placement: "as in a close grip bench press" });
  const r = score(FIXTURE, PACK, card);
  complains("a forbidden phrase in a variant field is caught", r, /must_not 'bench press' at card\.exercise\[0\]\.as_performed/);
  check("a forbidden phrase exits 2", exitCodeFor(r) === EXIT.must_not, "got " + exitCodeFor(r));
}

// ---------- 12b. and in the pack, not only on the card ----------

{
  const pack = clone(PACK);
  pack.exercises[0].seen_not_said = ["hands close together as in a bench press"];
  const r = score(FIXTURE, pack, clone(CARD));
  complains("a forbidden phrase in the pack is caught too", r, /must_not 'bench press' at pack\.exercise\[0\]\.seen_not_said/);
}

// ---------- 13. a number nobody stated ----------

{
  const card = clone(CARD);
  card.blocks[0].exercises[0].weight = "16 kg";
  const r = score(FIXTURE, PACK, card);
  complains("an invented load is caught", r, /must_not 'weight' at card\.exercise\[0\]\.weight/);
}

// ---------- 14. a card that claims to have watched a video nobody fetched ----------
//
// Instagram hands a server no media. A pack for one of those is a record that
// nobody looked, and it is cached globally — so a single invented observation is
// inherited by everybody who saves the same post afterwards.

{
  const fixture = clone(FIXTURE);
  fixture.visual = "unavailable";
  fixture.exercises = [];
  fixture.card_expectations = { stamped: 0, canonical_ids: [], deltas: { values: [] }, must_not: [] };
  const blind = { ...clone(PACK), visual: "unavailable", reader: "none", exercises: [], transcript: [] } as unknown as Pack;

  const clean = score(fixture, blind, { title: "x", blocks: [{ exercises: [{ name: "Goblet Squat", cue: "" }] }] });
  check("a caption-only card with no visual claim is clean", clean.ok, JSON.stringify(clean.problems));
  check("and its pack is not stored", clean.pack_valid.storable === false);

  const lying = score(fixture, blind, {
    title: "x",
    blocks: [{ exercises: [{ name: "Goblet Squat", cue: "", t0: 12, as_performed: variant(), delta: "with kettlebell", evidence: { source: "seen", quote: "hands on the bell" } }] }],
  });
  complains("an as_performed on an unwatched post is caught", lying, /provenance: card\.exercise\[0\]\.as_performed is set/);
  complains("so is a timestamp", lying, /provenance: card\.exercise\[0\]\.t0 is set/);
  complains("so is a delta", lying, /provenance: card\.exercise\[0\]\.delta is set/);
  complains("so is seen evidence", lying, /provenance: card\.exercise\[0\]\.evidence\.source is 'seen'/);

  // Cues stripped, so the pack VERIFIES: a fabricated observation with no quoted
  // speech in it passes validatePack, which is exactly why this check has to be
  // separate from that one.
  const inventedExercises = clone(PACK).exercises.map((e) => ({ ...e, creator_cues: [] }));
  const invented = score(fixture, { ...blind, exercises: inventedExercises } as unknown as Pack, { title: "x", blocks: [{ exercises: [] }] });
  complains("a pack built from no observation at all is caught", invented, /pack exercise\(s\) from no observation/);
  complains("and it would have been stored", invented, /a pack would be stored for a post with no visual/);
}

// ---------- 15. the pack stopped reaching the card ----------

{
  const card = clone(CARD);
  card.blocks[0].exercises[1].t0 = null;
  card.blocks[0].exercises[1].t1 = null;
  const r = score(FIXTURE, PACK, card);
  complains("a card that lost its stamps is caught", r, /applyPack stamped 1 of 2 exercise\(s\); the fixture expects 2/);
}

// ---------- 16. a pack that would not verify ----------

{
  const pack = clone(PACK);
  pack.exercises[0].creator_cues = [{ t: 15, quote: "squeeze your pecs at the top" }];
  const r = score(FIXTURE, pack, clone(CARD));
  complains("a quote that is not in the transcript fails verification", r, /validatePack: cue is not verbatim/);
}

// ---------- 17. an unrecorded movement is skipped, not scored ----------
//
// The rule that keeps the silent-video fixture honest: a gap in the record must
// not be scored as either a pass or a failure.

{
  const fixture = clone(FIXTURE);
  fixture.exercises.push({
    i: 2, observed: false, name_said: null, name_shown: null, canonical_id: null,
    t0: null, t1: null, variant: {}, creator_cues: [],
  });
  const r = score(fixture, clone(PACK), clone(CARD));
  check("an unrecorded movement is not missing", r.counts.missing === 0, "got " + r.counts.missing);
  check("it is counted as unobserved", r.counts.unobserved === 1, "got " + r.counts.unobserved);
  check("and the report still passes", r.ok, JSON.stringify(r.problems));
}

// ---------- the verdict ----------

console.log((failures ? "FAIL  " : "PASS  ") + (checks - failures) + "/" + checks +
  " check(s) — score.ts catches each failure class and leaves the correct pack alone");
if (failures) Deno.exit(1);

// Spotter — the pack scorer.
//
// The production-readiness review of 8 Sept asked for "a versioned, consented
// golden set measuring missing/extra exercises, dose fidelity, p95 latency and
// cost per successful import". This file is the measuring half of that: given one
// pack, the card that was built from it, and the fixture that says what both
// should have been, it produces a report a person can read in ten seconds and a
// machine can fail a build on.
//
// It exists because of how the failure it is looking for behaves. A pack that is
// wrong is never wrong in a way that looks wrong: the cue lines are the creator's
// own words, the timestamps are plausible, the exercise names are real exercises.
// The only thing missing is the fact nobody wrote down — that both hands were on
// the kettlebell — and no amount of reading the output catches that. So the output
// is compared, field by field, against a fixture somebody wrote by hand from the
// video itself.
//
// Three rules shape it:
//
//   1. **Nothing here calls a model, a network or a clock.** The scorer is a pure
//      function of (pack, card, fixture), so it runs in CI on a laptop and cannot
//      disagree with itself between runs.
//   2. **Unknown is not the same as wrong.** A fixture field that nobody ever
//      recorded is null, and null is SKIPPED rather than scored — with the skip
//      counted and printed, so a fixture that knows nothing cannot pass by knowing
//      nothing.
//   3. **The hard checks are the ones where being wrong costs a user something.**
//      A missing exercise, a forbidden phrase, an invented number, a visual claim
//      about a video nobody watched. The softer measures — how close a cue is to
//      the target wording, whether it opens with a verb — are printed as numbers
//      that can go down, not as a broken build. A build that breaks on prose gets
//      switched off.

import { normText } from "../../supabase/functions/spotter/evidence.ts";
import { type Pack, validatePack } from "../../supabase/functions/spotter/pack.ts";

// ---------- what the scorer is given ----------

/** One movement as the fixture's author recorded it. Any field may be null. */
export type FixtureExercise = {
  i: number;
  /**
   * False when the golden read saw this movement but its segment detail was never
   * written down. Such an exercise is kept in the fixture so a human reading the
   * file knows the video has five movements and not three, and is left out of the
   * missing/extra tally so the scorer never asks the pipeline for a number the
   * fixture cannot check.
   */
  observed?: boolean;
  name_said?: string | null;
  name_shown?: string | null;
  canonical_id?: string | null;
  acceptable_canonical_ids?: (string | null)[];
  reps_prescribed?: number | null;
  t0?: number | null;
  t1?: number | null;
  reps_seen?: number | null;
  variant?: Record<string, unknown> | null;
  delta_from_standard?: string | null;
  creator_cues?: { t: number; quote: string }[];
  seen_not_said?: string[] | null;
  provenance?: Record<string, string> | null;
  confidence?: number | null;
};

export type MustNot = { never?: string; field?: string; why?: string };

export type CardExpectations = {
  title?: string | null;
  block?: Record<string, unknown> | null;
  stamped?: number | null;
  cues?: (string | null)[];
  canonical_ids?: (string | null)[];
  acceptable_canonical_ids?: (string | null)[][];
  deltas?: { values?: (string | null)[] } | null;
  must_not?: MustNot[];
};

export type Fixture = {
  fixture_v?: number;
  shortcode: string;
  platform: string;
  duration_s?: number | null;
  visual: "read" | "unavailable";
  reader?: string;
  source?: Record<string, unknown>;
  exercises: FixtureExercise[];
  card_expectations?: CardExpectations;
};

/** Only the parts of a card this file reads. The real Card has more on it. */
export type EvalExercise = {
  name: string;
  canonical_id?: string | null;
  sets?: number | null;
  reps?: string | null;
  duration_seconds?: number | null;
  rest_seconds?: number | null;
  weight?: string | null;
  equipment?: string | null;
  cue?: string;
  delta?: string | null;
  t0?: number | null;
  t1?: number | null;
  as_performed?: Record<string, unknown> | null;
  evidence?: Record<string, unknown> | null;
  [k: string]: unknown;
};
export type EvalBlock = {
  title?: string | null;
  type?: string | null;
  rounds?: number | null;
  rest_seconds?: number | null;
  exercises: EvalExercise[];
};
export type EvalCard = { title?: string | null; blocks: EvalBlock[]; [k: string]: unknown };

// ---------- words ----------

// Stop words for overlap measures only. Deliberately short: "floor", "hands" and
// "bell" are the words that carry the whole judgement here, and a generous stop
// list is how a scorer ends up comparing two empty sets and calling them equal.
const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "with", "for", "on", "in", "at",
  "is", "are", "it", "that", "this", "your", "you", "from", "into", "by", "as",
]);

function words(s: string | null | undefined): string[] {
  return normText(String(s ?? "")).split(" ").filter(Boolean);
}

function content(s: string | null | undefined): string[] {
  const out: string[] = [];
  for (const w of words(s)) if (!STOP.has(w) && !out.includes(w)) out.push(w);
  return out;
}

/**
 * How much of what was EXPECTED actually turned up.
 *
 * Asymmetric on purpose. A delta that says everything the fixture asked for and
 * one thing more is still right; a delta that says half of it is not. Jaccard
 * would punish the first and forgive the second.
 */
export function coverage(expected: string | null | undefined, actual: string | null | undefined): number {
  const want = content(expected);
  if (!want.length) return 1;
  const got = new Set(content(actual));
  let hit = 0;
  for (const w of want) if (got.has(w)) hit++;
  return hit / want.length;
}

/**
 * The longest run of words two strings share, in order.
 *
 * This is how a cue is checked for a creator's own voice. A cue that shares three
 * consecutive words with something the creator said is quoting them; a cue that
 * shares the same three words scattered is using the vocabulary of the sport. Only
 * the first is worth attributing to a person by name.
 */
export function longestSharedRun(a: string, b: string): number {
  const x = words(a), y = words(b);
  if (!x.length || !y.length) return 0;
  let best = 0;
  // Row-by-row longest-common-substring. Both strings are one cue long, so the
  // quadratic table is a few hundred cells.
  let prev = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const row = new Array(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) {
      if (x[i - 1] === y[j - 1]) {
        row[j] = prev[j - 1] + 1;
        if (row[j] > best) best = row[j];
      }
    }
    prev = row;
  }
  return best;
}

// ---------- the cue rule, as the prompt states it ----------

/**
 * How far a segment may move before it is a different segment.
 *
 * The observation speaks in MM:SS, so a timestamp is right to the second and no
 * further; the golden fixture's own times are written to a tenth. 1.5 s is the
 * slack tools/pack-harness.ts already uses for the same comparison, and on the
 * golden input today the worst error is 0.5 s — all of it that quantisation. A
 * timestamp that drifts past this is pointing at the wrong movement, which is the
 * failure that puts a creator's words under somebody else's exercise.
 */
export const TIMESTAMP_SLACK_S = 1.5;

/** index.ts's CUE_MAX. Copied rather than lifted: this file must stay importable
 * without parsing a 12,000-line module, and a cue that grew past 170 characters
 * would be a visible failure in the report either way. */
export const CUE_MAX = 170;
/** Three words is where a shared run stops being vocabulary and starts being a quote. */
export const QUOTE_RUN = 3;

// The verbs a coach actually opens with. Used only to MEASURE the prompt's
// "verb first" instruction, never to enforce it: three of the five golden cues on
// the WODfather video do not open with a verb, because the creator's own coaching
// point does not ("Slow and controlled...", "Hip hinge..."), and a scorer that
// called those failures would be scoring the fixture rather than the pipeline.
const VERB_FIRST =
  /^(?:take|keep|drive|push|pull|squeeze|brace|hold|lower|press|lift|raise|reach|stay|focus|breathe|exhale|inhale|control|set|place|stack|tuck|extend|hinge|stand|sit|step|land|snap|float|aim|feel|avoid|don't|do|never|always|start|finish|return|drop|explode|pause|engage|activate|tighten|point|turn|rotate|squat|swing|row|dip|switch|move|squeeze|sink|brace|grip|drag|slide|kick|jump)\b/i;

function sentences(cue: string): string[] {
  return cue.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

export type CueScore = {
  index: number;
  name: string;
  cue: string;
  chars: number;
  sentences: number;
  within_length: boolean;
  within_sentences: boolean;
  verb_first: boolean;
  quote_run: number | null;
  quotes_creator: boolean | null;
  matches_expected: number | null;
};

/**
 * One cue, against the four things the prompt promises about it.
 *
 * `quotes_creator` is null — not false — when the fixture records no creator cue
 * for this movement. The push press in the golden video is coached entirely by the
 * camera; demanding a quotation there would demand a fabrication, which is the
 * failure mode this whole wave exists to prevent.
 */
export function scoreCue(
  index: number, name: string, cue: string,
  creatorCues: { quote: string }[] | null | undefined,
  expected: string | null | undefined,
): CueScore {
  const text = String(cue ?? "").trim();
  const parts = sentences(text);
  const quotes = (creatorCues ?? []).map((c) => c.quote).filter(Boolean);
  const run = quotes.length ? Math.max(...quotes.map((q) => longestSharedRun(text, q))) : null;
  return {
    index,
    name,
    cue: text,
    chars: text.length,
    sentences: parts.length,
    within_length: text.length <= CUE_MAX,
    within_sentences: parts.length <= 2,
    verb_first: !!parts.length && VERB_FIRST.test(parts[0]),
    quote_run: run,
    quotes_creator: run === null ? null : run >= QUOTE_RUN,
    matches_expected: expected === null || expected === undefined ? null : coverage(expected, text),
  };
}

// ---------- alignment ----------

export type Pairing = {
  fixture: FixtureExercise;
  actual: Pack["exercises"][number] | null;
  by: "canonical_id" | "name" | null;
};

function nameMatches(fx: FixtureExercise, pe: { name_said: string | null; name_shown: string }): boolean {
  const wanted = [fx.name_shown, fx.name_said].filter(Boolean).map((n) => normText(String(n)));
  const got = [pe.name_shown, pe.name_said].filter(Boolean).map((n) => normText(String(n)));
  for (const w of wanted) {
    for (const g of got) {
      if (w && g && (w === g || w.includes(g) || g.includes(w))) return true;
    }
  }
  return false;
}

/**
 * Which pack exercise each fixture exercise is.
 *
 * The catalog id first, because it is what the pipeline groups by and it survives
 * a model rewording a name; then the words. Never by position: a scorer that
 * aligned by position would report a pack that dropped the second of five
 * movements as "four right, one renamed" instead of "one missing", and the count
 * of missing exercises is the number this whole file exists to produce.
 */
export function align(fixture: Fixture, pack: Pack): { pairs: Pairing[]; extra: Pack["exercises"] } {
  const free = pack.exercises.slice();
  const taken = new Set<number>();
  const pairs: Pairing[] = [];
  for (const fx of fixture.exercises) {
    if (fx.observed === false) { pairs.push({ fixture: fx, actual: null, by: null }); continue; }
    let hit = fx.canonical_id
      ? free.find((pe, k) => !taken.has(k) && (fx.acceptable_canonical_ids ?? [fx.canonical_id]).includes(pe.canonical_id))
      : undefined;
    let by: Pairing["by"] = hit ? "canonical_id" : null;
    if (!hit) {
      hit = free.find((pe, k) => !taken.has(k) && nameMatches(fx, pe));
      by = hit ? "name" : null;
    }
    if (hit) taken.add(free.indexOf(hit));
    pairs.push({ fixture: fx, actual: hit ?? null, by });
  }
  return { pairs, extra: free.filter((_, k) => !taken.has(k)) };
}

// ---------- the report ----------

export type ExerciseReport = {
  i: number;
  observed: boolean;
  fixture_name: string | null;
  actual_name: string | null;
  matched_by: Pairing["by"];
  canonical_expected: string | null;
  canonical_actual: string | null;
  canonical_ok: boolean | null;
  dt0: number | null;
  dt1: number | null;
  equipment_expected: string[] | null;
  equipment_actual: string[] | null;
  equipment_ok: boolean | null;
  hand_placement: number | null;
  surface: number | null;
  load_position: number | null;
  provenance_ok: boolean | null;
};

export type Report = {
  shortcode: string;
  platform: string;
  visual: string;
  reader: string;
  fixture_v: number | null;
  ok: boolean;
  problems: string[];
  notes: string[];
  counts: {
    fixture: number;
    observed: number;
    unobserved: number;
    actual: number;
    matched: number;
    missing: number;
    extra: number;
    stamped: number;
    stamped_expected: number | null;
  };
  missing: string[];
  extra: string[];
  timestamps: { n: number; expected_boundaries: number; measured_boundaries: number; missing_boundaries: number; within_slack: number; mean_dt0: number | null; mean_dt1: number | null; max_dt: number | null };
  attributes: {
    equipment_checked: number;
    equipment_exact: number;
    hand_placement_mean: number | null;
    surface_mean: number | null;
    load_position_mean: number | null;
  };
  cues: {
    checked: number;
    within_length: number;
    within_sentences: number;
    verb_first: number;
    quote_checked: number;
    quotes_creator: number;
    mean_match: number | null;
    detail: CueScore[];
  };
  deltas: { checked: number; correct: number; detail: { i: number; expected: string | null; actual: string | null; coverage: number | null; ok: boolean }[] };
  must_not: { checked: number; violations: { rule: string; why: string; where: string; text: string }[] };
  provenance: { visual: string; ok: boolean; problems: string[] };
  pack_valid: { ok: boolean; problems: string[]; storable: boolean };
  exercises: ExerciseReport[];
};

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000;
}

function flatten(card: EvalCard | null | undefined): EvalExercise[] {
  const out: EvalExercise[] = [];
  for (const b of card?.blocks ?? []) for (const e of b.exercises ?? []) out.push(e);
  return out;
}

/**
 * Every string a forbidden phrase could hide in, each with a label saying where it
 * came from.
 *
 * Both halves of the output are walked, not just the card: `as_performed` and the
 * pack's own variant are what the explain sheet and the demo matcher read, so a
 * bench press that only ever appears in a variant field is still a bench press in
 * front of a user.
 */
function textFields(pack: Pack | null, card: EvalCard | null): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  const push = (where: string, v: unknown) => {
    if (typeof v === "string" && v.trim()) out.push({ where, text: v });
    else if (Array.isArray(v)) v.forEach((x, k) => push(where + "[" + k + "]", x));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) push(where + "." + k, x);
    }
  };
  push("card.title", card?.title);
  (card?.blocks ?? []).forEach((b, bi) => {
    push("card.block[" + bi + "].title", b.title);
    (b.exercises ?? []).forEach((e, ei) => {
      const at = "card.exercise[" + ei + "]";
      push(at + ".name", e.name);
      push(at + ".cue", e.cue);
      push(at + ".equipment", e.equipment);
      push(at + ".weight", e.weight);
      push(at + ".delta", e.delta);
      push(at + ".as_performed", e.as_performed);
      push(at + ".evidence", e.evidence);
    });
  });
  (pack?.exercises ?? []).forEach((pe, k) => {
    const at = "pack.exercise[" + k + "]";
    push(at + ".name_shown", pe.name_shown);
    push(at + ".name_said", pe.name_said);
    push(at + ".delta_from_standard", pe.delta_from_standard);
    push(at + ".variant", pe.variant);
    push(at + ".seen_not_said", pe.seen_not_said);
    push(at + ".creator_cues", pe.creator_cues.map((c) => c.quote));
  });
  if (pack) push("pack.session", pack.session);
  return out;
}

/** Limited literal negation handling; not a semantic judge. Only immediately
 * negated mentions are exempt. Later affirmative mentions still fail. */
export function hasAffirmedPhrase(text: string, phrase: string): boolean {
  const tokens = normText(text).split(" ");
  const wanted = normText(phrase).split(" ");
  for (let i = 0; i <= tokens.length - wanted.length; i++) {
    if (!wanted.every((w, j) => tokens[i + j] === w)) continue;
    const prefix = tokens.slice(Math.max(0, i - 5), i).join(" ");
    if (/(?:^| )(?:not|no|without|rather than|instead of)(?: (?:a|an|the))?$/.test(prefix)) continue;
    return true;
  }
  return false;
}

/** A card field that must have been left alone, checked on every exercise. */
function fieldViolations(card: EvalCard | null, field: string): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  flatten(card).forEach((e, k) => {
    const v = (e as Record<string, unknown>)[field];
    const set = v !== null && v !== undefined && v !== "" &&
      !(Array.isArray(v) && !v.length) && !(typeof v === "object" && !Object.keys(v as object).length);
    if (set) out.push({ where: "card.exercise[" + k + "]." + field, text: JSON.stringify(v) });
  });
  return out;
}

/**
 * Whether anything in this output claims to have SEEN something.
 *
 * The one check in the file that is about honesty rather than accuracy. A pack
 * whose visual channel was unavailable — an Instagram post, a carousel, a link the
 * server could not fetch — is a record that nobody looked. If a card built from
 * one of those carries an `as_performed`, a per-exercise timestamp, a delta or a
 * `seen` evidence line, then something downstream invented a video, and it will be
 * cached globally and believed by every call after it.
 */
function scoreProvenance(fixture: Fixture, pack: Pack, card: EvalCard | null, pairs: Pairing[]) {
  const problems: string[] = [];
  if (fixture.visual === "unavailable") {
    if (pack.visual !== "unavailable") problems.push("pack.visual is '" + pack.visual + "' for a video nobody could watch");
    if (pack.reader !== "none") problems.push("pack.reader is '" + pack.reader + "' with no visual channel");
    if (pack.exercises.length) problems.push(pack.exercises.length + " pack exercise(s) from no observation");
    for (const pe of pack.exercises) {
      for (const [k, v] of Object.entries(pe.provenance ?? {})) {
        if (v === "seen") problems.push("pack.exercise[" + pe.i + "].provenance." + k + " is 'seen'");
      }
    }
    flatten(card).forEach((e, k) => {
      const at = "card.exercise[" + k + "]";
      if (e.as_performed) problems.push(at + ".as_performed is set");
      if (e.t0 !== null && e.t0 !== undefined) problems.push(at + ".t0 is set");
      if (e.t1 !== null && e.t1 !== undefined) problems.push(at + ".t1 is set");
      if (e.delta) problems.push(at + ".delta is set");
      if ((e.evidence as { source?: string } | null)?.source === "seen") {
        problems.push(at + ".evidence.source is 'seen'");
      }
    });
    return { visual: fixture.visual, ok: !problems.length, problems };
  }
  for (const p of pairs) {
    if (!p.actual || !p.fixture.provenance) continue;
    for (const [k, want] of Object.entries(p.fixture.provenance)) {
      const got = (p.actual.provenance as Record<string, string>)[k];
      if (got !== want) {
        problems.push("exercise " + p.fixture.i + " provenance." + k + ": " + got + " (fixture says " + want + ")");
      }
    }
  }
  return { visual: fixture.visual, ok: !problems.length, problems };
}

/**
 * The whole report.
 *
 * `problems` is the hard list — the things that fail a build. `notes` is the soft
 * one: measurements that are allowed to move, printed so somebody notices when
 * they move a long way.
 */
export function score(fixture: Fixture, pack: Pack, card: EvalCard | null): Report {
  const ce = fixture.card_expectations ?? {};
  const problems: string[] = [];
  const notes: string[] = [];

  const { pairs, extra } = align(fixture, pack);
  const flat = flatten(card);

  const missing: string[] = [];
  const exercises: ExerciseReport[] = [];
  const dt0s: number[] = [], dt1s: number[] = [];
  let equipChecked = 0, equipExact = 0;
  const hands: number[] = [], surfaces: number[] = [], loads: number[] = [];

  for (const p of pairs) {
    const fx = p.fixture;
    const a = p.actual;
    const observed = fx.observed !== false;
    const label = String(fx.name_shown ?? fx.name_said ?? fx.canonical_id ?? "exercise " + fx.i);
    if (observed && !a) missing.push(label);

    const v = (fx.variant ?? {}) as Record<string, unknown>;
    const eqWant = Array.isArray(v.equipment) ? (v.equipment as string[]).map((e) => normText(e)).sort() : null;
    const eqGot = a ? a.variant.equipment.map((e) => normText(e)).sort() : null;
    let eqOk: boolean | null = null;
    if (observed && a && eqWant) {
      equipChecked++;
      eqOk = JSON.stringify(eqWant) === JSON.stringify(eqGot);
      if (eqOk) equipExact++;
    }

    const overlap = (key: string, sink: number[]): number | null => {
      if (!observed || !a) return null;
      const want = v[key];
      if (typeof want !== "string" || !want.trim()) return null;
      const got = (a.variant as unknown as Record<string, unknown>)[key];
      const c = coverage(want, typeof got === "string" ? got : "");
      sink.push(c);
      return Math.round(c * 1000) / 1000;
    };

    let dt0: number | null = null, dt1: number | null = null;
    if (observed && a && typeof fx.t0 === "number") { dt0 = Math.round(Math.abs(a.t0 - fx.t0) * 100) / 100; dt0s.push(dt0); }
    if (observed && a && typeof fx.t1 === "number") { dt1 = Math.round(Math.abs(a.t1 - fx.t1) * 100) / 100; dt1s.push(dt1); }
    for (const [which, d] of [["t0", dt0], ["t1", dt1]] as [string, number | null][]) {
      if (d !== null && d > TIMESTAMP_SLACK_S) {
        problems.push("exercise " + fx.i + " (" + label + "): " + which + " is " + d +
          " s from the fixture, over " + TIMESTAMP_SLACK_S + " s");
      }
    }

    let canonOk: boolean | null = null;
    if (observed && a && fx.canonical_id !== undefined && fx.canonical_id !== null) {
      canonOk = (fx.acceptable_canonical_ids ?? [fx.canonical_id]).includes(a.canonical_id);
      if (!canonOk) {
        problems.push("exercise " + fx.i + " (" + label + "): canonical_id " +
          JSON.stringify(a.canonical_id) + ", fixture says " + JSON.stringify(fx.canonical_id));
      }
    }

    if (observed && a && fx.reps_prescribed !== undefined &&
        (a.reps_prescribed ?? null) !== fx.reps_prescribed) {
      problems.push("exercise " + fx.i + " prescribed reps differ from creator evidence");
    }
    // Null means no verified visible count in the fixture, not a request to invent one.
    if (observed && a && typeof fx.reps_seen === "number" && a.reps_seen !== fx.reps_seen) {
      problems.push("exercise " + fx.i + " visible reps differ from the counted demonstration");
    }
    exercises.push({
      i: fx.i,
      observed,
      fixture_name: fx.name_shown ?? null,
      actual_name: a?.name_shown ?? null,
      matched_by: p.by,
      canonical_expected: fx.canonical_id ?? null,
      canonical_actual: a?.canonical_id ?? null,
      canonical_ok: canonOk,
      dt0, dt1,
      equipment_expected: eqWant,
      equipment_actual: eqGot,
      equipment_ok: eqOk,
      hand_placement: overlap("hand_placement", hands),
      surface: overlap("surface", surfaces),
      load_position: overlap("load_position", loads),
      provenance_ok: observed && a && fx.provenance
        ? Object.entries(fx.provenance).every(([k, want]) =>
          (a.provenance as Record<string, string>)[k] === want)
        : null,
    });
  }

  for (const m of missing) problems.push("missing exercise: " + m);
  for (const e of extra) problems.push("extra exercise not in the fixture: " + e.name_shown);

  // ---------- cues ----------

  const cueDetail: CueScore[] = [];
  flat.forEach((e, k) => {
    const cue = String(e.cue ?? "").trim();
    if (!cue) return;
    // The creator cues to check a quotation against are the ones for THIS movement,
    // found the same way applyPack found the pack exercise: by catalog id, then by
    // name. A quote borrowed from the movement before it is the bug, not the test.
    const pair = pairs.find((p) =>
      (e.canonical_id && p.fixture.canonical_id === e.canonical_id) ||
      (!!p.fixture.name_shown && normText(String(p.fixture.name_shown)).includes(normText(e.name))) ||
      (!!p.fixture.name_said && normText(String(p.fixture.name_said)).includes(normText(e.name))) ||
      (!!p.fixture.name_said && normText(e.name).includes(normText(String(p.fixture.name_said)))));
    const s = scoreCue(k, e.name, cue, pair?.fixture.creator_cues, ce.cues?.[k] ?? null);
    cueDetail.push(s);
    if (!s.within_length) problems.push("cue " + k + " (" + e.name + ") is " + s.chars + " characters, over " + CUE_MAX);
    if (!s.within_sentences) problems.push("cue " + k + " (" + e.name + ") is " + s.sentences + " sentences, over 2");
    if (s.quotes_creator === false) {
      problems.push("cue " + k + " (" + e.name + ") quotes nothing the creator said, and the fixture has " +
        (pair?.fixture.creator_cues?.length ?? 0) + " cue(s) for it");
    }
    if (!s.verb_first) notes.push("cue " + k + " (" + e.name + ") does not open with a verb: " + JSON.stringify(cue.slice(0, 40)));
    if (s.matches_expected !== null && s.matches_expected < 0.5) {
      notes.push("cue " + k + " (" + e.name + ") covers " + Math.round(s.matches_expected * 100) +
        "% of the fixture's wording");
    }
  });

  // ---------- the card's own ids and deltas ----------

  (ce.canonical_ids ?? []).forEach((want, k) => {
    if (want === undefined) return;
    const got = flat[k]?.canonical_id ?? null;
    if (!(ce.acceptable_canonical_ids?.[k] ?? [want]).includes(got)) {
      problems.push("card exercise " + k + " canonical_id " + JSON.stringify(got) +
        ", fixture says " + JSON.stringify(want));
    }
  });

  const deltaDetail: Report["deltas"]["detail"] = [];
  let deltaOk = 0;
  const deltaWanted = ce.deltas?.values ?? [];
  deltaWanted.forEach((want, k) => {
    if (want === undefined) return;
    const got = flat[k]?.delta ?? null;
    let ok: boolean;
    let cov: number | null = null;
    if (want === null) {
      // The half that matters more. A delta on a movement that WAS the standard
      // version tells a reader something is different when nothing is, and a delta
      // on every exercise says as much as a delta on none.
      ok = got === null || got === undefined || got === "";
      if (!ok) problems.push("card exercise " + k + " has delta " + JSON.stringify(got) + " where the fixture expects none");
    } else if (!got) {
      ok = false;
      problems.push("card exercise " + k + " has no delta; the fixture expects " + JSON.stringify(want));
    } else {
      cov = Math.round(coverage(want, got) * 1000) / 1000;
      ok = cov >= 0.5;
      if (!ok) {
        problems.push("card exercise " + k + " delta " + JSON.stringify(got) +
          " shares " + Math.round(cov * 100) + "% of " + JSON.stringify(want));
      }
    }
    if (ok) deltaOk++;
    deltaDetail.push({ i: k, expected: want, actual: got ?? null, coverage: cov, ok });
  });

  // ---------- must_not ----------

  const fields = textFields(pack, card);
  const violations: Report["must_not"]["violations"] = [];
  for (const rule of ce.must_not ?? []) {
    if (rule.never) {
      const needle = normText(rule.never);
      if (!needle) continue;
      for (const f of fields) {
        if (hasAffirmedPhrase(f.text, needle)) {
          violations.push({ rule: rule.never, why: rule.why ?? "", where: f.where, text: f.text.slice(0, 120) });
        }
      }
    } else if (rule.field) {
      for (const hit of fieldViolations(card, rule.field)) {
        violations.push({ rule: rule.field, why: rule.why ?? "", where: hit.where, text: hit.text.slice(0, 120) });
      }
    }
  }
  for (const v of violations) problems.push("must_not '" + v.rule + "' at " + v.where + ": " + v.text);

  // ---------- stamping, provenance, validity ----------

  const stamped = flat.filter((e) => e.t0 !== null && e.t0 !== undefined).length;
  if (typeof ce.stamped === "number" && stamped !== ce.stamped) {
    problems.push("applyPack stamped " + stamped + " of " + flat.length + " exercise(s); the fixture expects " + ce.stamped);
  }

  const prov = scoreProvenance(fixture, pack, card, pairs);
  for (const p of prov.problems) problems.push("provenance: " + p);

  // The same gate buildVideoPack applies before it writes a pack to video_cache:
  // verification passed AND there is something in it. A pack that fails either is
  // simply not stored, and the card is built the way it was built yesterday.
  const check = validatePack(pack);
  const storable = check.ok && !!(pack.exercises.length || pack.transcript.length);
  const valid = { ok: check.ok, problems: check.problems, storable };
  if (fixture.visual === "unavailable") {
    // Nothing was read and nothing was said, so there is nothing to keep. A pack
    // that would be STORED here is the expensive failure: it is cached globally
    // under the shortcode, so the next person to save the same post inherits a
    // record of a video nobody ever watched.
    if (storable) problems.push("a pack would be stored for a post with no visual and no transcript");
  } else {
    for (const p of check.problems) problems.push("validatePack: " + p);
    if (!storable) problems.push("the pack would not be stored: nothing was seen and nothing was said");
  }

  if (ce.title !== undefined && (card?.title ?? null) !== (ce.title ?? null)) {
    notes.push("title is " + JSON.stringify(card?.title ?? null) + ", fixture says " + JSON.stringify(ce.title ?? null));
  }

  const observedCount = fixture.exercises.filter((e) => e.observed !== false).length;
  return {
    shortcode: fixture.shortcode,
    platform: fixture.platform,
    visual: pack.visual,
    reader: pack.reader,
    fixture_v: fixture.fixture_v ?? null,
    ok: !problems.length,
    problems,
    notes,
    counts: {
      fixture: fixture.exercises.length,
      observed: observedCount,
      unobserved: fixture.exercises.length - observedCount,
      actual: pack.exercises.length,
      matched: pairs.filter((p) => p.actual).length,
      missing: missing.length,
      extra: extra.length,
      stamped,
      stamped_expected: ce.stamped ?? null,
    },
    missing,
    extra: extra.map((e) => e.name_shown),
    timestamps: {
      n: dt0s.length,
      expected_boundaries: fixture.exercises.filter((e) => e.observed !== false)
        .reduce((n, e) => n + Number(typeof e.t0 === "number") + Number(typeof e.t1 === "number"), 0),
      measured_boundaries: dt0s.length + dt1s.length,
      missing_boundaries: pairs.filter((p) => p.fixture.observed !== false && !p.actual)
        .reduce((n, p) => n + Number(typeof p.fixture.t0 === "number") + Number(typeof p.fixture.t1 === "number"), 0),
      within_slack: [...dt0s, ...dt1s].filter((d) => d <= TIMESTAMP_SLACK_S).length,
      mean_dt0: mean(dt0s),
      mean_dt1: mean(dt1s),
      max_dt: dt0s.concat(dt1s).length ? Math.max(...dt0s.concat(dt1s)) : null,
    },
    attributes: {
      equipment_checked: equipChecked,
      equipment_exact: equipExact,
      hand_placement_mean: mean(hands),
      surface_mean: mean(surfaces),
      load_position_mean: mean(loads),
    },
    cues: {
      checked: cueDetail.length,
      within_length: cueDetail.filter((c) => c.within_length).length,
      within_sentences: cueDetail.filter((c) => c.within_sentences).length,
      verb_first: cueDetail.filter((c) => c.verb_first).length,
      quote_checked: cueDetail.filter((c) => c.quotes_creator !== null).length,
      quotes_creator: cueDetail.filter((c) => c.quotes_creator === true).length,
      mean_match: mean(cueDetail.map((c) => c.matches_expected).filter((x): x is number => x !== null)),
      detail: cueDetail,
    },
    deltas: { checked: deltaDetail.length, correct: deltaOk, detail: deltaDetail },
    must_not: { checked: (ce.must_not ?? []).length, violations },
    provenance: prov,
    pack_valid: valid,
    exercises,
  };
}

// ---------- printing ----------

function pct(n: number, d: number): string {
  return d ? Math.round((n / d) * 100) + "%" : "—";
}

function num(n: number | null, digits = 2): string {
  return n === null ? "—" : n.toFixed(digits);
}

/** The report as a few lines somebody will actually read. */
export function formatReport(r: Report): string {
  const L: string[] = [];
  L.push("");
  L.push((r.ok ? "PASS  " : "FAIL  ") + r.shortcode + "  (" + r.platform + ", visual " + r.visual +
    ", read by " + r.reader + ")");
  L.push("  exercises   fixture " + r.counts.fixture +
    (r.counts.unobserved ? " (" + r.counts.unobserved + " unrecorded, skipped)" : "") +
    " · pack " + r.counts.actual + " · matched " + r.counts.matched +
    " · missing " + r.counts.missing + " · extra " + r.counts.extra);
  L.push("  stamped     " + r.counts.stamped +
    (r.counts.stamped_expected === null ? "" : " of " + r.counts.stamped_expected + " expected"));
  L.push("  timestamps  mean |dt0| " + num(r.timestamps.mean_dt0) + " s · mean |dt1| " +
    num(r.timestamps.mean_dt1) + " s · worst " + num(r.timestamps.max_dt) + " s (matched n=" + r.timestamps.n + "; " + r.timestamps.measured_boundaries + "/" + r.timestamps.expected_boundaries + " boundaries measured; " + r.timestamps.missing_boundaries + " missing)");
  L.push("  attributes  equipment exact " + r.attributes.equipment_exact + "/" + r.attributes.equipment_checked +
    " · hands " + num(r.attributes.hand_placement_mean) +
    " · surface " + num(r.attributes.surface_mean) +
    " · load " + num(r.attributes.load_position_mean) + "   (overlap 0–1, for a human)");
  L.push("  cues        " + r.cues.checked + " checked · length " + pct(r.cues.within_length, r.cues.checked) +
    " · two sentences " + pct(r.cues.within_sentences, r.cues.checked) +
    " · verb first " + pct(r.cues.verb_first, r.cues.checked) +
    " · quotes creator " + r.cues.quotes_creator + "/" + r.cues.quote_checked +
    (r.cues.mean_match === null ? "" : " · wording " + num(r.cues.mean_match)));
  L.push("  deltas      " + r.deltas.correct + "/" + r.deltas.checked + " correct");
  L.push("  must_not    " + r.must_not.checked + " rule(s), " + r.must_not.violations.length + " violation(s)");
  L.push("  provenance  " + (r.provenance.ok ? "consistent" : r.provenance.problems.length + " problem(s)") +
    " · pack " + (r.pack_valid.ok ? "valid" : "does not verify") +
    " · " + (r.pack_valid.storable ? "stored" : "not stored"));
  if (r.exercises.some((e) => e.observed)) {
    L.push("  per movement:");
    for (const e of r.exercises) {
      if (!e.observed) {
        L.push("    " + String(e.i).padEnd(2) + " (not recorded in the fixture — skipped)");
        continue;
      }
      L.push("    " + String(e.i).padEnd(2) + " " + (e.actual_name ?? "MISSING").slice(0, 34).padEnd(35) +
        " id " + (e.canonical_ok === null ? "—" : e.canonical_ok ? "ok" : "WRONG").padEnd(6) +
        " dt " + num(e.dt0, 1) + "/" + num(e.dt1, 1) +
        " eq " + (e.equipment_ok === null ? "—" : e.equipment_ok ? "ok" : "WRONG").padEnd(5) +
        " hands " + num(e.hand_placement) +
        (e.matched_by ? "  (by " + e.matched_by + ")" : ""));
    }
  }
  for (const p of r.problems) L.push("  ✗ " + p);
  for (const n of r.notes) L.push("  · " + n);
  return L.join("\n");
}

// ---------- exit codes ----------

export const EXIT = {
  ok: 0,
  usage: 1,
  /** A phrase the fixture forbids turned up in the output. */
  must_not: 2,
  /** The pipeline lost a movement the video contains. */
  missing: 3,
  /** Everything else the fixture calls hard. */
  failed: 4,
};

export function exitCodeFor(r: Report): number {
  if (r.must_not.violations.length) return EXIT.must_not;
  if (r.counts.missing) return EXIT.missing;
  return r.ok ? EXIT.ok : EXIT.failed;
}

// ---------- run me directly ----------
//
// `deno run --allow-read tools/pack-eval/score.ts <fixture.json> <actual.json>`
// where actual.json is `{"pack": …, "card": …}` — what the live runner writes out.
// Useful for re-scoring a bench run without paying for it twice.

if (import.meta.main) {
  const [fxPath, actualPath] = Deno.args.filter((a) => !a.startsWith("--"));
  if (!fxPath || !actualPath) {
    console.error("usage: score.ts <fixture.json> <actual.json>   (actual = {pack, card})");
    Deno.exit(EXIT.usage);
  }
  const fixture = JSON.parse(await Deno.readTextFile(fxPath)) as Fixture;
  const actual = JSON.parse(await Deno.readTextFile(actualPath)) as { pack: Pack; card: EvalCard };
  const report = score(fixture, actual.pack, actual.card ?? null);
  if (Deno.args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else console.log(formatReport(report));
  Deno.exit(exitCodeFor(report));
}

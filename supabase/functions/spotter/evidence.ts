// Spotter — evidence, and a confidence score computed from it.
//
// Extraction used to run once and be believed. The replacement is not a better
// model, it is a record of where each claim came from and a score derived from
// checkable properties of that record.
//
// The rule that shapes everything here: **the model never reports its own
// confidence.** Asking a language model how sure it is produces a number that
// correlates with fluency, not with correctness, and it is uniformly high on
// exactly the confident-nonsense output the score exists to catch. So the model is
// asked for something falsifiable instead — a verbatim quote from the source it
// claims to have read — and this module checks whether that quote is actually
// there. A quote that cannot be found is not evidence, and it drags the score down
// rather than propping it up.
//
// Everything in this file is pure and side-effect free, so it runs under `node
// --experimental-strip-types` for the test battery in tools/test-confidence.mjs
// as well as under Deno in the edge function.

// ---------- evidence ----------

export type EvidenceSource =
  | "caption"      // Instagram / TikTok caption text
  | "description"  // YouTube description, or a web page's body
  | "chapters"     // a timestamped line in a YouTube description
  | "carousel"     // read off a carousel slide by vision — no text to check against
  | "heuristic"    // the deterministic parser, which knows exactly which line it read
  | "none";

export type Evidence = {
  source: EvidenceSource;
  /** 0-based line index within the source text, when the source has lines. */
  line: number | null;
  /** Character offset of the located text within the source. */
  offset: number | null;
  /** The source line that carries the claim, trimmed and capped. */
  quote: string | null;
  /** Chapter timestamp in seconds, when the line that matched was a chapter. */
  t: number | null;
  /** Carousel slide index, for anything vision produced. */
  slide: number | null;
  /**
   * True only when the claim was located in a text we hold. Carousel OCR is
   * deliberately never verified: there is no text to check it against, and
   * pretending otherwise would make the least reliable source score the highest.
   */
  verified: boolean;
};

/** The minimum an exercise has to look like for this module to score it. */
export type ScorableExercise = {
  name: string;
  canonical_id?: string | null;
  sets?: number | null;
  reps?: string | null;
  duration_seconds?: number | null;
  rest_seconds?: number | null;
  evidence?: Evidence | null;
  /** What the model claimed it was quoting. Checked, then discarded. */
  evidence_quote?: string | null;
};

export type ScorableBlock = {
  rounds?: number | null;
  rest_seconds?: number | null;
  exercises: ScorableExercise[];
};

export type ScorableCard = {
  duration_minutes?: number | null;
  blocks: ScorableBlock[];
};

export function emptyEvidence(source: EvidenceSource = "none"): Evidence {
  return { source, line: null, offset: null, quote: null, t: null, slide: null, verified: false };
}

export function carouselEvidence(slide: number, quote: string | null): Evidence {
  return {
    source: "carousel", line: null, offset: null, t: null, slide,
    quote: quote ? quote.slice(0, 160) : null,
    // Nothing to verify against. This is the honest answer, and it is what makes a
    // vision-only card score below a caption-backed one.
    verified: false,
  };
}

// ---------- text normalization ----------
//
// Matching happens on a flattened form so that "▶️ Bulgarian Split Squats —
// 3x10" and "bulgarian split squat" meet in the middle. Offsets are reported
// against the ORIGINAL text, so a normalized match has to be traced back; that is
// why matching is done per line rather than over one giant normalized string.

export function normText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")   // strip combining accents left by NFKD
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "with", "for", "on", "in", "each",
  "side", "per", "x", "reps", "rep", "sets", "set", "second", "seconds", "sec",
  "secs", "minute", "minutes", "min", "mins",
]);

/**
 * A crude singularizer, so "Bulgarians" and "Bulgarian" are the same token. Not a
 * stemmer — deliberately. Anything more aggressive starts merging "press" with
 * "presses" AND with "pressure", and a false match here silently manufactures
 * evidence, which is the one outcome this whole file exists to prevent.
 */
function stem(t: string): string {
  if (t.length > 3 && t.endsWith("es") && !/(ss|se)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

function tokens(s: string): string[] {
  return normText(s).split(" ").filter((t) => t && !STOP.has(t)).map(stem);
}

export type SourceLine = {
  i: number;         // line index
  offset: number;    // char offset of the line start in the original text
  raw: string;
  norm: string;
  /** Set when the line is a chapter entry, in seconds. */
  t: number | null;
  label: string;     // the chapter label, or the raw line
};

// ---------- chapters ----------
//
// YouTube descriptions routinely carry "0:00 Warm up / 1:30 Goblet Squat", and the
// Data API already hands us the whole description. That is genuine evidence about
// what happens in the video and roughly when.
//
// It is also, on its own, a trap. A chapter list reads as a perfectly plausible
// workout — "Intro / Warm up / Circuit 1 / Outro" becomes a four-exercise card
// with no sets, no reps and nothing that happened in the gym. So chapters are fed
// to the extractor as one labelled source among others and are never allowed to
// terminate the search; and a card whose exercises trace ONLY to chapter lines is
// capped hard by the scorer below.

const CHAPTER_LEAD = /^[\s\-*•·]*[[(]?\s*(\d{1,3}:\d{2}(?::\d{2})?)\s*[\])]?\s*[-–—:.|)\]]*\s*(.+?)\s*$/;
const CHAPTER_TRAIL = /^\s*(.+?)\s*[-–—:|.]*\s*[[(]?\s*(\d{1,3}:\d{2}(?::\d{2})?)\s*[\])]?\s*$/;

/**
 * Labels that are never a movement, however confidently a model lists them.
 * "Warm up" and "cool down" are on this list on purpose: they are real parts of a
 * session and useless as exercise names, and they are half of the exact card the
 * handoff warns about — "Intro / Warm up / Outro" is what a chapter list becomes
 * when nobody checks. "Workout" is on it for the same reason: a chapter that says
 * the workout starts here is a heading, and nobody can perform it.
 */
export const CHAPTER_JUNK =
  /^(intro(duction)?|outro|start|welcome|about|subscribe|sponsor|ad\b|thanks|credits|music|my gear|gear|equipment( list)?|disclaimer|q ?& ?a|questions|recap|summary|conclusion|the end|end|preview|teaser|what'?s? (next|coming)|follow me|links?|shop|merch|discount|coupon|timestamps?|chapters?|warm ?-? ?up|cool ?-? ?down|stretch(ing)?|rest|break|(the )?workout)\b/i;

export type Chapter = { t: number; label: string; line: number };

function hmsToSeconds(hms: string): number {
  const p = hms.split(":").map((x) => parseInt(x, 10));
  if (p.some((x) => !Number.isFinite(x))) return -1;
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return -1;
}

/**
 * Pull the chapter list out of a description. Requires two timestamped lines
 * before it will call anything a chapter list: a lone "0:00" in a caption is a
 * stray number, and treating it as a chapter would invent a one-exercise workout.
 */
export function parseChapters(text: string | null | undefined): Chapter[] {
  if (!text) return [];
  const out: Chapter[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    let m = line.match(CHAPTER_LEAD);
    let t = -1, label = "";
    if (m) { t = hmsToSeconds(m[1]); label = m[2]; }
    else {
      m = line.match(CHAPTER_TRAIL);
      // A trailing timestamp only counts with a real label in front of it,
      // otherwise "…in 45:00" style prose becomes a chapter.
      if (m && m[1].trim().length >= 3) { t = hmsToSeconds(m[2]); label = m[1]; }
    }
    if (t < 0 || !label) continue;
    const clean = label.replace(/[\s\-–—:|.]+$/, "").trim();
    if (!clean || clean.length > 90) continue;
    out.push({ t, label: clean, line: i });
  }
  // Timestamps must be non-decreasing to be a chapter list rather than scattered
  // numbers; and one entry is not a list.
  if (out.length < 2) return [];
  for (let i = 1; i < out.length; i++) if (out[i].t < out[i - 1].t) return [];
  return out;
}

/** How many chapter labels could plausibly be a movement rather than furniture. */
export function chapterExerciseCount(chapters: Chapter[]): number {
  return chapters.filter((c) => !CHAPTER_JUNK.test(c.label.trim())).length;
}

/**
 * Is this exercise a chapter heading wearing an exercise's clothes?
 *
 * The chapters-only cap scores such a card down; it does not stop "Warm up",
 * "Workout" and "Cool Down & Stretch" being listed to the user as three movements
 * to perform. The cap answers "how much should this be trusted"; it cannot answer
 * "what is this card telling me to do", and three headings in the exercise list is
 * a wrong answer to the second question at any score.
 *
 * Deleting model output is a stronger action than scoring it, so all three
 * conditions have to hold and each one is deliberately narrow:
 *
 *   1. No dose of its own. Sets, reps or a duration make it a prescription
 *      whatever it is called. A chapter's span is not a dose — nothing copies a
 *      timestamp into duration_seconds — so a duration here came from written text.
 *   2. The name is furniture (CHAPTER_JUNK) rather than a movement.
 *   3. It traces to a chapter line, to nothing at all, or to the title line of a
 *      source that carries one — and only on a card that used chapters at all.
 *      Anything else located in real caption or description text is left alone
 *      however it is named: "Warm up set 3x10" written out in a caption is an
 *      instruction the creator actually gave.
 *
 * The title line is in that list because of how the sources are assembled, not as
 * a guess: ytMeta builds the text it hands over as `title + "\n\n" + description`,
 * and webMeta as `og:title + "\n" + og:description + body`, so line 0 is the video's
 * own title. A description titled "20 MINUTE WORKOUT" therefore gives the heading
 * "Workout" an exact match in written text, and without this it would outrank the
 * chapter line it actually came from and survive as the card's only exercise. A
 * title is not a prescription, so a dose-less furniture name matching there is the
 * same failure as one matching the chapter line — but the rule is confined to
 * chapter cards, so an Instagram caption whose first line happens to read "Warm up"
 * is untouched.
 *
 * `cardSources` is every evidence source present on the card, which is what makes
 * condition 3 answerable for an exercise that located nothing itself.
 */
export function isChapterJunkExercise(
  ex: ScorableExercise,
  cardSources: Iterable<EvidenceSource>,
): boolean {
  if (typeof ex.sets === "number" && ex.sets > 0) return false;
  if (ex.reps !== null && ex.reps !== undefined && String(ex.reps).trim() !== "") return false;
  if (typeof ex.duration_seconds === "number" && ex.duration_seconds > 0) return false;

  const name = (ex.name ?? "").trim();
  if (!name || !CHAPTER_JUNK.test(name)) return false;

  const src = ex.evidence?.source;
  if (src === "chapters") return true;

  let usedChapters = false;
  for (const s of cardSources) if (s === "chapters") { usedChapters = true; break; }
  if (!usedChapters) return false;

  // No located evidence. On a card that used chapters, a junk name with nothing
  // behind it is the same failure one step further along: the model read the
  // chapter list and the quote could not be found afterwards.
  if (!src || src === "none") return true;
  // Located, but on the title line — which is the video's own name, not something
  // it asks anyone to do.
  if ((src === "caption" || src === "description") && ex.evidence?.line === 0) return true;
  return false;
}

/**
 * Apply that decision across a card and report what was deleted. Runs after
 * attachEvidence, because every condition above is about evidence.
 *
 * The card's sources are collected first: "traced to nothing, on a card that used
 * chapters" is not a question one exercise can answer about itself. Blocks left
 * holding nothing are removed as well — a block that contained only headings was
 * a heading.
 */
export function dropChapterJunk(card: ScorableCard): string[] {
  const sources = new Set<EvidenceSource>();
  for (const b of card.blocks ?? []) {
    for (const ex of b.exercises ?? []) if (ex.evidence?.source) sources.add(ex.evidence.source);
  }
  const dropped: string[] = [];
  for (const b of card.blocks ?? []) {
    if (!Array.isArray(b.exercises)) continue;
    b.exercises = b.exercises.filter((ex) => {
      if (!isChapterJunkExercise(ex, sources)) return true;
      dropped.push(ex.name);
      return false;
    });
  }
  if (dropped.length) card.blocks = (card.blocks ?? []).filter((b) => (b.exercises?.length ?? 0) > 0);
  return dropped;
}

// ---------- the source index ----------

export type SourceIndex = {
  kind: "caption" | "description";
  text: string;
  lines: SourceLine[];
  chapters: Chapter[];
  normWhole: string;
};

export function indexSource(
  text: string | null | undefined,
  kind: "caption" | "description",
): SourceIndex {
  const t = text ?? "";
  const chapters = parseChapters(t);
  const byLine = new Map<number, Chapter>();
  for (const c of chapters) byLine.set(c.line, c);

  const lines: SourceLine[] = [];
  let offset = 0;
  const raws = t.split("\n");
  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i];
    const ch = byLine.get(i);
    lines.push({
      i, offset, raw,
      norm: normText(raw),
      t: ch ? ch.t : null,
      label: ch ? ch.label : raw.trim(),
    });
    offset += raw.length + 1;
  }
  return { kind, text: t, lines, chapters, normWhole: normText(t) };
}

// ---------- locating a claim in the source ----------

/**
 * Find the line that best supports any of `needles` — the model's claimed quote,
 * the exercise's own name, and the catalog aliases of whatever it normalized to.
 *
 * Two rules decide the winner, in this order:
 *
 *   1. **A written line beats a chapter line.** A description holding both
 *      "2:30 Goblet Squat" and "Goblet Squat 4x12" has a real prescription in it,
 *      and matching the timestamp instead would file a properly-sourced card under
 *      the chapters-only cap. Source strength is not a tiebreak, it is the point.
 *   2. Exact normalized containment beats token overlap.
 *
 * Returns null rather than guessing. An unlocatable claim has to cost the card
 * something, and a false match would hide exactly the failure this exists to expose.
 */
export function locate(src: SourceIndex, needles: string | string[]): SourceLine | null {
  const list = (Array.isArray(needles) ? needles : [needles])
    .filter((s): s is string => typeof s === "string" && normText(s).length >= 3);
  if (!list.length) return null;

  let best: SourceLine | null = null;
  let bestRank = -1;
  let bestQuality = -1;

  // rank: 3 written+exact, 2 chapter+exact, 1 written+fuzzy, 0 chapter+fuzzy
  const consider = (l: SourceLine, exact: boolean, quality: number) => {
    const rank = (exact ? 2 : 0) + (l.t === null ? 1 : 0);
    if (rank > bestRank || (rank === bestRank && quality > bestQuality)) {
      bestRank = rank; bestQuality = quality; best = l;
    }
  };

  for (const needle of list) {
    const n = normText(needle);
    for (const l of src.lines) {
      if (!l.norm) continue;
      if (l.norm.includes(n) || (n.length > 12 && n.includes(l.norm) && l.norm.length > 6)) {
        consider(l, true, 1);
      }
    }
  }
  if (bestRank >= 3) return best;   // a written exact match cannot be beaten

  for (const needle of list) {
    const want = tokens(needle);
    if (!want.length) continue;
    for (const l of src.lines) {
      if (!l.norm) continue;
      const have = new Set(tokens(l.raw));
      let hit = 0;
      for (const w of want) if (have.has(w)) hit++;
      const score = hit / want.length;
      // Two matching significant tokens, or a single-token name matched outright
      // against a short line. A long line matching one common token is a coincidence.
      const enough = want.length === 1 ? hit === 1 && have.size <= 12 : hit >= 2 && score >= 0.6;
      if (enough) consider(l, false, score);
    }
  }
  return best;
}

function evidenceFromLine(src: SourceIndex, l: SourceLine, quote: string | null): Evidence {
  return {
    // A line carrying a timestamp is chapter evidence even though it lives in the
    // description. Which of the two it is decides how much the card is trusted, so
    // the distinction is drawn from the line's own shape rather than asserted.
    source: l.t !== null ? "chapters" : src.kind,
    line: l.i,
    offset: l.offset,
    quote: (quote ?? l.raw).trim().slice(0, 160) || null,
    t: l.t,
    slide: null,
    verified: true,
  };
}

/**
 * Attach evidence to every exercise on the card, in order of decreasing strength:
 *
 *   1. the verbatim quote the model claimed, IF it can be found in the source
 *   2. the exercise's own name, found in the source
 *   3. nothing — recorded as unverified, which is the point
 *
 * Evidence already present (the heuristic parser knows its own line; vision knows
 * its slide) is left alone.
 */
export function attachEvidence(
  card: ScorableCard,
  src: SourceIndex | null,
  /**
   * Extra names to search for — in practice the catalog aliases of whatever the
   * exercise normalized to, so a card saying "Bulgarian Split Squat" still finds
   * the caption line that says "DB Bulgarians". The catalog already encodes this
   * synonymy; duplicating it as fuzzier matching here would only add false hits.
   */
  aliasesFor?: (ex: ScorableExercise) => string[],
): void {
  for (const b of card.blocks ?? []) {
    for (const ex of b.exercises ?? []) {
      if (ex.evidence && ex.evidence.source !== "none") { delete ex.evidence_quote; continue; }
      if (!src || !src.text) {
        ex.evidence = emptyEvidence("none");
        delete ex.evidence_quote;
        continue;
      }
      const claimed = typeof ex.evidence_quote === "string" ? ex.evidence_quote : "";
      const byQuote = claimed ? locate(src, claimed) : null;
      const line = byQuote ?? locate(src, [ex.name, ...(aliasesFor?.(ex) ?? [])]);
      ex.evidence = line
        ? evidenceFromLine(src, line, byQuote ? claimed : null)
        : emptyEvidence("none");
      // The model's claim has served its purpose; only the checked result is kept.
      delete ex.evidence_quote;
    }
  }
}

// ---------- what evidence is FOR ----------

/** A single movement lasting longer than this is the session, not the exercise. */
const MAX_EXERCISE_SECONDS = 1800;

const SECONDS_UNIT = "(?:s|sec|secs|second|seconds)";

/** "45 sec", "45s", "45 seconds" — the number immediately followed by a seconds unit. */
function saysSeconds(line: string, n: number): boolean {
  return new RegExp("\\b" + n + "\\s*" + SECONDS_UNIT + "\\b", "i").test(line);
}

/**
 * Repair the minutes/seconds confusion, using the evidence line as the authority.
 *
 * Found on the first real save this was tested against: a caption reading
 * "▶️goblet squats 45 secs" produced `duration_seconds: 2700`. The model read 45,
 * decided it was minutes, and multiplied. Forty-five minutes of goblet squats is
 * not a plausible prescription and it would have driven Workout Mode's timer.
 *
 * The correction is only made when the source says so: the value must be an exact
 * multiple of 60, and the line the exercise was traced to must contain the
 * quotient followed by a seconds unit. Anything still implausible afterwards is
 * set to null rather than clamped — a wrong-but-smaller number is still wrong, and
 * "not stated" is the truthful answer.
 */
export function correctUnitErrors(card: ScorableCard, src: SourceIndex | null): string[] {
  const fixed: string[] = [];
  for (const b of card.blocks ?? []) {
    for (const ex of b.exercises ?? []) {
      const d = ex.duration_seconds;
      if (typeof d !== "number" || d <= 600) continue;

      const lineNo = ex.evidence?.line;
      const line = src && lineNo != null ? src.lines[lineNo]?.raw ?? "" : "";
      const q = d % 60 === 0 ? d / 60 : 0;
      if (q && line && saysSeconds(line, q)) {
        ex.duration_seconds = q;
        fixed.push(`${ex.name}: ${d}s -> ${q}s (source says "${q} sec")`);
        continue;
      }
      if (d > MAX_EXERCISE_SECONDS) {
        ex.duration_seconds = null;
        fixed.push(`${ex.name}: dropped ${d}s as implausible for one movement`);
      }
    }
  }
  return fixed;
}

// ---------- the score ----------

export type ConfidenceParts = {
  evidence: number;
  numbers: number;
  agreement: number;
  catalog: number;
  duration: number;
};

export type Confidence = {
  score: number;
  parts: ConfidenceParts;
  /** Percentage of exercises whose evidence was located in a text we hold. */
  evidence_pct: number;
  /** True when any exercise traces to a chapter line. */
  chapters_used: boolean;
  /** True when EVERY exercise traces only to chapter lines — the known trap. */
  chapters_only: boolean;
  exercises: number;
  notes: string[];
};

const WEIGHTS: ConfidenceParts = {
  evidence: 0.30,
  numbers: 0.20,
  agreement: 0.20,
  catalog: 0.20,
  duration: 0.10,
};

/** No comparator available. Not evidence for the card and not evidence against it. */
const NEUTRAL = 0.5;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function numbersIn(s: string): Set<number> {
  const out = new Set<number>();
  for (const m of s.matchAll(/\d+/g)) {
    const n = parseInt(m[0], 10);
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}

/**
 * Do the doses the card claims actually appear in the text it claims to have read?
 *
 * This is the single most useful signal, because inventing plausible sets and reps
 * is precisely what a model does when a caption names exercises without prescribing
 * any. A number found on the exercise's own evidence line counts fully; the same
 * number found somewhere else in the source counts partially, since it may well be
 * a coincidence in a caption full of numbers.
 */
function doseScore(ex: ScorableExercise, src: SourceIndex | null): number | null {
  // `minutesOnly` marks a number that is only acceptable if the source is talking
  // in minutes. Without it, a card claiming 2700 seconds scores a hit against a
  // caption reading "45 secs", because 2700/60 is 45 — the arithmetic agrees while
  // the meaning is off by a factor of sixty, which is the exact error observed on
  // the first real save this was run against.
  const want: { n: number; minutesOnly?: boolean }[] = [];
  if (typeof ex.sets === "number" && ex.sets > 0) want.push({ n: ex.sets });
  if (ex.reps) for (const n of numbersIn(String(ex.reps))) want.push({ n });
  if (typeof ex.duration_seconds === "number" && ex.duration_seconds > 0) {
    want.push({ n: ex.duration_seconds });
    if (ex.duration_seconds % 60 === 0) want.push({ n: ex.duration_seconds / 60, minutesOnly: true });
  }
  if (!want.length) return null;          // nothing claimed: not this exercise's signal
  if (!src || !src.text) return 0;        // claimed with no source at all

  const line = ex.evidence?.line != null ? src.lines[ex.evidence.line]?.raw ?? "" : "";
  const lineNums = numbersIn(line);
  const wholeNums = numbersIn(src.text);

  let got = 0;
  const seen = new Set<number>();
  for (const w of want) {
    if (seen.has(w.n)) continue;
    seen.add(w.n);
    if (w.minutesOnly && line && saysSeconds(line, w.n)) continue;   // the source meant seconds
    if (lineNums.has(w.n)) got += 1;
    else if (wholeNums.has(w.n)) got += 0.55;
  }
  return clamp01(got / seen.size);
}

/** Rough seconds for one exercise: an explicit duration, or reps at a tempo. */
function exerciseSeconds(ex: ScorableExercise): number {
  const sets = typeof ex.sets === "number" && ex.sets > 0 ? ex.sets : 1;
  const rest = typeof ex.rest_seconds === "number" && ex.rest_seconds > 0 ? ex.rest_seconds : 0;
  if (typeof ex.duration_seconds === "number" && ex.duration_seconds > 0) {
    return sets * ex.duration_seconds + (sets - 1) * rest;
  }
  const reps = ex.reps ? [...numbersIn(String(ex.reps))] : [];
  const r = reps.length ? Math.max(...reps) : 10;
  return sets * Math.min(r, 60) * 3.5 + (sets - 1) * rest;
}

export function estimateSeconds(card: ScorableCard): number {
  let total = 0;
  for (const b of card.blocks ?? []) {
    const rounds = typeof b.rounds === "number" && b.rounds > 0 ? b.rounds : 1;
    let inner = 0;
    for (const ex of b.exercises ?? []) inner += exerciseSeconds(ex);
    total += rounds * inner + (rounds - 1) * (b.rest_seconds ?? 0);
  }
  return Math.round(total);
}

/**
 * Is the card's own length plausible against what it prescribes? A card claiming a
 * 20-minute session whose exercises add up to three minutes has either dropped most
 * of the workout or invented the duration; either way it should not read as certain.
 */
function durationScore(card: ScorableCard, statedSeconds: number | null): number {
  const est = estimateSeconds(card);
  const stated = card.duration_minutes ? card.duration_minutes * 60 : statedSeconds;
  if (!stated || stated <= 0 || est <= 0) return NEUTRAL;
  const ratio = est / stated;
  if (ratio >= 0.5 && ratio <= 2.0) return 1;
  if (ratio >= 0.2 && ratio <= 5.0) {
    // linear decay out to the outer bounds
    const over = ratio > 2 ? (ratio - 2) / 3 : (0.5 - ratio) / 0.3;
    return clamp01(1 - over);
  }
  return 0;
}

function agreementScore(n: number, others: number[]): number {
  const usable = others.filter((o) => Number.isFinite(o) && o > 0);
  if (!usable.length) return NEUTRAL;
  let sum = 0;
  for (const o of usable) sum += clamp01(1 - Math.abs(n - o) / Math.max(n, o, 1));
  return sum / usable.length;
}

export type ScoreContext = {
  src: SourceIndex | null;
  /** What the deterministic parser found, as a second opinion on the count. */
  heuristicCount?: number;
  /** Plausible-movement chapter labels, when the description had a chapter list. */
  chapterCount?: number;
  /** Real runtime from the platform, in seconds, when it told us. */
  mediaSeconds?: number | null;
};

/**
 * The score. Every input is something we can check; none of them is the model's
 * opinion. Weights are declared above rather than tuned, because there is not yet
 * a labelled set to tune them against — that is exactly what Phase 2 is for, and
 * storing the parts alongside the total is what will make retuning possible
 * without re-extracting anything.
 */
export function scoreCard(card: ScorableCard, ctx: ScoreContext): Confidence {
  const exercises: ScorableExercise[] = [];
  for (const b of card.blocks ?? []) for (const ex of b.exercises ?? []) exercises.push(ex);

  const notes: string[] = [];
  const zero: ConfidenceParts = { evidence: 0, numbers: 0, agreement: 0, catalog: 0, duration: 0 };
  if (!exercises.length) {
    return {
      score: 0, parts: zero, evidence_pct: 0,
      chapters_used: false, chapters_only: false, exercises: 0,
      notes: ["no exercises extracted"],
    };
  }

  // 1. evidence — verified counts fully, carousel OCR counts partially because
  //    there is no text to check it against, nothing counts as nothing.
  let evSum = 0, verified = 0, chapterEv = 0, carouselEv = 0;
  for (const ex of exercises) {
    const e = ex.evidence;
    if (!e || e.source === "none") continue;
    if (e.verified) { evSum += 1; verified++; }
    else if (e.source === "carousel") { evSum += 0.4; carouselEv++; }
    if (e.source === "chapters") chapterEv++;
  }
  const evidence = clamp01(evSum / exercises.length);
  const evidence_pct = Math.round(100 * verified / exercises.length);

  // 2. numbers — of the exercises that claim a dose, how many of those numbers are
  //    actually in the source. Exercises claiming nothing abstain rather than vote.
  const doses = exercises.map((ex) => doseScore(ex, ctx.src)).filter((d): d is number => d !== null);
  const numbers = doses.length ? doses.reduce((a, b) => a + b, 0) / doses.length : NEUTRAL;
  if (!doses.length) notes.push("no sets/reps/durations claimed");

  // 3. agreement — independent readers on the exercise count
  const agreement = agreementScore(exercises.length, [
    ctx.heuristicCount ?? 0,
    ctx.chapterCount ?? 0,
  ]);

  // 4. catalog — a name nobody recognises is a name nobody can group by
  const matched = exercises.filter((ex) => !!ex.canonical_id).length;
  const catalog = matched / exercises.length;

  // 5. duration — does the prescription add up to the stated length
  const duration = durationScore(card, ctx.mediaSeconds ?? null);

  const parts: ConfidenceParts = { evidence, numbers, agreement, catalog, duration };
  let score = 0;
  for (const k of Object.keys(WEIGHTS) as (keyof ConfidenceParts)[]) {
    score += WEIGHTS[k] * clamp01(parts[k]);
  }

  // ---- caps ----
  //
  // The weighted sum is a summary, and two failure modes deserve to be more than
  // summarised.

  const chapters_used = chapterEv > 0;
  const chapters_only = chapterEv > 0 && chapterEv === exercises.length;
  if (chapters_only) {
    // A chapter list is a table of contents, not a prescription. "Intro / Warm up /
    // Outro" scores well on every component above — it is traceable, the names are
    // real words, the count agrees with itself — and it is not a workout. This cap
    // is the reason chapters can be used as evidence at all.
    score = Math.min(score * 0.75, 0.45);
    notes.push("every exercise traces only to chapter timestamps");
  }
  if (verified === 0) {
    // Two different situations, and conflating them would waste the distinction.
    // A card read off a carousel slide has real evidence that simply cannot be
    // checked; a card with nothing at all is the model writing from memory. The
    // second deserves the harder cap.
    if (carouselEv > 0) {
      score = Math.min(score, 0.55);
      notes.push("read off carousel slides — no text to check it against");
    } else {
      score = Math.min(score, 0.35);
      notes.push("nothing could be located in a source text");
    }
  }

  return {
    score: Math.round(clamp01(score) * 1000) / 1000,
    parts: {
      evidence: Math.round(evidence * 100) / 100,
      numbers: Math.round(numbers * 100) / 100,
      agreement: Math.round(agreement * 100) / 100,
      catalog: Math.round(catalog * 100) / 100,
      duration: Math.round(duration * 100) / 100,
    },
    evidence_pct,
    chapters_used,
    chapters_only,
    exercises: exercises.length,
    notes,
  };
}

// ---------- merging two scores ----------

/**
 * What a merge decides about the score. `parts` is the components as they should
 * be stamped on the merged card: `scoreCard`'s five weighted numbers, plus the
 * flags recording what the pipeline did to this card — `merge_kept_old_score`,
 * `dropped_chapter_junk` — which is why the values are not all numbers. Phase 2
 * has to be able to tell a low score from a score that was never recomputed.
 */
export type MergedConfidence = {
  /** null only when the stored card predates scoring and its score was kept. */
  score: number | null;
  parts: Record<string, number | boolean>;
};

/**
 * Which score survives a reprocess merge.
 *
 * Reprocess re-runs the ladder and then refuses to make the card worse: when the
 * re-run comes back thinner, blocks are pulled forward from the stored row. The
 * merged card is re-scored afterwards, which is right — the score has to describe
 * what actually survived — but it silently punished exactly the case it was
 * protecting. Blocks stored before CARD_V 6 carry no evidence at all, so the
 * evidence component of the merged card scores zero and the `verified === 0` cap
 * lands on it, and the user's score drops on a reprocess where nothing got worse.
 * The number is advisory today; it is the Phase 2 measurement tomorrow, and a
 * measurement that moves when the thing it measures did not is worse than none.
 *
 * So:
 *
 *   - Nothing came back from the old row: the re-run stands on its own, unchanged.
 *   - Blocks came back and they carry no evidence: the re-score is measuring the
 *     absence of a field that did not exist when those blocks were written, not
 *     the quality of the card. Keep the stored score and its components verbatim —
 *     fabricating evidence to make the number come out right would corrupt the one
 *     record this whole module exists to keep honest. A stored score of null (a
 *     row from before scoring existed) stays null rather than becoming a computed
 *     number about a card that was never measured.
 *   - Blocks came back and they DO carry evidence (v6+): the re-score is
 *     meaningful, so it is used — but "never downgrade" applies to the score for
 *     the same reason it applies to the blocks, so the better of the two wins.
 *
 * `merge_kept_old_score` records which one it was, so a card whose number did not
 * come from its current contents can be found later rather than trusted.
 */
export function mergeConfidence(
  oldConf: number | null | undefined,
  oldParts: Record<string, number | boolean> | null | undefined,
  rescored: { score: number; parts: Record<string, number | boolean> },
  tookOldBlocks: boolean,
  oldHadEvidence: boolean,
): MergedConfidence {
  if (!tookOldBlocks) return { score: rescored.score, parts: { ...rescored.parts } };

  const stored = typeof oldConf === "number" && Number.isFinite(oldConf) ? oldConf : null;

  if (!oldHadEvidence) {
    const parts: Record<string, number | boolean> = { ...(oldParts ?? {}), merge_kept_old_score: true };
    // One exception to keeping the old components verbatim: how many chapter
    // headings this pass deleted is a record of what happened to the card, not a
    // component of a score, and losing it would hide the deletion.
    const dropped = rescored.parts?.dropped_chapter_junk;
    if (typeof dropped === "number" && dropped > 0) parts.dropped_chapter_junk = dropped;
    return { score: stored, parts };
  }

  const keepOld = stored !== null && stored > rescored.score;
  return {
    score: keepOld ? stored : rescored.score,
    parts: { ...rescored.parts, merge_kept_old_score: keepOld },
  };
}

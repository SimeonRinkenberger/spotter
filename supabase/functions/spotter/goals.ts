// Goals and programs (B.2): the pure half of Pumpy's goal coaching.
//
// "Get my bench to 305" or "lose 10 lb" arrives as a compact proposal the model
// wrote; this file turns it into the dated program the app shows and the confirm
// writes, and it is where the honesty lives: the verdict on a lift goal, the pace
// cap on fat loss, the adult check, the lines Spotter says instead of a plan.
// Nothing here reads a database, a clock or the network — index.ts resolves the
// workouts and the history and passes them in — so tools/goals-harness.mjs can
// import this file under plain Node and hold every rule to a table. Keep it that
// way: erasable TypeScript only (no enums, namespaces or parameter properties),
// and relative imports with their .ts extension if any are ever added.

export const GOAL_TYPES = ["lift", "fat", "muscle", "consistency"] as const;
export type GoalType = typeof GOAL_TYPES[number];
export type Unit = "lb" | "kg";

/** Twelve weeks is the longest block anybody should commit to without reassessing. */
export const PROGRAM_MAX_WEEKS = 12;
export const PROGRAM_MAX_DAYS = 6;
export const PROGRAM_MAX_TEMPLATES = 6;
/** Basic's one free program: this many of the person's own turns in its thread. */
export const GOAL_FREE_TURNS = 8;
/** A confirmed program can be taken back for this long; after it, End goal is the way out. */
export const PROGRAM_UNDO_MINUTES = 15;

const LB_PER_KG = 2.2046226;
const DAY = 86400000;

export function plateOf(unit: Unit): number { return unit === "kg" ? 2.5 : 5; }
export function toPlate(x: number, unit: Unit): number { const p = plateOf(unit); return Math.round(x / p) * p; }
function floorPlate(x: number, unit: Unit): number { const p = plateOf(unit); return Math.floor(x / p + 1e-9) * p; }
export function unitTo(w: number, from: Unit, to: Unit): number {
  if (!w || from === to) return w;
  return Math.round((to === "kg" ? w / LB_PER_KG : w * LB_PER_KG) * 10) / 10;
}

// ---------- dates: calendar strings, never clocks ----------
//
// A program's days are dates a person reads, so they are worked out as dates:
// "YYYY-MM-DD" parsed at UTC noon and moved in whole days. No local clock, so no
// daylight-saving hour can move a day, and a month's end is just the next day.

export function ymdOk(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T12:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function addDaysYmd(s: string, n: number): string {
  return new Date(Date.parse(s + "T12:00:00Z") + n * DAY).toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / DAY);
}
/** ISO weekday, Monday 1 … Sunday 7. */
export function isoDow(s: string): number {
  const d = new Date(s + "T12:00:00Z").getUTCDay();
  return d === 0 ? 7 : d;
}
/** The date of weekday `dow` inside the seven days that start at `from`. */
export function dayInWindow(from: string, dow: number): string {
  return addDaysYmd(from, (dow - isoDow(from) + 7) % 7);
}

// ---------- the estimated max, the server's copy of the app's liftMax ----------
//
// Epley over sets of ten reps or fewer from the eight weeks before a moment, the
// heavy low-rep sets preferred when there are any. The goal chip's "your best
// ~287" (app.ts liftMax) and Pumpy's baseline come from the same rule; the
// harness runs both on the same logs and requires the same number.

type LogSet = { reps?: number; weight?: number; unit?: string; seconds?: number } | null;
type LogEntry = { canonical_id?: string | null; name?: string; sets?: LogSet[] } | null;
export type LogRow = { started_at: string; completed_at?: string | null; workout_title?: string | null; entries?: LogEntry[] };

export function e1rm(weight: number, reps: number): number { return weight * (1 + reps / 30); }

const WINDOW_8W = 56 * DAY;

export function liftMaxAt(logs: LogRow[], exercise: string, before: number, unit: Unit):
  { est: number; weight: number; reps: number; at: string } | null {
  const from = before - WINDOW_8W;
  type Hit = { est: number; weight: number; reps: number; at: string };
  let best: Hit | null = null, low: Hit | null = null;
  for (const l of logs ?? []) {
    const t = Date.parse(l?.started_at ?? "");
    if (!(t >= from && t < before)) continue;
    for (const e of l.entries ?? []) {
      if (!e || e.canonical_id !== exercise) continue;
      for (const s of e.sets ?? []) {
        if (!s || !(Number(s.weight) > 0) || !(Number(s.reps) >= 1 && Number(s.reps) <= 10)) continue;
        const w = unitTo(Number(s.weight), (s.unit === "kg" ? "kg" : s.unit === "lb" ? "lb" : unit), unit);
        const hit = { est: e1rm(w, Number(s.reps)), weight: w, reps: Number(s.reps), at: l.started_at };
        if (!best || hit.est > best.est) best = hit;
        if (hit.reps <= 5 && (!low || hit.est > low.est)) low = hit;
      }
    }
  }
  return low ?? best;
}

/** Monday of the week a timestamp falls in, as a date string (UTC — history is coarse). */
function mondayOfTs(t: number): string {
  const d = new Date(t);
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (dow - 1), 12)).toISOString().slice(0, 10);
}

/**
 * What get_lift_history answers: the estimated max now, the best sets, and the
 * best estimate per week over twelve weeks, with the formula named so the coach
 * can say what the number is. `novice` is how the verdict below knows someone is
 * still in the fast early months — and it takes evidence: four or more sessions
 * with the lift and a best estimate that rose at least 5 % across three or more
 * weeks. Few or no logged sets mean new to Spotter, not new to lifting, and read
 * at intermediate rates (the review's bug 7: the spec's own 287 → 305 example read
 * "realistic" for anyone with no bench history).
 */
export function liftHistory(logs: LogRow[], exercise: string, now: number, unit: Unit) {
  const from = now - 84 * DAY;
  const weeks = new Map<string, { best: number; set: string }>();
  const sets: { weight: number; reps: number; date: string; est: number }[] = [];
  let sessions = 0;
  for (const l of logs ?? []) {
    const t = Date.parse(l?.started_at ?? "");
    if (!(t >= from && t <= now)) continue;
    let had = false;
    for (const e of l.entries ?? []) {
      if (!e || e.canonical_id !== exercise) continue;
      for (const s of e.sets ?? []) {
        if (!s || !(Number(s.weight) > 0) || !(Number(s.reps) >= 1)) continue;
        had = true;
        if (Number(s.reps) > 10) continue;
        const w = unitTo(Number(s.weight), (s.unit === "kg" ? "kg" : s.unit === "lb" ? "lb" : unit), unit);
        const est = e1rm(w, Number(s.reps));
        sets.push({ weight: w, reps: Number(s.reps), date: l.started_at.slice(0, 10), est });
        const wk = mondayOfTs(t), cur = weeks.get(wk);
        if (!cur || est > cur.best) weeks.set(wk, { best: est, set: w + " × " + s.reps });
      }
    }
    if (had) sessions++;
  }
  const m = liftMaxAt(logs, exercise, now + 1, unit);
  sets.sort((a, b) => b.est - a.est);
  const byWeek = [...weeks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const first = byWeek[0]?.[1].best ?? 0, last = byWeek[byWeek.length - 1]?.[1].best ?? 0;
  const novice = sessions >= 4 && byWeek.length >= 3 && first > 0 && last >= first * 1.05;
  return {
    exercise, unit,
    formula: "Epley: weight × (1 + reps ÷ 30), from sets of 10 reps or fewer in the last 8 weeks, heavy sets of 5 or fewer preferred. An estimate, ±10%.",
    est_max: m ? Math.round(m.est) : null,
    est_from: m ? { weight: m.weight, reps: m.reps, date: m.at.slice(0, 10) } : null,
    sessions_12w: sessions,
    novice,
    best_sets: sets.slice(0, 3).map((s) => ({ weight: s.weight, reps: s.reps, date: s.date, est: Math.round(s.est) })),
    weekly: byWeek
      .map(([week_start, v]) => ({ week_start, est: Math.round(v.best), top_set: v.set })),
  };
}

// ---------- honesty: lift goals ----------
//
// Typical progress, per month, as the verdict reads it (the prompt tells the model
// the same numbers so the two agree): an intermediate adds about 2–5 lb a month to
// a press and about 3–8 lb to a squat or a pull from the floor; somebody in their
// first months moves about twice as fast; even competitive lifters gain only about
// 10–13 kg a year (Latella et al. 2022). The press range is the spec's; the lower-
// body range is ours, scaled from it. A goal inside the top of the range is
// realistic, up to half again past it a stretch, and beyond that too fast — which
// never refuses: it becomes a milestone block toward what the range reaches, with
// the goal itself stated honestly and reassessed at the test day (Runna's model).

const LOWER_LIFTS = new Set(["back-squat", "front-squat", "deadlift", "sumo-deadlift", "trap-bar-deadlift",
  "hip-thrust", "romanian-deadlift", "leg-press", "hack-squat", "rack-pull", "deficit-deadlift"]);

export function liftRates(exercise: string, unit: Unit, novice: boolean): { lo: number; hi: number } {
  const lb = LOWER_LIFTS.has(exercise) ? [3, 8] : [2, 5];
  const k = novice ? 2 : 1, f = unit === "kg" ? 1 / LB_PER_KG : 1;
  return { lo: lb[0] * k * f, hi: lb[1] * k * f };
}

const SEVERITY = { realistic: 0, stretch: 1, too_fast: 2 } as const;
export type Verdict = keyof typeof SEVERITY;

export function monthsText(lo: number, hi: number): string {
  if (hi > 24) {
    const a = Math.max(1, Math.round(lo / 12)), b = Math.max(a, Math.round(hi / 12));
    return a === b ? "about " + a + " year" + (a > 1 ? "s" : "") : "about " + a + "–" + b + " years";
  }
  return lo === hi ? "about " + lo + " month" + (lo > 1 ? "s" : "") : "about " + lo + "–" + hi + " months";
}

export function liftVerdict(baseline: number, target: number, weeks: number, exercise: string, unit: Unit, novice: boolean) {
  const months = weeks * 7 / 30.44, r = liftRates(exercise, unit, novice), need = target - baseline;
  if (need <= 0) return { verdict: "realistic" as Verdict, target, dream: null as number | null, lo: 0, hi: 0 };
  const rate = need / months;
  const verdict: Verdict = rate <= r.hi + 1e-9 ? "realistic" : rate <= 1.5 * r.hi + 1e-9 ? "stretch" : "too_fast";
  let block = target, dream: number | null = null;
  if (verdict === "too_fast") {
    // The milestone: what the top of the typical range reaches in this block, never
    // rounded past it, and at least one plate above where they are.
    block = Math.max(floorPlate(baseline + r.hi * months, unit), floorPlate(baseline, unit) + plateOf(unit));
    dream = target;
  }
  return { verdict, target: block, dream, lo: Math.max(1, Math.ceil(need / r.hi - 1e-9)), hi: Math.max(1, Math.ceil(need / r.lo - 1e-9)) };
}

// ---------- honesty: fat loss ----------
//
// Planned loss is capped at 1 % of body weight and at 2 lb (0.9 kg) a week: the CDC
// says people who lose about 1–2 lb a week are more likely to keep it off, and the
// NHS says 0.5–1 kg. Past the cap the plan is lengthened in spirit and shortened in
// promise: the block aims for what the cap reaches, and the goal is stated. The
// FTC calls any claim of more than 3 lb a week for over four weeks false; nothing
// here comes near it. Spotter never sets a calorie target, never advises on food,
// supplements or medication, and never shames — the plan is training (which keeps
// muscle), a daily steps or cardio target, and a weekly weigh-in.

export const FAT_SOURCES = [
  { title: "CDC: Steps for losing weight", url: "https://www.cdc.gov/healthy-weight-growth/losing-weight/index.html" },
  { title: "NHS: Overweight and obesity", url: "https://www.nhs.uk/conditions/overweight-and-obesity/" },
];
export const FAT_MEDICAL_NOTE = "Not medical advice. If you have a health condition or take medication, check with your doctor before you start.";
export const FAT_HONEST = "Training builds strength and keeps muscle while you lose; the scale mostly follows food.";

export function fatCap(bodyWeight: number, unit: Unit): number {
  return Math.min(bodyWeight * 0.01, unit === "kg" ? 0.9 : 2);
}

export function fatVerdict(baseline: number, target: number, weeks: number, unit: Unit) {
  const cap = fatCap(baseline, unit), need = baseline - target;
  if (need <= cap * weeks + 1e-9) return { verdict: "realistic" as Verdict, target, dream: null as number | null, cap };
  // Round the block's end weight UP to a half: never promise a pound the cap did not allow.
  const block = Math.ceil((baseline - cap * weeks) * 2 - 1e-9) / 2;
  return { verdict: "too_fast" as Verdict, target: block, dream: target, cap };
}

// ---------- what Spotter says instead of a plan ----------
//
// Checked against the organisations' own guidance (briefs/simplify-b2/RESEARCH-DESIGN.md
// §5): start with feelings, no numbers about food or bodies, no diagnosis, point to
// specialist help, and a 24-hour option because the helplines keep office hours.
// NEDA no longer runs a helpline; ANAD does, and 988 answers any time.

export const SAFETY_LINES = {
  ed_us: "Thank you for telling me — that sounds really hard, and you don't have to figure it out alone. I'm not the right kind of help for this, but ANAD's free helpline (888-375-7767) is, and if you ever feel unsafe you can call or text 988 any time.",
  ed_uk: "Thank you for telling me — that sounds really hard, and you don't have to figure it out alone. I'm not the right kind of help for this, but Beat's helpline (0808 801 0677, weekdays 3–8 pm) is, and if you're in danger call 999 or Samaritans on 116 123.",
  ed_other: "Thank you for telling me — that sounds really hard, and you don't have to figure it out alone. I'm not the right kind of help for this, but a local eating-disorder charity or your doctor is, and if you ever feel unsafe, call your local emergency number.",
  minor_fat: "Because you're under 18, I won't set a weight-loss goal, but I'd love to help you get stronger and fitter, and a parent or your doctor is the right person to talk to about weight.",
  med: "I can't advise on medications or supplements — a doctor or pharmacist can tell you what's safe for you, especially alongside anything else you take. I can help with the training side whenever you're ready.",
};

export function edLine(tz: string | null | undefined): string {
  const z = String(tz ?? "");
  if (/^Europe\/(London|Belfast)$/.test(z)) return SAFETY_LINES.ed_uk;
  if (/^America\//.test(z) || /^US\//.test(z) || /^Pacific\/Honolulu$/.test(z)) return SAFETY_LINES.ed_us;
  return SAFETY_LINES.ed_other;
}

// Signs of disordered eating: a very-low-calorie day in the person's own words, or
// the behaviours the helplines list. Deliberately about what they say they are
// DOING, so "burn 500 calories" or "not eating enough protein" stay ordinary.
// A number is read whole, however it is grouped ("1,500", "1.500", "1 500"), and
// never from its middle: reading "500" out of "1,500" sent an ordinary intake to
// the helpline line and missed "1,000" (the review's bug 2). Every mention counts,
// so "2,000 on weekdays but 800 a day at weekends" is still heard. A snack or a
// meal is not a day.
const CAL_NUM = String.raw`(?<![\d,.])(\d{1,2}[,.\s]\d{3}|\d{3,4})(?![\d,])\s*(?:k?cals?|calories?)\b`;
const NOT_A_DAY = String.raw`(?!\s*(?:snacks?|bars?|packs?|servings?|portions?|meals?|breakfast|lunch|dinner|shakes?|drinks?)\b)`;
const ED_CAL = new RegExp(String.raw`\b(?:eat|eating|eats|ate|have|having|consume|consuming|intake|diet(?:ing)?|limit(?:ing)?|cap(?:ping)?|keep(?:ing)?|stay(?:ing)?|stick(?:ing)?|only|under|below|less than)\b[^.!?\n]{0,30}?` + CAL_NUM + NOT_A_DAY, "gi");
const ED_CAL_DAY = new RegExp(CAL_NUM + String.raw`\s*(?:a|per|each)\s*day\b`, "gi");
function lowDay(m: string): boolean {
  for (const re of [ED_CAL, ED_CAL_DAY]) {
    for (const hit of m.matchAll(re)) {
      const n = Number(hit[1].replace(/[,.\s]/g, ""));
      if (n > 0 && n < 1200) return true;
    }
  }
  return false;
}
const ED_ACT = /\b(?:starv(?:e|ed|ing|ation)|purg(?:e|ed|ing)|make myself (?:sick|throw up|vomit)|throw(?:ing)? up (?:after|my food|my meals|what i eat)|laxatives?|diuretics? to lose|stop(?:ped)? eating|not eating (?:at all|anything|for \d+)|eat(?:ing)? nothing|barely eat(?:ing)?|skip(?:ping)? (?:all )?(?:my )?meals|pro-?ana|thinspo|binge and purge|(?:water )?fast(?:ing)? for \d+ days)\b/i;
// "I'm 15" is an age; "I'm 5 foot 4", "I'm 14 stone" and "I'm 16 st" are not (the
// review's bug 3) — nor any number with a unit, a clock, a count or a fraction after it.
const NOT_AN_AGE = String.raw`(?!\s*(?:lbs?|pounds?|kgs?|kilos?|kilograms?|stone|st\b|%|percent|mins?\b|minutes|hours?|hrs?\b|reps?|sets?|weeks?|days?|months?|x\b|×|'|"|ft\b|feet|foot|inch(?:es)?|in\b|cm\b|km\b|miles?|k\b|and a half|[\/.,:]\d))`;
const AGE_SAID = String.raw`\b(1[0-7]|[5-9])\s*(?:years?\s*old|yrs?\s*old|yo|y\/o)\b|\b(?:i'?m|i am)\s+(?:a\s+)?(?:teen(?:ager)?|minor|in (?:middle|high) school)\b`;
const MINOR = new RegExp(String.raw`\b(?:i'?m|i am|im)\s+(1[0-7]|[5-9])\b` + NOT_AN_AGE + "|" + AGE_SAID, "i");
// What a conversation remembers is narrower: an age said outright, or a bare "I'm
// 13"–"I'm 17". A bare single digit is a height or a count far more often than an age.
const MINOR_KEPT = new RegExp(String.raw`\b(?:i'?m|i am|im)\s+(1[0-7])\b` + NOT_AN_AGE + "|" + AGE_SAID, "i");
const LOSS = /\b(?:lose|losing|lost|drop|dropping|cut|cutting|shed|shedding|burn off)\b[^.!?\n]{0,25}\b(?:weight|fat|lbs?|pounds?|kgs?|kilos?|stone|belly)\b|\bweight[- ]?loss\b|\b(?:get|be|become) (?:thin|skinny|slimmer)\b|\bslim down\b/i;
// "Pre-workout" is a supplement only on its own: a pre-workout warm-up, mobility
// routine or meal is training (the review's bug 5).
const MEDS = /\b(?:glp-?1s?|semaglutide|ozempic|wegovy|rybelsus|mounjaro|zepbound|tirzepatide|saxenda|liraglutide|phentermine|qsymia|contrave|orlistat|metformin|fat[- ]?burners?|diet pills?|appetite suppressants?|steroids?|sarms?|clenbuterol|testosterone|trt|hgh|peptides?|bpc-?157|ephedrine|dnp|supplements?|creatine|pre-?workouts?(?![\s-]*(?:warm|mobility|routine|stretch|activation|dynamic|drills?|meals?|snacks?|food|nutrition|prep|circuit|sets?|walk|jog|cardio|primer|flow))|protein powder|bcaas?|ashwagandha|l-carnitine|garcinia|keto pills?)\b/i;
const ASKING = /\?|\b(?:should i|can i|could i|is it (?:safe|ok|okay|worth)|would you|do you recommend|recommend|how much|what dose|dosage|dose of|worth taking|take|taking|start|try|use|using)\b/i;

export type SafetyHit = { kind: "ed" | "minor_fat" | "med"; reply: string };

/**
 * Before any model call: a message that shows signs of disordered eating, a
 * person under 18 asking to lose weight, or a question about medication or
 * supplements gets its line and no plan — deterministic, free, and the same every
 * time. `minorKnown` carries an earlier "I'm 15" in the same conversation.
 */
export function safetyCheck(message: string, ctx: { tz?: string | null; minorKnown?: boolean }): SafetyHit | null {
  const m = String(message ?? "");
  if (lowDay(m) || ED_ACT.test(m)) return { kind: "ed", reply: edLine(ctx.tz) };
  if ((MINOR.test(m) || ctx.minorKnown) && LOSS.test(m)) return { kind: "minor_fat", reply: SAFETY_LINES.minor_fat };
  if (MEDS.test(m) && ASKING.test(m)) return { kind: "med", reply: SAFETY_LINES.med };
  return null;
}

export function mentionsMinor(message: string): boolean { return MINOR_KEPT.test(String(message ?? "")); }

// What the coach wrote, with any sentence dropped that prescribes a calorie number or
// recommends taking a medication or supplement — the prompt forbids both, and this is
// the belt to its braces. A refusal that merely names one ("I can't advise on
// creatine") is kept.
// A calorie figure however it is written: 1500, 1,500, 1 500.
const KCAL = String.raw`(?:\d{1,2}[, ]\d{3}|\d{3,4})\s*(?:k?cals?|calories)`;
// Only an intake target: "your walk burns about 300 calories a day" is fine (the
// review's bug 5), "aim for 1,800 calories a day" and "a daily budget of 1,500" are not.
const CAL_RX = new RegExp(String.raw`\b(?:eat|eating|consume|intake|diet|budget|allowance|aim for|target|stay (?:under|below|around|at)|keep (?:it )?(?:under|below|around|at)|stick to|limit (?:yourself )?to|cut (?:down )?to|deficit of)\b[^!?]{0,40}?\b` + KCAL + String.raw`\b`, "i");
// "N calories a day" is an intake target unless the sentence is about burning them:
// "with 1,200 calories a day" goes, "your walk burns about 300 calories a day" stays.
const CAL_DAY = new RegExp(String.raw`\b` + KCAL + String.raw`\s*(?:a|per|each)\s*day\b`, "i");
const BURN = /\b(?:burn(?:s|ed|ing)?|expend(?:s|ed|ing)?|torch(?:es|ed|ing)?|use[sd]? up)\b/i;
const MED_RX = /\b(?:take|try|start|use|add|consider|dose|stack)\b/i;
const REFUSES = /\b(?:can'?t|cannot|won'?t|not able|don'?t|do not)\b/i;

/** One sentence the coach must not say: a calorie number to eat, or a medication or supplement to take. */
export function blockedSentence(s: string): boolean {
  return CAL_RX.test(s) || (CAL_DAY.test(s) && !BURN.test(s)) || (MEDS.test(s) && MED_RX.test(s) && !REFUSES.test(s));
}

export function cleanCoachText(say: string): { text: string; dropped: number } {
  const parts = String(say ?? "").match(/[^.!?]+[.!?]*\s*/g) ?? [String(say ?? "")];
  let dropped = 0;
  const kept = parts.filter((s) => {
    if (blockedSentence(s)) { dropped++; return false; }
    return true;
  });
  return { text: kept.join("").replace(/\s+/g, " ").trim(), dropped };
}

// ---------- the ask card ----------

export type AskField = { id: string; label: string; type: "choice" | "number" | "date"; options?: string[]; value?: string | number; unit?: string };
export type Ask = { kind: "ask"; fields: AskField[]; submit: string };

function str(v: unknown, max: number): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

const ADULT_Q = /\b18\b|\badult\b|\bolder\b/i;

/** The model's ask, bounded: ≤ 6 fields of three types, pre-fills that fit, and the adult question never pre-answered. */
export function validateAsk(raw: any): Ask | null {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.fields)) return null;
  const seen = new Set<string>();
  const fields: AskField[] = [];
  // Six good fields at most, taken from the first twelve the model wrote: one bad
  // field early on must not cost the good ones after it.
  for (const f of raw.fields.slice(0, 12)) {
    if (fields.length === 6) break;
    let id = str(f?.id, 24).toLowerCase().replace(/[^a-z0-9_]/g, "");
    const type = f?.type === "choice" || f?.type === "number" || f?.type === "date" ? f.type : null;
    const label = str(f?.label, 48);
    // The three answers the server reads by id (adultAnswer, validateProgram's max and
    // weight) are found whatever the model called them — an "over18" that went unread
    // refused a fat-loss plan the person had said yes to (the review's bug 12).
    const says = id + " " + label;
    const as = ADULT_Q.test(label) || id === "adult" ? "adult"
      : type === "number" && /\b(?:max|1rm|one[- ]rep)\b|_max\b|max_/i.test(says) ? "max"
      : type === "number" && /\b(?:body ?weight|weigh|current weight|your weight)\b|body_?weight|^weight/i.test(says) ? "weight" : null;
    if (as && !seen.has(as)) id = as;
    if (!id || !type || !label || seen.has(id)) continue;
    const out: AskField = { id, label, type };
    if (type === "choice") {
      const options = [...new Set((Array.isArray(f.options) ? f.options : []).map((o: unknown) => str(o, 24)).filter(Boolean))].slice(0, 6) as string[];
      if (options.length < 2) continue;
      out.options = options;
      if (options.includes(str(f.value, 24))) out.value = str(f.value, 24);
    } else if (type === "number") {
      const v = Number(f.value);
      if (Number.isFinite(v) && v > 0 && v < 100000) out.value = Math.round(v * 10) / 10;
    } else if (ymdOk(f.value)) {
      out.value = f.value;
    }
    const unit = str(f?.unit, 8);
    if (unit) out.unit = unit;
    // "Are you 18 or older?" is a question only the person answers.
    if (id === "adult") delete out.value;
    seen.add(id);
    fields.push(out);
  }
  if (!fields.length) return null;
  return { kind: "ask", fields, submit: str(raw.submit, 24) || "Build my plan" };
}

/** For a build that cannot draw the card: the same questions, as a sentence. */
export function askAsText(ask: Ask): string {
  return "To build it I need a few things: " + ask.fields.map((f) => f.label.replace(/[?:.]+$/, "").toLowerCase()).join(", ") + ".";
}

/** The answers a client sent back, kept only for the questions that were asked. */
export function cleanAnswers(raw: any, ask: Ask | null): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!raw || typeof raw !== "object" || !ask) return out;
  for (const f of ask.fields) {
    const v = raw[f.id];
    if (v === undefined || v === null || v === "") continue;
    if (f.type === "number") { const n = Number(v); if (Number.isFinite(n) && n > 0 && n < 100000) out[f.id] = Math.round(n * 10) / 10; }
    else if (f.type === "date") { if (ymdOk(v)) out[f.id] = v; }
    else { const s = str(v, 24); if (!f.options || f.options.includes(s)) out[f.id] = s; }
  }
  return out;
}

/** Yes, no, or not asked — read off every answered ask in the conversation. */
export function adultAnswer(answers: Record<string, unknown>[]): boolean | null {
  let said: boolean | null = null;
  for (const a of answers) {
    const v = a?.adult;
    if (typeof v === "string") {
      if (/^y(es)?$/i.test(v.trim())) said = true;
      else if (/^no?$/i.test(v.trim())) said = false;
    }
  }
  return said;
}

// ---------- the capability flag ----------

export function capsOf(body: any): Set<string> {
  const c = Array.isArray(body?.caps) ? body.caps : [];
  return new Set(c.filter((x: unknown) => x === "ask" || x === "program") as string[]);
}

// ---------- Basic's one free program ----------

export type FreeState = "available" | "open" | "used";

/** Whether the free thread made a program that still stands (ended counts; undone does not). */
export function freeProgramBuilt(goalsFromThread: { status: string }[]): boolean {
  return goalsFromThread.some((g) => g.status !== "undone");
}

/** The free thread's state: unclaimed, in progress, or spent (a live program from it, or its turns used). */
export function freeProgramState(freeThread: string | null, goalsFromThread: { status: string }[], userTurns: number): FreeState {
  if (!freeThread) return "available";
  if (goalsFromThread.some((g) => g.status !== "undone")) return "used";
  if (userTurns >= GOAL_FREE_TURNS) return "used";
  return "open";
}

// ---------- the program: compact in, dated out ----------

export type TemplateRef = {
  ref: string; workout_id: string; new: boolean; title: string; exercises: number; canon: string[];
  category?: string | null; duration_minutes?: number | null;
  /** A new workout's normalized create_workout fields, written by the confirm. */
  create?: Record<string, unknown>;
};

export type ExpandCtx = {
  today: string;                              // the person's local date
  unit: Unit;                                 // their weight unit (the plate step)
  templates: Map<string, TemplateRef>;        // refs resolved by index.ts
  exerciseName: (id: string) => string | null;
  history?: { novice: boolean; est: number | null } | null;
  answerMax?: number | null;                  // a max the person typed on the ask card
  bodyWeight?: number | null;                 // in `unit`
  adult: boolean | null;                      // their answer to "Are you 18 or older?"
  minor: boolean;                             // said they are under 18 in this conversation
  safetyStop: boolean;                        // this conversation hit the disordered-eating line
  free: boolean;
  replaces: { id: string; title: string } | null;
};

export type Program = {
  kind: "program"; v: 1;
  goal: {
    type: GoalType; title: string; exercise: string | null; exercise_name: string | null;
    target: number | null; dream: number | null; unit: Unit | null; baseline: number | null;
    start: string; end: string; weeks: number; days_per_week: number;
    daily: { steps: number } | { cardio_minutes: number } | null; weigh_in_dow: number | null;
  };
  verdict: Verdict; verdict_note: string; medical_note: string | null; sources: { title: string; url: string }[];
  templates: Omit<TemplateRef, "canon">[];
  weeks: { week: number; label: string; days: { day: string; dow: number; ref: string; title: string; rx: Rx | null }[] }[];
  start: string; end: string; plate: number; unit: Unit; replaces: { id: string; title: string } | null; free: boolean;
  counts: { weeks: number; sessions: number; new_templates: number }; summary: string;
};
export type Rx = { exercise: string | null; sets: number | null; reps: string | null; pct: number | null; weight: number | null; unit: Unit; rpe: number | null; note: string | null };

function num(v: unknown): number | null { const n = Number(v); return v !== null && v !== "" && Number.isFinite(n) ? n : null; }
function clampInt(v: unknown, lo: number, hi: number): number | null {
  const n = num(v);
  return n === null ? null : Math.max(lo, Math.min(hi, Math.round(n)));
}
function title(s: unknown, max: number): string { return str(s, max).replace(/^["']|["']$/g, ""); }

/**
 * The model's compact program → the dated program the card shows and the confirm
 * writes, or the reason it cannot be one. The reason goes back to the model
 * ("[proposal rejected: …]") and it gets one more try, the way every other
 * proposal kind already works.
 */
export function expandProgram(raw: any, ctx: ExpandCtx): { program: Program } | { error: string } {
  const g = raw?.goal ?? {};
  const type = GOAL_TYPES.includes(g.type) ? g.type as GoalType : null;
  if (!type) return { error: "goal.type must be one of lift, fat, muscle, consistency" };
  const unit: Unit = g.unit === "kg" || g.unit === "lb" ? g.unit : ctx.unit;
  if (!ymdOk(raw?.start)) return { error: "start must be a date, YYYY-MM-DD" };
  const start: string = raw.start;
  if (start < ctx.today) return { error: "start must be today (" + ctx.today + ") or later" };
  if (daysBetween(ctx.today, start) > 28) return { error: "start within four weeks of today" };
  const rawWeeks = Array.isArray(raw?.weeks) ? raw.weeks : [];
  if (!rawWeeks.length) return { error: "a program needs weeks" };
  if (rawWeeks.length > PROGRAM_MAX_WEEKS) return { error: "a program is at most " + PROGRAM_MAX_WEEKS + " weeks" };
  if (ctx.templates.size > PROGRAM_MAX_TEMPLATES) return { error: "use at most " + PROGRAM_MAX_TEMPLATES + " workouts" };

  // Safety first: no fat-loss program for someone under 18, in a conversation that
  // hit the disordered-eating line, or before the person has said they are an adult.
  if (type === "fat") {
    if (ctx.minor || ctx.adult === false) return { error: "no weight-loss program for someone under 18 — offer a strength or fitness goal instead" };
    if (ctx.safetyStop) return { error: "no weight-loss program in this conversation" };
    if (ctx.adult !== true) return { error: "ask 'Are you 18 or older?' (ask field id adult, options Yes/No) before a weight-loss program" };
  }

  const weeksN = rawWeeks.length;
  const end = addDaysYmd(start, 7 * weeksN - 1);
  let exercise: string | null = null, baseline: number | null = null, target: number | null = null;
  // The program's own words pass the filter the chat does: a calorie target or a
  // supplement in a note, a summary or a day's cue reached the card, the goal sheet
  // and Workout Mode (the review's bug 4).
  let dream: number | null = null, verdict: Verdict = "realistic", note = cleanCoachText(str(raw?.verdict_note, 280)).text;
  let daily: Program["goal"]["daily"] = null, weighIn: number | null = null;
  const modelVerdict: Verdict = raw?.verdict === "stretch" || raw?.verdict === "too_fast" ? raw.verdict : "realistic";

  if (type === "lift") {
    exercise = str(g.exercise, 60) || null;
    if (!exercise || !ctx.exerciseName(exercise)) return { error: "goal.exercise must be a catalog id, like bench-press" };
    const known = ctx.answerMax ?? ctx.history?.est ?? null;
    baseline = num(g.baseline);
    // The model's starting point is taken only when it agrees with what the person
    // typed or what their logs say; otherwise theirs wins.
    if (known && (!baseline || Math.abs(baseline - known) > known * 0.1)) baseline = known;
    if (!baseline || baseline <= 0) return { error: "goal.baseline (the current estimated max) is needed for a lift goal — ask for it" };
    baseline = Math.round(baseline);
    target = num(g.target);
    if (!target || target <= 0) return { error: "goal.target is needed for a lift goal" };
    target = toPlate(target, unit);
    const v = liftVerdict(baseline, target, weeksN, exercise, unit, !!ctx.history?.novice);
    verdict = SEVERITY[modelVerdict] > SEVERITY[v.verdict] ? modelVerdict : v.verdict;
    if (v.verdict === "too_fast") {
      target = v.target; dream = v.dream;
      note = dream + " usually takes " + monthsText(v.lo, v.hi) + " from an estimated " + baseline + ". This block aims for " +
        target + " by " + shortDate(end) + ", then we test and reassess.";
    } else if (verdict === "stretch" && !note) {
      note = target + " in " + weeksN + " weeks is a stretch — typical is up to about " + Math.round(liftRates(exercise, unit, !!ctx.history?.novice).hi) +
        " " + unit + " a month at your level.";
    }
  } else if (type === "fat") {
    // The weight the person gave (the ask card, or Settings) wins over the model's by
    // more than 5 %, as the lift's baseline does: a 260 → 240 line plotted against
    // 150-lb weigh-ins read "ahead" forever, at the wrong cap (the review's bug 8).
    baseline = num(g.baseline);
    const known = ctx.bodyWeight ?? null;
    if (known && (!baseline || Math.abs(baseline - known) > known * 0.05)) baseline = known;
    if (!baseline || baseline < (unit === "kg" ? 35 : 80) || baseline > (unit === "kg" ? 320 : 700)) {
      return { error: "goal.baseline (current body weight) is needed for a weight-loss goal — ask for it" };
    }
    target = num(g.target);
    if (!target || target >= baseline) return { error: "goal.target (the goal weight) must be below the current weight" };
    const v = fatVerdict(baseline, target, weeksN, unit);
    verdict = v.verdict === "too_fast" ? "too_fast" : modelVerdict === "too_fast" ? "realistic" : modelVerdict;
    target = Math.round(v.target * 2) / 2;
    if (v.verdict === "too_fast") {
      dream = v.dream;
      note = "Losing " + round1(baseline - (dream ?? target)) + " " + unit + " in " + weeksN + " weeks is faster than health guidance of about " +
        (unit === "kg" ? "0.5–1 kg" : "1–2 lb") + " a week. This plan aims for " + target + " " + unit + " by " + shortDate(end) +
        " — a pace people tend to keep.";
    }
    note = (note ? note.replace(/\s*$/, " ") : "") + FAT_HONEST;
    const steps = clampInt(g.daily?.steps, 3000, 15000), cardio = clampInt(g.daily?.cardio_minutes, 10, 60);
    daily = steps ? { steps: Math.round(steps / 500) * 500 } : cardio ? { cardio_minutes: cardio } : { steps: 7000 };
    weighIn = clampInt(g.weigh_in_dow, 1, 7) ?? 1;
  } else if (type === "consistency") {
    target = clampInt(g.target, 1, PROGRAM_MAX_DAYS);
  }

  // The weeks: every day dated from the start, every prescription checked against
  // the workout it rides on, every load worked out from the baseline and put on a plate.
  const weeks: Program["weeks"] = [];
  let sessions = 0, maxDays = 0;
  for (let i = 0; i < weeksN; i++) {
    const w = rawWeeks[i] ?? {};
    const from = addDaysYmd(start, 7 * i);
    const label = title(w.label, 20) || "Week " + (i + 1);
    const days: Program["weeks"][number]["days"] = [];
    const dows = new Set<number>();
    for (const d of (Array.isArray(w.days) ? w.days : []).slice(0, 7)) {
      const dow = clampInt(d?.dow, 1, 7);
      if (!dow || dows.has(dow)) continue;
      const t = ctx.templates.get(str(d?.ref, 12));
      if (!t) return { error: "week " + (i + 1) + " names a workout ref that is not in templates" };
      dows.add(dow);
      let rx: Rx | null = null;
      const r = d?.rx;
      if (r && typeof r === "object" && (r.exercise || r.sets || r.reps || r.pct || r.note)) {
        const ex = str(r.exercise, 60) || (type === "lift" && t.canon.includes(exercise!) ? exercise : null);
        if (ex && !t.canon.includes(ex)) {
          return { error: "week " + (i + 1) + ": " + ex + " is not in the workout " + t.title + " — pick a workout that has it or add it to a new template" };
        }
        const pct = num(r.pct);
        const okPct = pct !== null && pct >= 0.3 && pct <= 1.05 ? Math.round(pct * 1000) / 1000 : null;
        let weight: number | null = null;
        if (okPct && type === "lift" && ex === exercise && baseline) {
          weight = toPlate(okPct * baseline, unit);
          // Never a prescribed load past the block's own target.
          if (target && weight > target) weight = floorPlate(target, unit);
        }
        rx = {
          exercise: ex, sets: clampInt(r.sets, 1, 10), reps: str(r.reps, 12) || null, pct: okPct, weight, unit,
          rpe: clampInt(r.rpe, 5, 10), note: cleanCoachText(str(r.note, 60)).text || null,
        };
      }
      days.push({ day: dayInWindow(from, dow), dow, ref: t.ref, title: t.title, rx });
    }
    if (days.length > PROGRAM_MAX_DAYS) return { error: "at most " + PROGRAM_MAX_DAYS + " training days a week" };
    days.sort((a, b) => (a.day < b.day ? -1 : 1));
    sessions += days.length;
    maxDays = Math.max(maxDays, days.length);
    weeks.push({ week: i + 1, label, days });
  }
  if (!sessions) return { error: "a program needs training days" };

  const used = new Set<string>();
  for (const w of weeks) for (const d of w.days) used.add(d.ref);
  const templates = [...ctx.templates.values()].filter((t) => used.has(t.ref))
    .map(({ canon: _c, ...t }) => t);
  // A dream a fat-loss plan will never draw a line to (more than a fifth of the body)
  // is not printed as "the goal"; the note still says what was asked.
  const shownDream = type === "fat" && dream !== null && baseline && dream < baseline * 0.8 ? null : dream;
  // The title states the goal, never a pace or a deadline: "Lose 20 lb in 2 weeks" kept
  // its ten pounds a week on the card after the plan was held to two (the review's bug
  // 4). A fat-loss title is the amount itself; any other is the model's, cleaned.
  const said = cleanTitle(title(g.title, 40));
  const titleOf = type === "fat" && baseline && target ? "Lose " + round1(baseline - (shownDream ?? target)) + " " + unit
    : said && !blockedSentence(said) ? said
    : type === "lift" && exercise ? (ctx.exerciseName(exercise) ?? "Lift") + " " + (dream ?? target) : "My plan";
  return {
    program: {
      kind: "program", v: 1,
      goal: {
        type, title: titleOf, exercise, exercise_name: exercise ? ctx.exerciseName(exercise) : null,
        target, dream: shownDream, unit: type === "lift" || type === "fat" ? unit : null, baseline,
        start, end, weeks: weeksN, days_per_week: maxDays, daily, weigh_in_dow: weighIn,
      },
      verdict,
      verdict_note: note || (verdict === "realistic" ? "A steady, realistic pace." : ""),
      medical_note: type === "fat" ? FAT_MEDICAL_NOTE : null,
      sources: type === "fat" ? FAT_SOURCES.slice() : [],
      templates, weeks, start, end, plate: plateOf(unit), unit,
      replaces: ctx.replaces, free: ctx.free,
      counts: { weeks: weeksN, sessions, new_templates: templates.filter((t) => t.new).length },
      summary: cleanCoachText(str(raw?.summary, 160)).text || weeksN + " weeks, " + maxDays + " days a week.",
    },
  };
}

function round1(n: number): number { return Math.round(n * 10) / 10; }

const PACE = /\s*(?:\b(?:in|within|by|over)\s+(?:\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s*(?:days?|weeks?|wks?|months?|mos?)\b|\b(?:per|a|each|every)\s+(?:day|week|month)\b|\/\s*(?:wk|week|day|mo)\b|\b(?:fast|quick(?:ly)?|asap)\b)/gi;
function cleanTitle(t: string): string { return t.replace(PACE, "").replace(/\s{2,}/g, " ").replace(/[\s,:;–—-]+$/, "").trim(); }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(s: string): string {
  const d = new Date(s + "T12:00:00Z");
  return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate();
}

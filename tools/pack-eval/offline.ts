// Spotter — the offline half of the pack eval.
//
//   deno run --allow-read tools/pack-eval/offline.ts      (npm run eval:offline)
//
// Every fixture in tools/fixtures/eval is run back through the SHIPPING assembler
// and the SHIPPING applyPack — the same two functions a real save calls — using
// the fixture's own transcript and its own observation as the input. Nothing here
// touches a network, a key or a model, so it runs in CI in under a second and
// costs nothing.
//
// What that proves, and what it does not. It cannot tell you whether a model read
// a video correctly; a live reader test can help measure perception, and that costs money. The current live runner uses a fixture card, so it does not evaluate paid card synthesis. What
// it proves is that the pure half of the pipeline is STABLE against input it is
// already known to handle: that a change to the canonicalizer still lands the
// push-up on its movement family, that deltaFrom still says nothing about a swing
// that was standard, that a cue still fits on a card, that a card built from a
// post nobody could watch still makes no visual claim. Those are exactly the
// regressions that are invisible in a diff and obvious to a user, and there have
// already been two of them: a delta that reported an exercise's own definition as
// a difference from itself, and a canonicalizer that matched "Close Grip Pushups"
// to a bench press.
//
// So this must pass 100 % on its own golden input, every time, or the build is
// broken. It is the floor. The bench above it is the live runner.

import {
  assemblePack, type Observation, type PackEye, packReader, parseVtt, readObservation,
  REQUERY_CONFIDENCE, secondsToMmss, type TranscriptSeg, type TranscriptSource, vttCues,
} from "../../supabase/functions/spotter/pack.ts";
import { applyPack } from "./lift.ts";
import { type EvalCard, exitCodeFor, type Fixture, formatReport, type Report, score } from "./score.ts";

const HERE = new URL("./", import.meta.url);
const FIXTURES = new URL("../fixtures/eval/", HERE);

/** A fixture as it sits on disk: the scorer's shape plus what the runner needs. */
type EvalFixture = Fixture & {
  eye?: PackEye;
  transcript_vtt?: string | null;
  transcript?: TranscriptSeg[];
  transcript_source?: TranscriptSource;
  on_screen?: { t: string | number; text: string }[] | null;
  caption?: string | null;
  session?: Record<string, unknown>;
  card_input?: EvalCard & Record<string, unknown>;
};

/**
 * The observation a correct visual read of this video would have returned.
 *
 * DERIVED from the fixture rather than stored next to it, exactly as
 * tools/pack-harness.ts derives its mock: the movement is the name the camera
 * would use, the contact line is the facts the fixture says were seen and not
 * said, the placements are the fixture's own variant. Nothing in it can be tuned
 * to make a check pass, because there is nothing here to tune — change the fixture
 * and the input changes with it.
 *
 * An exercise the fixture marks `"observed": false` is left OUT. Those are
 * movements the golden read saw but whose segment detail nobody wrote down, and
 * inventing a timestamp for one of them would turn an honest gap in the record
 * into a number the pipeline gets graded against.
 */
function observationFrom(fx: EvalFixture): Observation | null {
  if (fx.visual === "unavailable") return null;
  const segments = fx.exercises
    .filter((e) => e.observed !== false && typeof e.t0 === "number" && typeof e.t1 === "number")
    .map((e) => {
      const v = (e.variant ?? {}) as Record<string, unknown>;
      const s = (k: string) => (typeof v[k] === "string" ? v[k] as string : "");
      return {
        t0: secondsToMmss(e.t0 as number),
        t1: secondsToMmss(e.t1 as number),
        movement: String(e.name_shown ?? "").toLowerCase(),
        contact: (e.seen_not_said ?? []).join("; "),
        hand_placement: s("hand_placement"),
        foot_placement: s("stance"),
        load_position: s("load_position"),
        range_of_motion: s("range_of_motion"),
        tempo: s("tempo"),
        reps_visible: e.reps_seen ?? null,
        unilateral: typeof v.unilateral === "boolean" ? v.unilateral : null,
        // A fixture that never recorded a per-segment confidence gets the floor its
        // own log proves — the read was accepted with no re-queries, so every
        // segment was at or above REQUERY_CONFIDENCE. That is the only number the
        // record supports, and it is the pessimistic one.
        confidence: typeof e.confidence === "number" ? e.confidence : REQUERY_CONFIDENCE,
      };
    });
  const sess = (fx.session ?? {}) as Record<string, unknown>;
  return readObservation({
    duration_s: fx.duration_s ?? 0,
    session: {
      format: sess.format ?? null,
      scheme: sess.scheme ?? null,
      equipment_seen: sess.equipment_seen ?? [],
      equipment_count: sess.equipment_count ?? {},
      setting: sess.setting ?? null,
    },
    on_screen: fx.on_screen ?? [],
    segments,
  });
}

/** The card the extraction model hands over, with the fixture's own annotations
 * stripped so a `$note` cannot be mistaken for card text by the must_not scan. */
function cardFrom(fx: EvalFixture): EvalCard | null {
  if (!fx.card_input) return null;
  const clone = JSON.parse(JSON.stringify(fx.card_input)) as Record<string, unknown>;
  const strip = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(strip);
    if (o && typeof o === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (k.startsWith("$")) continue;
        out[k] = strip(v);
      }
      return out;
    }
    return o;
  };
  return strip(clone) as EvalCard;
}

export type Run = {
  fixture: EvalFixture;
  report: Report;
  pack: unknown;
  card: EvalCard | null;
  /** What the shipping code said while it ran. Captured rather than silenced:
   * applyPack's "stamped 2 of 4" line is the one sentence a person debugging a
   * fixture wants, and it must not be interleaved with the report. */
  log: string[];
};

/** One fixture, all the way through the pure pipeline. */
export async function run(path: string | URL): Promise<Run> {
  const fx = JSON.parse(await Deno.readTextFile(path)) as EvalFixture;

  // The VTT rather than the fixture's own transcript when there is one. The
  // fixture's transcript is a hand-authored SEMANTIC segmentation of the same
  // words — useful to a reader, not what production sees — and the raw cues carry
  // the finer clock that every creator cue's timestamp is taken from.
  let transcript: TranscriptSeg[] = fx.transcript ?? [];
  let cues = null;
  if (fx.transcript_vtt) {
    const text = await Deno.readTextFile(new URL("../fixtures/" + fx.transcript_vtt, HERE));
    transcript = parseVtt(text);
    cues = vttCues(text);
  }

  const pack = assemblePack({
    shortcode: fx.shortcode,
    platform: fx.platform,
    caption: fx.caption ?? null,
    durationS: fx.duration_s ?? null,
    transcript,
    transcriptSource: fx.transcript_source ?? "none",
    cues,
    observation: observationFrom(fx),
    // `<eye>:<model>` is the label main adopted so a pack cannot claim it was read
    // by a model that did not read it. Nothing read anything here — the observation
    // came out of the fixture — so the label says so.
    reader: packReader((fx.eye as PackEye) ?? "none", "fixture"),
  });

  const card = cardFrom(fx);
  const log: string[] = [];
  if (card) {
    const real = console.log;
    console.log = (...a: unknown[]) => { log.push(a.map((x) => String(x)).join(" ").trim()); };
    try { applyPack(card, pack); } finally { console.log = real; }
  }

  return { fixture: fx, report: score(fx, pack, card), pack, card, log };
}

if (import.meta.main) {
  const args = Deno.args;
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const asJson = args.includes("--json");

  // URLs, not paths: the worktree lives under ".claude/worktrees" inside a folder
  // with a space in its name, and a pathname taken off a URL comes back
  // percent-encoded and does not open.
  const names: string[] = [];
  for await (const entry of Deno.readDir(FIXTURES)) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    if (only && !entry.name.includes(only)) continue;
    names.push(entry.name);
  }
  names.sort();
  const paths = names.map((n) => new URL(n, FIXTURES));

  if (!paths.length) {
    console.error("no fixtures in " + FIXTURES.href + (only ? " matching " + only : ""));
    Deno.exit(1);
  }

  const runs: Run[] = [];
  for (const p of paths) runs.push(await run(p));

  if (asJson) {
    console.log(JSON.stringify(runs.map((r) => r.report), null, 2));
  } else {
    console.log("pack-eval — offline, against the golden set (" + paths.length + " fixture(s), no model, no network)");
    for (const r of runs) {
      console.log(formatReport(r.report));
      for (const line of r.log) console.log("  … " + line);
    }
    console.log("");
    const failed = runs.filter((r) => !r.report.ok);
    const moves = runs.reduce((n, r) => n + r.report.counts.matched, 0);
    const notes = runs.reduce((n, r) => n + r.report.notes.length, 0);
    console.log(
      (failed.length ? "FAIL  " : "PASS  ") + (runs.length - failed.length) + "/" + runs.length +
      " fixture(s) · " + moves + " movement(s) matched · " + notes + " advisory note(s)",
    );
    if (failed.length) {
      console.log("      " + failed.map((r) => r.report.shortcode).join(", "));
    }
  }

  // The worst code any fixture produced, so a must_not violation and a missing
  // exercise are still told apart when three fixtures ran together.
  const worst = runs.map((r) => exitCodeFor(r.report)).reduce((a, b) => (b > a ? b : a), 0);
  Deno.exit(worst);
}

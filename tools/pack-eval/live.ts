// Spotter — the live half of the pack eval. THIS ONE SPENDS MONEY.
//
//   PACK_EVAL_KEY=… PROJECT_REF=… \
//     deno run --allow-read --allow-net --allow-env tools/pack-eval/live.ts --model gemini-3.6-flash
//
// The offline runner proves the pure half of the pipeline is stable. It cannot
// answer the only question that made this wave necessary: can the model actually
// SEE that both hands are on the kettlebell? That question has one honest form —
// put identical pixels in front of two models and compare what comes back — and
// that is what `POST /api/worker/eval-sheets` exists for. This file is the client
// for it: it posts the contact sheets the phone really cut, runs the observation
// that comes back through the SHIPPING assembler and the SHIPPING applyPack, and
// scores the result against the same fixture the offline runner uses. Same report,
// plus what it cost and how long it took.
//
// Three things it deliberately does not do.
//
// It does not run itself. There is no default model, no default fixture that has
// sheets, and no key in the repo; every one of those has to be supplied on the
// command line or in the environment by a person who meant it. The agent that
// wrote this file never executed it.
//
// It does not read .env.local or hold a secret. `PACK_EVAL_KEY` and the project
// reference come from the environment. The route is 404 to anyone without the
// key, and the key was unset after the 15 Sept bench — see RESULTS.md.
//
// It does not touch a user. `/api/worker/eval-sheets` is matched above the user
// gate, caches nothing, writes no card and reserves its spend against a `sys:`
// work key with a null user, so a bench run cannot eat somebody's monthly budget.

import {
  assemblePack, type Observation, parseVtt, readObservation, type TranscriptSeg, vttCues,
} from "../../supabase/functions/spotter/pack.ts";
import { applyPack } from "./lift.ts";
import { type EvalCard, exitCodeFor, EXIT, type Fixture, formatReport, type Report, score } from "./score.ts";

const HERE = new URL("./", import.meta.url);
const FIXTURES = new URL("../fixtures/eval/", HERE);

type SheetFile = { file: string; times: number[] };
type EvalFixture = Fixture & {
  transcript_vtt?: string | null;
  transcript?: TranscriptSeg[];
  transcript_source?: string;
  caption?: string | null;
  card_input?: EvalCard & Record<string, unknown>;
  sheets?: {
    dir: string;
    zoom_dir?: string;
    cols: number;
    rows: number;
    cell_w: number;
    cell_h: number;
    files: SheetFile[];
  } | null;
};

// ---------- arguments ----------

function flag(name: string): string | null {
  const i = Deno.args.indexOf("--" + name);
  return i >= 0 ? Deno.args[i + 1] ?? "" : null;
}
const has = (name: string) => Deno.args.includes("--" + name);

const USAGE = [
  "usage: live.ts --model <id> [--fixture <shortcode>] [--zoom] [--blind] [--repeat N] [--json]",
  "",
  "  --model     an id ai-guard prices, e.g. gemini-3.6-flash, gpt-5.6-luna, gpt-5.6-terra.",
  "              The route refuses anything it cannot price, so a typo costs nothing.",
  "  --fixture   which fixture to bench (default tt-7679960172495785246, the only one with sheets).",
  "  --zoom      post the 2x person-magnified sheets instead of the phone's own.",
  "  --blind     tell the route to withhold the transcript, so the reader is not anchored by the",
  "              words 'push ups' before it looks at the hands. The pack is still assembled with",
  "              the transcript afterwards, because production always has it.",
  "  --repeat    run N times and report p50/p95 latency and mean cost (default 1).",
  "  --dry       build the request and check the sheets against the route's limits, then stop.",
  "              Spends nothing, needs no key, and is how this file is tested.",
  "",
  "  PACK_EVAL_KEY must be set. The endpoint comes from SPOTTER_URL, or is built from PROJECT_REF.",
].join("\n");

// ---------- bytes ----------

/** A JPEG as base64, without dragging in a dependency for it. */
function toBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

// ---------- one run ----------

type LiveResult = {
  report: Report;
  ms: number;
  server_ms: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  detail: string | null;
  observation: Observation | null;
};

export type SheetPayload = {
  b64: string;
  times: number[];
  cols: number;
  rows: number;
  cell_w: number;
  cell_h: number;
};

/**
 * The sheets block of the request, exactly as the phone's would look.
 *
 * Separated from the request so that `--dry` can exercise everything up to the
 * spend: the files open, the geometry matches the contract, and every sheet is
 * under the route's 600 KB ceiling. That is the half of this file that can be
 * checked without a key, and it is worth checking, because a sheet that is one
 * byte over comes back as a 400 after the round trip rather than before it.
 */
export async function buildPayload(fx: EvalFixture, zoom: boolean): Promise<SheetPayload[]> {
  const sheets = fx.sheets;
  if (!sheets) throw new Error(fx.shortcode + " has no contact sheets — only the WODfather fixture does");
  const dir = zoom ? (sheets.zoom_dir ?? sheets.dir) : sheets.dir;
  const out: SheetPayload[] = [];
  for (const s of sheets.files) {
    const bytes = await Deno.readFile(new URL("../fixtures/eval/" + dir + "/" + s.file, HERE));
    out.push({
      b64: toBase64(bytes),
      times: s.times,
      cols: sheets.cols,
      rows: sheets.rows,
      cell_w: sheets.cell_w,
      cell_h: sheets.cell_h,
    });
  }
  return out;
}

async function once(
  fx: EvalFixture, endpoint: string, key: string, model: string, zoom: boolean, blind: boolean,
): Promise<LiveResult> {
  const payload = await buildPayload(fx, zoom);

  const t0 = Date.now();
  const res = await fetch(endpoint + "/api/worker/eval-sheets", {
    method: "POST",
    headers: { "content-type": "application/json", "x-pack-eval-key": key },
    body: JSON.stringify({
      model,
      duration_s: fx.duration_s,
      sheets: payload,
      // The route only fetches a transcript when it is asked to AND given a URL;
      // the fixture's own VTT is not uploaded, because the point of the axis is
      // what the SERVER put in the prompt.
      transcript: !blind,
      url: (fx.source as { url?: string } | undefined)?.url ?? null,
    }),
  });
  const ms = Date.now() - t0;
  const body = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok || body?.status !== "ok") {
    // 404 is the shape of an unset key, and it is worth saying so out loud: the
    // route answers 404 rather than 401 on purpose, so a bench nobody configured
    // looks like a bench that does not exist.
    throw new Error(
      "eval-sheets " + res.status + (res.status === 404 ? " (PACK_EVAL_KEY unset on the function, or wrong)" : "") +
      ": " + JSON.stringify(body).slice(0, 300),
    );
  }

  const obs = readObservation(body.observation);

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
    transcriptSource: (fx.transcript_source as "tiktok_vtt" | "gemini_audio" | "none") ?? "none",
    cues,
    observation: obs,
    // Frames were used, so this is the sheets path whichever model read them —
    // exactly as buildVideoPack decides it.
    reader: "luna_sheets",
  });

  const card = fx.card_input
    ? JSON.parse(JSON.stringify(fx.card_input)) as EvalCard
    : null;
  if (card) applyPack(card, pack);

  return {
    report: score(fx, pack, card),
    ms,
    server_ms: Number(body.ms ?? 0),
    tokens_in: Number(body.tokens_in ?? 0),
    tokens_out: Number(body.tokens_out ?? 0),
    cost_usd: Number(body.cost_usd ?? 0),
    detail: (body.detail as string | null) ?? null,
    observation: obs,
  };
}

// ---------- latency ----------

/** The percentile the production review asked for, taken the boring way. */
function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

if (import.meta.main) {
  const model = flag("model");
  if (!model || has("help")) {
    console.error(USAGE);
    Deno.exit(model ? EXIT.ok : EXIT.usage);
  }
  const which0 = flag("fixture") ?? "tt-7679960172495785246";
  if (has("dry")) {
    const dry = JSON.parse(await Deno.readTextFile(new URL(which0 + ".json", FIXTURES))) as EvalFixture;
    const payload = await buildPayload(dry, has("zoom"));
    const CAP = 600 * 1024;   // SHEET_MAX_BYTES, as the route enforces it
    let bad = 0;
    console.log("pack-eval — dry run of the live request for " + dry.shortcode +
      (has("zoom") ? " (2x magnified sheets)" : "") + ". Nothing is sent.");
    payload.forEach((s, i) => {
      const bytes = Math.floor(s.b64.length * 3 / 4);
      const cells = s.cols * s.rows;
      const over = bytes > CAP;
      const short = s.times.length > cells;
      if (over || short) bad++;
      console.log("  sheet " + (i + 1) + "  " + (bytes / 1024).toFixed(0) + " KB" +
        (over ? "  OVER THE 600 KB CAP" : "") + "  ·  " + s.cols + "x" + s.rows + " of " +
        s.cell_w + "x" + s.cell_h + "  ·  " + s.times.length + " frame(s) " +
        s.times[0] + "–" + s.times[s.times.length - 1] + " s" +
        (short ? "  MORE FRAMES THAN CELLS" : ""));
    });
    console.log("  " + payload.length + " sheet(s), " + (payload.length > 3 ? "OVER the 3-sheet limit" : "within the 3-sheet limit"));
    Deno.exit(bad || payload.length > 3 ? EXIT.failed : EXIT.ok);
  }

  const key = Deno.env.get("PACK_EVAL_KEY") ?? "";
  if (!key) {
    console.error("PACK_EVAL_KEY is not set. It is the function's own secret for this route and it is\n" +
      "not in the repo; the senior session sets it with `supabase secrets set` before a bench and\n" +
      "unsets it after. Without it the route answers 404.");
    Deno.exit(EXIT.usage);
  }
  const ref = Deno.env.get("PROJECT_REF");
  const endpoint = Deno.env.get("SPOTTER_URL") ??
    (ref ? "https://" + ref + ".supabase.co/functions/v1/spotter" : "");
  if (!endpoint) {
    console.error("set SPOTTER_URL, or PROJECT_REF so the endpoint can be built from it");
    Deno.exit(EXIT.usage);
  }

  const which = which0;
  const fx = JSON.parse(await Deno.readTextFile(new URL(which + ".json", FIXTURES))) as EvalFixture;
  const zoom = has("zoom");
  const blind = has("blind");
  const repeat = Math.max(1, Math.min(20, Number(flag("repeat") ?? 1) || 1));

  console.log("pack-eval — LIVE. This spends money.");
  console.log("  fixture " + fx.shortcode + " · " + (fx.sheets?.files.length ?? 0) + " sheet(s)" +
    (zoom ? " (2x magnified)" : "") + " · model " + model +
    " · transcript " + (blind ? "withheld" : "sent") + " · " + repeat + " run(s)");
  console.log("  endpoint " + endpoint.replace(/https:\/\/([^.]{4})[^.]*/, "https://$1…"));
  console.log("");

  const runs: LiveResult[] = [];
  for (let i = 0; i < repeat; i++) {
    const r = await once(fx, endpoint, key, model, zoom, blind);
    runs.push(r);
    console.log(formatReport(r.report));
    console.log("  cost        " + r.tokens_in + " in / " + r.tokens_out + " out · $" +
      r.cost_usd.toFixed(4) + " · " + r.server_ms + " ms model, " + r.ms + " ms round trip" +
      (r.detail ? " · " + r.detail : ""));
  }

  if (has("json")) {
    console.log(JSON.stringify(
      runs.map((r) => ({
        report: r.report,
        ms: r.ms,
        server_ms: r.server_ms,
        tokens_in: r.tokens_in,
        tokens_out: r.tokens_out,
        cost_usd: r.cost_usd,
        observation: r.observation,
      })),
      null,
      2,
    ));
  }

  const ok = runs.filter((r) => r.report.ok).length;
  const spend = runs.reduce((n, r) => n + r.cost_usd, 0);
  const lat = runs.map((r) => r.server_ms);
  console.log("");
  console.log(
    (ok === runs.length ? "PASS  " : "FAIL  ") + ok + "/" + runs.length + " run(s) clean · " +
    "p50 " + percentile(lat, 50) + " ms · p95 " + percentile(lat, 95) + " ms · " +
    "$" + spend.toFixed(4) + " total, $" + (spend / runs.length).toFixed(4) + " per read",
  );
  console.log("Add the numbers to tools/pack-eval/RESULTS.md, with the date and the function version.");

  const worst = runs.map((r) => exitCodeFor(r.report)).reduce((a, b) => (b > a ? b : a), 0);
  Deno.exit(worst);
}

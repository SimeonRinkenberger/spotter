// Pumpy must never ship a claim without the workout behind it.
// Run: deno run --allow-env --allow-read tools/pumpy-truncation-harness.ts — exits non-zero on failure.
//
// Found 2026-09-23 in ai_cost_log + pumpy_messages: 8 of 81 coach calls in three
// weeks ended at exactly the 1,500-token cap, every one a workout being built,
// and every answer a sentence saying the workout was done with no proposal on it.
// The model had run out of room mid-proposal; the JSON would not parse; the turn
// kept the sentence it had streamed and lost the workout.
//
// This drives the REAL pumpyRun — the loop, the adapters, ai-guard's reservation
// path, validateProposal, the stream events — with fetch mocked at the network:
// OpenAI answers from a script, the database answers from memory. No model is
// called and nothing is written anywhere.
//
//   0. the measurement the cap was chosen from, and the prompt rule that trims it
//   1. a cut reply is retried once at a larger cap and the proposal arrives
//   2. cut twice: an honest answer, meta.truncated, and a warning naming the thread
//   3. a normal turn is unchanged: one call, no retry, no reset
//   4. every chat call carries the configured reasoning_effort and cap
//   5. the stream takes the claim back off the screen BEFORE the retry starts
//   6. a cut on the last step still gets its retry; the last-step note is not doubled
//   7. history replays a cut turn as what it was
//   8. the adapters report truncation; other callers see nothing new
//
// index.ts is an entrypoint (Deno.serve at the bottom); stubbing that before the
// import is what lets the harness load it without a port.

Deno.env.set("SUPABASE_URL", "https://harness.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "harness-not-a-jwt");
Deno.env.set("OPENAI_API_KEY", "harness-openai");
Deno.env.set("GEMINI_API_KEY", "harness-gemini");
(Deno as unknown as { serve: unknown }).serve = () => ({
  finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {},
  addr: { transport: "tcp", hostname: "127.0.0.1", port: 0 },
});

const { aiActor, openaiInputBound, tokenCost } = await import("../supabase/functions/spotter/ai-guard.ts");
const S = await import("../supabase/functions/spotter/index.ts");

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

// ---------- the fixture: a realistic 60-minute, four-video combine ----------

// The one real card in tools/fixtures, for its creator cues — the text a model
// copies into `notes` when nothing tells it not to.
const CARD = JSON.parse(Deno.readTextFileSync(new URL("./fixtures/pumpy-wodfather-card.json", import.meta.url)));
const CUES: string[] = [
  ...CARD.blocks[0].exercises.map((e: any) => String(e.cue)),
  "Drive through the whole foot, knee tracks over the toes, stand tall at the top.",
  "Hinge from the hips with a flat back, bell close to the legs, squeeze glutes to finish.",
  "Pull the elbow back to the hip, pause, lower under control without twisting.",
  "Brace the core, press straight overhead, biceps by the ears at lockout.",
  "Keep hips level, step long enough that the front shin stays vertical.",
  "Ribs down, lower back pressed to the floor, slow controlled reach.",
];
const NAMES = [
  "Goblet Squat", "Kettlebell Swing", "Romanian Deadlift", "Bulgarian Split Squat", "Reverse Lunge", "Glute Bridge",
  "Single-Arm Dumbbell Row", "Push Press", "Close Grip Push-Up", "Sumo Deadlift High Pull", "Plank", "Dead Bug",
  "Russian Twist", "Mountain Climber", "Hollow Hold", "Side Plank", "Walking Lunge", "Step-Up",
  "Farmer Carry", "Bird Dog", "Lateral Lunge", "Hip Thrust", "Calf Raise", "Bicycle Crunch",
];
const HANDLES = ["h3f9a1c", "h7b21e0", "h0c44d9", "h9e18a2"];

/**
 * The proposal a model writes for `blocks` × `per` exercises. "loose" is how the
 * old prompt let it write: every null spelled out and each creator's cue copied
 * into notes. "compact" is the new rule: nulls left out, a short note on about
 * one exercise in four, `from` kept.
 */
function combine(blocks: number, per: number, style: "loose" | "compact") {
  const p: any = {
    kind: "create_workout", title: "Legs and Core Hour", category: "Strength", duration_minutes: 60,
    equipment: ["kettlebell", "dumbbell"], blocks: [],
    summary: "Four saved workouts combined into one hour-long legs and core session, in their original order.",
  };
  let k = 0;
  for (let b = 0; b < blocks; b++) {
    const circuit = b % 2 === 1;
    const blk: any = style === "compact"
      ? { title: "Part " + (b + 1), type: circuit ? "circuit" : "straight", ...(circuit ? { rounds: 3, rest_seconds: 60 } : {}), exercises: [] }
      : { title: "Part " + (b + 1), type: circuit ? "circuit" : "straight", rounds: circuit ? 3 : null, rest_seconds: circuit ? 60 : null, exercises: [] };
    for (let i = 0; i < per; i++, k++) {
      const timed = k % 5 === 4;
      if (style === "compact") {
        const e: any = { name: NAMES[k % NAMES.length], sets: 3 };
        if (timed) e.duration_seconds = 40; else e.reps = String(8 + (k % 5) * 2);
        if (k % 3 === 0) e.rest_seconds = 45;
        if (k % 4 === 1) e.notes = "Pumpy recommendation: 3 sets, the video gave none";
        e.from = HANDLES[b % 4];
        blk.exercises.push(e);
      } else {
        blk.exercises.push({
          name: NAMES[k % NAMES.length], sets: 3, reps: timed ? null : String(8 + (k % 5) * 2),
          duration_seconds: timed ? 40 : null, rest_seconds: k % 3 === 0 ? 45 : null,
          notes: CUES[k % CUES.length], from: HANDLES[b % 4],
        });
      }
    }
    p.blocks.push(blk);
  }
  return p;
}

/**
 * Tokens, the way o200k splits compact JSON: a leading space joins its word,
 * common words are one token and long ones split about every six letters, digits
 * go in threes, and punctuation runs merge about two characters to a token. It
 * reads JSON as denser than index.ts's chars/4 (approxTokens) does — correctly:
 * `":"`, `","` and `null` are a token each. No tokenizer is vendored here, so this
 * is an estimate; it is reported beside chars/4 and chars/3 so the spread shows.
 */
function estTokens(s: string): number {
  let n = 0;
  for (const m of s.matchAll(/ ?[A-Za-z]+|\d{1,3}|\s+|[^\sA-Za-z\d]+/g)) {
    const t = m[0];
    if (/^ ?[A-Za-z]+$/.test(t)) n += Math.max(1, Math.ceil(t.trim().length / 6));
    else if (/^\d+$/.test(t) || /^\s+$/.test(t)) n += 1;
    else n += Math.ceil(t.length / 2);
  }
  return n;
}

const CLAIM = "I combined all four videos into a 60-minute legs-and-core session.";
const GOOD_SAY = "Here it is: four videos, one hour, legs first and core to finish.";
const full = (say = GOOD_SAY, p: unknown = combine(4, 5, "compact")) => JSON.stringify({ say, tool: null, proposal: p });
/** The same reply the cap cut off two-thirds of the way through the proposal. */
const half = (say = CLAIM) => { const t = full(say, combine(4, 5, "loose")); return t.slice(0, Math.floor(t.length * 0.66)); };

// ---------- 0. the measurement ----------

const REASONING_ALLOWANCE = 1000; // what "low" is budgeted to think; not measurable offline
const sizes: Record<string, number> = {};
for (const [b, per] of [[4, 4], [4, 5], [4, 6]] as const) {
  for (const style of ["loose", "compact"] as const) {
    const text = JSON.stringify({ say: CLAIM, tool: null, proposal: combine(b, per, style) });
    const est = estTokens(text);
    sizes[b + "x" + per + ":" + style] = est;
    console.log(`measure  ${b}×${per} ${style.padEnd(7)} ${String(text.length).padStart(5)} chars · ` +
      `≈${est} tokens (chars/4 ${Math.ceil(text.length / 4)}, chars/3 ${Math.ceil(text.length / 3)})`);
  }
}
const DEFAULTS = S.buildPumpyCfg({});
const worst = Math.max(...Object.values(sizes));
console.log(`measure  worst ${worst} + ${REASONING_ALLOWANCE} low-reasoning allowance = ${worst + REASONING_ALLOWANCE}; ` +
  `cap ${DEFAULTS.maxOut} (${(DEFAULTS.maxOut / (worst + REASONING_ALLOWANCE)).toFixed(2)}×), retry ${Math.min(8000, Math.ceil(DEFAULTS.maxOut * 4 / 3))}`);
check("the old habit alone overflows the old cap: a 4×5 loose combine is over 1,500", sizes["4x5:loose"] > 1500, String(sizes["4x5:loose"]));
check("the compact rule roughly halves it", sizes["4x6:compact"] < sizes["4x6:loose"] * 0.65,
  sizes["4x6:compact"] + " vs " + sizes["4x6:loose"]);
check("the default cap is at least 2× the worst realistic combine plus low reasoning",
  DEFAULTS.maxOut >= 2 * (worst + REASONING_ALLOWANCE), DEFAULTS.maxOut + " vs " + (worst + REASONING_ALLOWANCE));
check("and inside ai-guard's 8,000 ceiling", DEFAULTS.maxOut <= 8000);
eq("the default reasoning is low", DEFAULTS.reasoning, "low");

{
  const sys = S.pumpySystem(new Date("2026-09-23T12:00:00Z"), [], "LIBRARY — empty; nothing saved yet.");
  check("the prompt tells the model to keep proposals compact",
    sys.includes("Leave out any field that would be null") && sys.includes("12 words or fewer") &&
    sys.includes("Never copy cues, evidence, as_performed"));
  for (const field of ['"name"', '"sets"', '"reps"', '"duration_seconds"', '"rest_seconds"', '"notes"', '"from"', '"summary"', '"duration_minutes"']) {
    check("the proposal schema still names " + field, sys.includes(field));
  }
}

// ---------- the mock network ----------

type Reply = { content: string; finish: "stop" | "length" | null; tool?: boolean };
const USER = "00000000-0000-4000-8000-00000000abcd";
const THREAD = "11111111-2222-4333-8444-555555555555";
let script: Reply[] = [];
let history: any[] = [];
const bodies: any[] = [];
const reserves: any[] = [];
const inserted: { table: string; row: any }[] = [];
let log: any[] = [];   // stream events AND model calls, in the order they happened
let nextId = 1000;

function sseOf(r: Reply, cap: number): string {
  const chunks: unknown[] = [{ choices: [{ delta: { role: "assistant" } }] }];
  for (let i = 0; i < r.content.length; i += 37) chunks.push({ choices: [{ delta: { content: r.content.slice(i, i + 37) } }] });
  if (r.finish) chunks.push({ choices: [{ delta: {}, finish_reason: r.finish }] });
  chunks.push({ choices: [], usage: { prompt_tokens: 3000, completion_tokens: r.finish === "length" ? cap : 400 } });
  return chunks.map((c) => "data: " + JSON.stringify(c) + "\n\n").join("") + (r.finish ? "data: [DONE]\n\n" : "");
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  if (url === "https://api.openai.com/v1/chat/completions") {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    log.push({ t: "__call", n: bodies.length });
    const r = script.shift();
    if (!r) return new Response("no scripted reply", { status: 500 });
    const cap = body.max_completion_tokens;
    if (body.stream) {
      return new Response(sseOf(r, cap), { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({
      id: "cmpl-fixture", model: body.model,
      choices: [{ message: { role: "assistant", content: r.content }, finish_reason: r.finish ?? "stop" }],
      usage: { prompt_tokens: 3000, completion_tokens: r.finish === "length" ? cap : 400 },
    });
  }
  if (url.includes(":countTokens")) return Response.json({ totalTokens: 1000 });
  if (url.startsWith("https://generativelanguage.googleapis.com/")) {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    const r = script.shift()!;
    const reason = r.finish === "length" ? "MAX_TOKENS" : "STOP";
    const usageMetadata = { promptTokenCount: 800, candidatesTokenCount: 30 };
    if (url.includes(":streamGenerateContent")) {
      const sse = "data: " + JSON.stringify({ candidates: [{ content: { parts: [{ text: r.content }] } }] }) + "\n\n" +
        "data: " + JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: reason }], usageMetadata }) + "\n\n";
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({ candidates: [{ content: { parts: [{ text: r.content }] }, finishReason: reason }], usageMetadata });
  }
  if (url.startsWith("https://harness.invalid/rest/v1/rpc/")) {
    const name = url.split("/rpc/")[1];
    if (name === "ai_budget_status") return Response.json({ daily_used: 0, daily_limit: 1, monthly_used: 0, monthly_limit: 10 });
    if (name === "ai_reserve") { reserves.push(JSON.parse(String(init.body))); return Response.json("ok"); }
    if (name === "ai_record_attempt") return Response.json(true);
    return Response.json(null);
  }
  if (url.startsWith("https://harness.invalid/rest/v1/")) {
    const table = url.split("/rest/v1/")[1].split("?")[0];
    if (method === "POST") {
      const row = { id: ++nextId, ...JSON.parse(String(init.body)) };
      inserted.push({ table, row });
      return Response.json([row]);
    }
    if (method === "PATCH") return Response.json([{}]);
    if (method === "HEAD") return new Response(null, { status: 200, headers: { "content-range": "*/0" } });
    if (table === "pumpy_messages") return Response.json(history.slice().reverse());
    return Response.json([]);
  }
  throw new Error("harness: unexpected fetch " + url);
}) as typeof fetch;

const warnings: string[] = [];
const realWarn = console.warn;
console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(" ")); };
const realLog = console.log;

type Turn = { res: any; events: any[]; bodies: any[]; messages: any[]; screenAtCall: string[]; left: number };

/** One coach turn through the real pumpyRun, streamed or whole. */
async function turn(stream: boolean, replies: Reply[], opts: { config?: Record<string, string>; message?: string } = {}): Promise<Turn> {
  script = replies.slice();
  bodies.length = 0; reserves.length = 0; inserted.length = 0; log = [];
  const sink = stream ? { send(ev: any) { log.push(ev); }, dead: false } : null;
  const cfg = S.buildPumpyCfg(opts.config ?? {});
  const meter = { plan: "plus", day: 400, month: 5000, totals: { day: 0, month: 0, minute: 0 } };
  console.log = () => {};   // pumpyRun's own per-turn log line
  let res: any;
  try {
    res = await aiActor.run({ userId: USER, workKey: crypto.randomUUID(), deadline: Date.now() + 60_000 }, () =>
      S.pumpyRun({ userId: USER, thread: { id: THREAD }, userMsg: { id: 900 }, message: opts.message ??
        "Can you combine all of these workouts into a workout? That's about an hour long", refs: [], meter, cfg }, sink as any));
  } finally { console.log = realLog; }
  // Replay the events the way the browser does, noting what was on screen at the
  // moment each model call went out.
  let screen = "";
  const screenAtCall: string[] = [];
  for (const ev of log) {
    if (ev.t === "__call") screenAtCall.push(screen);
    else if (ev.t === "delta") screen += ev.text;
    else if (ev.t === "retract") screen = screen.slice(0, screen.length - ev.chars);
    else if (ev.t === "reset") screen = "";
  }
  return { res, events: log.filter((e) => e.t !== "__call"), bodies: bodies.slice(),
    messages: inserted.filter((x) => x.table === "pumpy_messages" && x.row.role === "assistant").map((x) => x.row),
    screenAtCall, left: script.length };
}

const CUT_NOTE = "cut off before it finished";
const CUT_WORKOUT = "That workout came out too long for me to finish in one go. Ask again with fewer exercises, or in two parts.";
const exercisesIn = (p: any) => (p?.blocks ?? []).reduce((n: number, b: any) => n + b.exercises.length, 0);

// Omitting a null must mean exactly what writing it meant, or the compact rule
// would quietly change workouts. Both shapes through the real validateProposal.
await aiActor.run({ userId: USER, workKey: "validate-fixture" }, async () => {
  const a: any = await S.validateProposal(USER, combine(4, 5, "compact"));
  const loose = combine(4, 5, "loose");
  for (const b of loose.blocks) for (const e of b.exercises) e.notes = null;
  const b: any = await S.validateProposal(USER, loose);
  const strip = (p: any) => p.blocks.map((bl: any) => ({ ...bl, exercises: bl.exercises.map((e: any) => ({ ...e, cue: null, notes: null })) }));
  check("both shapes validate", !("error" in a) && !("error" in b));
  eq("an absent field normalises exactly as a written null does", strip(a), strip(b));
  eq("and nothing is lost on the way", exercisesIn(a), 20);
});

// ---------- 1. cut → retry → the proposal arrives (both paths) ----------

for (const stream of [false, true]) {
  const tag = stream ? " (stream)" : " (whole)";
  warnings.length = 0;
  const t = await turn(stream, [{ content: half(), finish: "length" }, { content: full(), finish: "stop" }]);
  eq("cut reply is retried once" + tag, t.bodies.length, 2);
  eq("the first call used the configured cap" + tag, t.bodies[0].max_completion_tokens, 6000);
  eq("the retry asked for a third more room, within the guard" + tag, t.bodies[1].max_completion_tokens, 8000);
  const prompt2 = t.bodies[1].messages[1].content as string;
  check("the retry is told why" + tag, prompt2.includes(CUT_NOTE) && !t.bodies[0].messages[1].content.includes(CUT_NOTE));
  check("the cut claim is not carried into the retry's transcript" + tag, !prompt2.includes(CLAIM));
  eq("one assistant message" + tag, t.messages.length, 1);
  const m = t.messages[0];
  eq("the proposal was delivered" + tag, m?.meta?.proposal?.kind, "create_workout");
  eq("with every block" + tag, m?.meta?.proposal?.blocks?.length, 4);
  eq("and every exercise" + tag, exercisesIn(m?.meta?.proposal), 20);
  eq("and it is pending confirmation" + tag, [m?.meta?.status, t.res.pending], ["pending", m?.id]);
  eq("what the user reads is the retry's sentence, not the claim" + tag, m?.content, GOOD_SAY);
  check("no truncation flag on a delivered turn" + tag, !m?.meta?.truncated);
  eq("both calls are metered" + tag, t.res.usage.calls, 2);
  check("the cut is logged with the thread" + tag, warnings.some((w) => w.includes("cut off at 6000") && w.includes(THREAD)));
  eq("two reservations, sized to their caps" + tag, reserves.length, 2);
}

// ---------- 2. cut twice → honest answer ----------

for (const stream of [false, true]) {
  const tag = stream ? " (stream)" : " (whole)";
  warnings.length = 0;
  const t = await turn(stream, [{ content: half(), finish: "length" }, { content: half(), finish: "length" }]);
  eq("exactly one retry, never a third call" + tag, t.bodies.length, 2);
  eq("one assistant message" + tag, t.messages.length, 1);
  const m = t.messages[0];
  eq("it says the workout was too long to finish" + tag, m?.content, CUT_WORKOUT);
  eq("marked truncated" + tag, m?.meta?.truncated, true);
  check("and carries no proposal" + tag, !m?.meta?.proposal && t.res.pending === null);
  check("the claim is nowhere in what was saved" + tag, !JSON.stringify(t.messages).includes(CLAIM));
  check("a warning names the thread" + tag, warnings.some((w) => w.includes("cut off again") && w.includes(THREAD)));
  if (stream) {
    let screen = "";
    for (const ev of t.events) {
      if (ev.t === "delta") screen += ev.text;
      else if (ev.t === "reset") screen = "";
    }
    eq("nothing the model streamed is left on screen" + tag, screen, "");
    eq("each cut was taken back" + tag, t.events.filter((e) => e.t === "reset").length, 2);
  }
}

// A cut that had not reached a proposal — empty content, all reasoning — is
// retried the same way, and if it happens twice the answer does not claim a workout.
{
  const t = await turn(false, [{ content: "", finish: "length" }, { content: "", finish: "length" }]);
  eq("reasoning that eats the whole cap is a cut, not an outage", t.messages[0]?.meta?.truncated, true);
  eq("and says so without naming a workout", t.messages[0]?.content,
    "That answer came out too long for me to finish in one go. Ask again with a narrower question.");
  check("not the busy line", !String(t.messages[0]?.content).includes("breather"));
}
{
  const t = await turn(false, [{ content: "", finish: "length" }, { content: full(), finish: "stop" }]);
  eq("an empty cut followed by a good retry delivers the workout", t.messages[0]?.meta?.proposal?.kind, "create_workout");
}

// A stream that broke without a finish_reason: no flag, but the JSON will not parse
// and a proposal had begun — the same cut.
{
  const t = await turn(true, [{ content: half(), finish: null }, { content: full(), finish: "stop" }]);
  eq("an unterminated proposal is treated as a cut", t.bodies.length, 2);
  eq("and the retry delivers", t.messages[0]?.meta?.proposal?.kind, "create_workout");
}
{
  const t = await turn(true, [{ content: JSON.stringify({ say: CLAIM, tool: null }).slice(0, -1) + ',"proposal":', finish: null },
    { content: full(), finish: "stop" }]);
  eq("a stream that broke right after \"proposal\": is a cut too", t.bodies.length, 2);
  check("and the claim is not what was saved", t.messages[0]?.content === GOOD_SAY);
}
// …but a broken stream whose proposal was null is not a lost workout: the sentence stands.
{
  const broken = JSON.stringify({ say: "Three rounds, rest ninety seconds.", tool: null, proposal: null }).slice(0, -3);
  const t = await turn(true, [{ content: broken, finish: null }]);
  eq("a broken tail after proposal:null is not retried", t.bodies.length, 1);
  eq("its sentence is kept", t.messages[0]?.content, "Three rounds, rest ninety seconds.");
}

// ---------- 3. a normal turn is unchanged ----------

for (const stream of [false, true]) {
  const tag = stream ? " (stream)" : " (whole)";
  warnings.length = 0;
  const t = await turn(stream, [{ content: full(), finish: "stop" }]);
  eq("one call" + tag, t.bodies.length, 1);
  eq("proposal delivered" + tag, t.messages[0]?.meta?.proposal?.blocks?.length, 4);
  check("no cut note, no warning" + tag, !t.bodies[0].messages[1].content.includes(CUT_NOTE) && !warnings.some((w) => w.includes("cut off")));
  if (stream) {
    eq("no reset" + tag, t.events.filter((e) => e.t === "reset").length, 0);
    eq("the streamed sentence is the saved one" + tag,
      t.events.filter((e) => e.t === "delta").map((e) => e.text).join(""), GOOD_SAY);
  }
  const say = await turn(stream, [{ content: JSON.stringify({ say: "Three rounds, rest ninety seconds.", tool: null, proposal: null }), finish: "stop" }],
    { message: "How long should I rest?" });
  eq("a plain answer is one call" + tag, say.bodies.length, 1);
  eq("and says what it said" + tag, say.messages[0]?.content, "Three rounds, rest ninety seconds.");
  check("with no proposal and no flag" + tag, !say.messages[0]?.meta?.proposal && !say.messages[0]?.meta?.truncated);
}

// ---------- 4. the dials reach the request ----------

{
  const t = await turn(false, [{ content: full(), finish: "stop" }]);
  const b = t.bodies[0];
  eq("chat sends reasoning_effort explicitly", b.reasoning_effort, "low");
  eq("chat sends the configured cap", b.max_completion_tokens, 6000);
  eq("on the text default model", b.model, "gpt-6-luna");
  check("still JSON mode", b.response_format?.type === "json_object");
  // The reservation the guard made for that call is input bound + cap at GPT-6
  // prices, and it is below what the same prompt reserved on 5.6 at the old 1,500.
  const bound = openaiInputBound(b);
  const now = tokenCost("gpt-6-luna", bound, 6000), before = tokenCost("gpt-5.6-luna", bound, 1500);
  console.log(`reserve  Pumpy call, empty library: input bound ${bound} B → GPT-6 @6000 $${now.toFixed(5)} ` +
    `vs 5.6 @1500 $${before.toFixed(5)}; 5.6 @6000 (before the migration) $${tokenCost("gpt-5.6-luna", bound, 6000).toFixed(5)}; ` +
    `retry GPT-6 @8000 $${tokenCost("gpt-6-luna", bound, 8000).toFixed(5)}`);
  check("the smallest real Pumpy prompt is past the 12 KB break-even", bound > 12_000, String(bound));
  check("GPT-6 at 6,000 reserves less than 5.6 did at 1,500", now < before, now + " vs " + before);
  eq("the reservation went to ai_reserve at that price", reserves[0]?.p_usd, Math.ceil(now * 1e6) / 1e6);
}
{
  const t = await turn(true, [{ content: half(), finish: "length" }, { content: full(), finish: "stop" }],
    { config: { "pumpy.max_out": "7000", "pumpy.reasoning": "medium" } });
  eq("app_config's pumpy.max_out and pumpy.reasoning are obeyed",
    t.bodies.map((b) => [b.max_completion_tokens, b.reasoning_effort]), [[7000, "medium"], [8000, "medium"]]);
}
eq("a cap above the guard's ceiling is clamped, not obeyed", S.buildPumpyCfg({ "pumpy.max_out": "90000" }).maxOut, 8000);
eq("a cap too small for any proposal is raised", S.buildPumpyCfg({ "pumpy.max_out": "10" }).maxOut, 1000);
eq("a nonsense cap falls back", S.buildPumpyCfg({ "pumpy.max_out": "lots" }).maxOut, 6000);
{
  const errs: string[] = [];
  const realErr = console.error;
  console.error = (...a: unknown[]) => { errs.push(a.map(String).join(" ")); };
  eq("an effort the API does not know falls back to low", S.buildPumpyCfg({ "pumpy.reasoning": "turbo" }).reasoning, "low");
  console.error = realErr;
  check("and says so", errs.some((e) => e.includes("pumpy.reasoning")));
}
eq("an effort is read case-blind", S.buildPumpyCfg({ "pumpy.reasoning": " None " }).reasoning, "none");
{
  // Other callers keep exactly what they sent before.
  script = [{ content: "{}", finish: "stop" }, { content: "{}", finish: "stop" }, { content: "{}", finish: "stop" }];
  bodies.length = 0;
  await aiActor.run({ userId: USER, workKey: "extract-fixture" }, async () => {
    await S.openaiGenerate("s", "u", true, { purpose: "extract", userId: USER });
    await S.openaiGenerate("s", "u", true, { purpose: "swap", userId: USER });
    await S.openaiStream("s", "u", true, { purpose: "reprocess", userId: USER }, () => {});
  });
  eq("extract still sends none", bodies[0]?.reasoning_effort, "none");
  check("a helper that never set an effort still sends none of it", !("reasoning_effort" in (bodies[1] ?? {})));
  eq("and keeps its old default cap", bodies[1]?.max_completion_tokens, 4000);
  eq("reprocess on the stream still sends none", bodies[2]?.reasoning_effort, "none");
}

// ---------- 5. the stream takes the claim back before the retry ----------

{
  const t = await turn(true, [{ content: half(), finish: "length" }, { content: full(), finish: "stop" }]);
  const firstReset = t.events.findIndex((e) => e.t === "reset");
  const claimShown = t.events.findIndex((e) => e.t === "delta");
  check("the claim was streamed first (the case that matters)", claimShown >= 0 && claimShown < firstReset);
  eq("the screen was empty when the retry went out", t.screenAtCall[1], "");
  eq("and after the reset the user reads a status, not a claim", t.events[firstReset + 1],
    { t: "status", text: "Writing that out in full…" });
  let screen = "";
  for (const ev of t.events) {
    if (ev.t === "delta") screen += ev.text;
    else if (ev.t === "reset") screen = "";
  }
  eq("the screen ends on the delivered sentence", screen, GOOD_SAY);
}

// ---------- 6. a cut on the last step still gets its retry ----------

for (const stream of [false, true]) {
  const tag = stream ? " (stream)" : " (whole)";
  const tool = (q: string) => ({ content: JSON.stringify({ say: "", tool: { name: "search_catalog", args: { query: q } }, proposal: null }), finish: "stop" as const });
  const t = await turn(stream, [tool("squat"), tool("lunge"), tool("plank"),
    { content: half(), finish: "length" }, { content: full(), finish: "stop" }]);
  eq("three tools, the cut last step, and its retry" + tag, t.bodies.length, 5);
  eq("the retry delivered on the last step" + tag, t.messages[0]?.meta?.proposal?.kind, "create_workout");
  const last = t.bodies[4].messages[1].content as string;
  eq("the last-step note appears once in the retry" + tag, last.split("[no tool calls left").length - 1, 1);
  check("and the cut note after it" + tag, last.indexOf("[no tool calls left") < last.indexOf(CUT_NOTE));
  eq("nothing was left in the script" + tag, t.left, 0);
}

// ---------- 7. history tells the truth ----------

{
  const lines = S.pumpyHistoryContext([
    { role: "user", content: "Combine these into an hour" },
    { role: "assistant", content: "That workout came out too long for me to finish in one go.", meta: { truncated: true, model: "openai:gpt-6-luna" } },
    { role: "assistant", content: "I combined all three.", meta: {} },
  ]);
  eq("a cut turn replays as cut", lines[1], "Pumpy: [that answer was cut off — no workout was delivered]");
  eq("an ordinary turn is unchanged", lines[2], "Pumpy: I combined all three.");
  eq("user lines are unchanged", lines[0], "User: Combine these into an hour");
  history = [
    { role: "user", content: "Combine these into an hour", meta: {} },
    { role: "assistant", content: CUT_WORKOUT, meta: { truncated: true } },
  ];
  const t = await turn(false, [{ content: full(), finish: "stop" }], { message: "Where is the updated workout" });
  history = [];
  check("the next turn's prompt says no workout was delivered",
    (t.bodies[0].messages[1].content as string).includes("[that answer was cut off — no workout was delivered]"));
  eq("and asking again delivers it", t.messages[0]?.meta?.proposal?.kind, "create_workout");
}

// ---------- 8. the adapters ----------

await aiActor.run({ userId: USER, workKey: "adapter-fixture" }, async () => {
  const ctx = { purpose: "chat", userId: USER, maxOut: 6000, reasoning: "low" };
  script = [{ content: '{"say":"cut', finish: "length" }];
  const a = await S.openaiGenerate("s", "u", true, ctx);
  eq("openai whole: finish_reason length → truncated", a.truncated, true);
  script = [{ content: '{"say":"ok"}', finish: "stop" }];
  const b = await S.openaiGenerate("s", "u", true, ctx);
  check("openai whole: stop → no flag at all", !("truncated" in b));
  script = [{ content: '{"say":"cut', finish: "length" }];
  const c = await S.openaiStream("s", "u", true, ctx, () => {});
  eq("openai stream: the finish chunk's length → truncated", c.truncated, true);
  script = [{ content: '{"say":"ok"}', finish: "stop" }];
  const d = await S.openaiStream("s", "u", true, ctx, () => {});
  check("openai stream: stop → no flag at all", !("truncated" in d));
  script = [{ content: "", finish: "length" }];
  const e = await S.openaiStream("s", "u", true, ctx, () => {});
  check("openai stream: a cap spent entirely on reasoning is still reported", e.truncated === true && e.text === null);

  // Gemini is media-only by the guard, so each call carries a file part.
  const media = (_stream: boolean) => ({
    contents: [{ parts: [{ fileData: { fileUri: "https://generativelanguage.googleapis.com/v1beta/files/fixture", mimeType: "video/mp4" } }, { text: "read" }] }],
    generationConfig: { maxOutputTokens: 4000, thinkingConfig: { thinkingBudget: 0 } },
  });
  const gctx = { purpose: "media", userId: USER };
  script = [{ content: '{"blocks":[', finish: "length" }];
  const g1 = await S.geminiGenerate(media(false), gctx, "gemini-3.6-flash");
  eq("gemini whole: MAX_TOKENS → truncated", g1.truncated, true);
  script = [{ content: "{}", finish: "stop" }];
  const g2 = await S.geminiGenerate(media(false), gctx, "gemini-3.6-flash");
  check("gemini whole: STOP → no flag", !("truncated" in g2) && g2.text === "{}");
  script = [{ content: '{"blocks":[', finish: "length" }];
  const g3 = await S.geminiStream(media(true), gctx, "s", "u", () => {});
  eq("gemini stream: MAX_TOKENS → truncated", g3.truncated, true);
  script = [{ content: "{}", finish: "stop" }];
  const g4 = await S.geminiStream(media(true), gctx, "s", "u", () => {});
  check("gemini stream: STOP → no flag", !("truncated" in g4) && g4.text === "{}");
});

// ---------- 9. a goal program must fit in one reply (B.2) ----------
//
// The largest program the prompt allows in practice: 12 weeks, 4 days a week, the goal
// lift prescribed twice a week, two new compact templates. Written to the prompt's
// rules (nulls left out, rx only on the lift's days), it has to leave the model room
// to think under pumpy.max_out; and a build that did not declare "program" must never
// be handed one.
function program12x4() {
  const tpl = (ref: string, title: string, names: string[]) => ({ ref, title, category: "Push", duration_minutes: 60,
    blocks: [{ title: null, type: "straight", exercises: names.map((name, i) => ({ name, sets: i ? 3 : 5, reps: i ? "10" : "5" })) }] });
  const pct = [0.75, 0.775, 0.8, 0.65, 0.8, 0.825, 0.85, 0.7, 0.85, 0.875, 0.9, 1];
  const labels = ["Build", "Build", "Build", "Deload", "Build", "Build", "Heavy", "Deload", "Heavy", "Heavy", "Peak", "Test"];
  const start = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  return {
    kind: "program",
    goal: { type: "lift", title: "Bench 305", exercise: "bench-press", target: 305, unit: "lb", baseline: 287 },
    verdict: "stretch", verdict_note: "305 is a stretch in 12 weeks; we test at the end.",
    templates: [tpl("t1", "Bench Day", ["Bench Press", "Incline Dumbbell Press", "Dumbbell Row", "Lateral Raise", "Tricep Pushdown"]),
      tpl("t2", "Legs and Pull", ["Back Squat", "Romanian Deadlift", "Lat Pulldown", "Leg Curl", "Plank"])],
    weeks: pct.map((p, i) => ({ week: i + 1, label: labels[i], days: [
      { dow: 1, ref: "t1", rx: { exercise: "bench-press", sets: i === 11 ? 1 : 5, reps: i === 11 ? "1" : "5", pct: p, rpe: 8 } },
      { dow: 2, ref: "t2" },
      { dow: 4, ref: "t1", rx: { exercise: "bench-press", sets: 4, reps: "8", pct: Math.round((p - 0.1) * 100) / 100 } },
      { dow: 5, ref: "t2" }] })),
    start, summary: "Twelve weeks, four days a week, building your bench toward 305.",
  };
}
const GOAL_SAY = "It's a stretch in 12 weeks, so we build, deload, peak and test at the end.";
{
  const text = JSON.stringify({ say: GOAL_SAY, tool: null, proposal: program12x4() });
  const est = estTokens(text);
  console.log(`measure  program 12×4 ${text.length} chars · ≈${est} tokens (chars/4 ${Math.ceil(text.length / 4)}, chars/3 ${Math.ceil(text.length / 3)})`);
  check("a 12-week, 4-day program plus low reasoning uses under three-quarters of the cap",
    est + REASONING_ALLOWANCE <= DEFAULTS.maxOut * 0.75, (est + REASONING_ALLOWANCE) + " vs " + DEFAULTS.maxOut);
  const legacy = S.pumpySystem(new Date("2026-09-23T12:00:00Z"), [], "LIBRARY — empty; nothing saved yet.");
  const goals = S.pumpySystem(new Date("2026-09-23T12:00:00Z"), [], "LIBRARY — empty; nothing saved yet.", { goals: true, ask: true });
  check("a build without caps gets no goals prompt", !legacy.includes("GOALS.") && !legacy.includes("get_lift_history"));
  check("a build with caps gets it, inside the static prefix", goals.includes("GOALS.") && goals.includes("get_lift_history") &&
    goals.indexOf("GOALS.") < goals.indexOf("--- CURRENT STATE"));
  check("the goals prompt forbids calorie targets and names the pace cap", /Never set calorie targets/.test(goals) && /1% of body weight and 2 lb/.test(goals));
}
await aiActor.run({ userId: USER, workKey: "validate-program" }, async () => {
  const none: any = await S.validateProposal(USER, program12x4());
  eq("no caps: a program is not a proposal kind", none.error, "unknown proposal kind program");
  const today = new Date().toISOString().slice(0, 10);
  const vctx = { caps: new Set(["ask", "program"]), free: null, unit: "lb", today, answers: [], minor: false, safetyStop: false, bodyWeight: null };
  const p: any = await S.validateProposal(USER, program12x4(), vctx);
  check("with caps it expands: 12 weeks, 48 sessions, two new templates", p.kind === "program" && p.counts?.weeks === 12 &&
    p.counts?.sessions === 48 && p.counts?.new_templates === 2, JSON.stringify(p).slice(0, 300));
  check("the verdict is the server's: 287 → 305 in 12 weeks is a stretch", p.verdict === "stretch" && p.goal?.target === 305);
  check("every new template has an id and its normalized workout", p.templates?.every((t: any) => t.new && /^[0-9a-f-]{36}$/.test(t.workout_id) && t.create?.blocks?.length));
  const free: any = await S.validateProposal(USER, combine(1, 3, "compact"), { ...vctx, free: THREAD });
  check("in Basic's free conversation only a program can be proposed", String(free.error ?? "").includes("only a program"));
});
{
  // The whole turn: streamed, one call, the program arrives, and the prompt carried GOALS.
  script = [{ content: JSON.stringify({ say: GOAL_SAY, tool: null, proposal: program12x4() }), finish: "stop" }];
  bodies.length = 0; inserted.length = 0; log = [];
  const cfg = S.buildPumpyCfg({});
  const meter = { plan: "plus", day: 400, month: 5000, totals: { day: 0, month: 0, minute: 0 }, profile: { settings: { unit: "lb", tz: "America/Chicago" } } };
  const sink = { send(ev: any) { log.push(ev); }, dead: false };
  console.log = () => {};
  let res: any;
  try {
    res = await aiActor.run({ userId: USER, workKey: crypto.randomUUID(), deadline: Date.now() + 60_000 }, () =>
      S.pumpyRun({ userId: USER, thread: { id: THREAD }, userMsg: { id: 901 }, message: "Get my bench to 305", refs: [], meter, cfg,
        caps: new Set(["ask", "program"]), free: null }, sink as any));
  } finally { console.log = realLog; }
  const msg = inserted.filter((x) => x.table === "pumpy_messages" && x.row.role === "assistant").map((x) => x.row)[0];
  check("one model call, no retry", bodies.length === 1, String(bodies.length));
  check("the program arrived as the pending proposal", !!res?.pending && msg?.meta?.proposal?.kind === "program");
  check("the call carried the goals prompt", String(bodies[0]?.messages?.[0]?.content ?? "").includes("GOALS."));
  check("the say streamed", log.some((e) => e.t === "delta"));

  // An ask card, drawn by a build that declared it; spoken to one that did not.
  const askReply = JSON.stringify({ say: "A few details first:", ask: { fields: [
    { id: "days", label: "Days a week", type: "choice", options: ["3", "4"], value: "4" },
    { id: "adult", label: "Are you 18 or older?", type: "choice", options: ["Yes", "No"], value: "Yes" }], submit: "Build my plan" }, tool: null, proposal: null });
  for (const withAsk of [true, false]) {
    script = [{ content: askReply, finish: "stop" }];
    bodies.length = 0; inserted.length = 0; log = [];
    console.log = () => {};
    try {
      await aiActor.run({ userId: USER, workKey: crypto.randomUUID(), deadline: Date.now() + 60_000 }, () =>
        S.pumpyRun({ userId: USER, thread: { id: THREAD }, userMsg: { id: 902 }, message: "Help me lose 10 lb", refs: [], meter, cfg,
          caps: new Set(withAsk ? ["ask", "program"] : ["program"]), free: null }, null));
    } finally { console.log = realLog; }
    const m = inserted.filter((x) => x.table === "pumpy_messages" && x.row.role === "assistant").map((x) => x.row)[0];
    if (withAsk) {
      check("caps ask: the card rides on the message, the 18+ question unanswered", m?.meta?.ask?.fields?.length === 2 &&
        m.meta.ask.fields[1].value === undefined, JSON.stringify(m?.meta));
    } else {
      check("no ask cap: the questions are said instead", !m?.meta?.ask && /To build it I need a few things: days a week, are you 18 or older/.test(m?.content ?? ""), m?.content);
    }
  }
}

globalThis.fetch = realFetch;
console.warn = realWarn;
console.log((failures ? "FAILED " : "ok ") + (checks - failures) + "/" + checks + " checks — mocked OpenAI and database, no paid calls");
Deno.exit(failures ? 1 : 0);

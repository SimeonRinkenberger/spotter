// Battery for the streaming half of the coach — the pieces whose bugs would be
// invisible until somebody watched a wrong word appear on their phone.
// Run: deno run --allow-env tools/stream-harness.ts   — exits non-zero on failure.
//
//   1. The `say` scanner. The model answers with a JSON object and only ONE field
//      of it may ever be shown, so `say` is decoded out of a string that is still
//      arriving. Every case here is fed at EVERY possible split point, because the
//      network chooses the split points and a scanner that only works on whole
//      chunks works right up until it does not: escapes cut in half, a surrogate
//      pair cut in half, `say` arriving after `tool`, `say` never arriving at all.
//   2. The retraction rule. pumpyClean drops a sentence that names a condition,
//      and it can do that because it has the whole sentence. A stream does not —
//      "that sounds" is innocent and "that sounds like tendinitis" is not. The
//      invariant asserted here is the one that matters: at NO point during the
//      stream may the visible text contain a sentence the final answer would drop.
//   3. The four SSE adapters, against recorded fixtures with fetch mocked. Each
//      provider puts its usage somewhere different and on a different chunk, and
//      a turn charged on approxTokens instead of the provider's own numbers is a
//      ledger that quietly drifts away from the invoice.
//   4. The NDJSON framing: one JSON object per line, and the last line is the
//      whole body the non-streaming route would have returned.
//
// index.ts is an entrypoint, not a library — it calls Deno.serve at the bottom.
// Stubbing that before the import is what lets the harness read the module
// without binding a port or asking for net permission.

Deno.env.set("SUPABASE_URL", "https://harness.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "harness-not-a-jwt");
Deno.env.set("OPENAI_API_KEY", "harness-openai");
Deno.env.set("ANTHROPIC_API_KEY", "harness-anthropic");
Deno.env.set("GEMINI_API_KEY", "harness-gemini");
Deno.env.set("GROQ_API_KEY", "harness-groq");

const realFetch = globalThis.fetch;
(Deno as unknown as { serve: unknown }).serve = () => ({
  finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {},
  addr: { transport: "tcp", hostname: "127.0.0.1", port: 0 },
});

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

// ---------- 1. the say scanner ----------

/** Feed `raw` in two pieces split at `at`, and give back everything the scanner said. */
function scanSplit(raw: string, at: number): string {
  const sc = S.makeSayScanner();
  return sc.push(raw.slice(0, at)) + sc.push(raw.slice(at));
}

/** Feed `raw` one character at a time — the worst case the network can produce. */
function scanByChar(raw: string): string {
  const sc = S.makeSayScanner();
  let out = "";
  for (const ch of raw) out += sc.push(ch);
  return out;
}

/** Every split point, plus character-by-character, must all agree. */
function scanCase(name: string, raw: string, want: string) {
  let bad = -1;
  for (let i = 0; i <= raw.length; i++) if (scanSplit(raw, i) !== want) { bad = i; break; }
  check(name + " — every split point", bad < 0,
    bad < 0 ? "" : "split " + bad + " gave " + JSON.stringify(scanSplit(raw, bad)) +
      ", wanted " + JSON.stringify(want));
  eq(name + " — one character at a time", scanByChar(raw), want);
}

scanCase(
  "plain say",
  '{"say":"Nice one. Let us build a push day.","tool":null,"proposal":null}',
  "Nice one. Let us build a push day.",
);

// A quote, a newline and a backslash, each of which is two characters on the wire
// and can be cut between them.
scanCase(
  "escapes",
  '{"say":"He said \\"go\\" and\\nthen\\\\left.\\tOk","tool":null}',
  'He said "go" and\nthen\\left.\tOk',
);

// é is one code unit; the flexed bicep is a surrogate PAIR written as two
// separate escapes, so half of it must never be emitted on its own.
scanCase(
  "unicode and a surrogate pair",
  '{"say":"Strong \\u00e9lan \\ud83d\\udcaa done","tool":null}',
  "Strong élan 💪 done",
);

scanCase(
  "say after tool",
  '{"tool":{"name":"get_workout","args":{"id":"h3f9a1c"}},"say":"Reading that one."}',
  "Reading that one.",
);

// "say" as a VALUE rather than a key must not start the scanner: the key form is
// the one followed by a colon and a quote.
scanCase(
  "a tool named say is not the say key",
  '{"tool":{"name":"say"},"say":"The real one."}',
  "The real one.",
);

scanCase("say missing entirely", '{"tool":{"name":"list_library","args":{}},"proposal":null}', "");
scanCase("say is null", '{"say":null,"tool":{"name":"get_plan","args":{}}}', "");
scanCase("empty say", '{"say":"","tool":{"name":"get_plan","args":{}}}', "");

// A stream that stops mid-object still hands back every word it managed to read.
scanCase("truncated mid-string", '{"say":"Half a senten', "Half a senten");

// An escape that has not finished arriving must be held, not guessed at.
scanCase("truncated mid-escape", '{"say":"one\\', "one");
scanCase("truncated mid-unicode-escape", '{"say":"two \\u00e', "two ");

{
  const sc = S.makeSayScanner();
  sc.push('{"say":"done."');
  check("the scanner closes on the unescaped quote", sc.done());
  eq("nothing is read past the close", sc.push(',"tool":{"name":"get_plan"}}'), "");
}
{
  const sc = S.makeSayScanner();
  sc.push('{"say":"still going');
  check("an unclosed string is not done", !sc.done());
}
{
  // A lone high surrogate is held back until its partner arrives; it is never
  // emitted on its own, because half a character is not a character.
  const sc = S.makeSayScanner();
  const first = sc.push('{"say":"hi \\ud83d');
  eq("half a surrogate pair is withheld", first, "hi ");
  eq("the pair completes on the next chunk", sc.push('\\udcaa!"}'), "💪!");
}

// ---------- 2. the retraction rule ----------

const DIAG = /\b(tendinitis|tendonitis|tendinopathy|bursitis|impingement|arthritis|torn|tear\b|fracture|herniat|sciatica|labral|labrum|dislocat|you (probably|likely|may|might|could) have|sounds like|diagnos)/i;

/**
 * The client, in six lines: apply the events to a string exactly as the browser
 * does, and check the safety invariant after every single one of them.
 */
function playGate(say: string, chunk: number): { seen: string; worst: string | null } {
  const gate = S.makeSayGate(1200);
  let seen = "";
  let worst: string | null = null;
  for (let i = 0; i < say.length; i += chunk) {
    for (const ev of gate.push(say.slice(i, i + chunk))) {
      if (ev.t === "retract") seen = seen.slice(0, seen.length - (ev.chars as number));
      else if (ev.t === "delta") seen += ev.text as string;
      if (worst === null && DIAG.test(seen)) worst = seen;
    }
  }
  check("the gate's own count matches what the client is showing (chunk " + chunk + ")",
    gate.shown() === seen.length, gate.shown() + " vs " + seen.length);
  return { seen, worst };
}

const DIAGNOSTIC_SAY =
  "Here is what I would do. That sounds like tendinitis to me. " +
  "Ease the load and range on it, and build the shoulder up slowly.";
const CLEAN_TAIL = "Here is what I would do. Ease the load and range on it, and build the shoulder up slowly.";

for (const chunk of [1, 2, 3, 5, 11, 40, 400]) {
  const { seen, worst } = playGate(DIAGNOSTIC_SAY, chunk);
  check("no diagnostic sentence is ever visible (chunk " + chunk + ")", worst === null,
    worst === null ? "" : JSON.stringify(worst));
  eq("the diagnostic sentence is gone by the end (chunk " + chunk + ")",
    seen.replace(/\s+/g, " ").trim(), CLEAN_TAIL);
}

// The same answer, cleaned the way the final body cleans it. The streamed text and
// the final text must agree, or the bubble would visibly rewrite itself at the end.
{
  const { seen } = playGate(DIAGNOSTIC_SAY, 3);
  eq("the streamed text matches what the final answer keeps",
    seen.replace(/\s+/g, " ").trim(), CLEAN_TAIL);
}

// A diagnosis in the FIRST sentence: nothing has been shown before it, so there is
// nothing to take back — the gate must simply say nothing until the sentence ends.
{
  const gate = S.makeSayGate(1200);
  const evs = gate.push("You probably have bursitis. Try this instead.");
  const text = evs.filter((e) => e.t === "delta").map((e) => e.text).join("");
  eq("a diagnosis in the first sentence is never sent", text.trim(), "Try this instead.");
  eq("and nothing is retracted, because nothing was shown",
    evs.filter((e) => e.t === "retract").length, 0);
}

// Retraction across a chunk boundary: the words were sent in an earlier event, so
// this is the case that actually needs a retract to exist at all.
{
  const gate = S.makeSayGate(1200);
  const a = gate.push("That sounds ");
  const b = gate.push("like tendinitis. Fine otherwise.");
  eq("the innocent-looking start is sent", a, [{ t: "delta", text: "That sounds " }]);
  check("the retract comes before the next delta", b[0]?.t === "retract");
  eq("it takes back exactly what was shown", b[0]?.chars, "That sounds ".length);
  eq("and the next sentence carries on", b[1], { t: "delta", text: " Fine otherwise." });
}

// A clean answer costs nothing: no retracts, and every character arrives.
{
  const { seen, worst } = playGate("Three rounds. Rest ninety seconds between them.", 4);
  eq("a clean answer arrives whole", seen, "Three rounds. Rest ninety seconds between them.");
  check("and is never blocked", worst === null);
}

// Past the cap the final answer slices at, the gate stops: showing more would only
// be text that vanishes when `final` lands.
{
  const gate = S.makeSayGate(10);
  let seen = "";
  for (const ev of gate.push("abcdefghijklmnopqrstuvwxyz")) if (ev.t === "delta") seen += ev.text;
  eq("the gate stops at its limit", seen, "abcdefghij");
}

// ---------- 3. the four SSE adapters ----------

/** A body delivered in awkward pieces, cutting lines and UTF-8 characters in half. */
function chunkedBody(text: string, size: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= bytes.length) { c.close(); return; }
      c.enqueue(bytes.slice(i, i + size));
      i += size;
    },
  });
}

/** Every provider call answers from `routes`; everything else (the ledger) is a quiet ok. */
function mockFetch(routes: { match: string; body: string; status?: number }[], size = 7) {
  const seen: { url: string; body: any }[] = [];
  globalThis.fetch = ((input: any, init?: any) => {
    const url = String(input);
    const hit = routes.find((r) => url.includes(r.match));
    if (!hit) return Promise.resolve(new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
    seen.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (hit.status && hit.status >= 400) return Promise.resolve(new Response("nope", { status: hit.status }));
    return Promise.resolve(new Response(chunkedBody(hit.body, size), {
      status: 200, headers: { "content-type": "text/event-stream" },
    }));
  }) as typeof fetch;
  return seen;
}

const CTX = { purpose: "chat", userId: null, maxOut: 1500 };

// -- OpenAI: usage rides a final chunk whose `choices` is empty.
{
  const sse = [
    'data: {"choices":[{"delta":{"role":"assistant"}}]}',
    'data: {"choices":[{"delta":{"content":"Three "}}]}',
    'data: {"choices":[{"delta":{"content":"rounds."}}]}',
    'data: {"choices":[],"usage":{"prompt_tokens":1200,"completion_tokens":40,"prompt_tokens_details":{"cached_tokens":1024}}}',
    "data: [DONE]", "",
  ].join("\n\n");
  const seen = mockFetch([{ match: "api.openai.com", body: sse }]);
  const got: string[] = [];
  const gen = await S.openaiStream("sys", "usr", true, CTX, (t) => got.push(t));
  eq("openai deltas arrive in order", got, ["Three ", "rounds."]);
  eq("openai text is the whole answer", gen.text, "Three rounds.");
  eq("openai usage comes from the provider", [gen.usage?.inTok, gen.usage?.outTok, gen.usage?.cachedTok], [1200, 40, 1024]);
  check("openai asked for the usage chunk", seen[0]?.body?.stream === true && seen[0]?.body?.stream_options?.include_usage === true);
  check("openai names the model it used", String(gen.by).startsWith("openai:"));
}
{
  const sse = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n';
  mockFetch([{ match: "api.openai.com", body: sse }]);
  const gen = await S.openaiStream("sys", "usr", true, CTX, () => {});
  eq("openai falls back to approxTokens when no usage arrives",
    [gen.usage?.inTok, gen.usage?.outTok], [Math.ceil("sysusr".length / 4), 1]);
}
{
  mockFetch([{ match: "api.openai.com", body: "", status: 500 }]);
  const gen = await S.openaiStream("sys", "usr", true, CTX, () => {});
  eq("a refused openai stream hands the ladder nothing", gen.text, null);
}

// -- Anthropic: input usage on message_start, output usage on message_delta.
{
  const sse = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":900,"cache_read_input_tokens":100,"cache_creation_input_tokens":20}}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Nice "}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"one."}}',
    'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":55}}',
    'event: message_stop\ndata: {"type":"message_stop"}', "",
  ].join("\n\n");
  mockFetch([{ match: "api.anthropic.com", body: sse }]);
  const got: string[] = [];
  const gen = await S.claudeStream("sys", "usr", CTX, (t) => got.push(t));
  eq("anthropic deltas arrive in order", got, ["Nice ", "one."]);
  eq("anthropic folds cache reads and writes into inTok", gen.usage?.inTok, 1020);
  eq("anthropic reports the cached subset", gen.usage?.cachedTok, 100);
  eq("anthropic output tokens come off message_delta", gen.usage?.outTok, 55);
}

// -- Gemini: text under candidates[0].content.parts[], usage on the last chunk.
{
  const sse = [
    'data: {"candidates":[{"content":{"parts":[{"text":"Try "}]}}]}',
    'data: {"candidates":[{"content":{"parts":[{"text":"goblet squats."}]}}],"usageMetadata":{"promptTokenCount":800,"candidatesTokenCount":30,"thoughtsTokenCount":12}}',
    "",
  ].join("\n\n");
  const seen = mockFetch([{ match: "generativelanguage.googleapis.com", body: sse }]);
  const got: string[] = [];
  const gen = await S.geminiStream(
    { systemInstruction: { parts: [{ text: "sys" }] }, contents: [], generationConfig: { thinkingConfig: { thinkingBudget: 0 } } },
    CTX, "sys", "usr", (t) => got.push(t),
  );
  eq("gemini deltas arrive in order", got, ["Try ", "goblet squats."]);
  check("gemini asked the streaming endpoint", seen[0]?.url.includes(":streamGenerateContent?alt=sse"), seen[0]?.url);
  eq("gemini bills thinking tokens as output too", gen.usage?.outTok, 42);
  eq("gemini prompt tokens", gen.usage?.inTok, 800);
}
{
  // The older models reject thinkingConfig outright; the adapter drops it and asks
  // that same model again rather than rotating away from it.
  let call = 0;
  globalThis.fetch = ((input: any, init?: any) => {
    const url = String(input);
    if (!url.includes("generativelanguage")) return Promise.resolve(new Response("[]", { status: 200 }));
    call++;
    if (call === 1) return Promise.resolve(new Response("thinkingConfig unsupported", { status: 400 }));
    const body = JSON.parse(String(init.body));
    check("the retry has no thinkingConfig", !("thinkingConfig" in (body.generationConfig ?? {})));
    return Promise.resolve(new Response(
      chunkedBody('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n', 9),
      { status: 200 },
    ));
  }) as typeof fetch;
  const gen = await S.geminiStream(
    { systemInstruction: { parts: [{ text: "s" }] }, contents: [], generationConfig: { thinkingConfig: { thinkingBudget: 0 } } },
    CTX, "s", "u", () => {},
  );
  eq("gemini retries the same model without thinkingConfig", gen.text, "ok");
}

// -- Groq: OpenAI's shape, usage under x_groq on the final chunk.
{
  const sse = [
    'data: {"choices":[{"delta":{"content":"Kettlebell "}}]}',
    'data: {"choices":[{"delta":{"content":"swings."}}],"x_groq":{"usage":{"prompt_tokens":600,"completion_tokens":25}}}',
    "data: [DONE]", "",
  ].join("\n\n");
  mockFetch([{ match: "api.groq.com", body: sse }]);
  const got: string[] = [];
  const gen = await S.groqStream("sys", "usr", true, CTX, (t) => got.push(t));
  eq("groq deltas arrive in order", got, ["Kettlebell ", "swings."]);
  eq("groq usage is read from x_groq", [gen.usage?.inTok, gen.usage?.outTok], [600, 25]);
}
{
  // A model that is gone rotates to the next in the pool rather than failing the turn.
  let call = 0;
  globalThis.fetch = ((input: any) => {
    const url = String(input);
    if (!url.includes("api.groq.com")) return Promise.resolve(new Response("[]", { status: 200 }));
    call++;
    if (call === 1) return Promise.resolve(new Response("decommissioned", { status: 404 }));
    return Promise.resolve(new Response(
      chunkedBody('data: {"choices":[{"delta":{"content":"second"}}]}\n\n', 5), { status: 200 },
    ));
  }) as typeof fetch;
  const gen = await S.groqStream("sys", "usr", true, CTX, () => {});
  eq("groq rotates past a decommissioned model", gen.text, "second");
}

// -- the line splitter itself, with UTF-8 cut in half.
{
  const text = "data: {\"a\":\"héllo 💪\"}\r\ndata: {\"b\":2}\n\ndata: [DONE]\n";
  const got: any[] = [];
  for await (const o of S.sseObjects(chunkedBody(text, 3))) got.push(o);
  eq("multi-byte characters survive the chunk boundaries", got, [{ a: "héllo 💪" }, { b: 2 }]);
}
{
  const got: string[] = [];
  for await (const l of S.streamLines(chunkedBody("one\ntwo\nthree", 2))) got.push(l);
  eq("a body with no trailing newline still yields its last line", got, ["one", "two", "three"]);
}

globalThis.fetch = realFetch;

// ---------- 4. the NDJSON framing ----------

{
  const res = S.ndjsonResponse({ "Access-Control-Allow-Origin": "*" }, async (sink) => {
    sink.send({ t: "status", text: "Looking through your library…" });
    sink.send({ t: "delta", text: "Three\nrounds." });
    sink.send({ t: "retract", chars: 6 });
  });
  eq("the content type says ndjson", res.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
  eq("nothing in front of it may buffer", res.headers.get("x-accel-buffering"), "no");
  eq("the cors header rides along", res.headers.get("access-control-allow-origin"), "*");
  const body = await res.text();
  const lines = body.split("\n").filter(Boolean);
  eq("one line per event", lines.length, 3);
  eq("a newline inside an event does not become a frame boundary",
    JSON.parse(lines[1]).text, "Three\nrounds.");
  eq("the body ends with a newline, so no line is left half-written", body.endsWith("\n"), true);
}
{
  // The last line is the whole body the non-streaming route would have returned.
  const final = { status: "ok", thread_id: "t1", messages: [{ id: 2, content: "Done." }], pending: null };
  const res = S.ndjsonResponse({}, async (sink) => {
    sink.send({ t: "delta", text: "Done." });
    sink.send({ t: "final", ...final });
  });
  const lines = (await res.text()).split("\n").filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  eq("final is last", last.t, "final");
  delete last.t;
  eq("and final IS today's body", last, final);
}
{
  // A user who closes the tab cancels the stream. Writing into it must not throw,
  // because the turn still has database rows to finish writing.
  let threw: unknown = null;
  const res = S.ndjsonResponse({}, async (sink) => {
    await new Promise((r) => setTimeout(r, 10));
    try { for (let i = 0; i < 50; i++) sink.send({ t: "delta", text: "x" }); }
    catch (e) { threw = e; }
  });
  await res.body!.cancel();
  await new Promise((r) => setTimeout(r, 60));
  check("writing to a cancelled stream does not throw", threw === null, String(threw));
}

// ---------- 5. the tool status lines ----------

{
  const names = ["list_library", "get_workout", "search_catalog", "get_plan", "get_logs_summary"];
  const missing = names.filter((n) => !S.PUMPY_TOOL_STATUS[n]);
  eq("every tool has a line the user can read", missing, []);
  check("and none of them says 'loading'",
    names.every((n) => !/loading|please wait/i.test(S.PUMPY_TOOL_STATUS[n])));
}

console.log((failures ? "FAILED " : "ok ") + (checks - failures) + "/" + checks + " checks");
Deno.exit(failures ? 1 : 0);

// No model the code can call is ever charged at $0 for tokens it used.
//
//   deno run --allow-read tools/ai-price-check.ts
//
// Every model name the function, its modules or a migration's app_config seed
// can name is collected from source. Each one must be either:
//   - priced, with a positive input and output rate, and a guarded call to it
//     that reports non-zero usage must settle a positive charge — on both the
//     reservation path (ai-guard.ts createGuardedFetch) and the ledger path
//     (index.ts estimateCost, what ai_cost_log's est_cost_usd is); or
//   - refused by the guard before any request leaves (unknown_price /
//     unpriced_provider / gemini_media_only), so it cannot run up a bill that is
//     recorded as nothing.
//
// Why: 37 Gemini vision rows (and a handful of chat/swap/video ones) sit in
// ai_cost_log at $0 with real token counts, all written 2026-09-01..08 by the
// ledger's first price table, which read a missing provider price as [0, 0, 0].
// The guard that replaced it (e37a8eb, 2026-09-08) throws on an unknown model;
// this keeps it that way.
import { aiActor, createGuardedFetch, GuardError, tokenCost, tokenPrice } from "../supabase/functions/spotter/ai-guard.ts";

const failures: string[] = [];
let passed = 0;
function check(ok: unknown, what: string) {
  if (ok) passed++;
  else { failures.push(what); console.error("FAIL " + what); }
}

// ---------- every model name the code can reach ----------
const root = new URL("../", import.meta.url);
const read = (p: string) => Deno.readTextFileSync(new URL(p, root));
const sources = ["index.ts", "pack.ts", "vision-reader.ts", "ai-guard.ts", "pumpy-combine.ts"]
  .map((f) => read("supabase/functions/spotter/" + f));
for (const e of Deno.readDirSync(new URL("supabase/migrations/", root))) {
  if (e.name.endsWith(".sql")) sources.push(read("supabase/migrations/" + e.name));
}
const MODEL_RE = /["'](gpt-[a-z0-9.-]+|gemini-[a-z0-9.-]+|claude-[a-z0-9.-]+|whisper-[a-z0-9.-]+|o[0-9]-[a-z0-9.-]+|openai\/[a-z0-9.-]+)["']/g;
// Probe-route kind labels, not models (index.ts handleWorkerProbe).
const NOT_MODELS = new Set(["gemini-files", "gemini-video", "gemini-youtube"]);
const models = new Set<string>();
for (const s of sources) {
  for (const m of s.matchAll(MODEL_RE)) if (!NOT_MODELS.has(m[1])) models.add(m[1]);
  // app_config pools are comma lists inside one string.
  for (const m of s.matchAll(/'model\.gemini_pool'\s*,\s*'([^']+)'/g)) for (const x of m[1].split(",")) models.add(x.trim());
}
check(models.size >= 6, "found " + models.size + " model names in source: " + [...models].sort().join(", "));
for (const must of ["gpt-6-luna", "gemini-3.6-flash", "gemini-flash-latest", "claude-haiku-4-5-20251001"]) {
  check(models.has(must), "the inventory includes " + must);
}

// ---------- the ledger path: index.ts estimateCost as it runs ----------
const index = sources[0];
function slice(name: string): string {
  const at = index.search(new RegExp("^function " + name + "\\(", "m"));
  if (at < 0) throw new Error(name + " not found");
  return index.slice(at, index.indexOf("\n}", at) + 2);
}
const ledger = await import("data:application/typescript," + encodeURIComponent(
  `import { GuardError, tokenCost } from ${JSON.stringify(new URL("supabase/functions/spotter/ai-guard.ts", root).href)};
   type Usage = { inTok: number; outTok: number; cachedTok?: number; usd?: number };
   ${slice("estimateCost")}
   ${slice("cachedPart")}
   export { estimateCost };`)) as { estimateCost: (p: string, u: { inTok: number; outTok: number; cachedTok?: number }, m?: string) => number };

// ---------- the reservation path: a guarded call with stubbed provider ----------
function providerOf(model: string): "openai" | "gemini" | "anthropic" | "other" {
  if (/^(gpt-|o[0-9]-)/.test(model)) return "openai";
  if (model.startsWith("gemini-")) return "gemini";
  if (model.startsWith("claude-")) return "anthropic";
  return "other";
}
async function guardedCall(model: string): Promise<{ settled: number | null; refused: string | null; requests: number }> {
  let settled: number | null = null, requests = 0;
  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (name === "ai_reserve") return "ok";
    if (name === "ai_record_attempt") { if (args.p_final) settled = args.p_usd as number | null; return true; }
    throw new Error("rpc " + name);
  };
  const native = (async (input: string | URL | Request) => {
    requests++;
    const url = String(input);
    if (url.endsWith(":countTokens")) return Response.json({ totalTokens: 1000 });
    if (url.includes("openai.com")) {
      return Response.json({ model, choices: [{ finish_reason: "stop", message: { content: "{}" } }],
        usage: { prompt_tokens: 1200, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 0 } } });
    }
    return Response.json({ modelVersion: model, candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{}" }] } }],
      usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300 } });
  }) as typeof fetch;
  const guarded = createGuardedFetch(rpc, native);
  const kind = providerOf(model);
  const [url, body] = kind === "openai"
    ? ["https://api.openai.com/v1/chat/completions", { model, max_completion_tokens: 500, messages: [{ role: "user", content: "hi" }] }]
    : kind === "gemini"
    ? ["https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: "image/jpeg", data: "AAAA" } }, { text: "read" }] }],
      generationConfig: { maxOutputTokens: 500 } }]
    : kind === "anthropic"
    ? ["https://api.anthropic.com/v1/messages", { model, max_tokens: 500, messages: [{ role: "user", content: "hi" }] }]
    : ["https://api.groq.com/openai/v1/chat/completions", { model, max_tokens: 500, messages: [] }];
  try {
    await aiActor.run({ userId: null, workKey: "price-check:" + model, purpose: "pack" }, async () => {
      const r = await guarded(url as string, { method: "POST", body: JSON.stringify(body) });
      await r.text();
    });
    return { settled, refused: null, requests };
  } catch (e) {
    return { settled, refused: e instanceof GuardError ? e.reason : String(e), requests };
  }
}

for (const model of [...models].sort()) {
  const price = tokenPrice(model);
  const call = await guardedCall(model);
  if (price) {
    check(price[0] > 0 && price[1] > 0 && price[2] >= 0, model + ": priced with positive input and output rates (" + price.join("/") + ")");
    check(tokenCost(model, 1000, 1000) > 0, model + ": 1,000 in + 1,000 out costs more than $0");
    let est = 0;
    try { est = ledger.estimateCost(providerOf(model), { inTok: 1200, outTok: 300 }, model); } catch { est = -1; }
    check(est > 0, model + ": the ledger (ai_cost_log est_cost_usd) records " + est + " for 1,200 in / 300 out");
    if (call.refused) {
      // Priced but refused on this route is fine (e.g. a text call to Gemini);
      // what matters is that nothing was sent for free.
      check(call.requests === 0 || call.settled === null || (call.settled ?? 0) > 0,
        model + ": refused (" + call.refused + ") without a free request");
    } else {
      check((call.settled ?? 0) > 0, model + ": a guarded call reporting 1,200 in / 300 out settles " + call.settled + " (> $0)");
    }
  } else {
    check(call.refused !== null && call.requests === 0,
      model + ": unpriced, so the guard refuses it before any request (" + (call.refused ?? "NOT refused, " + call.requests + " requests, settled " + call.settled) + ")");
    let threw = false;
    try { ledger.estimateCost(providerOf(model), { inTok: 1200, outTok: 300 }, model); } catch (e) { threw = e instanceof GuardError; }
    check(threw, model + ": and the ledger refuses to price it rather than write $0");
  }
}

if (failures.length) {
  console.error("\n" + failures.length + " of " + (failures.length + passed) + " AI price checks FAILED");
  Deno.exit(1);
}
console.log("PASS " + passed + " AI price checks over " + models.size + " model names: every callable model is priced above $0 on both the reservation and the ledger path, every unpriced one is refused before a request.");

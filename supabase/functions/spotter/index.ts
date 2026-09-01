// Spotter — save a fitness video, get a structured workout.
// One function under /functions/v1/spotter:
//   GET  /                          the web app (HTML)
//   GET  /icon.png  /manifest.webmanifest
//   POST /api/ingest                { url } — Bearer token OR per-user ingest key (iOS Shortcut)
//   POST /api/workouts/:id/reprocess re-run extraction on a saved workout
//   POST /api/explain               form coaching for one exercise
//   POST /api/swap                  substitute exercises
//   POST /api/rotate-key            new ingest key
//   GET  /api/limits                today's counts, and the spend ceiling
//   POST /api/worker/tick           drain the ingest queue (shared secret, not a user)
//
// Ingest is asynchronous: it enqueues and returns in ~200ms, and the worker fills
// the row in afterwards. The browser watches its own workouts row over Realtime.
// Everything else (listing, editing, logs, plan) goes straight to PostgREST from
// the browser under RLS — this function only holds what needs secrets.

import { PAGE_HTML } from "./page.ts";
import { ICON_B64 } from "./icon.ts";
import { canonicalize } from "./catalog.ts";
import { assertPublicUrl, dnsAvailable, safeFetch } from "./net.ts";

// Whether the DNS half of the SSRF guard is live here. The static checks always
// run; Deno.resolveDns is not present in every Deno-compatible runtime, and the
// difference decides whether a public hostname pointing at a private A record is
// caught. Logged once at cold start so it is answerable from the function logs.
console.log("ssrf guard: static checks on, dns resolution", dnsAvailable() ? "on" : "UNAVAILABLE");

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const CLAUDE_MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-haiku-4-5-20251001";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.6-flash";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";

// Per-user daily caps. Cache hits cost nothing, so they get the looser cap.
// LIMIT_EXTRACT covers everything that runs the extraction ladder — a new save AND
// a reprocess, which re-runs the whole thing and was previously counted by nothing.
// LIMIT_HELPER is the looser ceiling for /api/explain and /api/swap: one short
// completion each, far cheaper than an extraction, but not free and not unmetered.
const LIMIT_EXTRACT = Number(Deno.env.get("LIMIT_EXTRACT") ?? "60");
const LIMIT_SAVES = Number(Deno.env.get("LIMIT_SAVES") ?? "200");
const LIMIT_HELPER = Number(Deno.env.get("LIMIT_HELPER") ?? "300");

// ---------- the money ceiling ----------
//
// The extraction chain already falls through on failure. Nothing falls through on
// cost, which is the failure that does not announce itself: every individual call
// succeeds, and the bill is the only thing that changes. Past this many estimated
// dollars in a UTC day, paid providers are switched off and extraction runs on the
// free path — a thinner card, never a failed save.
const DAILY_SPEND_USD = Number(Deno.env.get("DAILY_SPEND_USD") ?? "5");

// USD per 1,000,000 tokens, [input, output]. A provider priced at zero is a free
// tier: it is never gated by the ceiling, and it is what the ceiling falls back to.
// Env-overridable because prices change and a key can move off a free tier without
// a single line of this file changing.
const PRICES: Record<string, [number, number]> = {
  openai: [Number(Deno.env.get("PRICE_OPENAI_IN") ?? "0.20"), Number(Deno.env.get("PRICE_OPENAI_OUT") ?? "1.20")],
  anthropic: [Number(Deno.env.get("PRICE_ANTHROPIC_IN") ?? "1.00"), Number(Deno.env.get("PRICE_ANTHROPIC_OUT") ?? "5.00")],
  gemini: [Number(Deno.env.get("PRICE_GEMINI_IN") ?? "0"), Number(Deno.env.get("PRICE_GEMINI_OUT") ?? "0")],
  groq: [Number(Deno.env.get("PRICE_GROQ_IN") ?? "0"), Number(Deno.env.get("PRICE_GROQ_OUT") ?? "0")],
};

// ---------- background worker ----------

const WORKER_SECRET = Deno.env.get("WORKER_SECRET") ?? "";
const WORKER_BATCH = Number(Deno.env.get("WORKER_BATCH") ?? "4");
// How long a claimed job may sit untouched before it is assumed its worker died.
const WORKER_STALE_SECONDS = Number(Deno.env.get("WORKER_STALE_SECONDS") ?? "300");
const SELF_URL = `${SUPABASE_URL}/functions/v1/spotter`;
const WORKER_ID = crypto.randomUUID().slice(0, 8);

// Bump when the extraction prompt changes materially: cached cards below this
// version are treated as a miss and re-extracted.
// 5: every exercise carries canonical_id, and muscle_groups/equipment are derived
//    from the catalog whenever the exercises map to it.
const CARD_V = 5;

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://simeonrinkenberger.github.io,http://localhost:8000,http://127.0.0.1:8000")
  .split(",").map((s) => s.trim()).filter(Boolean);

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

const CATEGORIES = [
  "Push", "Pull", "Legs", "Upper Body", "Full Body",
  "Core", "Cardio", "HIIT", "Mobility", "Yoga", "Other",
];
const MUSCLES = [
  "chest", "back", "shoulders", "biceps", "triceps", "forearms",
  "core", "glutes", "quads", "hamstrings", "calves", "full body",
];
const EQUIPMENT = [
  "dumbbells", "barbell", "kettlebell", "resistance bands", "pull-up bar",
  "bench", "cables", "machine", "medicine ball", "jump rope", "box", "other",
];
const BLOCK_TYPES = ["straight", "superset", "circuit", "warmup", "cooldown", "amrap", "emom"];
const DIFFICULTIES = ["beginner", "intermediate", "advanced"];

type Cors = Record<string, string>;

function corsFor(req: Request): Cors {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-key",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status = 200, cors: Cors = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8" },
  });
}

// ---------- background work ----------
//
// The whole point of the queue is that a request returns before the work does, so
// something has to keep the isolate alive after the response has been written.
// Supabase's edge runtime provides EdgeRuntime.waitUntil for exactly this; probe
// once so a runtime without it degrades to running the work inline rather than
// having it silently truncated.
type WaitUntil = { waitUntil?: (p: Promise<unknown>) => void };
let waitUntilProbe: boolean | null = null;

function hasWaitUntil(): boolean {
  if (waitUntilProbe === null) {
    const er = (globalThis as { EdgeRuntime?: WaitUntil }).EdgeRuntime;
    waitUntilProbe = typeof er?.waitUntil === "function";
  }
  return waitUntilProbe;
}

/**
 * Promise.all, but every rejection is observed. With a plain Promise.all the first
 * rejection is thrown and the rest become unhandled rejections, which in Deno can
 * take the whole isolate down — and these run in batches of independent database
 * reads where more than one failing at once is the normal shape of an outage.
 */
async function settledAll<T>(ps: Promise<T>[]): Promise<T[]> {
  const rs = await Promise.allSettled(ps);
  const bad = rs.find((r) => r.status === "rejected");
  if (bad) throw (bad as PromiseRejectedResult).reason;
  return rs.map((r) => (r as PromiseFulfilledResult<T>).value);
}

function background(p: Promise<unknown>): void {
  const quiet = p.catch((e) => console.error("background task failed", e));
  if (hasWaitUntil()) {
    (globalThis as { EdgeRuntime?: WaitUntil }).EdgeRuntime!.waitUntil!(quiet);
  }
}

console.log("edge runtime: waitUntil", hasWaitUntil() ? "available" : "UNAVAILABLE (worker runs inline)");

/** Constant-time string compare, so the worker secret cannot be probed byte by byte. */
function secretEquals(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- cost accounting ----------

// Which unit of work a model call belongs to, and who to charge it to. Passed
// explicitly rather than held in a module variable: one isolate serves many
// concurrent requests, and a shared "current user" would bill the wrong person.
type AiCtx = { purpose: string; userId: string | null };

type Usage = { inTok: number; outTok: number };

function approxTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function priceFor(provider: string): [number, number] {
  const p = PRICES[provider];
  return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : [0, 0];
}

/** A provider is "paid" iff someone configured a price for it. */
function isPaidProvider(provider: string): boolean {
  const [i, o] = priceFor(provider);
  return i > 0 || o > 0;
}

function estimateCost(provider: string, u: Usage): number {
  const [pin, pout] = priceFor(provider);
  return (u.inTok / 1_000_000) * pin + (u.outTok / 1_000_000) * pout;
}

// Today's spend, memoised briefly. Read before every paid call, so it has to be
// cheap; a stale window of 20 seconds can overshoot the ceiling by whatever one
// isolate spends in 20 seconds, which is orders of magnitude below the ceiling.
let spendCache: { at: number; usd: number } | null = null;

async function spendToday(): Promise<number> {
  if (spendCache && Date.now() - spendCache.at < 20_000) return spendCache.usd;
  try {
    const v = await rpc("ai_spend_today", {});
    const usd = Number(v);
    spendCache = { at: Date.now(), usd: Number.isFinite(usd) ? usd : 0 };
    return spendCache.usd;
  } catch (e) {
    // Fails open, loudly. A database that cannot answer this is a database that
    // cannot serve the save either, so refusing here would break extraction to
    // prevent a cost that is not being incurred.
    console.error("spend ceiling: could not read today's spend —", e);
    return spendCache?.usd ?? 0;
  }
}

/** False once the day's estimated spend has crossed the ceiling. */
async function paidAllowed(): Promise<boolean> {
  if (!(DAILY_SPEND_USD > 0)) {
    console.warn("spend ceiling: DAILY_SPEND_USD is " + DAILY_SPEND_USD + " — paid tiers disabled");
    return false;
  }
  const spent = await spendToday();
  if (spent < DAILY_SPEND_USD) return true;
  console.warn(
    "spend ceiling reached: $" + spent.toFixed(4) + " of $" + DAILY_SPEND_USD +
    " today — paid tiers disabled, falling back to the free extraction path",
  );
  return false;
}

/**
 * One row per model call. This is what gives the ceiling something to read, and
 * it is deliberately awaited rather than fired and forgotten: a save is allowed to
 * take another 30ms, and a spend ledger with holes in it is not a ceiling.
 */
async function recordCost(
  provider: string, model: string, ctx: AiCtx, u: Usage, ok: boolean,
): Promise<void> {
  const est = estimateCost(provider, u);
  try {
    await dbInsert("ai_cost_log", {
      user_id: ctx.userId,
      provider, model, purpose: ctx.purpose,
      input_tokens: u.inTok, output_tokens: u.outTok,
      est_cost_usd: Number(est.toFixed(6)),
      ok,
    });
    if (est > 0) spendCache = null;   // a paid call invalidates the memoised total
  } catch (e) {
    console.error("ai_cost_log insert failed", provider, model, e);
  }
}

// ---------- tiny HTML helpers ----------

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

function metaTag(html: string, prop: string): string | null {
  const re1 = new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]*)"`, "i");
  const re2 = new RegExp(`<meta[^>]+content="([^"]*)"[^>]+property="${prop}"`, "i");
  const m = html.match(re1) ?? html.match(re2);
  return m ? decodeEntities(m[1]) : null;
}

// ---------- URL parsing ----------

type Parsed = {
  platform: "instagram" | "tiktok" | "youtube" | "web";
  shortcode: string;   // unique key (tiktok ids prefixed tt-, youtube yt-, generic pages web-<hash>)
  kind: string;        // reel | p | tv | video | page
  clean: string;       // canonical link
};

function matchInstagram(u: string): Parsed | null {
  const m = u.match(/instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
  if (!m) return null;
  const kind = m[1] === "reels" ? "reel" : m[1];
  return { platform: "instagram", shortcode: m[2], kind, clean: `https://www.instagram.com/${kind}/${m[2]}/` };
}

function matchTikTok(u: string): Parsed | null {
  const m = u.match(/tiktok\.com\/(?:@[^/]+\/video|v)\/(\d+)/);
  if (!m) return null;
  return { platform: "tiktok", shortcode: `tt-${m[1]}`, kind: "video", clean: u.split("?")[0] };
}

function matchYouTube(u: string): Parsed | null {
  const m = u.match(/(?:youtube\.com\/(?:watch\?[^#\s]*\bv=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/);
  if (!m) return null;
  return { platform: "youtube", shortcode: `yt-${m[1]}`, kind: "video", clean: `https://www.youtube.com/watch?v=${m[1]}` };
}

// Any other http(s) page — a training blog, a program write-up. Keyed by URL hash.
// Returns null for anything unusable and BLOCKED for anything that fails the SSRF
// guard, so ingest can tell the user which of the two happened.
const BLOCKED = Symbol("blocked");
type WebParse = Parsed | null | typeof BLOCKED;

async function webParsed(target: string): Promise<WebParse> {
  const guard = await assertPublicUrl(target.split("#")[0]);
  if (!guard.ok) { console.error("ssrf: rejected", target, "—", guard.reason); return BLOCKED; }
  const u = guard.url;
  // social links that failed their own matcher (profiles, channels) make junk cards — reject
  if (/(^|\.)(instagram\.com|tiktok\.com|facebook\.com|youtube\.com|youtu\.be)$/i.test(u.hostname)) return null;
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "igsh", "mc_cid", "mc_eid"]) {
    u.searchParams.delete(k);
  }
  const clean = u.toString();
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(clean.toLowerCase()));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { platform: "web", shortcode: `web-${hex.slice(0, 16)}`, kind: "page", clean };
}

async function resolveShare(raw: string): Promise<WebParse> {
  const urlMatch = raw.match(/https?:\/\/[^\s"'<>]+/);
  if (!urlMatch) return null;
  let target = urlMatch[0];

  // Guard what the user actually posted before anything else looks at it, so a
  // private address cannot reach a platform matcher and be laundered into `clean`.
  const first = await assertPublicUrl(target);
  if (!first.ok) { console.error("ssrf: rejected", target, "—", first.reason); return BLOCKED; }

  let parsed = matchInstagram(target) ?? matchTikTok(target) ?? matchYouTube(target);
  if (parsed) return parsed;

  // Short/share links (instagram.com/share/..., vm.tiktok.com/...): follow redirects.
  // Each hop is validated before it is fetched AND after the Location header names
  // its successor — a public host that redirects to 169.254.169.254 is the whole
  // attack, so checking only what the user typed would be checking nothing.
  for (let hop = 0; hop < 4 && !parsed; hop++) {
    const guard = await assertPublicUrl(target);
    if (!guard.ok) { console.error("ssrf: rejected hop", hop, target, "—", guard.reason); return BLOCKED; }

    let loc: string | null = null;
    try {
      const r = await fetch(guard.url.toString(), {
        redirect: "manual",
        headers: { "User-Agent": DESKTOP_UA, "Accept-Language": "en-US" },
      });
      loc = r.headers.get("location");
      await r.body?.cancel();
    } catch (_) { break; }
    if (!loc) break;
    try { target = new URL(loc, guard.url).toString(); } catch { return BLOCKED; }
    // login redirects carry the real path in ?next=
    const next = new URL(target).searchParams.get("next");
    parsed = matchInstagram(target) ?? matchTikTok(target) ?? matchYouTube(target) ??
      (next ? matchInstagram("https://www.instagram.com" + next) : null);
  }
  return parsed ?? await webParsed(target);
}

// ---------- AI chain ----------

type Meta = {
  caption: string | null;
  thumb: string | null;
  author: string | null;
  images?: string[];
  seconds?: number;   // real runtime, when the platform tells us
  // Which scrapers actually contributed a field, comma-joined. Recorded per save so
  // a source going dark shows up as a shift in the mix rather than as user reports.
  source?: string;
};

// Gemini free-tier daily caps are tiny (20/day) PER MODEL, so rotate models.
const GEMINI_MODELS = [...new Set([GEMINI_MODEL, "gemini-3.6-flash-lite", "gemini-3-flash-lite", "gemini-3-flash", "gemini-flash-latest"])];
let geminiGoodModel: string | null = null;

function hasThinkingConfig(body: Record<string, unknown>): boolean {
  const gc = body.generationConfig as Record<string, unknown> | undefined;
  return !!gc && "thinkingConfig" in gc;
}

function withoutThinkingConfig(body: Record<string, unknown>): Record<string, unknown> {
  const gc = { ...(body.generationConfig as Record<string, unknown>) };
  delete gc.thinkingConfig;
  return { ...body, generationConfig: gc };
}

async function geminiGenerate(body: Record<string, unknown>, ctx: AiCtx): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;
  const models = geminiGoodModel
    ? [geminiGoodModel, ...GEMINI_MODELS.filter((m) => m !== geminiGoodModel)]
    : GEMINI_MODELS;
  for (const model of models) {
    let payload = body;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify(payload),
      });
      if (r.status === 429 && attempt === 0) {
        await r.body?.cancel();
        await new Promise((res) => setTimeout(res, 2500));
        continue;
      }
      if (r.status === 429 || r.status === 404) {
        console.error("gemini", model, r.status, "— rotating to next model");
        await r.body?.cancel();
        if (geminiGoodModel === model) geminiGoodModel = null;
        break;
      }
      // Older models reject thinkingConfig outright — drop it and try this model again.
      if (r.status === 400 && hasThinkingConfig(payload)) {
        await r.body?.cancel();
        payload = withoutThinkingConfig(payload);
        continue;
      }
      if (!r.ok) { console.error("gemini", model, r.status, await r.text()); return null; }
      const data = await r.json();
      const cand = data.candidates?.[0];
      const text = cand?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
      // Thinking tokens are billed, so they belong in the ledger even when the
      // candidate came back empty — that is precisely the run that costs money
      // and returns nothing.
      const um = data?.usageMetadata ?? {};
      const usage: Usage = {
        inTok: Number(um.promptTokenCount) || 0,
        outTok: (Number(um.candidatesTokenCount) || 0) + (Number(um.thoughtsTokenCount) || 0),
      };
      // A thinking model can spend the whole output budget reasoning and return no
      // text at all; that is a failure, not an empty answer, so let the chain fall on.
      if (!text) {
        console.error("gemini", model, "empty text, finishReason", cand?.finishReason,
          "thoughts", um?.thoughtsTokenCount);
        await recordCost("gemini", model, ctx, usage, false);
        if (geminiGoodModel === model) geminiGoodModel = null;
        break;
      }
      await recordCost("gemini", model, ctx, usage, true);
      geminiGoodModel = model;
      return text;
    }
  }
  console.error("gemini: all models exhausted");
  return null;
}

// Groq free tier is 14,400 requests/day, no card. OpenAI-compatible API.
const GROQ_MODELS = [...new Set([
  Deno.env.get("GROQ_MODEL") ?? "",
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "openai/gpt-oss-20b",
].filter(Boolean))];
let groqGoodModel: string | null = null;

async function groqGenerate(system: string, user: string, wantJson: boolean, ctx: AiCtx): Promise<string | null> {
  if (!GROQ_API_KEY) return null;
  const models = groqGoodModel
    ? [groqGoodModel, ...GROQ_MODELS.filter((m) => m !== groqGoodModel)]
    : GROQ_MODELS;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${GROQ_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          max_tokens: 4000,
          ...(wantJson ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      if (r.status === 429 && attempt === 0) {
        await r.body?.cancel();
        await new Promise((res) => setTimeout(res, 2500));
        continue;
      }
      if (r.status === 429 || r.status === 404 || r.status === 400) {
        // 404/400: decommissioned model or unsupported json mode — rotate
        console.error("groq", model, r.status, "— rotating to next model");
        await r.body?.cancel();
        if (groqGoodModel === model) groqGoodModel = null;
        break;
      }
      if (!r.ok) { console.error("groq error", model, r.status, await r.text()); return null; }
      const data = await r.json();
      const out = data.choices?.[0]?.message?.content ?? null;
      await recordCost("groq", model, ctx, {
        inTok: Number(data?.usage?.prompt_tokens) || approxTokens(system + user),
        outTok: Number(data?.usage?.completion_tokens) || approxTokens(out ?? ""),
      }, !!out);
      groqGoodModel = model;
      return out;
    }
  }
  console.error("groq: all models failed");
  return null;
}

// OpenAI (GPT-5.6 Luna by default): the paid tier's cheapest flagship-family model.
// The 5.6 series rejects max_tokens in favour of max_completion_tokens.
async function openaiGenerate(system: string, user: string, wantJson: boolean, ctx: AiCtx): Promise<string | null> {
  if (!OPENAI_API_KEY) return null;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_completion_tokens: wantJson ? 8000 : 3000,
        // json_object mode requires the word "json" somewhere in the messages,
        // which buildPrompt and the helper prompts all satisfy.
        ...(wantJson ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!r.ok) {
      console.error("openai", OPENAI_MODEL, r.status, (await r.text()).slice(0, 300));
      return null;
    }
    const data = await r.json();
    const out = data.choices?.[0]?.message?.content ?? null;
    await recordCost("openai", OPENAI_MODEL, ctx, {
      inTok: Number(data?.usage?.prompt_tokens) || approxTokens(system + user),
      outTok: Number(data?.usage?.completion_tokens) || approxTokens(out ?? ""),
    }, !!out);
    return out;
  } catch (e) {
    console.error("openai failed", e);
    return null;
  }
}

// The single front door for text generation. Order is cost-and-quality descending:
// a paid key when present, then the free tiers as fallback. Every caller goes
// through here, so swapping providers is a one-line change — and so is switching
// the paid half of the ladder off when the day's spend has run out.
//
// The ceiling is checked once per call rather than per provider, because the
// answer cannot change between two rungs of the same ladder.
async function textGenerate(system: string, user: string, wantJson: boolean, ctx: AiCtx): Promise<string | null> {
  const paid = await paidAllowed();
  const allowed = (provider: string) => paid || !isPaidProvider(provider);

  let out: string | null = null;
  if (allowed("openai")) out = await openaiGenerate(system, user, wantJson, ctx);
  if (!out && allowed("anthropic")) out = await parseWithClaude(system, user, ctx);
  if (!out && GEMINI_API_KEY && allowed("gemini")) {
    out = await geminiGenerate({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      // Extraction wants structured output, not reasoning. Thinking tokens are billed
      // against maxOutputTokens, so leaving it on can consume the entire budget and
      // return an empty candidate. Budgets are generous for the same reason.
      generationConfig: wantJson
        ? {
          responseMimeType: "application/json",
          maxOutputTokens: 8000,
          thinkingConfig: { thinkingBudget: 0 },
        }
        : { maxOutputTokens: 3000, thinkingConfig: { thinkingBudget: 0 } },
    }, ctx);
  }
  if (!out && allowed("groq")) out = await groqGenerate(system, user, wantJson, ctx);
  return out;
}

function haveAI(): boolean {
  return !!(OPENAI_API_KEY || ANTHROPIC_API_KEY || GEMINI_API_KEY || GROQ_API_KEY);
}

// ---------- metadata scraping ----------

async function igMeta(p: Parsed): Promise<Meta> {
  let caption: string | null = null;
  let thumb: string | null = null;
  let author: string | null = null;
  let images: string[] = [];
  const used: string[] = [];

  // 1) og: tags, served to link-preview crawlers
  try {
    const r = await safeFetch(p.clean, {
      headers: { "User-Agent": CRAWLER_UA, "Accept-Language": "en-US", "Accept": "text/html" },
    });
    if (r.ok) {
      const html = await r.text();
      thumb = metaTag(html, "og:image");
      const ogTitle = metaTag(html, "og:title");
      const ogDesc = metaTag(html, "og:description");
      const quoted = (s: string | null) => s?.match(/: ["“]([\s\S]*?)["”]?\s*$/)?.[1]?.trim() ?? null;
      const candidates = [quoted(ogTitle), quoted(ogDesc)].filter((c): c is string => !!c);
      caption = candidates.sort((a, b) => b.length - a.length)[0] ?? null;
      if (!caption && ogDesc) {
        caption = ogDesc.replace(/^[\d.,KMB]+ likes?,\s*[\d.,KMB]+ comments?\s*-\s*\S+\s+on\s+[^:]+:\s*/i, "").trim();
      }
      author = ogTitle?.match(/^([^|:]+?) on Instagram/)?.[1]?.trim() ?? null;
      if (caption || thumb || author) used.push("og");
    }
  } catch (_) { /* fall through */ }

  // 2) the captioned-embed page often works when og: tags are login-walled
  try {
    const r = await safeFetch(`https://www.instagram.com/p/${p.shortcode}/embed/captioned/`, {
      headers: { "User-Agent": DESKTOP_UA, "Accept-Language": "en-US" },
    });
    if (r.ok) {
      const html = await r.text();
      if (!thumb) {
        const im = html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/) ??
          html.match(/src="(https:\/\/[^"]*scontent[^"]+)"/);
        if (im) thumb = decodeEntities(im[1]);
      }
      const capDiv = html.match(/<div class="Caption"[^>]*>([\s\S]*?)<div class="CaptionComments"/) ??
        html.match(/<div class="Caption"[^>]*>([\s\S]*?)<\/div>/);
      if (capDiv) {
        const text = decodeEntities(
          capDiv[1].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "),
        ).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
        // og: tags collapse newlines; a caption WITH line structure beats a longer flat one
        const structured = text.includes("\n") && !(caption ?? "").includes("\n");
        if (text && (!caption || structured || text.length > caption.length)) caption = text;
      }
      if (!author) {
        const a = html.match(/class="UsernameText"[^>]*>([^<]+)</);
        if (a) author = decodeEntities(a[1]);
      }
      // carousel posts: the embed page's inline JSON exposes display_url for every slide,
      // and slide 2 is very often the written workout
      for (const mm of html.matchAll(/"display_url"\s*:\s*"([^"]+)"/g)) {
        const u = mm[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
        if (/^https:\/\//.test(u) && !images.includes(u)) images.push(u);
      }
      if (caption || thumb || author || images.length) used.push("embed-captioned");
    }
  } catch (_) { /* fall through */ }

  if (!images.length && thumb) images = [thumb];
  return { caption, thumb, author, images, source: used.join(",") || "none" };
}

// ---------- TikTok ----------
//
// oEmbed used to be the only source here, and a single 400 from it left a save with
// no title, no author, no thumbnail and no caption — an empty card. TikTok exposes
// the same facts in four different shapes, so each is a parser and ttMeta walks them
// until every field is filled. Partial answers are merged, not discarded: the
// crawler view of the video page carries a thumbnail and a handle but no caption,
// which is worth having when the caption comes from somewhere else.

type TtRaw = { caption: string | null; thumb: string | null; author: string | null; seconds?: number };

function ttPickCover(covers: unknown): string | null {
  if (typeof covers === "string") return covers.startsWith("http") ? covers : null;
  if (Array.isArray(covers)) {
    for (const c of covers) if (typeof c === "string" && c.startsWith("http")) return c;
  }
  return null;
}

function ttSome(r: TtRaw): TtRaw | null {
  return r.caption || r.thumb || r.author ? r : null;
}

/** oEmbed JSON. `title` is the whole caption, hashtags and all. */
function ttFromOembed(text: string): TtRaw | null {
  try {
    const o = JSON.parse(text);
    return ttSome({
      caption: typeof o.title === "string" && o.title.trim() ? o.title : null,
      thumb: typeof o.thumbnail_url === "string" ? o.thumbnail_url : null,
      author: (typeof o.author_name === "string" && o.author_name) ||
        (typeof o.author_unique_id === "string" && o.author_unique_id) || null,
    });
  } catch { return null; }
}

/** The embed page's inline Frontity state — caption, cover, handle and runtime. */
function ttFromEmbedState(html: string): TtRaw | null {
  const m = html.match(/<script id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1])?.source?.data ?? {};
    for (const key of Object.keys(data)) {
      const vd = data[key]?.videoData;
      if (!vd) continue;
      const it = vd.itemInfos ?? {};
      const au = vd.authorInfos ?? {};
      const hit = ttSome({
        caption: typeof it.text === "string" && it.text.trim() ? it.text : null,
        thumb: ttPickCover(it.covers) ?? ttPickCover(it.coversOrigin) ?? ttPickCover(it.shareCover),
        author: au.nickName || au.uniqueId || null,
        seconds: Number(it.video?.videoMeta?.duration) || undefined,
      });
      if (hit) return hit;
    }
  } catch { /* fall through */ }
  return null;
}

/** The full watch page's rehydration blob. Same facts, different envelope. */
function ttFromUniversalData(html: string): TtRaw | null {
  const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const it = JSON.parse(m[1])?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct;
    if (!it) return null;
    return ttSome({
      caption: typeof it.desc === "string" && it.desc.trim() ? it.desc : null,
      thumb: ttPickCover(it.video?.cover) ?? ttPickCover(it.video?.originCover) ?? ttPickCover(it.video?.dynamicCover),
      author: it.author?.nickname || it.author?.uniqueId || null,
      seconds: Number(it.video?.duration) || undefined,
    });
  } catch { return null; }
}

/**
 * og: tags on the video page — a thumbnail and the creator handle, and deliberately
 * never a caption.
 *
 * Measured from this datacenter IP against six real videos and one dead link,
 * og:title and og:description carried the real caption zero times. What they carry is
 * marketing copy: "TikTok · handle", "TikTok | Make Your Day", "Watch, follow, and
 * discover more trending content.", and — for a video that no longer exists —
 * "Visit TikTok to discover videos!". An earlier version of this function accepted
 * anything that did not look like boilerplate, and a dead link promptly saved with
 * the title "Visit TikTok to discover videos!". Denylisting that class of string is
 * a losing game, so the rule is structural instead: the caption comes only from
 * oEmbed, the embed state, or the rehydration blob, all three of which carry the
 * creator's real text. og: tags contribute the two fields they are honest about.
 */
const TT_OG_NOT_A_HANDLE = /^(make your day|watch|discover|explore|trending|log in|sign up)\b/i;

function ttFromOg(html: string): TtRaw | null {
  const thumb = metaTag(html, "og:image");
  const title = metaTag(html, "og:title");

  // "TikTok · handle" is the only author shape observed. The separator match must
  // not turn "TikTok | Make Your Day" into a creator called "Make Your Day".
  let author: string | null = null;
  const m = title?.match(/^TikTok\s*[·|]\s*(.+?)\s*$/);
  const cand = m?.[1]?.trim();
  if (cand && !TT_OG_NOT_A_HANDLE.test(cand)) author = cand;

  return ttSome({ caption: null, thumb, author });
}

type TtSource = {
  name: string;
  url: (id: string, clean: string) => string;
  ua: string;
  parse: (body: string) => TtRaw | null;
};

// Ordered by cost, and trimmed to what earned its place when seven candidate
// endpoints were measured from this datacenter IP against six real videos:
//   oembed        3KB   caption + thumb + author   — 200 on all six
//   embed/v2    ~285KB  caption + thumb + author + runtime
//   page-crawler  7KB   thumb + author only
//   page-desktop ~400KB caption + thumb + author
// Dropped: the crawler UA on oEmbed (byte-identical response to the desktop UA),
// /embed/ without the v2 (serves the same page), and m.tiktok.com/v/<id>.html
// (200 but no parseable payload on any sample). The ladder stops as soon as
// nothing is missing, so the usual save costs one 3KB request; the later rungs
// exist for the day oEmbed stops answering.
const TT_SOURCES: TtSource[] = [
  { name: "oembed", ua: DESKTOP_UA, parse: ttFromOembed,
    url: (_id, clean) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(clean)}` },
  { name: "embed-v2", ua: DESKTOP_UA, parse: (b) => ttFromEmbedState(b) ?? ttFromOg(b),
    url: (id) => `https://www.tiktok.com/embed/v2/${id}` },
  { name: "page-crawler", ua: CRAWLER_UA, parse: (b) => ttFromUniversalData(b) ?? ttFromOg(b),
    url: (_id, clean) => clean },
  { name: "page-desktop", ua: DESKTOP_UA, parse: (b) => ttFromUniversalData(b) ?? ttFromOg(b),
    url: (_id, clean) => clean },
];

async function ttFetchSource(s: TtSource, id: string, clean: string):
  Promise<{ status: number; bytes: number; raw: TtRaw | null; error?: string }> {
  const headers: Record<string, string> = { "Accept-Language": "en-US,en;q=0.9" };
  if (s.ua) headers["User-Agent"] = s.ua;
  try {
    const r = await safeFetch(s.url(id, clean), { headers, signal: AbortSignal.timeout(15000) });
    const body = await r.text();
    if (!r.ok) return { status: r.status, bytes: body.length, raw: null };
    return { status: r.status, bytes: body.length, raw: s.parse(body) };
  } catch (e) {
    return { status: 0, bytes: 0, raw: null, error: String(e).slice(0, 160) };
  }
}

async function ttMeta(p: Parsed): Promise<Meta> {
  const id = p.shortcode.replace(/^tt-/, "");
  const out: Meta = { caption: null, thumb: null, author: null };
  const used: string[] = [];

  for (const s of TT_SOURCES) {
    if (out.caption && out.thumb && out.author) break;
    const got = await ttFetchSource(s, id, p.clean);
    if (!got.raw) {
      if (got.status && got.status !== 200) console.error("tiktok", s.name, "http", got.status);
      else if (got.error) console.error("tiktok", s.name, got.error);
      continue;
    }
    let gained = false;
    if (!out.caption && got.raw.caption) { out.caption = got.raw.caption; gained = true; }
    if (!out.thumb && got.raw.thumb) { out.thumb = got.raw.thumb; gained = true; }
    if (!out.author && got.raw.author) { out.author = got.raw.author; gained = true; }
    if (!out.seconds && got.raw.seconds) { out.seconds = got.raw.seconds; gained = true; }
    if (gained) used.push(s.name);
  }

  out.source = used.join(",") || "none";
  console.log("tiktok meta", id, "sources:", out.source,
    "caption:", out.caption?.length ?? 0, "thumb:", !!out.thumb, "author:", out.author ?? "-");
  return out;
}

// Reading a YouTube description from a server is only reliable through the official
// Data API. Verified 2026-09 from Supabase's datacenter IP: the watch page answers 429,
// the WEB player endpoint answers LOGIN_REQUIRED, ANDROID/IOS fail attestation, and both
// embedded-player clients answer ERROR. Without a key we keep the oEmbed title only.
// YOUTUBE_API_KEY, or GEMINI_API_KEY if the YouTube Data API v3 is enabled on that
// Google project (videos.list costs 1 unit of the free 10,000/day).
const YOUTUBE_API_KEY = Deno.env.get("YOUTUBE_API_KEY") ?? GEMINI_API_KEY;

async function ytDataApi(videoId: string): Promise<{ desc: string; author: string; seconds: number } | null> {
  if (!YOUTUBE_API_KEY) return null;
  try {
    const r = await fetch(
      "https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=" +
      encodeURIComponent(videoId) + "&key=" + YOUTUBE_API_KEY,
      { signal: AbortSignal.timeout(12000) },
    );
    if (!r.ok) {
      console.error("youtube data api", r.status, (await r.text()).slice(0, 200));
      return null;
    }
    const data = await r.json();
    const item = data?.items?.[0];
    if (!item) return null;
    return {
      desc: item.snippet?.description ?? "",
      author: item.snippet?.channelTitle ?? "",
      seconds: isoMinutes(item.contentDetails?.duration ?? "") * 60,
    };
  } catch (e) {
    console.error("youtube data api failed", e);
    return null;
  }
}

// "PT1H30M" -> 90
function isoMinutes(iso: string): number {
  const m = iso.match(/^P(?:([\d.]+)D)?T?(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?$/);
  if (!m) return 0;
  const d = parseFloat(m[1] ?? "0"), h = parseFloat(m[2] ?? "0");
  const mi = parseFloat(m[3] ?? "0"), s = parseFloat(m[4] ?? "0");
  return Math.round(d * 1440 + h * 60 + mi + s / 60);
}

async function ytMeta(p: Parsed): Promise<Meta> {
  let caption: string | null = null;
  let thumb: string | null = null;
  let author: string | null = null;
  let ytSeconds = 0;
  const used: string[] = [];
  try {
    const r = await safeFetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(p.clean)}&format=json`,
      { headers: { "User-Agent": DESKTOP_UA }, signal: AbortSignal.timeout(10000) },
    );
    if (r.ok) {
      const o = await r.json();
      caption = o.title ?? null;
      thumb = o.thumbnail_url ?? null;
      author = o.author_name ?? null;
      if (caption || thumb || author) used.push("oembed");
    }
  } catch (_) { /* fall through */ }
  // The description — where creators paste the full workout — isn't in oEmbed.
  const vid = p.shortcode.replace(/^yt-/, "");
  const api = await ytDataApi(vid);
  if (api) {
    if (api.desc && api.desc.length > 20) caption = (caption ? caption + "\n\n" : "") + api.desc;
    if (!author && api.author) author = api.author;
    if (api.seconds > 0) ytSeconds = api.seconds;
    used.push("data-api");
  }
  // i.ytimg.com serves a thumbnail for every public video without an API call, so
  // this is a real fallback rather than a placeholder.
  if (!thumb) { thumb = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`; used.push("ytimg"); }
  return { caption, thumb, author, seconds: ytSeconds || undefined, source: used.join(",") || "none" };
}

// Generic pages: og: tags plus enough body text for the AI. There is no schema.org
// type for workouts the way there is for recipes, so everything goes through the model.
async function webMeta(p: Parsed): Promise<Meta> {
  const out: Meta = { caption: null, thumb: null, author: null };
  try {
    const r = await safeFetch(p.clean, {
      headers: { "User-Agent": DESKTOP_UA, "Accept-Language": "en-US", "Accept": "text/html" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) { console.error("webMeta fetch", p.clean, r.status); return out; }
    const html = await r.text();
    out.thumb = metaTag(html, "og:image");
    out.author = metaTag(html, "og:site_name");
    if (!out.author) { try { out.author = new URL(p.clean).hostname.replace(/^www\./, ""); } catch (_) { /* ok */ } }
    const ogTitle = metaTag(html, "og:title") ??
      (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null);
    const ogDesc = metaTag(html, "og:description");
    out.caption = [ogTitle, ogDesc].filter(Boolean).join("\n") || null;

    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, "\n");
    const text = decodeEntities(body)
      .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length > 200) out.caption = ((out.caption ?? "") + "\n\n" + text.slice(0, 6000)).trim();
    out.source = "og";
  } catch (e) {
    console.error("webMeta failed", e);
  }
  if (!out.source) out.source = "none";
  return out;
}

function fetchMeta(p: Parsed): Promise<Meta> {
  if (p.platform === "instagram") return igMeta(p);
  if (p.platform === "tiktok") return ttMeta(p);
  if (p.platform === "youtube") return ytMeta(p);
  return webMeta(p);
}

// ---------- caption -> workout card ----------

type Exercise = {
  // `name` stays exactly what the model produced — nothing is lost, and the UI
  // still shows the creator's wording. `canonical_id` is the catalog key that the
  // weight prefill and personal records group by; null when nothing matched.
  name: string;
  canonical_id: string | null;
  sets: number | null;
  reps: string | null;
  duration_seconds: number | null;
  rest_seconds: number | null;
  weight: string | null;
  equipment: string | null;
  notes: string | null;
};

type Block = {
  title: string | null;
  type: string;
  rounds: number | null;
  rest_seconds: number | null;
  exercises: Exercise[];
};

type Card = {
  title: string;
  category: string;
  muscle_groups: string[];
  equipment: string[];
  difficulty: string | null;
  duration_minutes: number | null;
  calories: number | null;
  tags: string[];
  has_full_workout: boolean;
  blocks: Block[];
  source_url?: string | null;
};

const SPAM_LINE = /^(#|link in bio|follow (me|for)|save this|comment [A-Z]+ below|tag a|dm me|check out my)/i;
// Lines that carry a duration but describe the protocol, not a movement to perform.
const NOT_AN_EXERCISE = /^(rest|repeat|complete|do |perform|between|then |x\d|round|set\b|circuit|total|warm ?up:|cool ?down:)/i;

function cleanLine(s: string): string {
  return s
    .replace(/[•▪●–—\-\*]+\s*/g, " ")
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "")
    // arrows, dingbats and geometric shapes are single BMP code points, so the
    // surrogate-pair strip above misses them (▶️ in front of every exercise line)
    .replace(/[←-⇿⌀-⏿■-➿⬀-⯿️‍]/g, "")
    .replace(/#\w+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTitle(s: string): string {
  const t = cleanLine(s).replace(/["“”]/g, "").trim();
  return t.length > 120 ? t.slice(0, 117).trim() + "…" : t;
}

// Keyword table over the taxonomy — cheap, deterministic, and good enough that the
// AI rarely has to be second-guessed. Order matters: first hit wins.
const CAT_RULES: [string, RegExp][] = [
  ["HIIT", /\b(hiit|tabata|interval|emom|amrap|circuit burn|metcon)\b/i],
  ["Yoga", /\b(yoga|vinyasa|flow|sun salutation|asana)\b/i],
  ["Mobility", /\b(mobility|stretch|flexibility|warm ?up routine|cool ?down|prehab|rehab)\b/i],
  ["Cardio", /\b(cardio|run(ning)?|jog|treadmill|cycling|rowing|stair|jump rope|conditioning)\b/i],
  ["Core", /\b(core|abs?|six ?pack|oblique|plank)\b/i],
  ["Push", /\b(push day|bench press|chest day|overhead press|tricep|dips?)\b/i],
  ["Pull", /\b(pull day|back day|deadlift|row|lat pulldown|pull ?ups?|bicep)\b/i],
  ["Legs", /\b(leg day|legs|squat|lunge|quad|hamstring|glute|calf|calves)\b/i],
  ["Upper Body", /\b(upper body|upper day)\b/i],
  ["Full Body", /\b(full body|total body|whole body)\b/i],
];

// Scored rather than first-match: a full-body dumbbell circuit whose caption happens
// to mention "cool down" and "row" should not come back as Mobility or Pull. The title
// is what the post is actually about, so it counts far more than the body text.
function catFor(title: string, body?: string): string | null {
  const scores: Record<string, number> = {};
  for (const [cat, re] of CAT_RULES) {
    let s = 0;
    if (re.test(title)) s += 5;
    if (body && re.test(body)) s += 1;
    if (s) scores[cat] = s;
  }
  const best = Object.keys(scores).sort((a, b) => scores[b] - scores[a])[0];
  return best ?? null;
}

const MUSCLE_RULES: [string, RegExp][] = [
  ["chest", /\b(chest|pec|bench press|push ?up|fly)\b/i],
  ["back", /\b(back|lat|row|pull ?up|pulldown|deadlift)\b/i],
  ["shoulders", /\b(shoulder|delt|overhead press|lateral raise)\b/i],
  ["biceps", /\b(bicep|curl)\b/i],
  ["triceps", /\b(tricep|skull ?crusher|dip|pushdown)\b/i],
  ["core", /\b(core|abs?|plank|crunch|oblique|hollow)\b/i],
  ["glutes", /\b(glute|hip thrust|bridge)\b/i],
  ["quads", /\b(quad|squat|lunge|leg press|leg extension)\b/i],
  ["hamstrings", /\b(hamstring|rdl|romanian|leg curl|good morning)\b/i],
  ["calves", /\b(calf|calves)\b/i],
  ["forearms", /\b(forearm|grip|wrist)\b/i],
  ["full body", /\b(full body|total body|whole body)\b/i],
];

function musclesFor(text: string): string[] {
  const out: string[] = [];
  for (const [m, re] of MUSCLE_RULES) if (re.test(text)) out.push(m);
  return out;
}

const EQUIP_RULES: [string, RegExp][] = [
  ["dumbbells", /\b(dumbbell|db)\b/i],
  ["barbell", /\b(barbell|bb|bench press|deadlift|back squat)\b/i],
  ["kettlebell", /\b(kettlebell|kb)\b/i],
  ["resistance bands", /\b(band|resistance band)\b/i],
  ["pull-up bar", /\b(pull ?up bar|chin ?up bar|hanging)\b/i],
  ["bench", /\b(bench|incline|decline)\b/i],
  ["cables", /\b(cable|pulley|pushdown|pulldown)\b/i],
  ["machine", /\b(machine|leg press|smith)\b/i],
  ["medicine ball", /\b(medicine ball|med ball|slam ball|wall ball)\b/i],
  ["jump rope", /\b(jump rope|skipping)\b/i],
  ["box", /\b(box jump|step ?up|plyo box)\b/i],
];

function equipmentFor(text: string): string[] {
  const out: string[] = [];
  for (const [e, re] of EQUIP_RULES) if (re.test(text)) out.push(e);
  return out;
}

function emptyCard(title: string): Card {
  return {
    title, category: "Other", muscle_groups: [], equipment: [], difficulty: null,
    duration_minutes: null, calories: null, tags: [], has_full_workout: false, blocks: [],
  };
}

// The always-available parser under the AI: catches "3x10 Bench Press" style lines
// so a card is never completely empty even with every AI key exhausted.
const SETSxREPS = /(\d{1,2})\s*[x×]\s*(\d{1,3}(?:\s*[-–]\s*\d{1,3})?)/;
const SETS_OF = /(\d{1,2})\s*sets?\s*(?:of|x|×)?\s*(\d{1,3}(?:\s*[-–]\s*\d{1,3})?)/i;
const TIMED = /(\d{1,3})\s*(sec(?:ond)?s?|s\b|min(?:ute)?s?)/i;
// A single exercise longer than this is really the whole session's length
// ("20 MIN FULL BODY WORKOUT"), not one movement.
const MAX_EXERCISE_SECONDS = 600;

function durationFor(text: string): number | null {
  const m = text.match(/(\d{1,3})\s*[-\s]?\s*(min(?:ute)?s?|hour|hr)\b/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const mins = /hour|hr/i.test(m[2]) ? n * 60 : n;
  return mins >= 4 && mins <= 300 ? mins : null;
}

function heuristicWorkout(caption: string | null, fallbackTitle: string): Card {
  const card = emptyCard(fallbackTitle);
  if (!caption) return card;

  const rawLines = caption.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const lines = rawLines.filter((l) => !SPAM_LINE.test(l));
  const titleLine = lines.find((l) => cleanLine(l).length >= 4) ?? null;
  if (titleLine) card.title = cleanTitle(titleLine) || fallbackTitle;

  const exercises: Exercise[] = [];
  for (const raw of lines) {
    // the title is a headline, not the first exercise
    if (raw === titleLine) continue;
    const line = cleanLine(raw);
    if (!line || line.length > 120) continue;

    const sr = line.match(SETS_OF) ?? line.match(SETSxREPS);
    const tm = line.match(TIMED);
    if (!sr && !tm) continue;

    // the exercise name is whatever is left once the numbers are stripped
    const name = cleanTitle(
      line.replace(SETS_OF, " ").replace(SETSxREPS, " ").replace(TIMED, " ")
        .replace(/\b(reps?|sets?|each side|per side|ea)\b/gi, " ")
        .replace(/[:\-–—]+/g, " ").replace(/\s+/g, " ").trim(),
    );
    if (name.length < 3 || NOT_AN_EXERCISE.test(name)) continue;

    let seconds: number | null = null;
    if (tm && !sr) {
      const n = parseInt(tm[1], 10);
      seconds = /min/i.test(tm[2]) ? n * 60 : n;
      if (seconds > MAX_EXERCISE_SECONDS) continue;
    }
    exercises.push({
      name,
      canonical_id: null,   // filled by applyCatalog once the card is assembled
      sets: sr ? parseInt(sr[1], 10) : null,
      reps: sr ? sr[2].replace(/\s+/g, "") : null,
      duration_seconds: seconds,
      rest_seconds: null,
      weight: null,
      equipment: equipmentFor(line)[0] ?? null,
      notes: null,
    });
    if (exercises.length >= 15) break;
  }

  // One lone timed line is usually a stray number in the caption; require either
  // two exercises or one with explicit sets before calling this a real workout.
  const real = exercises.length >= 2 || exercises.some((e) => e.sets !== null);
  if (real) {
    card.blocks = [{ title: null, type: "straight", rounds: null, rest_seconds: null, exercises }];
    card.has_full_workout = true;
  }
  const all = caption;
  card.category = catFor(card.title, all) ?? "Other";
  card.muscle_groups = musclesFor(all);
  card.equipment = equipmentFor(all);
  card.duration_minutes = durationFor(card.title) ?? durationFor(all.slice(0, 400));
  return card;
}

function buildPrompt(): string {
  return "You turn social-media fitness video captions and descriptions into structured workout cards. " +
    "Reply with ONLY a JSON object with exactly these keys:\n" +
    '"title": short workout name in Title Case, no emojis or hashtags.\n' +
    `"category": exactly one of ${JSON.stringify(CATEGORIES)} — the closest fit.\n` +
    `"muscle_groups": array using only these values: ${JSON.stringify(MUSCLES)}.\n` +
    `"equipment": array using only these values: ${JSON.stringify(EQUIPMENT)}. Use [] when the workout is bodyweight only.\n` +
    `"difficulty": one of ${JSON.stringify(DIFFICULTIES)} or null.\n` +
    '"duration_minutes": integer — stated length, or a realistic estimate from the exercise volume, or null.\n' +
    '"calories": rough integer kcal estimate for one session, or null.\n' +
    '"tags": up to 5 short lowercase tags such as "no-equipment", "apartment-friendly", "20-min".\n' +
    '"has_full_workout": true ONLY if the text lists actual exercises with sets/reps or times.\n' +
    `"blocks": array of blocks. Each block is {"title": string or null, "type": one of ${JSON.stringify(BLOCK_TYPES)}, ` +
    '"rounds": integer or null, "rest_seconds": integer or null, "exercises": [...]}. ' +
    'Group supersets and circuits into ONE block with the shared rounds, rather than repeating exercises. ' +
    'Each exercise is {"name": string, "sets": integer or null, "reps": string or null such as "10" or "8-12" or "AMRAP", ' +
    '"duration_seconds": integer or null for timed moves, "rest_seconds": integer or null, ' +
    '"weight": string or null such as "moderate" or "70% 1RM", "equipment": string or null, "notes": string or null}.\n' +
    "Use null for anything the text does not state — do not guess sets or reps. " +
    "NEVER invent exercises that are not in the text: a video with no written workout gets blocks: [] and has_full_workout: false.";
}

function parseJsonLoose(text: string): any {
  let t = text.trim();
  if (t.startsWith("```")) t = t.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "");
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  return JSON.parse(t);
}

function pickFrom(list: string[], value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") continue;
    const norm = v.toLowerCase().trim();
    const hit = list.find((x) => x === norm);
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

function intOrNull(v: unknown, max: number): number | null {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n), max);
}

function normalizeExercise(raw: any): Exercise | null {
  const name = typeof raw?.name === "string" ? cleanTitle(raw.name) : "";
  if (!name || name.length < 2) return null;
  const reps = raw?.reps === null || raw?.reps === undefined ? null : String(raw.reps).slice(0, 24).trim() || null;
  return {
    name,
    canonical_id: null,   // filled by applyCatalog once the card is assembled
    sets: intOrNull(raw?.sets, 30),
    reps,
    duration_seconds: intOrNull(raw?.duration_seconds, 7200),
    rest_seconds: intOrNull(raw?.rest_seconds, 3600),
    weight: typeof raw?.weight === "string" ? raw.weight.slice(0, 40).trim() || null : null,
    equipment: typeof raw?.equipment === "string" ? raw.equipment.slice(0, 40).trim().toLowerCase() || null : null,
    notes: typeof raw?.notes === "string" ? raw.notes.slice(0, 240).trim() || null : null,
  };
}

function normalizeCard(raw: any, fallback: Card): Card {
  const blocks: Block[] = [];
  if (Array.isArray(raw?.blocks)) {
    for (const b of raw.blocks.slice(0, 12)) {
      const exercises = Array.isArray(b?.exercises)
        ? b.exercises.slice(0, 15).map(normalizeExercise).filter((e: Exercise | null): e is Exercise => !!e)
        : [];
      if (!exercises.length) continue;
      const type = typeof b?.type === "string" && BLOCK_TYPES.includes(b.type.toLowerCase())
        ? b.type.toLowerCase() : "straight";
      blocks.push({
        title: typeof b?.title === "string" ? cleanTitle(b.title) || null : null,
        type,
        rounds: intOrNull(b?.rounds, 50),
        rest_seconds: intOrNull(b?.rest_seconds, 3600),
        exercises,
      });
    }
  }

  const title = typeof raw?.title === "string" ? cleanTitle(raw.title) : "";
  const category = typeof raw?.category === "string" && CATEGORIES.includes(raw.category)
    ? raw.category : fallback.category;
  const difficulty = typeof raw?.difficulty === "string" && DIFFICULTIES.includes(raw.difficulty.toLowerCase())
    ? raw.difficulty.toLowerCase() : fallback.difficulty;
  const tags = Array.isArray(raw?.tags)
    ? raw.tags.filter((t: unknown) => typeof t === "string").slice(0, 5)
        .map((t: string) => t.toLowerCase().replace(/^#/, "").slice(0, 30).trim()).filter(Boolean)
    : fallback.tags;

  const muscles = pickFrom(MUSCLES, raw?.muscle_groups);
  const equip = pickFrom(EQUIPMENT, raw?.equipment);

  return {
    title: title || fallback.title,
    category,
    muscle_groups: muscles.length ? muscles : fallback.muscle_groups,
    equipment: Array.isArray(raw?.equipment) ? equip : fallback.equipment,
    difficulty,
    duration_minutes: intOrNull(raw?.duration_minutes, 600) ?? fallback.duration_minutes,
    calories: intOrNull(raw?.calories, 5000) ?? fallback.calories,
    tags,
    has_full_workout: blocks.length > 0 && blocks.some((b) => b.exercises.length > 0),
    blocks: blocks.length ? blocks : fallback.blocks,
  };
}

// ---------- catalog normalization ----------

// The single place a card is reconciled with the controlled catalog. Runs on every
// path that produces a card — AI, heuristic parser, vision, reprocess merge — so no
// exercise can reach the database without having been offered to the normalizer.
//
// Rules, all deliberate:
//   * the raw model name is never overwritten. A creator's "Bulgarians" still reads
//     as "Bulgarians"; only the grouping key underneath it changes.
//   * a name that does not match leaves canonical_id null. Guessing would merge two
//     different lifts' personal records, which is worse than not matching at all.
//   * muscle_groups come from the catalog, because which muscles a goblet squat
//     trains does not depend on the video. The model is unreliable here — it
//     labelled a squat/row/deadlift session "chest, shoulders, full body".
//   * equipment does NOT get overwritten by the catalog. The catalog lists what a
//     movement is *commonly* done with, which is not what a given video used: a
//     dumbbell-only home workout would come back demanding a barbell, a machine and
//     a medicine ball, because that is what rows, chest presses and Russian twists
//     usually use. The video's own statement is the better evidence, so the catalog
//     only fills the field when the model produced nothing at all.
function applyCatalog(card: Card): Card {
  const muscles: string[] = [];
  const equip: string[] = [];
  let matched = 0;

  for (const b of card.blocks) {
    for (const ex of b.exercises) {
      const m = canonicalize(ex.name);
      ex.canonical_id = m ? m.id : null;
      if (!m) continue;
      matched++;
      for (const g of m.entry.muscles) if (!muscles.includes(g)) muscles.push(g);
      for (const q of m.entry.equipment) if (!equip.includes(q)) equip.push(q);
    }
  }

  // Only speak for the card when the catalog actually knows its exercises. A card
  // where nothing matched keeps whatever the model said, rather than going blank.
  if (matched) {
    if (muscles.length) card.muscle_groups = muscles.slice(0, 8);
    if (!card.equipment.length && equip.length) card.equipment = equip;
  }
  return card;
}

async function parseWithClaude(system: string, user: string, ctx: AiCtx): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!r.ok) { console.error("anthropic", r.status, await r.text()); return null; }
    const data = await r.json();
    const out = data.content?.map((c: { text?: string }) => c.text ?? "").join("") ?? null;
    await recordCost("anthropic", CLAUDE_MODEL, ctx, {
      inTok: Number(data?.usage?.input_tokens) || approxTokens(system + user),
      outTok: Number(data?.usage?.output_tokens) || approxTokens(out ?? ""),
    }, !!out);
    return out;
  } catch (e) {
    console.error("anthropic failed", e);
    return null;
  }
}

// ---------- vision (fallback for written plans on carousel slides) ----------

function b64encode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function visionCard(dataB64: string, mime: string, fallback: Card, ctx: AiCtx): Promise<Card | null> {
  if (!GEMINI_API_KEY) return null;
  if (isPaidProvider("gemini") && !(await paidAllowed())) return null;
  const prompt =
    "If this image contains a written workout (a training plan, exercise list with sets and reps, " +
    "whiteboard, screenshot of a program, or handwritten notes), extract it. " +
    "Reply with ONLY a JSON object in this shape: " +
    `{"title": string, "category": one of ${JSON.stringify(CATEGORIES)}, "muscle_groups": string[], ` +
    '"equipment": string[], "difficulty": string or null, "duration_minutes": int or null, "calories": int or null, ' +
    '"tags": string[], "has_full_workout": boolean, "blocks": [{"title": string or null, "type": string, ' +
    '"rounds": int or null, "rest_seconds": int or null, "exercises": [{"name": string, "sets": int or null, ' +
    '"reps": string or null, "duration_seconds": int or null, "rest_seconds": int or null, "weight": string or null, ' +
    '"equipment": string or null, "notes": string or null}]}]}. ' +
    "Transcribe exactly what is written, keeping the exercise order from the image. " +
    "If the image does NOT contain a written workout (it is just a person, a gym, or a video frame), " +
    'reply with exactly {"none": true}. Never invent text that is not readable in the image.';
  const text = await geminiGenerate({
    contents: [{ role: "user", parts: [{ inline_data: { mime_type: mime, data: dataB64 } }, { text: prompt }] }],
    generationConfig: { maxOutputTokens: 8000, thinkingConfig: { thinkingBudget: 0 } },
  }, { ...ctx, purpose: "vision" });
  if (!text) return null;
  try {
    const raw = parseJsonLoose(text);
    if (raw.none) return null;
    const card = normalizeCard(raw, fallback);
    return card.has_full_workout ? card : null;
  } catch {
    return null;
  }
}

async function extractFromImage(imgUrl: string, fallback: Card, ctx: AiCtx): Promise<Card | null> {
  if (!GEMINI_API_KEY || !imgUrl) return null;
  try {
    const ir = await safeFetch(imgUrl, { headers: { "User-Agent": DESKTOP_UA }, signal: AbortSignal.timeout(10000) });
    if (!ir.ok) return null;
    const buf = await ir.arrayBuffer();
    if (buf.byteLength < 1000 || buf.byteLength > 4_000_000) return null;
    return await visionCard(b64encode(buf), ir.headers.get("content-type") ?? "image/jpeg", fallback, ctx);
  } catch (e) {
    console.error("extractFromImage failed", e);
    return null;
  }
}

// ---------- extraction waterfall ----------

async function extractCard(meta: Meta, platform: string, ctx: AiCtx): Promise<Card> {
  const fallbackTitle = cleanTitle(meta.caption?.split("\n")[0] ?? "") || "Saved workout";
  const base = heuristicWorkout(meta.caption, fallbackTitle);
  if (!meta.caption || !haveAI()) return base;

  const system = buildPrompt();
  const user = [
    meta.author ? `Creator: ${meta.author}` : "",
    `Platform: ${platform}`,
    "Caption / description:",
    meta.caption.slice(0, 6000),
  ].filter(Boolean).join("\n");

  const text = await textGenerate(system, user, true, ctx);
  if (!text) return base;
  try {
    const card = normalizeCard(parseJsonLoose(text), base);
    // the AI must never come back thinner than the plain parser
    if (!card.blocks.length && base.blocks.length) {
      card.blocks = base.blocks;
      card.has_full_workout = base.has_full_workout;
    }
    return card;
  } catch (e) {
    console.error("card parse failed", e);
    return base;
  }
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube",
};

/**
 * The title for a card whose scrape came back with nothing. "Saved workout" on
 * every such row gives a library of identical cards the user cannot tell apart,
 * and that is what an empty save actually looks like today. The platform is always
 * known and the handle usually survives even when the caption does not, so the row
 * can at least name the thing it came from.
 */
function fallbackTitle(meta: Meta, p: Parsed): string {
  const who = meta.author?.trim().slice(0, 60);
  if (p.platform === "web") {
    let host: string | null = null;
    try { host = new URL(p.clean).hostname.replace(/^www\./, ""); } catch { /* keep null */ }
    const from = who || host;
    return from ? `Workout from ${from}` : "Saved workout";
  }
  const label = PLATFORM_LABEL[p.platform] ?? "Saved";
  const kind = p.platform === "instagram" ? (p.kind === "reel" ? "reel" : "post") : "video";
  return who ? `${label} ${kind} by ${who}` : `${label} ${kind}`;
}

/**
 * A structurally valid, empty card. Used when card building itself throws, so an
 * unexpected failure anywhere in the extraction ladder still leaves the user with a
 * row carrying the link, the platform and a name — never a failed save.
 */
function minimalCard(meta: Meta, p: Parsed): Card {
  return {
    title: cleanTitle(fallbackTitle(meta, p)) || "Saved workout",
    category: "Other",
    muscle_groups: [], equipment: [], difficulty: null,
    duration_minutes: null, calories: null, tags: [],
    has_full_workout: false, blocks: [],
    source_url: p.platform === "web" ? p.clean : null,
  };
}

async function buildCard(meta: Meta, p: Parsed, ctx: AiCtx): Promise<Card> {
  let card = await extractCard(meta, p.platform, ctx);

  // Instagram carousels often put the written plan on a later slide — read it only
  // when the caption produced nothing, since vision burns the scarcest quota.
  if (!card.has_full_workout && p.platform === "instagram" && meta.images?.length) {
    for (const img of meta.images.slice(0, 3)) {
      const fromImage = await extractFromImage(img, card, ctx);
      if (fromImage?.has_full_workout) { card = fromImage; break; }
    }
  }

  // A video's real runtime beats a guess, but only for follow-along lengths —
  // a 3-hour upload is a compilation, not a session.
  if (!card.duration_minutes && meta.seconds) {
    const mins = Math.round(meta.seconds / 60);
    if (mins >= 4 && mins <= 120) card.duration_minutes = mins;
  }
  if (p.platform === "web") card.source_url = p.clean;
  // The extractor's own fallback is the literal string "Saved workout" whenever the
  // caption was missing. Replace it with something identifiable rather than shipping
  // a library of identically named cards.
  if (!card.title.trim() || card.title.trim() === "Saved workout") {
    card.title = cleanTitle(fallbackTitle(meta, p)) || "Saved workout";
  }
  return applyCatalog(card);
}

// Reprocess must never make a card worse: a quota-exhausted re-run comes back
// empty, and silently wiping a good workout would be the worst possible bug.
function mergeNoDowngrade(old: any, next: Card): Card {
  const out: Card = { ...next };
  if (!next.blocks.length && Array.isArray(old.blocks) && old.blocks.length) {
    out.blocks = old.blocks;
    out.has_full_workout = !!old.has_full_workout;
  }
  if (out.category === "Other" && old.category && old.category !== "Other") out.category = old.category;
  if (!out.muscle_groups.length && old.muscle_groups?.length) out.muscle_groups = old.muscle_groups;
  if (!out.equipment.length && old.equipment?.length) out.equipment = old.equipment;
  if (!out.difficulty && old.difficulty) out.difficulty = old.difficulty;
  if (!out.duration_minutes && old.duration_minutes) out.duration_minutes = old.duration_minutes;
  if (!out.calories && old.calories) out.calories = old.calories;
  if (!out.tags.length && old.tags?.length) out.tags = old.tags;
  // a much longer old title is usually the hand-edited one
  if (old.title && (!out.title || old.title.length > out.title.length + 20)) out.title = old.title;
  // Last, not first: blocks pulled back from the old card are pre-catalog rows with
  // no canonical_id, and the derived muscle/equipment must describe what survived
  // the merge rather than what the re-run happened to produce.
  return applyCatalog(out);
}

// ---------- storage + db ----------

// Legacy service keys are JWTs and want a Bearer header; new sb_secret_ keys
// are not JWTs and must be sent as `apikey` only (storage rejects them as Bearer).
const KEY_IS_JWT = SERVICE_KEY.split(".").length === 3;
const authHeaders: Record<string, string> = KEY_IS_JWT
  ? { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` }
  : { apikey: SERVICE_KEY };
const dbHeaders = { ...authHeaders, "content-type": "application/json" };

async function storeThumb(shortcode: string, src: string | null): Promise<string | null> {
  if (!src) return null;
  try {
    const r = await safeFetch(src, { headers: { "User-Agent": DESKTOP_UA } });
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    if (buf.byteLength < 500) return null;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/thumbs/${shortcode}.jpg`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": r.headers.get("content-type") ?? "image/jpeg",
        "x-upsert": "true",
      },
      body: buf,
    });
    if (!up.ok) { console.error("thumb upload", up.status, await up.text()); return null; }
    return `${SUPABASE_URL}/storage/v1/object/public/thumbs/${shortcode}.jpg`;
  } catch (e) {
    console.error("storeThumb failed", e);
    return null;
  }
}

function rest(table: string): string {
  return `${SUPABASE_URL}/rest/v1/${table}`;
}

async function dbSelect(table: string, query: string): Promise<any[]> {
  const r = await fetch(`${rest(table)}?${query}`, { headers: dbHeaders });
  if (!r.ok) throw new Error(`db select ${r.status}: ${await r.text()}`);
  return await r.json();
}

async function dbInsert(table: string, row: Record<string, unknown>): Promise<any> {
  const r = await fetch(rest(table), {
    method: "POST",
    headers: { ...dbHeaders, prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`db insert ${r.status}: ${await r.text()}`);
  return (await r.json())[0];
}

async function dbUpsert(table: string, row: Record<string, unknown>): Promise<void> {
  const r = await fetch(rest(table), {
    method: "POST",
    headers: { ...dbHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  if (!r.ok) console.error(`db upsert ${table}`, r.status, await r.text());
}

async function dbPatchMany(table: string, query: string, body: Record<string, unknown>): Promise<any[]> {
  const r = await fetch(`${rest(table)}?${query}`, {
    method: "PATCH",
    headers: { ...dbHeaders, prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`db patch ${r.status}: ${await r.text()}`);
  return await r.json();
}

async function dbPatch(table: string, query: string, body: Record<string, unknown>): Promise<any> {
  return (await dbPatchMany(table, query, body))[0];
}

/**
 * Call a security-definer function. Every multi-statement piece of queue logic
 * lives behind one of these, because the alternative is a check in the edge
 * function and an insert a few milliseconds later with a race in the gap.
 */
async function rpc(name: string, args: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: dbHeaders,
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`rpc ${name} ${r.status}: ${await r.text()}`);
  return await r.json();
}

/**
 * These counts are the daily caps, which makes their failure mode the interesting
 * part. This used to return 0 whenever the count could not be read, which silently
 * removed the cap at exactly the moment the database was unhealthy. Observed twice
 * while testing: once a transient HEAD failure reported 0 saves against 4 real
 * rows, and once the first request into a freshly deployed isolate got a 401.
 *
 * So: one retry, because a cold-start blip should not fail a user's save; then
 * throw, because an unreadable cap must never read as an empty one.
 */
async function dbCount(table: string, query: string): Promise<number> {
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((res) => setTimeout(res, 150));
    let r: Response;
    try {
      r = await fetch(`${rest(table)}?${query}&select=id`, {
        method: "HEAD",
        headers: { ...dbHeaders, prefer: "count=exact" },
      });
    } catch (e) {
      last = String(e);
      continue;
    }
    if (!r.ok) { last = `${table} ${r.status}`; continue; }
    const range = r.headers.get("content-range") ?? "";
    const n = parseInt(range.split("/")[1] ?? "", 10);
    if (Number.isFinite(n)) return n;
    last = `${table}: unreadable content-range "${range}"`;
  }
  throw new Error(`db count ${last}`);
}

// ---------- auth ----------

// Resolve the caller from their Supabase access token. Deliberately an HTTP call
// rather than local JWT verification: new projects sign with asymmetric keys and
// the algorithm is not ours to assume.
async function userFromBearer(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || token === ANON_KEY) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, authorization: `Bearer ${token}` },
    });
    if (!r.ok) { await r.body?.cancel(); return null; }
    const u = await r.json();
    return typeof u?.id === "string" ? u.id : null;
  } catch (e) {
    console.error("auth lookup failed", e);
    return null;
  }
}

// The long-lived per-user key used by the iOS Shortcut. Hex-validated before it
// ever reaches a PostgREST filter.
async function userFromIngestKey(req: Request, url: URL): Promise<string | null> {
  const key = (req.headers.get("x-ingest-key") ?? url.searchParams.get("key") ?? "").trim();
  if (!/^[0-9a-f]{32}$/.test(key)) return null;
  const rows = await dbSelect("profiles", `ingest_key=eq.${key}&select=id`);
  return rows[0]?.id ?? null;
}

function utcMidnight(): string {
  const d = new Date();
  return `${d.toISOString().slice(0, 10)}T00:00:00Z`;
}

// ---------- handlers ----------

// ---------- limits ----------

type Counts = { saves: number; extracts: number; helpers: number };

/**
 * The three daily ceilings, read together. `extracts` is what actually costs
 * money — it counts a new save AND a reprocess, since both run the full ladder.
 * A cache hit is a save but not an extract, which is the whole point of the cache.
 */
async function countsFor(userId: string): Promise<Counts> {
  const since = utcMidnight();
  const base = `user_id=eq.${userId}&created_at=gte.${since}`;
  const [saves, extracts, helpers] = await settledAll([
    dbCount("saves_log", `${base}&kind=eq.save`),
    dbCount("saves_log", `${base}&cached=is.false&kind=in.(save,reprocess)`),
    dbCount("saves_log", `${base}&kind=eq.helper`),
  ]);
  return { saves, extracts, helpers };
}

function extractLimitResponse(cors: Cors): Response {
  return json({
    status: "limit",
    message:
      `Daily limit reached (${LIMIT_EXTRACT} new extractions/day while Spotter is free) — ` +
      "resets at midnight UTC. Videos someone else already saved still work.",
  }, 429, cors);
}

// ---------- ingest ----------

async function handleIngest(req: Request, userId: string, cors: Cors): Promise<Response> {
  const t0 = Date.now();
  let shared = "";
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("json")) {
    try { shared = (await req.json())?.url ?? ""; } catch (_) { shared = ""; }
  } else {
    shared = (await req.text()).trim();
  }
  if (!shared) return json({ status: "error", message: "No link provided." }, 400, cors);

  const p = await resolveShare(shared);
  if (p === BLOCKED) {
    return json({
      status: "blocked",
      message: "That link points to a private or internal address, so Spotter will not fetch it.",
    }, 400, cors);
  }
  if (!p) return json({ status: "error", message: "No workout link found in what was shared." }, 400, cors);

  const sc = encodeURIComponent(p.shortcode);

  // Three independent questions — do you already have this, are you over a cap,
  // has anyone extracted this video — asked at once. Sequentially they were three
  // round trips on the critical path of a request whose whole purpose is now to
  // return quickly.
  const [dupeR, countsR, cachedR] = await Promise.allSettled([
    dbSelect("workouts", `user_id=eq.${userId}&shortcode=eq.${sc}&select=id,title,ingest_status`),
    countsFor(userId),
    dbSelect("video_cache", `shortcode=eq.${sc}&v=gte.${CARD_V}&select=*`),
  ]);
  for (const r of [dupeR, countsR, cachedR]) {
    if (r.status === "rejected") throw r.reason;
  }
  const dupe = (dupeR as PromiseFulfilledResult<any[]>).value;
  const counts = (countsR as PromiseFulfilledResult<Counts>).value;
  const cached = (cachedR as PromiseFulfilledResult<any[]>).value;

  // Idempotency, cheap layer. The authoritative one is the unique (user_id,
  // shortcode) constraint inside enqueue_ingest — this only saves a round trip on
  // the common "I already have that" case, and reports a save still in flight so a
  // double-tap does not look like a failure.
  if (dupe.length) {
    const processing = dupe[0].ingest_status === "processing";
    return json({
      status: processing ? "processing" : "exists",
      id: dupe[0].id, title: dupe[0].title,
      message: processing ? "Already reading that one." : "Already in your library.",
    }, 200, cors);
  }

  if (counts.saves >= LIMIT_SAVES) {
    return json({
      status: "limit",
      message: `Daily save limit reached (${LIMIT_SAVES}/day while Spotter is free) — resets at midnight UTC.`,
    }, 429, cors);
  }

  // A cache hit costs nothing and already answers in well under a second. Pushing
  // it through the queue would make the fast path slower to no purpose, so it
  // stays synchronous and comes back as a finished card.
  if (cached.length) {
    const c = cached[0];
    const card = c.card as Card;
    const meta: Meta = { caption: c.caption, thumb: c.thumb_url, author: c.author, source: "cache" };
    let row;
    try {
      row = await dbInsert("workouts", {
        user_id: userId,
        url: p.clean, shortcode: p.shortcode, platform: p.platform, kind: p.kind,
        author: meta.author, title: card.title, caption: meta.caption, thumb_url: c.thumb_url,
        category: card.category, muscle_groups: card.muscle_groups, equipment: card.equipment,
        difficulty: card.difficulty, duration_minutes: card.duration_minutes, calories: card.calories,
        blocks: card.blocks, tags: card.tags, has_full_workout: card.has_full_workout,
        source_url: card.source_url ?? null, ingest_status: "ready",
      });
    } catch (e) {
      // Two simultaneous saves of the same cached video by the same user: the
      // unique constraint rejects the second, which is correct, not an error.
      if (!String(e).includes("23505")) throw e;
      const again = await dbSelect("workouts", `user_id=eq.${userId}&shortcode=eq.${sc}&select=id,title`);
      return json({ status: "exists", id: again[0]?.id, title: again[0]?.title, message: "Already in your library." }, 200, cors);
    }
    await logSave(userId, p, meta, card, c.thumb_url, true, false, "save", null);
    console.log("cache hit", p.platform, p.shortcode, "served in", Date.now() - t0, "ms");
    return json({
      status: "saved", cached: true, id: row.id, title: row.title,
      category: row.category, has_full_workout: row.has_full_workout, degraded: false,
    }, 200, cors);
  }

  if (counts.extracts >= LIMIT_EXTRACT) return extractLimitResponse(cors);

  // Cache miss. Everything past here used to happen inline: scrape, model call,
  // thumbnail upload, 5-15 seconds with the user's request held open. Now it is a
  // row in a table and somebody else's problem, and the response is the row the
  // user can already see.
  const provisional = cleanTitle(fallbackTitle({ caption: null, thumb: null, author: null }, p)) || "Saved workout";
  const q = (await rpc("enqueue_ingest", {
    p_user: userId, p_url: p.clean, p_shortcode: p.shortcode,
    p_platform: p.platform, p_kind: p.kind, p_title: provisional,
  }))[0];

  if (!q) throw new Error("enqueue_ingest returned nothing");
  if (q.already) {
    return json({ status: "exists", id: q.workout_id, message: "Already in your library." }, 200, cors);
  }

  console.log("enqueued", p.platform, p.shortcode, "job", q.job_id,
    q.job_created ? "(new)" : "(joined existing)", "in", Date.now() - t0, "ms");
  kickWorker();

  return json({
    status: "processing",
    id: q.workout_id,
    job_id: q.job_id,
    title: provisional,
    message: "Reading the video…",
  }, 202, cors);
}

/**
 * Per-save success metrics. Cheap by construction — no extra fetch, no extra model
 * call, just what the save already knows — so the cost of knowing a platform has
 * degraded is one column set on a row that was being written anyway.
 *
 * saves_log is also the rate limiter, so the insert falls back to the legacy shape
 * if the metrics columns are missing and never propagates: losing telemetry is
 * survivable, failing a save the user already made is not.
 */
async function logSave(
  userId: string, p: Parsed, meta: Meta, card: Card,
  thumbUrl: string | null, fromCache: boolean, degraded: boolean,
  kind: "save" | "reprocess" | "helper" = "save", jobId: string | null = null,
): Promise<void> {
  const exercises = card.blocks.reduce((n, b) => n + (b.exercises?.length ?? 0), 0);
  const base = { user_id: userId, shortcode: p.shortcode, cached: fromCache, kind };
  try {
    await dbInsert("saves_log", {
      ...base,
      job_id: jobId,
      platform: p.platform,
      meta_source: meta.source ?? null,
      caption_found: !!meta.caption,
      caption_chars: meta.caption?.length ?? 0,
      thumb_found: !!thumbUrl,
      author_found: !!meta.author,
      exercises_found: exercises,
      degraded,
    });
  } catch (e) {
    console.error("saves_log metrics insert failed, retrying legacy shape", e);
    try {
      await dbInsert("saves_log", base);
    } catch (e2) {
      console.error("saves_log insert failed entirely", e2);
    }
  }
}

// ---------- the worker ----------
//
// Two things drive it. Ingest fires a kick the instant a job lands, which is what
// makes a card fill in a few seconds rather than at the top of the next minute;
// pg_cron sweeps every minute as the backstop for when a kick is lost. Neither
// path is trusted on its own, and both are idempotent because SKIP LOCKED means a
// job can only ever be claimed once.

type Job = {
  id: string;
  user_id: string;
  url: string;
  shortcode: string;
  platform: string;
  kind: string | null;
  step: string;
  meta: Meta | null;
  card: Card | null;
  attempts: number;
  max_attempts: number;
};

/** 30s, 60s, 120s, 240s… capped. Long enough for a rate limit to lift, short
 *  enough that a user watching a pending card sees it resolve. */
function backoffMs(attempts: number): number {
  return Math.min(15_000 * Math.pow(2, Math.max(1, attempts)), 15 * 60_000);
}

function kickWorker(): void {
  if (!WORKER_SECRET) { console.error("worker kick skipped: WORKER_SECRET is not set"); return; }
  background(
    fetch(`${SELF_URL}/api/worker/tick`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-secret": WORKER_SECRET },
      body: JSON.stringify({ source: "kick" }),
      signal: AbortSignal.timeout(15_000),
    }).then(async (r) => {
      const body = await r.text();
      if (!r.ok) console.error("worker kick", r.status, body.slice(0, 200));
    }),
  );
}

async function jobStep(id: string, step: string, extra: Record<string, unknown>): Promise<void> {
  await dbPatch("ingest_jobs", `id=eq.${id}`, { step, ...extra, updated_at: new Date().toISOString() });
}

/**
 * Write the finished card onto every workouts row waiting for this video, not
 * just the one that triggered the job. This is why the job is keyed on the
 * shortcode: two users saving the same reel at the same moment share one
 * extraction, and both libraries fill in from it.
 */
async function finishJob(
  job: Job, p: Parsed, meta: Meta, card: Card, thumbUrl: string | null, degraded: boolean,
): Promise<void> {
  const sc = encodeURIComponent(p.shortcode);
  const filled = await dbPatchMany("workouts", `shortcode=eq.${sc}&ingest_status=eq.processing`, {
    url: p.clean, platform: p.platform, kind: p.kind,
    author: meta.author, title: card.title, caption: meta.caption, thumb_url: thumbUrl,
    category: card.category, muscle_groups: card.muscle_groups, equipment: card.equipment,
    difficulty: card.difficulty, duration_minutes: card.duration_minutes, calories: card.calories,
    blocks: card.blocks, tags: card.tags, has_full_workout: card.has_full_workout,
    source_url: card.source_url ?? null,
    ingest_status: "ready", ingest_error: null,
  });

  // The rate-limit row was written at enqueue time so a burst could not slip past
  // the cap; the quality metrics only exist now, so they are patched in afterwards.
  const exercises = card.blocks.reduce((n, b) => n + (b.exercises?.length ?? 0), 0);
  try {
    await dbPatchMany("saves_log", `job_id=eq.${job.id}`, {
      platform: p.platform,
      meta_source: meta.source ?? null,
      caption_found: !!meta.caption,
      caption_chars: meta.caption?.length ?? 0,
      thumb_found: !!thumbUrl,
      author_found: !!meta.author,
      exercises_found: exercises,
      degraded,
    });
  } catch (e) {
    console.error("saves_log metrics patch failed", job.id, e);
  }

  const now = new Date().toISOString();
  // meta and card are cleared: they exist to let a retry resume, and the finished
  // card lives in video_cache and on the rows. Keeping them would make this table
  // grow by a caption per save forever.
  //
  // Guarded on still holding the claim. A worker the sweeper has already given up
  // on can come back to life — the isolate was slow, not dead — and must not
  // stamp 'done' over a job that has since been reassigned and re-claimed.
  const closed = await dbPatchMany("ingest_jobs", `id=eq.${job.id}&locked_by=eq.${WORKER_ID}`, {
    status: "done", step: "done", finished_at: now, updated_at: now,
    locked_by: null, locked_at: null, meta: null, card: null,
  });
  if (!closed.length) {
    console.warn("job", job.id, "finished but the claim had already been taken back — rows were written, job left alone");
    return;
  }
  console.log("job done", job.id, p.platform, p.shortcode,
    "rows filled:", filled.length, "exercises:", exercises, degraded ? "(degraded)" : "");
}

/**
 * Retry with backoff, then stop. A job that has failed max_attempts times is not
 * going to succeed on the eleventh; it becomes 'dead' and the user's card becomes
 * retryable rather than eternally pending.
 */
async function failJob(job: Job, err: unknown): Promise<void> {
  const msg = String(err).slice(0, 500);
  const dead = job.attempts >= job.max_attempts;
  console.error("job", dead ? "DEAD" : "failed", job.id, job.platform, job.shortcode,
    "attempt", job.attempts, "of", job.max_attempts, "—", msg);
  const now = new Date().toISOString();
  try {
    // Same claim guard as finishJob: only the worker that still holds the job may
    // decide its fate. Without this a slow worker's failure would push a job the
    // sweeper had already handed to somebody else back onto the queue.
    const moved = await dbPatchMany("ingest_jobs", `id=eq.${job.id}&locked_by=eq.${WORKER_ID}`, {
      status: dead ? "dead" : "queued",
      run_after: new Date(Date.now() + backoffMs(job.attempts)).toISOString(),
      locked_by: null, locked_at: null, last_error: msg,
      finished_at: dead ? now : null, updated_at: now,
    });
    if (!moved.length) {
      console.warn("job", job.id, "failed but the claim had already been taken back — leaving it alone");
      return;
    }
    if (dead) {
      await dbPatchMany("workouts", `ingest_job_id=eq.${job.id}&ingest_status=eq.processing`, {
        ingest_status: "failed",
        ingest_error: "Spotter could not read this video. Tap ↻ to try again.",
      });
    }
  } catch (e) {
    console.error("failJob could not record the failure", job.id, e);
  }
}

async function runJob(job: Job): Promise<void> {
  const p: Parsed = {
    platform: job.platform as Parsed["platform"],
    shortcode: job.shortcode,
    kind: job.kind ?? "video",
    clean: job.url,
  };
  const ctx: AiCtx = { purpose: "extract", userId: job.user_id };
  const sc = encodeURIComponent(p.shortcode);

  // Somebody may have filled the cache while this job was waiting on a backoff.
  // Paying for the same extraction twice because the queue was slow would defeat
  // the point of having a cache at all.
  const cached = await dbSelect("video_cache", `shortcode=eq.${sc}&v=gte.${CARD_V}&select=*`);
  if (cached.length) {
    const c = cached[0];
    await finishJob(job, p,
      { caption: c.caption, thumb: c.thumb_url, author: c.author, source: "cache" },
      c.card as Card, c.thumb_url, false);
    return;
  }

  // Resume from wherever the last attempt got to. A model that timed out should
  // not cost a second scrape of a caption we already have.
  let meta: Meta;
  if (job.step === "meta" || !job.meta) {
    meta = await fetchMeta(p);          // throws: worth a retry, that is a network fault
    await jobStep(job.id, "card", { meta });
  } else {
    meta = job.meta;
  }

  let card: Card;
  let degraded = false;
  if (job.step === "thumb" && job.card) {
    card = job.card;
  } else {
    try {
      card = await buildCard(meta, p, ctx);
    } catch (e) {
      console.error("job buildCard failed", job.id, e);
      card = minimalCard(meta, p);
      degraded = true;
    }
    await jobStep(job.id, "thumb", { card });
  }

  let thumbUrl: string | null = null;
  try {
    thumbUrl = await storeThumb(p.shortcode, meta.thumb);
  } catch (e) {
    console.error("job storeThumb failed", job.id, e);
  }
  if (!meta.caption) degraded = true;

  // Nothing at all: no caption, no thumbnail, no handle, no exercises. That is a
  // platform refusing us rather than a video without a written workout, and it is
  // worth another attempt before the job is given up on.
  if (!meta.caption && !meta.author && !thumbUrl && !card.blocks.length) {
    throw new Error("no metadata from any source for " + p.platform + " " + p.shortcode +
      " (tried " + (meta.source ?? "none") + ")");
  }

  // Only cache a card worth reusing. Writing an empty scrape at the current
  // extraction version would pin that emptiness for everyone who saves the video
  // next and for every retry of this one, which is the opposite of failing soft.
  if (meta.caption || card.blocks.length) {
    await dbUpsert("video_cache", {
      shortcode: p.shortcode, url: p.clean, platform: p.platform, kind: p.kind,
      author: meta.author, caption: meta.caption, thumb_url: thumbUrl,
      card, v: CARD_V, updated_at: new Date().toISOString(),
    });
  } else {
    console.log("empty scrape, not cached", p.platform, p.shortcode, "source:", meta.source);
  }

  await finishJob(job, p, meta, card, thumbUrl, degraded);
}

async function handleWorkerTick(req: Request): Promise<Response> {
  // Not 401: an unauthenticated caller should not learn this route exists.
  if (!secretEquals(req.headers.get("x-worker-secret") ?? "", WORKER_SECRET)) {
    return json({ status: "error", message: "Not found" }, 404);
  }

  try {
    await rpc("sweep_ingest_jobs", { p_stale_seconds: WORKER_STALE_SECONDS });
  } catch (e) {
    console.error("sweep failed", e);   // not fatal: claiming is still worth trying
  }

  const jobs = (await rpc("claim_ingest_jobs", { p_worker: WORKER_ID, p_limit: WORKER_BATCH })) as Job[];
  if (!jobs.length) return json({ status: "ok", claimed: 0 });

  console.log("claimed", jobs.length, "job(s):", jobs.map((j) => j.shortcode).join(","));
  const work = Promise.all(jobs.map((j) => runJob(j).catch((e) => failJob(j, e))));

  // Return before the work finishes — otherwise the tick is just the old
  // synchronous ingest wearing a different hat. The claim is already committed, so
  // nothing else will pick these up, and the sweeper covers this isolate dying.
  if (hasWaitUntil()) {
    background(work);
    return json({ status: "ok", claimed: jobs.length, mode: "background" });
  }
  await work;
  return json({ status: "ok", claimed: jobs.length, mode: "inline" });
}

async function handleReprocess(id: string, userId: string, cors: Cors): Promise<Response> {
  const rows = await dbSelect("workouts", `id=eq.${id}&user_id=eq.${userId}&select=*`);
  if (!rows.length) return json({ status: "error", message: "Not found." }, 404, cors);
  const old = rows[0];

  // Reprocess re-runs the whole extraction ladder — the same scrape and the same
  // model call as a new save. It was counted by nothing at all, which made the
  // daily cap trivially bypassable by anyone holding the ↻ button.
  const counts = await countsFor(userId);
  if (counts.extracts >= LIMIT_EXTRACT) return extractLimitResponse(cors);

  // A card that never finished — or that died in the queue — is not something to
  // re-run inline. It goes back on the queue, so the retry gets the same backoff,
  // dead-lettering and one-job-per-video guarantees as the original save.
  if (old.ingest_status !== "ready") {
    const q = (await rpc("requeue_ingest", { p_user: userId, p_workout: id }))[0];
    if (!q) return json({ status: "error", message: "Not found." }, 404, cors);
    console.log("requeued", old.platform, old.shortcode, "job", q.job_id, q.job_created ? "(new)" : "(joined existing)");
    kickWorker();
    return json({ status: "processing", id, job_id: q.job_id, message: "Trying that video again…" }, 202, cors);
  }

  const p: Parsed = {
    platform: old.platform, shortcode: old.shortcode, kind: old.kind ?? "video", clean: old.url,
  };
  const ctx: AiCtx = { purpose: "reprocess", userId };
  // Same fail-soft rule as ingest: a re-run that cannot reach the platform falls
  // back to what is already stored rather than erroring out. mergeNoDowngrade then
  // guarantees the saved card cannot come back thinner than it went in.
  let meta: Meta = { caption: null, thumb: null, author: null, source: "none" };
  try {
    meta = await fetchMeta(p);
  } catch (e) {
    console.error("reprocess fetchMeta failed", p.platform, p.shortcode, e);
  }
  if (!meta.caption && old.caption) meta.caption = old.caption;
  let fresh: Card;
  try {
    fresh = await buildCard(meta, p, ctx);
  } catch (e) {
    console.error("reprocess buildCard failed", p.shortcode, e);
    fresh = minimalCard(meta, p);
  }
  const card = mergeNoDowngrade(old, fresh);

  let thumbUrl: string | null = old.thumb_url;
  try {
    thumbUrl = (await storeThumb(p.shortcode, meta.thumb)) ?? old.thumb_url;
  } catch (e) {
    console.error("reprocess storeThumb failed", p.shortcode, e);
  }
  const updated = await dbPatch("workouts", `id=eq.${id}&user_id=eq.${userId}`, {
    title: card.title, category: card.category, muscle_groups: card.muscle_groups,
    equipment: card.equipment, difficulty: card.difficulty, duration_minutes: card.duration_minutes,
    calories: card.calories, blocks: card.blocks, tags: card.tags,
    has_full_workout: card.has_full_workout, caption: meta.caption ?? old.caption, thumb_url: thumbUrl,
  });

  // keep the shared cache fresh too, so the next person to save it gets the better card
  await dbUpsert("video_cache", {
    shortcode: p.shortcode, url: p.clean, platform: p.platform, kind: p.kind,
    author: meta.author ?? old.author, caption: meta.caption ?? old.caption, thumb_url: thumbUrl,
    card, v: CARD_V, updated_at: new Date().toISOString(),
  });

  // Charged to the same ledger and the same daily cap as a save, and recorded with
  // the same per-platform metrics, because it is the same work.
  await logSave(userId, p, meta, card, thumbUrl, false, !meta.caption, "reprocess", null);
  return json({ status: "ok", workout: updated }, 200, cors);
}

/**
 * Thin AI passthrough for the explain/swap helpers: validate, cap input, generate,
 * return text. Metered on its own looser ceiling — one short completion is far
 * cheaper than an extraction, but "far cheaper" is not "free", and these two routes
 * were previously the only way to spend Spotter's money without limit.
 */
async function aiText(
  system: string, user: string, cors: Cors, userId: string, purpose: string, helpersToday: number,
): Promise<Response> {
  if (!haveAI()) return json({ status: "error", message: "AI is not configured yet." }, 503, cors);
  if (helpersToday >= LIMIT_HELPER) {
    return json({
      status: "limit",
      message: `Daily coaching limit reached (${LIMIT_HELPER}/day) — resets at midnight UTC.`,
    }, 429, cors);
  }
  const out = await textGenerate(system, user, false, { purpose, userId });
  if (!out) return json({ status: "error", message: "The AI is busy — try again in a minute." }, 503, cors);
  // Only a successful answer is charged: a provider outage should not eat the
  // user's daily allowance.
  try {
    await dbInsert("saves_log", { user_id: userId, kind: "helper", cached: false, shortcode: null });
  } catch (e) {
    console.error("helper saves_log insert failed", e);
  }
  return json({ status: "ok", text: out.trim() }, 200, cors);
}

// ---------- router ----------

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  try {
    const url = new URL(req.url);
    const i = url.pathname.indexOf("/spotter");
    const path = i >= 0 ? url.pathname.slice(i + "/spotter".length) || "/" : url.pathname;

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (req.method === "HEAD" && (path === "/" || path === "/icon.png")) {
      return new Response(null, { status: 200, headers: cors });
    }
    if (req.method === "GET" && (path === "/" || path === "")) {
      return new Response(PAGE_HTML, {
        headers: { ...cors, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    if (req.method === "GET" && path === "/icon.png") {
      const bin = Uint8Array.from(atob(ICON_B64), (c) => c.charCodeAt(0));
      return new Response(bin, {
        headers: { ...cors, "content-type": "image/png", "cache-control": "public, max-age=86400" },
      });
    }
    if (req.method === "GET" && path === "/manifest.webmanifest") {
      return json({
        name: "Spotter", short_name: "Spotter", start_url: ".", scope: ".",
        display: "standalone", background_color: "#F5F6F8", theme_color: "#F5F6F8",
        icons: [{ src: "icon.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }],
      }, 200, cors);
    }

    if (!path.startsWith("/api/")) return json({ status: "error", message: "Not found" }, 404, cors);

    // The worker is machine-to-machine — pg_cron via pg_net, and the function
    // kicking itself after a save. It authenticates with a shared secret rather
    // than a user token, so it has to be matched before the user-auth gate below.
    if (req.method === "POST" && path === "/api/worker/tick") return await handleWorkerTick(req);

    // One auth resolution for every API route. Ingest is the only route that also
    // accepts the long-lived per-user key.
    let userId = await userFromBearer(req);
    if (!userId && path === "/api/ingest") userId = await userFromIngestKey(req, url);
    if (!userId) return json({ status: "error", message: "Sign in to use Spotter." }, 401, cors);

    if (req.method === "POST" && path === "/api/ingest") return await handleIngest(req, userId, cors);

    const reproc = path.match(/^\/api\/workouts\/([0-9a-f-]{36})\/reprocess$/);
    if (req.method === "POST" && reproc) return await handleReprocess(reproc[1], userId, cors);

    if (req.method === "POST" && path === "/api/explain") {
      const body = await req.json().catch(() => ({}));
      const exercise = String(body?.exercise ?? "").slice(0, 120).trim();
      if (!exercise) return json({ status: "error", message: "No exercise given." }, 400, cors);
      const system =
        "You are a calm, experienced personal trainer. In 3-5 short sentences, explain how to perform the " +
        "exercise with good form: the setup, the movement, what to feel, and the single most common mistake. " +
        "Plain language, no lists, no emojis. If the movement is risky for beginners, say so briefly.";
      const { helpers } = await countsFor(userId);
      return await aiText(system, `Exercise: ${exercise}` +
        (body?.title ? `\nFrom the workout: ${String(body.title).slice(0, 120)}` : ""),
        cors, userId, "explain", helpers);
    }

    if (req.method === "POST" && path === "/api/swap") {
      const body = await req.json().catch(() => ({}));
      const exercise = String(body?.exercise ?? "").slice(0, 120).trim();
      if (!exercise) return json({ status: "error", message: "No exercise given." }, 400, cors);
      const have = String(body?.equipment_have ?? "").slice(0, 200).trim();
      const system =
        "You are a personal trainer suggesting substitute exercises. Give 1-3 alternatives that train the same " +
        "muscles with a similar stimulus, each as one line: the name, then a short why. Be honest about what is " +
        "lost in the swap. No emojis, no preamble.";
      const { helpers } = await countsFor(userId);
      return await aiText(system,
        `Exercise to replace: ${exercise}` + (have ? `\nAvailable equipment: ${have}` : "\nAssume bodyweight only."),
        cors, userId, "swap", helpers);
    }

    if (req.method === "POST" && path === "/api/rotate-key") {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      const key = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
      await dbPatch("profiles", `id=eq.${userId}`, { ingest_key: key });
      return json({ status: "ok", ingest_key: key }, 200, cors);
    }

    if (req.method === "GET" && path === "/api/limits") {
      const counts = await countsFor(userId);
      // The spend figures are global rather than per-user: the ceiling protects the
      // project's bill, and it is the one number that has to be visible from
      // outside the logs when extraction quietly drops to the free path.
      const spent = await spendToday();
      return json({
        status: "ok",
        saves_today: counts.saves, extracts_today: counts.extracts, helpers_today: counts.helpers,
        limit_saves: LIMIT_SAVES, limit_extract: LIMIT_EXTRACT, limit_helper: LIMIT_HELPER,
        spend_today: Number(spent.toFixed(4)), spend_limit: DAILY_SPEND_USD,
        paid_enabled: DAILY_SPEND_USD > 0 && spent < DAILY_SPEND_USD,
      }, 200, cors);
    }

    return json({ status: "error", message: "Not found" }, 404, cors);
  } catch (e) {
    console.error("unhandled", e);
    return json({ status: "error", message: String(e) }, 500, cors);
  }
});

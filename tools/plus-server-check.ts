// The server half of "Spotter Plus is always visible": what is on sale, what a
// refusal says about it, and what the Plus page is told. Lifted out of the real
// index.ts and billing.ts and run on their own, the way
// tools/allowance-table-check.ts lifts the allowance table. No network, no
// database, no Stripe.
//
// What has to hold:
// - Plus is on sale with no app_config row and no Stripe key (the store sells
//   it), `billing.store_plans` can take it off sale, an unreadable table is the
//   code default, and Stripe prices still add to the list when a key is set.
// - A Basic account at the shelf gets upgrade:true, next_plan plus, next_cap
//   null, and a sentence that names Plus for the Share Extension; a Plus account
//   at a burst stop still gets upgrade:false (pro is on sale nowhere).
// - The preview refusals carry cap/used/next_cap/scope/resets_at.
// - GET /api/billing/prices carries caps and features with configured:false,
//   with Stripe's prices, and on a Stripe failure.
// - Basic's media ceiling is reported as the number the read route enforces.
//
//   deno run --allow-read tools/plus-server-check.ts        (from the repo root)

const ROOT = new URL("../", import.meta.url);
const INDEX = await Deno.readTextFile(new URL("supabase/functions/spotter/index.ts", ROOT));
const BILLING = await Deno.readTextFile(new URL("supabase/functions/spotter/billing.ts", ROOT));

/** A top-level function, `export`/`async` or not, ended by the closing brace in column 0. */
function fn(src: string, name: string): string {
  const m = src.match(new RegExp("^(?:export )?(?:async )?function " + name + "\\(", "m"));
  if (!m || m.index === undefined) throw new Error("no longer declares function " + name);
  const end = src.indexOf("\n}", m.index);
  return src.slice(m.index, end + 2).replace(/^export /, "");
}
/** A top-level `const`/`let`, ended by `;` at a line end (or `};` for an object). */
function decl(src: string, head: string): string {
  const start = src.indexOf("\n" + head);
  if (start < 0) throw new Error("no longer declares " + head);
  const brace = src.indexOf("\n};", start), semi = src.indexOf(";\n", start);
  return brace > start && brace < semi ? src.slice(start + 1, brace + 3) : src.slice(start + 1, semi + 2);
}

// ---------- billing.ts: what is on sale ----------

const billingModule = [
  "let rows: any[] | Error = [];",
  "let stripeKey = false;",
  "let catalog: any = { byKey: {} };",
  "export function setRows(r: any[] | Error) { rows = r; storePlansCache = null; }",
  "export function setStripe(on: boolean, byKey: any = {}) { stripeKey = on; catalog = { byKey }; }",
  "async function bSelect(table: string, query: string) { if (table !== 'app_config' || !/billing\\.store_plans/.test(query)) throw new Error('unexpected read ' + table + ' ' + query); if (rows instanceof Error) throw rows; return rows; }",
  "function billingConfigured() { return stripeKey; }",
  "async function loadCatalog() { if (catalog instanceof Error) throw catalog; return catalog; }",
  "const CFG_TTL_MS = 5 * 60_000;",
  decl(BILLING, "const STORE_PLANS_DEFAULT"),
  decl(BILLING, "let storePlansCache"),
  fn(BILLING, "storePlans"),
  fn(BILLING, "sellablePlans"),
  "export { sellablePlans };",
].join("\n\n");

// The code under test logs its fallbacks, which are the cases being asserted.
const quiet = console.error;
console.error = () => {};
const B = await import("data:application/typescript," + encodeURIComponent(billingModule));

let checks = 0;
async function check(name: string, body: () => void | Promise<void>): Promise<void> {
  await body();
  checks++;
  console.log("PASS " + name);
}
function eq(a: unknown, b: unknown, why?: string): void {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((why ? why + ": " : "") + x + " !== " + y);
}
function ok(v: unknown, why: string): void { if (!v) throw new Error(why); }

await check("Plus is on sale with no config row and no Stripe key", async () => {
  B.setStripe(false); B.setRows([]);
  eq(await B.sellablePlans(), ["plus"]);
});
await check("billing.store_plans takes a plan off sale, or lists more, in JSON or as a comma list", async () => {
  B.setStripe(false);
  B.setRows([{ value: "[]" }]); eq(await B.sellablePlans(), []);
  B.setRows([{ value: "" }]); eq(await B.sellablePlans(), [], "an empty value is nothing on sale");
  B.setRows([{ value: '["plus","pro"]' }]); eq(await B.sellablePlans(), ["plus", "pro"]);
  B.setRows([{ value: "Plus, pro" }]); eq(await B.sellablePlans(), ["plus", "pro"]);
  B.setRows([{ value: '["plus","drop table"]' }]); eq(await B.sellablePlans(), ["plus"], "only plan-shaped names");
});
await check("an unreadable app_config is the code default, not nothing on sale", async () => {
  B.setStripe(false); B.setRows(new Error("db down"));
  eq(await B.sellablePlans(), ["plus"]);
});
await check("Stripe prices still add to the list, and a Stripe failure only drops Stripe's", async () => {
  B.setRows([]);
  B.setStripe(true, { spotter_pro_month: { unit_amount: 999 }, spotter_plus_year: { unit_amount: 4999 } });
  eq((await B.sellablePlans()).sort(), ["plus", "pro"]);
  B.setStripe(true, new Error("stripe down") as any);
  eq(await B.sellablePlans(), ["plus"]);
});

// ---------- index.ts: refusals and the prices route ----------

const indexModule = [
  "let sellable: string[] = ['plus'];",
  "export function setSellable(s: string[]) { sellable = s; }",
  "async function sellablePlans() { return sellable; }",
  "function models() {}",
  "async function ensureConfig() {}",
  'function plusPlan(plan: string): boolean { return ["plus", "pro", "staff"].includes(plan); }',
  "let stripeKey = false, stripeFails = false;",
  "export function setStripe(on: boolean, fails = false) { stripeKey = on; stripeFails = fails; }",
  "function billingConfigured() { return stripeKey; }",
  "async function pricesBlock() { if (stripeFails) throw new Error('stripe down'); return { configured: true, currency: 'usd', trial_days: 0, plans: { plus: { month: { amount: 699 }, year: { amount: 4999 } } }, founding: null }; }",
  "function pumpyConfig() { return { plans: { free: { day: 150, month: 1500 }, plus: { day: 400, month: 5000 } }, perMinute: 6 }; }",
  "type Cors = Record<string, string>;",
  "type LimitKind = 'library' | 'saves' | 'extract' | 'media' | 'uploads' | 'helper';",
  "type LimitCaps = Record<LimitKind, number | null>;",
  "type UserCaps = { plan: string; caps: LimitCaps };",
  decl(INDEX, "const LIMITS_DEFAULTS"),
  "const LIMITS_FLOOR = LIMITS_DEFAULTS;",
  "function limitsConfig() { return LIMITS_DEFAULTS; }",
  decl(INDEX, "const PLAN_LADDER"),
  decl(INDEX, "type AllowanceKind"),
  decl(INDEX, "type Allowance "),
  decl(INDEX, "const ALLOWANCE_KINDS"),
  decl(INDEX, "const ALLOWANCE_DEFAULTS"),
  decl(INDEX, "const PREVIEW_CAP"),
  "function allowancesConfig() { return ALLOWANCE_DEFAULTS; }",
  decl(INDEX, "const PLAN_NAMES"),
  decl(INDEX, "const BASIC_MEDIA_BURST"),
  decl(INDEX, "const PLAN_FEATURES"),
  ...["isDailyKind", "allowanceFor", "biggerCap", "upgradePath", "planName", "capMessage", "capLimit",
    "previewLimit", "mediaBurst", "capsBlock", "json", "utcNextMidnight", "utcNextMonth", "handleBilling"]
    .map((n) => fn(INDEX, n)),
  "export { capLimit, previewLimit, mediaBurst, handleBilling, LIMITS_DEFAULTS };",
].join("\n\n");
const M = await import("data:application/typescript," + encodeURIComponent(indexModule));

const body = async (r: Response) => ({ ...(await r.json()), http: r.status });
const basic = { plan: "free", caps: { ...M.LIMITS_DEFAULTS.free } };
const plus = { plan: "plus", caps: { ...M.LIMITS_DEFAULTS.plus } };

await check("a Basic account at the shelf is shown Plus, and told where it is from the Share Extension", async () => {
  M.setSellable(["plus"]);
  const r = await body(await M.capLimit("library", basic, 20, {}));
  eq([r.http, r.upgrade, r.next_plan, r.next_cap, r.cap, r.used, r.resets_at], [429, true, "plus", null, 20, 20, null]);
  ok(r.message.startsWith("That is 20 saved workouts — the whole Basic library."), r.message);
  ok(r.message.endsWith(" Spotter Plus keeps every workout — open Spotter to see it."), r.message);
  ok(r.message.length <= 300, "the Share Extension shows 300 characters: " + r.message.length);
});
await check("with Plus off sale the shelf is a plain refusal, exactly as before", async () => {
  M.setSellable([]);
  const r = await body(await M.capLimit("library", basic, 20, {}));
  eq(r.upgrade, false);
  ok(!/Plus/.test(r.message), r.message);
  M.setSellable(["plus"]);
});
await check("a Plus account at a burst stop is told the ceiling, not sold a tier on sale nowhere", async () => {
  M.setSellable(["plus"]);
  const r = await body(await M.capLimit("saves", plus, 200, {}));
  eq([r.upgrade, r.next_plan], [false, undefined]);
  const b = await body(await M.capLimit("saves", basic, 30, {}));
  eq([b.upgrade, b.next_plan, b.next_cap], [true, "plus", 200], "and Basic at the same stop is shown Plus");
});
await check("a preview refusal says what ran out, when it comes back and what Plus reads", async () => {
  const r = await body(M.previewLimit(basic, "You have used all four Plus video previews this month.", {}));
  eq([r.http, r.status, r.kind, r.upgrade, r.plan, r.cap, r.used, r.scope, r.next_plan, r.next_cap],
    [429, "limit", "media", true, "free", 4, 4, "month", "plus", 20]);
  ok(/^\d{4}-\d\d-01T00:00:00\.000Z$/.test(r.resets_at), "resets on the 1st: " + r.resets_at);
});
await check("Basic's media ceiling is the one the read route enforces", () => {
  eq(M.mediaBurst(basic), 15);
  eq(M.mediaBurst(plus), plus.caps.media);
});

const pricesReq = () => new Request("https://fn.invalid/api/billing/prices", { method: "GET" });
await check("the prices route always carries caps and features, also with configured:false", async () => {
  M.setStripe(false);
  const r = await body(await M.handleBilling("/api/billing/prices", pricesReq(), "u1", {}));
  eq([r.http, r.status, r.configured], [200, "ok", false]);
  eq(r.features, { pumpy: ["plus"], awards_all: ["plus"] });
  eq([r.caps.free.library, r.caps.plus.library, r.caps.free.month_reads, r.caps.plus.month_reads], [20, null, 4, 20]);
  eq([r.caps.free.month_answers, r.caps.plus.month_answers], [0, 300], "Basic's coaching is none");
  eq([r.caps.free.month_helpers, r.caps.plus.month_helpers, r.caps.free.month_uploads, r.caps.plus.month_uploads],
    [20, 100, 1, 10]);
  eq(r.caps.free.media, 15, "the media ceiling the read route enforces");
  M.setStripe(true);
  const s = await body(await M.handleBilling("/api/billing/prices", pricesReq(), "u1", {}));
  eq([s.configured, s.plans.plus.year.amount, !!s.caps.free, !!s.features], [true, 4999, true, true]);
  M.setStripe(true, true);
  const f = await body(await M.handleBilling("/api/billing/prices", pricesReq(), "u1", {}));
  eq([f.http, f.code, !!f.caps.plus, !!f.features], [502, "billing_failed", true, true]);
});

console.error = quiet;
console.log(checks + " Plus server checks passed");

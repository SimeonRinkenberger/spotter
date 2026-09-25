// The monthly allowance table and the copy of its refusals, lifted out of
// index.ts and run on their own.
//
// This is the half of tools/allowance-harness.mjs that needs no DOM, so it can
// live in `npm run gtm:check`: what a person is sold has to survive a config
// typo, an unknown plan and a seed that names two plans out of four, and a 429
// has to name the allowance, the month and the day it comes back.
//
//   deno run --allow-read tools/allowance-table-check.ts     (from the repo root)

const ROOT = new URL("../", import.meta.url);
const SRC = await Deno.readTextFile(new URL("supabase/functions/spotter/index.ts", ROOT));

/** A top-level `function name(...) {...}`, ended by the closing brace in column 0. */
function fn(name: string): string {
  const head = "function " + name + "(";
  const start = SRC.indexOf("\n" + head);
  if (start < 0) throw new Error("index.ts no longer declares function " + name);
  const end = SRC.indexOf("\n}", start);
  if (end < 0) throw new Error("unterminated function " + name);
  return SRC.slice(start + 1, end + 2);
}

/** A top-level `const`/`type` declaration, ended by `;` in column 0 or at line end. */
function decl(keyword: string, name: string): string {
  const head = keyword + " " + name;
  const start = SRC.indexOf("\n" + head);
  if (start < 0) throw new Error("index.ts no longer declares " + keyword + " " + name);
  const brace = SRC.indexOf("\n};", start);
  const semi = SRC.indexOf(";\n", start);
  if (brace > start && brace < semi) return SRC.slice(start + 1, brace + 3);
  return SRC.slice(start + 1, semi + 2);
}

const module = [
  "// lifted by tools/allowance-table-check.ts",
  // The cache tick the real allowancesConfig calls first. Not under test here;
  // tools/pack-harness.ts is where the config read itself is exercised.
  "function models(): void {}",
  'function plusPlan(plan: string): boolean { return ["plus", "pro", "staff"].includes(plan); }',
  decl("type", "AllowanceKind"),
  decl("type", "Allowance"),
  decl("const", "ALLOWANCE_KINDS"),
  decl("const", "ALLOWANCE_LOG_KIND"),
  decl("const", "ALLOWANCE_DEFAULTS"),
  decl("const", "PREVIEW_CAP"),
  decl("const", "PLAN_NAMES"),
  fn("limitCap"),
  fn("planName"),
  fn("buildAllowanceCfg"),
  "let allowanceCache: Record<string, Allowance> = ALLOWANCE_DEFAULTS;",
  "export function seed(json: string | null): void { allowanceCache = json === null ? ALLOWANCE_DEFAULTS : buildAllowanceCfg({ 'allowances.monthly': json }); }",
  fn("allowancesConfig"),
  fn("allowanceFor"),
  fn("allowanceMessage"),
  fn("utcMonthStart"),
  fn("utcMonthName"),
  fn("utcResetDay"),
  fn("utcNextMonth"),
  "export { ALLOWANCE_KINDS, ALLOWANCE_LOG_KIND, PREVIEW_CAP, allowanceFor, allowanceMessage, utcMonthStart, utcMonthName, utcNextMonth, utcResetDay };",
].join("\n\n") + "\n";

const M = await import("data:application/typescript," + encodeURIComponent(module));

let checks = 0;
function check(name: string, body: () => void): void {
  body();
  checks++;
  console.log("PASS " + name);
}
function eq(a: unknown, b: unknown, why?: string): void {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((why ? why + ": " : "") + x + " !== " + y);
}
function ok(v: unknown, why: string): void {
  if (!v) throw new Error(why);
}

// The table of record is ALLOWANCES.md section 3. If this assertion is edited,
// the paywall, Settings and the price page were all just quietly repriced.
check("the compiled defaults are the published allowances", () => {
  M.seed(null);
  eq(M.allowanceFor("free"), { reads: 4, answers: 0, helpers: 20, uploads: 1 });
  eq(M.allowanceFor("plus"), { reads: 20, answers: 300, helpers: 100, uploads: 10 });
});

check("an unknown plan reads as Basic, never as uncapped", () => {
  M.seed(null);
  eq(M.allowanceFor("gold-tier"), M.allowanceFor("free"));
  eq(M.allowanceFor("staff").reads, null, "staff is the only uncapped row");
});

check("config merges over the defaults rather than replacing them", () => {
  M.seed(JSON.stringify({ free: { reads: 3 }, plus: { reads: 12 } }));
  eq(M.allowanceFor("plus").reads, 12);
  eq(M.allowanceFor("free").reads, 3);
  // The rows the seed said nothing about are still there.
  eq(M.allowanceFor("free").helpers, 20);
  eq(M.allowanceFor("plus").uploads, 10);
  eq(M.allowanceFor("staff").reads, null);
});

check("config cannot sell Basic more previews than the database will admit", () => {
  // reserve_video_preview holds the enforcing copy of this number in SQL. A
  // config row that promises more would be a promise the function then refuses.
  M.seed(JSON.stringify({ free: { reads: 99 } }));
  eq(M.allowanceFor("free").reads, M.PREVIEW_CAP);
  M.seed(JSON.stringify({ free: { reads: null } }));
  eq(M.allowanceFor("free").reads, M.PREVIEW_CAP, "uncapped Basic still means four");
});

check("config cannot promise Basic coaching the chat route refuses", () => {
  // Pumpy answers a Basic account with a 403 before a credit is counted, so the
  // only true allowance is none, whatever a row written in beta still says.
  M.seed(JSON.stringify({ free: { answers: 100 } }));
  eq(M.allowanceFor("free").answers, 0);
  eq(M.allowanceFor("gold-tier").answers, 0, "an unknown plan reads as Basic here too");
  M.seed(JSON.stringify({ free: { answers: null } }));
  eq(M.allowanceFor("free").answers, 0, "uncapped Basic coaching is still none");
  eq(M.allowanceFor("plus").answers, 300);
});

check("a typo falls back to the compiled table; an explicit null is honoured", () => {
  M.seed("{not json");
  eq(M.allowanceFor("plus"), { reads: 20, answers: 300, helpers: 100, uploads: 10 });
  M.seed(JSON.stringify({ plus: { reads: "twenty" } }));
  eq(M.allowanceFor("plus").reads, 20);
  M.seed("{}");
  eq(M.allowanceFor("plus").reads, 20, "an empty object is a bad seed, not an empty table");
  M.seed(JSON.stringify({ plus: { reads: null } }));
  eq(M.allowanceFor("plus").reads, null);
});

check("a refusal names the allowance, the month, and the day it comes back", () => {
  M.seed(null);
  const msg = M.allowanceMessage("reads", "plus", 20);
  ok(msg.startsWith("That is 20 video reads on the Plus plan for "), msg);
  ok(msg.includes("your allowance comes back on 1 "), msg);
  ok(!msg.includes("today"), "a monthly refusal must not say today: " + msg);
  ok(!msg.includes("midnight"), "a monthly refusal must not say midnight: " + msg);
  ok(msg.includes(M.utcMonthName()), "the refusal should name this month: " + msg);
  // Singular where the number is one, which is Basic's whole upload allowance.
  ok(M.allowanceMessage("uploads", "free", 1).startsWith("That is 1 upload on the Basic plan"),
    M.allowanceMessage("uploads", "free", 1));
  ok(M.allowanceMessage("helpers", "plus", 100).includes("explanations and swaps"),
    M.allowanceMessage("helpers", "plus", 100));
});

check("the month window and the reset day are the same UTC instant", () => {
  eq(M.utcMonthStart().slice(8), "01T00:00:00Z");
  eq(M.utcNextMonth().slice(8, 10), "01");
  eq(M.utcResetDay().slice(0, 2), "1 ");
  ok(new Date(M.utcNextMonth()).getTime() > new Date(M.utcMonthStart()).getTime(),
    "the reset is not after the month it resets");
});

check("every allowance is counted from its own ledger kind", () => {
  eq(new Set(Object.values(M.ALLOWANCE_LOG_KIND)).size, M.ALLOWANCE_KINDS.length);
  for (const kind of M.ALLOWANCE_KINDS) {
    ok(typeof M.ALLOWANCE_LOG_KIND[kind] === "string", "no ledger kind for " + kind);
  }
});

console.log(checks + " allowance-table checks passed");

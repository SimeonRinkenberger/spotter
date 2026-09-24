// The hourly push tick survives PostgREST's top-of-the-hour 401 PGRST303.
//
//   deno run --allow-env --allow-read tools/push-tick-retry-check.ts
//
// Production, 23–24 Sept 2026: 14 of 24 ticks died at hh:00:02–05 with
// "push db push_devices|push_subscriptions 401 PGRST303 JWT issued at future",
// thrown out of a Promise.all, so neither transport sent anything that hour.
// This drives the real runPushTick (and the real serviceFetch under it) against a
// stubbed PostgREST:
//   - PGRST303 once, then 200: the read is retried and the tick completes;
//   - PGRST303 every time on one table: the tick logs it, returns it in
//     `errors`, still serves the other table, and does not throw;
//   - any other 401 is not retried (it is a real credential problem).

Deno.env.set("SUPABASE_URL", "https://harness.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "harness-not-a-jwt");
// APNs configured, so push_devices is read too (as in production).
const apnsKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", apnsKey.privateKey));
Deno.env.set("APNS_KEY_ID", "ABCDE12345");
Deno.env.set("APNS_TEAM_ID", "TEAM123456");
Deno.env.set("APNS_KEY_P8", "-----BEGIN PRIVATE KEY-----\n" + btoa(String.fromCharCode(...pkcs8)) + "\n-----END PRIVATE KEY-----");

const P = await import("../supabase/functions/spotter/push.ts");
let fastRetry = false;
try {
  const R = await import("../supabase/functions/spotter/rest.ts");
  R.pgrstRetry.waitMs = 10;
  fastRetry = true;
} catch { /* main has no rest.ts */ }

const failures: string[] = [];
let passed = 0;
const say = console.error;   // the tick's own logs are captured below; FAIL lines are not
function check(ok: unknown, what: string) {
  if (ok) passed++;
  else { failures.push(what); say("FAIL " + what); }
}

// A stub PostgREST: `plan[table]` is the list of statuses to answer in order
// (the last one repeats); 401s carry the body PostgREST sends.
let plan: Record<string, (number | "303")[]> = {};
const reads: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, _init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  const table = url.split("/rest/v1/")[1]?.split("?")[0] ?? "";
  reads.push(table);
  const q = plan[table] ?? [200];
  const next = q.length > 1 ? q.shift()! : q[0];
  if (next === "303") {
    return Promise.resolve(new Response(JSON.stringify({ code: "PGRST303", details: null, hint: null, message: "JWT issued at future" }), { status: 401 }));
  }
  if (next === 401) {
    return Promise.resolve(new Response(JSON.stringify({ code: "PGRST301", message: "JWT expired" }), { status: 401 }));
  }
  // No live rows: the tick has nothing to send, which is all these cases need.
  return Promise.resolve(Response.json([]));
}) as typeof fetch;

const logs: string[] = [];
const realError = console.error, realWarn = console.warn, realLog = console.log;
console.error = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
console.warn = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
console.log = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };

async function tick(): Promise<{ out: any; threw: unknown }> {
  reads.length = 0; logs.length = 0;
  try { return { out: await P.runPushTick(Date.parse("2026-09-24T12:00:03Z"), false), threw: null }; }
  catch (e) { return { out: null, threw: e }; }
}

try {
  // ---- once, then fine ----
  plan = { push_subscriptions: ["303", 200], push_devices: [200] };
  let r = await tick();
  check(r.threw === null, "a single PGRST303 does not throw the tick (" + String(r.threw).slice(0, 120) + ")");
  check(reads.filter((t) => t === "push_subscriptions").length === 2, "push_subscriptions is read twice: the 401, then the retry");
  check(Array.isArray(r.out?.errors) && r.out.errors.length === 0, "and the tick reports no errors");

  plan = { push_subscriptions: [200], push_devices: ["303", 200] };
  r = await tick();
  check(r.threw === null && r.out?.errors?.length === 0, "the same for push_devices (the other table in the Promise.all)");

  // ---- persistent on one table ----
  plan = { push_subscriptions: [200], push_devices: ["303"] };
  r = await tick();
  check(r.threw === null, "a PGRST303 that persists is handled, not thrown (" + String(r.threw).slice(0, 120) + ")");
  check(JSON.stringify(r.out?.errors) === '["push_devices"]', "it is returned as an error naming the table (" + JSON.stringify(r.out?.errors) + ")");
  check(reads.includes("push_subscriptions"), "and the other table is still read and served");
  check(logs.some((l) => l.includes("push_devices") && /could not read/.test(l)), "and logged");
  check(reads.filter((t) => t === "push_devices").length === 2, "the persistent one is retried exactly once");

  // ---- a real credential failure is not retried ----
  plan = { push_subscriptions: [401], push_devices: [200] };
  r = await tick();
  check(r.threw === null && reads.filter((t) => t === "push_subscriptions").length === 1,
    "a 401 that is not PGRST303 is not retried, and still does not throw the tick");
  check(fastRetry, "rest.ts exposes the retry wait (set to 10 ms here)");
} finally {
  globalThis.fetch = realFetch;
  console.error = realError; console.warn = realWarn; console.log = realLog;
}

if (failures.length) {
  console.error("\n" + failures.length + " of " + (failures.length + passed) + " push tick retry checks FAILED");
  Deno.exit(1);
}
console.log("PASS " + passed + " push tick retry checks: PGRST303 retried once, a persistent one handled per table, other 401s not retried, the tick never throws.");

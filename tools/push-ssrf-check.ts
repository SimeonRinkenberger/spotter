// Where a web push may be sent: the real sendPush, vapidAuth and runPushTick
// with the resolver and fetch stubbed. No network, no keys from anywhere.
//
//   deno run --allow-env --allow-read tools/push-ssrf-check.ts
//
// A push_subscriptions row's endpoint is written by the browser, so the sender
// has to hold it to the same outbound rules as every other address the function
// fetches: https on 443, a public address, no redirect followed. And every real
// web push service (FCM, Mozilla autopush, Apple, WNS) must still be reached.

Deno.env.set("SUPABASE_URL", "https://harness.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "harness-not-a-jwt");
Deno.env.set("VAPID_SUBJECT", "https://simeonrinkenberger.github.io/spotter/");

// A throwaway VAPID pair made here, as tools/push-harness.ts does.
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
Deno.env.set("VAPID_PUBLIC_KEY", b64u(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))));
Deno.env.set("VAPID_PRIVATE_KEY", (await crypto.subtle.exportKey("jwk", pair.privateKey)).d!);

// A subscriber key pair, so encryptPayload has something real to encrypt to.
const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
const P256DH = b64u(new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey)));
const AUTH = b64u(crypto.getRandomValues(new Uint8Array(16)));

const P = await import("../supabase/functions/spotter/push.ts");

const failures: string[] = [];
let passed = 0;
function check(ok: unknown, what: string) {
  if (ok) passed++;
  else { failures.push(what); console.error("FAIL " + what); }
}

type Resolver = (host: string, type: string) => Promise<string[]>;
const D = Deno as unknown as { resolveDns?: Resolver };
const realResolve = D.resolveDns;
const realFetch = globalThis.fetch;
const PUBLIC: Resolver = async (_h, t) => t === "A" ? ["142.250.72.10"] : ["2607:f8b0:4005:80b::200a"];
D.resolveDns = PUBLIC;

// Push-service requests are recorded; PostgREST reads are answered from `db`.
type Sent = { url: string; init?: RequestInit };
const sent: Sent[] = [];
let pushStatus = 201;
let db: Record<string, unknown[]> = {};
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith("https://harness.invalid/rest/v1/")) {
    const table = url.split("/rest/v1/")[1].split("?")[0];
    if ((init?.method ?? "GET") !== "GET") return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(Response.json(db[table] ?? []));
  }
  sent.push({ url, init });
  return Promise.resolve(new Response(null, { status: pushStatus }));
}) as typeof fetch;

async function trySend(endpoint: string): Promise<unknown> {
  try { return await P.sendPush(endpoint, P256DH, AUTH, { title: "t", body: "b" }); }
  catch (e) { return e; }
}
const refused = (x: unknown) => (x as Error)?.name === "PushEndpointError";

try {
  // ---- refused: never reaches fetch, and the error carries no URL ----
  const bad: [string, string][] = [
    ["http://169.254.169.254/latest/meta-data/iam", "cloud metadata over http"],
    ["https://169.254.169.254/latest/meta-data/iam", "cloud metadata over https"],
    ["http://127.0.0.1:8080/admin", "loopback with a port"],
    ["https://[::1]/x", "IPv6 loopback"],
    ["http://updates.push.services.mozilla.com/wpush/v2/abc", "a real push host over plain http"],
    ["https://fcm.googleapis.com:8443/fcm/send/abc", "a real push host on another port"],
    ["https://push.internal/x", "an internal suffix"],
    ["https://10.0.0.1.nip.io/x", "an address smuggled into a name"],
    ["ftp://fcm.googleapis.com/x", "not http at all"],
    ["::garbage::", "garbage"],
  ];
  for (const [endpoint, what] of bad) {
    sent.length = 0;
    const out = await trySend(endpoint);
    check(refused(out), "sendPush refuses " + what);
    check(sent.length === 0, "and sends nothing for " + what);
    check(!String((out as Error)?.message ?? "").includes(endpoint), "and the refusal does not repeat the endpoint (" + what + ")");
  }
  {
    // A public-looking name that resolves to a private address.
    D.resolveDns = async (_h, t) => t === "A" ? ["10.1.2.3"] : [];
    sent.length = 0;
    const out = await trySend("https://push.attacker.example/x");
    check(refused(out) && sent.length === 0, "sendPush refuses a name that resolves privately");
    // And a runtime that cannot resolve at all.
    delete D.resolveDns;
    sent.length = 0;
    const out2 = await trySend("https://fcm.googleapis.com/fcm/send/abc");
    check(refused(out2) && sent.length === 0, "sendPush refuses when nothing can vouch for the address");
    D.resolveDns = PUBLIC;
  }
  {
    let threw: unknown = null;
    try { await P.vapidAuth("http://169.254.169.254/latest/"); } catch (e) { threw = e; }
    check(refused(threw), "vapidAuth refuses a non-https endpoint");
    threw = null;
    try { await P.vapidAuth("https://fcm.googleapis.com:444/fcm/send/x"); } catch (e) { threw = e; }
    check(refused(threw), "vapidAuth refuses a non-443 port");
  }

  // ---- every real web push service still gets its message ----
  const good = [
    "https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bHxyz-_abc",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABlabc",
    "https://web.push.apple.com/QGuQyavXutnMp-abc",
    "https://wns2-by3p.notify.windows.com/w/?token=BQYAAAB%2babc",
    "https://jmt17.google.com/fcm/send/abc",
  ];
  for (const endpoint of good) {
    sent.length = 0;
    pushStatus = 201;
    const out = await trySend(endpoint) as { status?: number };
    check(out?.status === 201, "delivered to " + new URL(endpoint).hostname);
    check(sent.length === 1 && sent[0].url === endpoint, "exactly one POST to the endpoint as given (" + new URL(endpoint).hostname + ")");
    check(sent[0]?.init?.redirect === "manual", "and a redirect is not followed (" + new URL(endpoint).hostname + ")");
    const auth = String((sent[0]?.init?.headers as Record<string, string>)?.authorization ?? "");
    const claims = JSON.parse(atob(auth.split("t=")[1]?.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "e30="));
    check(claims.aud === new URL(endpoint).origin, "the VAPID audience is the endpoint's origin (" + new URL(endpoint).hostname + ")");
  }
  {
    // A push service that answers with a redirect is reported, not followed.
    sent.length = 0;
    pushStatus = 307;
    const out = await trySend("https://fcm.googleapis.com/fcm/send/abc") as { status?: number; gone?: boolean };
    check(out?.status === 307 && out.gone === false && sent.length === 1, "a 3xx from a push service is one request and a non-2xx result");
    pushStatus = 201;
  }

  // ---- the hourly tick skips a refused row and names it by id ----
  {
    const now = Date.parse("2026-09-24T17:00:00Z");
    const today = "2026-09-24";
    const row = {
      id: "sub-row-7", user_id: "user-7", tz: "UTC", remind_plan: true, remind_risk: false, remind_at: 17 * 60,
      last_sent_at: null, sent_week: 0, week_key: null, risk_week: null,
      endpoint: "http://169.254.169.254/latest/meta-data/iam/security-credentials/", p256dh: P256DH, auth: AUTH,
    };
    db = {
      push_subscriptions: [row],
      workout_logs: [],
      plan: [{ day: today, workouts: { title: "Legs", duration_minutes: 30 } }],
      profiles: [{ plan: "free", settings: {} }],
    };
    const logs: string[] = [];
    const realError = console.error, realLog = console.log;
    console.error = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
    console.log = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
    sent.length = 0;
    let out: Awaited<ReturnType<typeof P.runPushTick>> | null = null;
    try { out = await P.runPushTick(now, false); } finally { console.error = realError; console.log = realLog; }
    check(sent.length === 0, "the tick sends nothing to the refused row (sent to: " + sent.map((x) => x.url).join(", ") + ")");
    check(out?.sent === 0, "and counts nothing as sent");
    check(logs.some((l) => l.includes("sub-row-7") && l.includes("refused")), "the refusal is logged by row id (" + logs.join(" | ") + ")");
    check(!logs.some((l) => l.includes("169.254.169.254")), "and no log line carries the endpoint");
  }
} finally {
  if (realResolve) D.resolveDns = realResolve;
  globalThis.fetch = realFetch;
}

if (failures.length) {
  console.error("\n" + failures.length + " of " + (failures.length + passed) + " push endpoint checks FAILED");
  Deno.exit(1);
}
console.log("PASS " + passed + " push endpoint checks: internal, non-https and non-443 endpoints refused before any request; FCM, Mozilla, Apple and WNS delivered; the tick skips and names a refused row by id");

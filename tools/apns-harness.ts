// Battery for the APNs half of push.ts, which nobody can watch go wrong.
//
// Run: npm run push:harness
//   (deno run --allow-env --allow-read --allow-write --allow-net=127.0.0.1 tools/apns-harness.ts)
//
// Why this exists, in the same words as tools/push-harness.ts and for the same
// reason: Apple's answer to a malformed provider token is `403
// InvalidProviderToken`, which is byte-for-byte its answer to a correct token
// with the wrong Team ID, an expired one, or a key somebody revoked. From this
// side of the wire a bug and a paperwork problem look identical — and this
// project has no developer account yet to tell them apart with. So:
//
//   1. **The token is verified, not merely produced.** The JWT is signed by the
//      real signer and then checked against the public half of the same pair:
//      header `alg`/`kid`, claims `iss`/`iat`, and the raw r||s signature over
//      `header.payload`. A signer that emitted DER instead of P1363, or put
//      `iss` in the header, would pass "it ran" and fail here.
//
//   2. **The request is inspected, not merely sent.** A local Deno.serve stands
//      in for api.push.apple.com and asserts the path, every header Apple
//      requires and the exact payload — then answers the statuses that decide
//      whether a device row lives or dies, so the drop path is exercised rather
//      than reasoned about.
//
//   3. **The simulator fixtures are generated, not typed.** `tools/ios/fixtures/
//      reminder-*.apns` come out of the SAME `apnsPayload()` the sender calls,
//      so what `xcrun simctl push` puts on a simulator cannot drift away from
//      what Apple would deliver to a phone.
//
// Nothing here talks to Apple and nothing here needs a real key: the pair is
// generated on the spot, which also exercises the PEM import path the owner's
// `.p8` will take.

// push.ts reads its Supabase pair at module load, the way strava.ts does, so the
// environment is set before a DYNAMIC import rather than after a static one.
Deno.env.set("SUPABASE_URL", "https://harness.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "harness-not-a-jwt");

const root = new URL("../", import.meta.url);
const P = await import("../supabase/functions/spotter/push.ts");

let passed = 0;
const failures: string[] = [];

/** Every body may be async, and every one of them is awaited: an assertion that
 *  rejected into a floating promise is a check that silently never ran. */
async function check(label: string, body: () => unknown): Promise<void> {
  try {
    await body();
    passed++;
  } catch (e) {
    failures.push(`${label}\n    ${e instanceof Error ? e.message : String(e)}`);
  }
}

function same(got: unknown, want: unknown, what = ""): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) throw new Error(`${what}got ${a}, wanted ${b}`);
}

function ok(cond: unknown, why: string): void {
  if (!cond) throw new Error(why);
}

function decode(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(P.b64uBytes(part)));
}

// ---------- a throwaway signing key, in the shape Apple's .p8 arrives in ----------

const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
) as CryptoKeyPair;
const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
let raw = "";
for (const byte of pkcs8) raw += String.fromCharCode(byte);
// Wrapped at 64 columns with a trailing newline, which is how Apple's download
// looks and what `supabase secrets set APNS_KEY_P8="$(cat AuthKey_XXXX.p8)"`
// will hand the function.
const pem = "-----BEGIN PRIVATE KEY-----\n" +
  (btoa(raw).match(/.{1,64}/g) ?? []).join("\n") +
  "\n-----END PRIVATE KEY-----\n";

const KEY_ID = "ABC123DEFG";
const TEAM_ID = "DEF123GHIJ";
const cfg = { keyId: KEY_ID, teamId: TEAM_ID, p8: pem };
const NOW = Date.UTC(2026, 8, 18, 17, 0, 0);
const TOKEN = "9f".repeat(32);
const BUNDLE = "app.spotter.dev";

// ---------- 1. the provider token ----------

const jwt = await P.apnsAuth(cfg, NOW);
const parts = jwt.split(".");

await check("the provider token has three parts", () => same(parts.length, 3));
await check("the header says ES256 and nothing but the key id", () => {
  const header = decode(parts[0]);
  same(header.alg, "ES256", "alg: ");
  same(header.kid, KEY_ID, "kid: ");
  same(Object.keys(header).sort(), ["alg", "kid"]);
});
await check("the claims are the Team ID and the issue time, and nothing else", () => {
  const claims = decode(parts[1]);
  same(claims.iss, TEAM_ID, "iss: ");
  // Seconds, not milliseconds. Apple reads a millisecond iat as a timestamp
  // fifty thousand years from now and answers 403 for ever.
  same(claims.iat, Math.floor(NOW / 1000), "iat: ");
  same(Object.keys(claims).sort(), ["iat", "iss"]);
});
await check("the signature is a 64-byte r||s pair, not a DER sequence", () =>
  same(P.b64uBytes(parts[2]).length, 64));
await check("the signature verifies against the public half of the pair", async () =>
  ok(
    await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, pair.publicKey, P.b64uBytes(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1]),
    ),
    "the JWT does not verify under the key that signed it",
  ));

// Apple's two rules point in opposite directions: refresh at LEAST hourly, and
// no MORE than once every twenty minutes or the connection starts answering
// TooManyProviderTokenUpdates. Fifty minutes is the cache.
await check("a token inside the window is reused", async () =>
  same(await P.apnsAuth(cfg, NOW + 49 * 60_000), jwt));
const fresh = await P.apnsAuth(cfg, NOW + 51 * 60_000);
await check("a token past the window is reminted", () =>
  ok(fresh !== jwt, "the JWT was not refreshed after 51 minutes"));
await check("and the new one is dated from the new instant", () =>
  same(decode(fresh.split(".")[1]).iat, Math.floor((NOW + 51 * 60_000) / 1000)));

// ---------- 2. the request, against a server standing in for Apple ----------

type Seen = { path: string; method: string; headers: Headers; body: string };
let latest: Seen | undefined;
let reply: { status: number; body: string } = { status: 200, body: "" };

// Read through a function rather than a `!`: the handler assigns from a closure,
// which is exactly the case TypeScript's narrowing cannot see.
function seen(): Seen {
  if (!latest) throw new Error("nothing reached the stand-in server");
  return latest;
}

const PORT = 8945;
const stop = new AbortController();
const server = Deno.serve(
  { hostname: "127.0.0.1", port: PORT, signal: stop.signal, onListen: () => {} },
  async (req) => {
    const url = new URL(req.url);
    latest = { path: url.pathname, method: req.method, headers: req.headers, body: await req.text() };
    return new Response(reply.body || null, { status: reply.status });
  },
);

const apple = () => `http://127.0.0.1:${PORT}`;
const device = { token: TOKEN, bundle: BUNDLE, env: "sandbox" };

const sent = await P.sendApns(
  device, "plan", "Push day is on today's plan.", "42 minutes.", cfg, NOW, apple,
);

await check("it POSTs to /3/device/<token>", () => {
  same(seen().method, "POST");
  same(seen().path, "/3/device/" + TOKEN);
});
await check("it authorizes with a bearer provider token we can verify", async () => {
  const header = seen().headers.get("authorization") ?? "";
  ok(header.startsWith("bearer "), "the authorization header is not a bearer token: " + header);
  const bits = header.slice(7).split(".");
  same(bits.length, 3, "the bearer value is not a JWT: ");
  same(decode(bits[0]).kid, KEY_ID, "kid: ");
  ok(
    await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, pair.publicKey, P.b64uBytes(bits[2]),
      new TextEncoder().encode(bits[0] + "." + bits[1]),
    ),
    "the provider token on the wire does not verify",
  );
});
await check("the topic is the row's own bundle id", () =>
  same(seen().headers.get("apns-topic"), BUNDLE));
await check("the push type is alert", () =>
  same(seen().headers.get("apns-push-type"), "alert"));
await check("the priority is immediate", () =>
  same(seen().headers.get("apns-priority"), "10"));
await check("it expires in an hour, as UNIX seconds", () =>
  same(seen().headers.get("apns-expiration"), String(Math.floor(NOW / 1000) + 3600)));
await check("a repeat of the same reminder collapses onto the first", () =>
  same(seen().headers.get("apns-collapse-id"), "spotter-plan"));

await check("the alert carries the two lines", () =>
  same(JSON.parse(seen().body).aps.alert,
    { title: "Push day is on today's plan.", body: "42 minutes." }));
await check("it makes a sound and shares one notification thread", () => {
  same(JSON.parse(seen().body).aps.sound, "default");
  same(JSON.parse(seen().body).aps["thread-id"], "reminders");
});
await check("the deep link is a peer of aps, which is where custom keys are read", () => {
  same(JSON.parse(seen().body).url, "spotter://tab/plan");
  same(JSON.parse(seen().body).aps.url, undefined);
});
await check("the payload is well under Apple's 4 KB ceiling", () =>
  ok(new TextEncoder().encode(seen().body).length < 4096, "payload over 4096 bytes"));
await check("200 keeps the row", () => same({ status: sent.status, gone: sent.gone },
  { status: 200, gone: false }));

// A reminder with no second line must not ship an empty one: "body": "" renders
// as a blank line under the title on the Lock Screen.
await P.sendApns(device, "risk", "One session left this week.", undefined, cfg, NOW, apple);
await check("a one-line reminder has no body key at all", () =>
  same(JSON.parse(seen().body).aps.alert, { title: "One session left this week." }));
await check("the at-risk reminder opens Progress", () =>
  same(JSON.parse(seen().body).url, "spotter://tab/progress"));
await check("and collapses onto its own kind", () =>
  same(seen().headers.get("apns-collapse-id"), "spotter-risk"));

// ---------- the answers that decide whether a row survives ----------

async function answers(status: number, reason: string) {
  reply = { status, body: reason ? JSON.stringify({ reason }) : "" };
  return await P.sendApns(device, "plan", "t", undefined, cfg, NOW, apple);
}

await check("410 Unregistered drops the device", async () =>
  same((await answers(410, "Unregistered")).gone, true));
await check("400 BadDeviceToken drops it too", async () =>
  same((await answers(400, "BadDeviceToken")).gone, true));
await check("400 DeviceTokenNotForTopic drops it", async () =>
  same((await answers(400, "DeviceTokenNotForTopic")).gone, true));
await check("429 TooManyRequests keeps it", async () =>
  same((await answers(429, "TooManyRequests")).gone, false));
await check("503 Shutdown keeps it", async () =>
  same((await answers(503, "Shutdown")).gone, false));
await check("400 BadTopic keeps it — that is our paperwork, not their device", async () =>
  same((await answers(400, "BadTopic")).gone, false));
await check("the reason comes back so the log can name it", async () =>
  same((await answers(403, "InvalidProviderToken")).reason, "InvalidProviderToken"));

// The same predicate the tick consults before deleting, asserted directly as
// well as through a live response: a row's life hangs on this table.
await check("the drop table matches Apple's do-not-retry list", () => {
  same(P.apnsGone(410, ""), true);
  same(P.apnsGone(400, "ExpiredToken"), true);
  same(P.apnsGone(400, "PayloadTooLarge"), false);
  same(P.apnsGone(500, "InternalServerError"), false);
  same(P.apnsGone(200, ""), false);
});

await check("the two origins are Apple's two origins", () => {
  same(P.apnsOrigin("production"), "https://api.push.apple.com");
  same(P.apnsOrigin("sandbox"), "https://api.sandbox.push.apple.com");
  // Anything unrecognised is sandbox. A sandbox token sent to production is a
  // silent nothing; a production token sent to sandbox is a visible 400, and a
  // visible failure is the one worth defaulting to.
  same(P.apnsOrigin(""), "https://api.sandbox.push.apple.com");
});

stop.abort();
await server.finished;

// ---------- 3. the simulator fixtures ----------

const dir = new URL("tools/ios/fixtures/", root);
await Deno.mkdir(dir, { recursive: true });

const CASES = [
  ["plan", "reminder-plan", "Push day is on today's plan.", "42 minutes."],
  ["risk", "reminder-risk", "One session left this week.", "Your streak is at 6."],
] as const;

for (const [kind, name, title, line] of CASES) {
  const payload = {
    // simctl needs telling which app to deliver to when the bundle id is not
    // given on the command line. The committed default from ios/debug.xcconfig
    // goes in; a CLI argument overrides it, which is what a local build with its
    // own SPOTTER_BUNDLE_ID needs.
    "Simulator Target Bundle": BUNDLE,
    ...P.apnsPayload(kind, title, line),
  };
  await Deno.writeTextFile(new URL(name + ".apns", dir), JSON.stringify(payload, null, 2) + "\n");
}

for (const [kind, name, title, line] of CASES) {
  await check(`the ${kind} fixture is the sender's own payload`, async () => {
    const file = JSON.parse(await Deno.readTextFile(new URL(name + ".apns", dir)));
    same(file["Simulator Target Bundle"], BUNDLE, "target bundle: ");
    delete file["Simulator Target Bundle"];
    same(file, P.apnsPayload(kind, title, line));
  });
}

if (failures.length) {
  for (const f of failures) console.error("FAIL " + f);
  console.error(`\n${passed} passed, ${failures.length} failed`);
  Deno.exit(1);
}
console.log(`apns harness: ${passed} checks passed`);
console.log("fixtures written to tools/ios/fixtures/reminder-{plan,risk}.apns");

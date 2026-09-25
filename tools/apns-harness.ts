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
// Types only: erased before the module runs, so the env above still comes first.
type ReadyCard = import("../supabase/functions/spotter/push.ts").ReadyCard;

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

// ---------- the ready notification, on the wire ----------
//
// A save shared in from another app has become a workout. The same stand-in for
// Apple, and the same headers as a reminder except the collapse id — which is
// the whole of the burst rule on the phone's side: every banner of a burst
// replaces the one before it.

const CARD = "7c1f2a9e-3b4d-4e5f-8a6b-9c0d1e2f3a4b";
const PULL: ReadyCard = { id: CARD, title: "Pull Day Routine", exercises: 5, minutes: 45 };
reply = { status: 200, body: "" };
const readyOne = P.readyAlert(PULL, 1);
const readySent = await P.sendApnsReady(device, readyOne, cfg, NOW, apple);

await check("a ready card POSTs to the same /3/device/<token> as a reminder", () => {
  same(seen().method, "POST");
  same(seen().path, "/3/device/" + TOKEN);
  same(seen().headers.get("apns-topic"), BUNDLE);
  same(seen().headers.get("apns-push-type"), "alert");
  same(seen().headers.get("apns-priority"), "10");
  same(seen().headers.get("apns-expiration"), String(Math.floor(NOW / 1000) + 3600));
});
await check("a ready card collapses onto its own kind, so a burst is one banner", () =>
  same(seen().headers.get("apns-collapse-id"), "spotter-ready"));
await check("the ready payload is these exact bytes", () =>
  same(seen().body,
    '{"aps":{"alert":{"title":"Pull Day Routine is ready","body":"5 exercises · ~45 min · Start now or plan it"},' +
    '"sound":"default","thread-id":"ready","category":"CARD_READY"},' +
    '"url":"spotter://ready/' + CARD + '","card":"' + CARD + '"}'));
await check("the category names the two actions the app registers, inside aps", () =>
  same(JSON.parse(seen().body).aps.category, "CARD_READY"));
await check("the link and the card are peers of aps, where custom keys are read", () => {
  same(JSON.parse(seen().body).aps.url, undefined);
  same(JSON.parse(seen().body).aps.card, undefined);
});
await check("a ready card is under Apple's 4 KB ceiling", () =>
  ok(new TextEncoder().encode(seen().body).length < 4096, "payload over 4096 bytes"));
await check("200 keeps the device for a ready card too", () =>
  same({ status: readySent.status, gone: readySent.gone }, { status: 200, gone: false }));

stop.abort();
await server.finished;

// ---------- the ready notification, in words ----------

await check("one card: its name is the title, its size and the two actions the body", () =>
  same(readyOne, { title: "Pull Day Routine is ready", body: "5 exercises · ~45 min · Start now or plan it",
    url: "spotter://ready/" + CARD, card: CARD }));
await check("a burst is counted, opens Workouts, and names the latest card for the actions", () =>
  same(P.readyAlert(PULL, 3), { title: "3 workouts are ready", body: "Latest: Pull Day Routine · Start now or plan it",
    url: "spotter://tab/library", card: CARD }));
await check("a card read with nothing in it says only what it can", () =>
  same(P.readyAlert({ id: CARD, title: "Stretch", exercises: 0, minutes: null }, 1).body, "Start now or plan it"));
await check("one exercise is one exercise", () =>
  same(P.readyAlert({ id: CARD, title: "Plank", exercises: 1, minutes: 3 }, 1).body,
    "1 exercise · ~3 min · Start now or plan it"));
await check("a long title is cut at a word so 'is ready' stays on the line", () => {
  const t = P.readyAlert({ id: CARD, title: "Full Upper Body Dumbbell Workout For Beginners At Home", exercises: 8, minutes: 40 }, 1).title;
  same(t, "Full Upper Body Dumbbell… is ready");
});
await check("an untitled card still reads as a sentence", () =>
  same(P.readyAlert({ id: CARD, title: "  ", exercises: 3, minutes: null }, 1).title, "Your workout is ready"));

// The whole decision, without a database: which cards count, which is named.
const rows = [
  { id: "c3", title: "Leg Day", blocks: [{ exercises: [{}, {}, {}] }], duration_minutes: 30 },
  { id: CARD, title: "Pull Day Routine", blocks: [{ exercises: [{}, {}] }, { exercises: [{}, {}, {}] }], duration_minutes: 45 },
  { id: "c1", title: "Core Finisher", blocks: [], duration_minutes: null },
];
await check("absent is on", () => same(P.readyNotice(CARD, rows.slice(1, 2), [], {}).send, true));
await check("notifyReady false is off, whatever else is true", () =>
  same(P.readyNotice(CARD, rows, [], { notifyReady: false }), { send: false, why: "switched off" }));
await check("a card that is not among the ready ones sends nothing", () =>
  same(P.readyNotice("gone", rows, [], null), { send: false, why: "not ready" }));
await check("one ready card: the single notification, sized from its blocks", () => {
  const n = P.readyNotice(CARD, rows.slice(1, 2), [], null);
  same(n.send && n.count, 1);
  same(n.send && n.alert.body, "5 exercises · ~45 min · Start now or plan it");
});
await check("three in the window: counted, and the card that just finished is the one named", () => {
  const n = P.readyNotice(CARD, rows, [], null);
  same(n.send && [n.count, n.alert.title, n.alert.card], [3, "3 workouts are ready", CARD]);
});
await check("a card already started is not news, and is not counted", () => {
  const n = P.readyNotice(CARD, rows, ["c1"], null);
  same(n.send && [n.count, n.alert.title], [2, "2 workouts are ready"]);
});
await check("if the named card was started, the newest one left is named instead", () => {
  const n = P.readyNotice(CARD, rows, [CARD], null);
  same(n.send && [n.count, n.alert.card], [2, "c3"]);
});
await check("everything started: nothing to say", () =>
  same(P.readyNotice(CARD, rows, ["c1", "c3", CARD], null), { send: false, why: "already started" }));

// ---------- sendReady, reads and all ----------
//
// The glue around readyNotice: which rows it asks PostgREST for, that it stops
// reading the moment there is nobody to tell, that every device hears it, and
// that a token Apple has let go of is dropped. One stand-in plays both
// PostgREST and Apple. push.ts reads its Supabase address and the APNs key at
// module load and per call, so a second copy of the module — a fresh URL — is
// loaded with this environment instead of the first one's.

const PORT2 = 8946;
const U = "5b0c7a44-1d2e-4f3a-9b8c-7d6e5f4a3b2c";
let world = { devices: [] as unknown[], settings: {} as unknown, jobs: [] as unknown[], cards: [] as unknown[], logs: [] as unknown[] };
const asked: string[] = [];
const pushed: { token: string; body: string }[] = [];
const dropped: string[] = [];
const stop2 = new AbortController();
const server2 = Deno.serve({ hostname: "127.0.0.1", port: PORT2, signal: stop2.signal, onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  const table = url.pathname.replace("/rest/v1/", "");
  if (url.pathname.startsWith("/3/device/")) {
    const token = url.pathname.slice(10);
    pushed.push({ token, body: await req.text() });
    return token.startsWith("dead")
      ? new Response(JSON.stringify({ reason: "Unregistered" }), { status: 410 })
      : new Response(null, { status: 200 });
  }
  if (req.method === "DELETE") { dropped.push(decodeURIComponent(url.search)); return new Response(null, { status: 204 }); }
  asked.push(table + url.search);
  const rowsFor: Record<string, unknown> = {
    push_devices: world.devices, profiles: [{ settings: world.settings }], ingest_jobs: world.jobs,
    workouts: world.cards, workout_logs: world.logs,
  };
  return Response.json(rowsFor[table] ?? []);
});
Deno.env.set("SUPABASE_URL", `http://127.0.0.1:${PORT2}`);
Deno.env.set("APNS_KEY_ID", KEY_ID);
Deno.env.set("APNS_TEAM_ID", TEAM_ID);
Deno.env.set("APNS_KEY_P8", pem);
const R = await import("../supabase/functions/spotter/push.ts?sendReady");
const here = () => `http://127.0.0.1:${PORT2}`;

function reset(w: Partial<typeof world>) {
  world = { devices: [], settings: {}, jobs: [], cards: [], logs: [], ...w };
  asked.length = 0; pushed.length = 0; dropped.length = 0;
}
const dev = (token: string) => ({ token, bundle: BUNDLE, env: "sandbox" });

reset({});
await check("nobody to tell: one read, of the devices, and nothing else", async () => {
  same(await R.sendReady(U, CARD, NOW, here), { sent: 0, why: "no device" });
  same(asked.map((q) => q.split("?")[0]), ["push_devices"]);
});

reset({ devices: [dev("aa11")], settings: { notifyReady: false }, cards: [{ id: CARD, title: "Pull Day Routine", blocks: [] }] });
await check("switched off in Settings: nothing is sent", async () => {
  same((await R.sendReady(U, CARD, NOW, here)).sent, 0);
  same(pushed.length, 0);
});

reset({
  devices: [dev("aa11"), dev("dead22")], jobs: [{ id: "a1b2c3d4-0000-4000-8000-000000000001" }],
  cards: [
    { id: CARD, title: "Pull Day Routine", blocks: [{ exercises: [{}, {}, {}, {}, {}] }], duration_minutes: 45 },
    { id: "c2", title: "Leg Day", blocks: [], duration_minutes: 30 },
    { id: "c3", title: "Core", blocks: [], duration_minutes: 10 },
  ],
});
const burst = await R.sendReady(U, CARD, NOW, here);
await check("a burst of three goes to every device as one counted notification", () => {
  same(pushed.map((p) => p.token), ["aa11", "dead22"]);
  same(JSON.parse(pushed[0].body).aps.alert.title, "3 workouts are ready");
  same(JSON.parse(pushed[0].body).card, CARD);
  same(burst, { sent: 1, why: "sent" });
});
await check("a device Apple has let go of is dropped by its token", () =>
  same(dropped, ["?token=eq.dead22"]));
await check("the jobs read asks for this person's marked jobs finished in the last two minutes", () => {
  const q = decodeURIComponent(asked.find((a) => a.startsWith("ingest_jobs")) ?? "");
  const since = new Date(NOW - 120_000).toISOString();
  ok(q.includes(`user_id=eq.${U}`) && q.includes("status=eq.done") && q.includes(`finished_at=gte.${since}`) &&
    q.includes("meta->>notify_ready=eq.true"), "jobs query was " + q);
});
await check("the cards read counts the card, the marked jobs' cards and cache hits in the window", () => {
  const q = decodeURIComponent(asked.find((a) => a.startsWith("workouts")) ?? "");
  const since = new Date(NOW - 120_000).toISOString();
  ok(q.includes(`user_id=eq.${U}`) && q.includes("ingest_status=eq.ready"), "cards query was " + q);
  ok(q.includes(`or=(id.eq.${CARD},and(ingest_job_id.is.null,platform.neq.pumpy,created_at.gte."${since}"),` +
    `ingest_job_id.in.(a1b2c3d4-0000-4000-8000-000000000001))`), "cards filter was " + q);
});
await check("and a card with a session already is asked about by id", () => {
  const q = decodeURIComponent(asked.find((a) => a.startsWith("workout_logs")) ?? "");
  ok(q.includes(`workout_id=in.(${CARD},c2,c3)`), "logs query was " + q);
});

stop2.abort();
await server2.finished;

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

// The ready card, one and a burst. The id is a placeholder: to watch Start Now
// and Plan It land on a real card, copy the file and put one of the signed-in
// account's own card ids in "url" and "card".
const READY_CASES = [["card-ready", readyOne], ["card-ready-burst", P.readyAlert(PULL, 3)]] as const;
for (const [name, alert] of READY_CASES) {
  await Deno.writeTextFile(new URL(name + ".apns", dir),
    JSON.stringify({ "Simulator Target Bundle": BUNDLE, ...P.readyPayload(alert) }, null, 2) + "\n");
}
for (const [name, alert] of READY_CASES) {
  await check(`the ${name} fixture is the sender's own payload`, async () => {
    const file = JSON.parse(await Deno.readTextFile(new URL(name + ".apns", dir)));
    same(file["Simulator Target Bundle"], BUNDLE, "target bundle: ");
    delete file["Simulator Target Bundle"];
    same(file, P.readyPayload(alert));
  });
}

if (failures.length) {
  for (const f of failures) console.error("FAIL " + f);
  console.error(`\n${passed} passed, ${failures.length} failed`);
  Deno.exit(1);
}
console.log(`apns harness: ${passed} checks passed`);
console.log("fixtures written to tools/ios/fixtures/reminder-{plan,risk}.apns and card-ready{,-burst}.apns");

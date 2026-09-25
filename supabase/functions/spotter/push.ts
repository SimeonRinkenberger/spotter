// Spotter — the two reminders, and the one answer to something the user just did.
//
// There are exactly two reminders in this app and there will not be a third:
//
//   1. **Plan day** — at an hour the user picked. "Push day is on today's plan.
//      42 minutes."
//   2. **Week at risk** — once a week, on the day the goal stops having slack,
//      never after 20:00 local. "One session left this week. Your streak is at 6."
//
// The third notification is not a reminder and does not pretend to be one: a
// video shared into Spotter from another app has finished becoming a workout
// ("Pull Day Routine is ready"). The person started it seconds or minutes ago,
// so it keeps none of the reminders' schedule or caps — see "a save is ready"
// at the bottom of this file.
//
// Everything below is shaped by the same three rules the design report set:
// opt-in from a real tap and never at launch, hard caps (one a day, three a week,
// silence for 24h after a finished session), and an Off switch that costs
// nothing. A reminder is a thing the user asked for; the moment it becomes a
// thing we do TO them it has failed, and the caps are what keep that honest when
// nobody is watching.
//
// Four rules shape the code, and three of them are somebody else's.
//
// **It must not be able to take the rest of the function down.** Same shape as
// `billing.ts` and `strava.ts`: nothing beyond the Supabase pair is read at
// module load, the VAPID secrets are read on the call that needs them, and a
// project with none of them set answers `configured: false` and the app hides
// the rows. This module imports nothing from `index.ts`, so there is no cycle.
//
// **The encryption is ours to get right.** `npm:web-push` is a Node library —
// it reaches for `crypto.createECDH` and `https.request`, neither of which the
// edge runtime has in the shape it wants — so the payload is encrypted here
// against RFC 8291 (aes128gcm) and signed against RFC 8292 (VAPID, ES256) with
// Web Crypto and nothing else. Getting that subtly wrong produces a push service
// that answers 201 and a phone that shows nothing, which is why the interop is
// proved in `tools/push-harness.ts` against the `web-push` package's own
// decryption running in Node.
//
// **The clock belongs to the user, not to the server.** Every "is it time yet"
// question is asked in the row's own IANA zone through `Intl`, which is also
// what makes a DST weekend behave: 17:00 local is 17:00 local on both sides of
// the change, and no offset is ever stored or arithmetic-ed.
//
// **The week is re-derived, not trusted.** The client computes the ring; the
// sender computes its own copy from `workout_logs`, `plan` and the goal, with
// the same rule (`weekStats` in app.ts), because a notification that says "one
// session left" to somebody who finished an hour ago is worse than no
// notification at all.

import { assertPublicUrl, checkUrl } from "./net.ts";
import { serviceFetch } from "./rest.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Same rule as index.ts, billing.ts and strava.ts: legacy service keys are JWTs
// and want a Bearer header, new sb_secret_ keys are not JWTs and must go as
// `apikey` only.
const KEY_IS_JWT = (SERVICE_KEY ?? "").split(".").length === 3;
const dbHeaders: Record<string, string> = KEY_IS_JWT
  ? { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" }
  : { apikey: SERVICE_KEY, "content-type": "application/json" };

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://simeonrinkenberger.github.io,http://localhost:8000,http://127.0.0.1:8000")
  .split(",").map((s) => s.trim()).filter(Boolean);

/** Where a tapped notification opens. The app's own address, always. */
function appUrl(): string {
  return `${ALLOWED_ORIGINS[0]}/spotter/`;
}

// ---------- configuration ----------

type Vapid = { publicKey: string; privateKey: string; subject: string };

/** The three secrets an APNs push needs, or nothing if any one of them is unset. */
export type Apns = { keyId: string; teamId: string; p8: string };

function apnsCfg(): Apns | null {
  const keyId = (Deno.env.get("APNS_KEY_ID") ?? "").trim();
  const teamId = (Deno.env.get("APNS_TEAM_ID") ?? "").trim();
  const p8 = (Deno.env.get("APNS_KEY_P8") ?? "").trim();
  // All three or none. Two of three is a deployment that would sign a token
  // Apple rejects with InvalidProviderToken once an hour, for ever, and look
  // configured the whole time.
  if (!keyId || !teamId || !p8) return null;
  return { keyId, teamId, p8 };
}

function vapidCfg(): Vapid | null {
  const publicKey = (Deno.env.get("VAPID_PUBLIC_KEY") ?? "").trim();
  const privateKey = (Deno.env.get("VAPID_PRIVATE_KEY") ?? "").trim();
  const subject = (Deno.env.get("VAPID_SUBJECT") ?? "").trim() || appUrl();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

/**
 * What `GET /api/push/config` answers. The public key is not a secret — it ends
 * up in every subscription — but it is read from the environment rather than
 * baked into the page so that rotating the pair is a secret change and a reload,
 * not a deploy of the app.
 */
export function pushConfig(): { configured: boolean; key?: string; apns: boolean } {
  const cfg = vapidCfg();
  // Two transports, two independent answers. A browser asks whether it may
  // subscribe; a native install asks whether there is an APNs key to push it
  // with. Neither should be able to switch the other's rows on: a deployment
  // with VAPID set and no APNs key must keep showing the native app the same
  // honest "not configured" line it shows today.
  const both = cfg ? { configured: true, key: cfg.publicKey } : { configured: false };
  return { ...both, apns: apnsCfg() !== null };
}

// ---------- bytes ----------

// TS 5.7 widened the bare `Uint8Array` to allow a SharedArrayBuffer behind it,
// and neither Web Crypto nor fetch will take one of those. Every buffer here is
// a plain one, so say so once and stop repeating the argument at every call.
type Bytes = Uint8Array<ArrayBuffer>;

const utf8 = new TextEncoder();

export function b64uBytes(s: string): Bytes {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64u(bytes: Bytes): string {
  let bin = "";
  // Chunked rather than spread: a 4KB payload spread into String.fromCharCode
  // is a stack overflow waiting for the one user who writes long notes.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function cat(...parts: Bytes[]): Bytes {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

// ---------- RFC 8291: encrypt the payload to the subscriber ----------
//
// The whole scheme in one place, because it is short and because every step of
// it is load-bearing:
//
//   ecdh_secret = ECDH(our ephemeral private key, the subscriber's p256dh)
//   PRK_key     = HMAC(auth_secret, ecdh_secret)
//   IKM         = HMAC(PRK_key, "WebPush: info" 0x00 ua_public as_public 0x01)
//   PRK         = HMAC(salt, IKM)
//   CEK         = HMAC(PRK, "Content-Encoding: aes128gcm" 0x00 0x01)[0..15]
//   NONCE       = HMAC(PRK, "Content-Encoding: nonce"     0x00 0x01)[0..11]
//
// then one AES-128-GCM record over `plaintext || 0x02` (0x02 is RFC 8188's
// last-record delimiter), behind the header the push service passes through
// untouched: salt(16) || record size(4, big-endian) || key id length(1) ||
// our ephemeral public key(65). The subscriber's browser is the only thing on
// earth holding the private half, so the push service — Apple's, Google's,
// Mozilla's — carries a blob it cannot read.
//
// A fresh ephemeral key pair and a fresh salt per message, which is not
// ceremony: reusing either across two messages to the same subscriber reuses the
// key and the nonce, and AES-GCM under a repeated nonce leaks the plaintexts.

export async function encryptPayload(
  p256dh: string, auth: string, plaintext: Bytes,
): Promise<Bytes> {
  const uaPublic = b64uBytes(p256dh);
  const authSecret = b64uBytes(auth);

  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  ) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const uaKey = await crypto.subtle.importKey(
    "raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, pair.privateKey, 256),
  );

  const prkKey = await hmac(authSecret, shared);
  const ikm = await hmac(prkKey, cat(
    utf8.encode("WebPush: info"), new Uint8Array([0]), uaPublic, asPublic, new Uint8Array([1]),
  ));

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(
    utf8.encode("Content-Encoding: aes128gcm"), new Uint8Array([0, 1]),
  ))).slice(0, 16);
  const nonce = (await hmac(prk, cat(
    utf8.encode("Content-Encoding: nonce"), new Uint8Array([0, 1]),
  ))).slice(0, 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const body = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce }, key, cat(plaintext, new Uint8Array([2])),
  ));

  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);   // record size; one record, so any ceiling above it
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return cat(header, body);
}

// ---------- RFC 8292: say who is asking ----------
//
// A push service will accept a message for any endpoint it issued; VAPID is what
// ties the message to us, so that a leaked endpoint cannot be used by somebody
// else to notify our user. One ES256 JWT per push service origin, audience =
// that origin, twelve hours of life (the ceiling is 24), and the public key
// alongside it so the service can check the signature without knowing us.

let signingKey: CryptoKey | null = null;
let signingFor = "";

async function vapidKey(cfg: Vapid): Promise<CryptoKey> {
  if (signingKey && signingFor === cfg.privateKey) return signingKey;
  const raw = cfg.privateKey.indexOf("-----") === 0
    ? b64uBytes(cfg.privateKey.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""))
    : b64uBytes(cfg.privateKey);
  let key: CryptoKey;
  if (raw.length === 32) {
    // What `web-push generate-vapid-keys` prints: the bare 32-byte scalar. Web
    // Crypto will not import that on its own, so it is dressed as a JWK with the
    // x and y taken out of the public key we already have.
    const pub = b64uBytes(cfg.publicKey);
    key = await crypto.subtle.importKey("jwk", {
      kty: "EC", crv: "P-256", ext: true,
      d: b64u(raw), x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)),
    }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  } else {
    // A PKCS#8 key, PEM or bare base64. Accepted because the alternative is a
    // deploy day spent discovering which of the two shapes the pair was saved in.
    key = await crypto.subtle.importKey(
      "pkcs8", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
    );
  }
  signingKey = key;
  signingFor = cfg.privateKey;
  return key;
}

// ---------- where a web push may go ----------
//
// A subscription's endpoint is a column the browser writes, so it is held to the
// same outbound rules as every other address this function sends a request to
// (net.ts), plus one of its own: every web push service there is — FCM, Mozilla
// autopush, web.push.apple.com, WNS — lives at an https URL on port 443, so
// nothing else is a push endpoint. The error names the rule and never the URL:
// an endpoint is a bearer capability for somebody's device and does not belong
// in a log line.

export class PushEndpointError extends Error {
  constructor(readonly reason: string) {
    super("push endpoint refused: " + reason);
    this.name = "PushEndpointError";
  }
}

function pushEndpointShape(endpoint: string): URL {
  const c = checkUrl(endpoint);
  if (!c.ok) throw new PushEndpointError(c.reason);
  if (c.url.protocol !== "https:" || (c.url.port !== "" && c.url.port !== "443")) {
    throw new PushEndpointError("not https on port 443");
  }
  return c.url;
}

/** The endpoint as the URL to POST to, or a PushEndpointError saying which rule it broke. */
export async function pushEndpoint(endpoint: string): Promise<URL> {
  pushEndpointShape(endpoint);
  const g = await assertPublicUrl(endpoint);
  if (!g.ok) throw new PushEndpointError(g.reason);
  return g.url;
}

export async function vapidAuth(endpoint: string, nowMs = Date.now()): Promise<string> {
  const cfg = vapidCfg();
  if (!cfg) throw new Error("push: VAPID keys are not set");
  const aud = pushEndpointShape(endpoint).origin;
  const head = b64u(utf8.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(utf8.encode(JSON.stringify({
    aud,
    exp: Math.floor(nowMs / 1000) + 12 * 3600,
    sub: cfg.subject,
  })));
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, await vapidKey(cfg), utf8.encode(`${head}.${body}`),
  ));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${cfg.publicKey}`;
}

// ---------- APNs: say who is asking, again, in Apple's dialect ----------
//
// Same idea as VAPID and a different spelling of it. Apple's provider token is
// an ES256 JWT over a two-field header and a two-field claim set and nothing
// else: `{alg:"ES256", kid:<10-char Key ID>}` . `{iss:<10-char Team ID>, iat:
// <seconds>}`, signed with the `.p8` key the developer account issues. There is
// no `aud`, no `exp` and no `sub` — Apple dates the token from `iat` alone and
// rejects anything more than an hour old with ExpiredProviderToken (403).
//
// Which is why the token is cached rather than minted per message. Apple's two
// rules point in opposite directions: refresh at LEAST every 60 minutes, and no
// MORE often than every 20, or the connection starts answering
// TooManyProviderTokenUpdates (429). Fifty minutes sits in the middle of that
// window with ten minutes of slack for a slow tick, and the cache is per isolate
// because that is the only lifetime an edge function can promise.
//
// Sources: Apple, "Establishing a token-based connection to APNs" and "Sending
// notification requests to APNs" (both read 18 Sept 2026) — see
// design/native/push.md for the full list and what each one settled.

const APNS_ORIGINS = {
  sandbox: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
} as const;

let apnsJwt = "";
let apnsJwtFor = "";
let apnsJwtAt = 0;

/** Import the PEM the owner pastes into `supabase secrets set`. */
async function apnsKey(cfg: Apns): Promise<CryptoKey> {
  // A .p8 from Apple is a PKCS#8 PEM. The header/footer and every newline go,
  // and what is left is ordinary base64 — which b64uBytes already accepts,
  // because it normalises the URL-safe alphabet before decoding rather than
  // after. Pasting the file through a shell tends to mangle the line breaks and
  // nothing else, so the stripping is deliberately indiscriminate.
  const raw = b64uBytes(cfg.p8.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  return await crypto.subtle.importKey(
    "pkcs8", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
}

/**
 * The `authorization` header value, cached. Exported because the harness signs
 * one with a throwaway key and verifies it with the public half — the only way
 * to find out that a JWT is malformed without a developer account, since Apple's
 * answer to a bad one is a 403 that looks exactly like a wrong Team ID.
 */
export async function apnsAuth(cfg: Apns, nowMs = Date.now()): Promise<string> {
  const stamp = `${cfg.keyId}:${cfg.teamId}:${cfg.p8.length}`;
  if (apnsJwt && apnsJwtFor === stamp && nowMs - apnsJwtAt < 50 * 60_000) return apnsJwt;
  const head = b64u(utf8.encode(JSON.stringify({ alg: "ES256", kid: cfg.keyId })));
  const body = b64u(utf8.encode(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(nowMs / 1000) })));
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, await apnsKey(cfg), utf8.encode(`${head}.${body}`),
  ));
  // Web Crypto's ECDSA signature is already the raw r||s pair JWS wants (IEEE
  // P1363), not the DER sequence OpenSSL prints. No unwrapping, deliberately.
  apnsJwt = `${head}.${body}.${b64u(sig)}`;
  apnsJwtFor = stamp;
  apnsJwtAt = nowMs;
  return apnsJwt;
}

/** Where a tapped reminder goes in the native app. Two links, same two reminders. */
export function apnsLink(kind: "plan" | "risk"): string {
  return kind === "risk" ? "spotter://tab/progress" : "spotter://tab/plan";
}

/** The exact JSON body APNs carries. Kept in one place so the simulator fixtures
 *  in `tools/ios/fixtures/*.apns` and the live sender cannot drift apart. */
export function apnsPayload(
  kind: "plan" | "risk", title: string, body?: string,
): Record<string, unknown> {
  return {
    aps: {
      alert: body ? { title, body } : { title },
      sound: "default",
      // One thread for both reminders: iOS groups them under a single stack in
      // Notification Centre, which is the right shape for a thing that arrives
      // at most once a day and never wants its own section.
      "thread-id": "reminders",
    },
    // A peer of `aps`, never inside it — APNs drops custom keys in that
    // dictionary. NotificationsHost reads this on the tap and hands it to the
    // web app as the action id, which routes it through openDeepLink.
    url: apnsLink(kind),
  };
}

/** What Apple said, and whether the device row survived it. */
export type ApnsResult = { status: number; reason: string; gone: boolean };

/**
 * One notification to one device.
 *
 * Deno's `fetch` is the whole HTTP/2 story here: it negotiates h2 over ALPN for
 * any https origin, and APNs speaks nothing else, so a request that came back at
 * all came back over HTTP/2. There is no h2 client to hand-roll and no socket to
 * keep — which also means no connection reuse across isolates, and therefore no
 * benefit in batching. The hourly tick sends a handful of messages at most.
 */
export async function sendApns(
  device: { token: string; bundle: string | null; env: string },
  kind: "plan" | "risk", title: string, body: string | undefined,
  cfg: Apns, nowMs = Date.now(), originFor = apnsOrigin,
): Promise<ApnsResult> {
  // The web sender's `tag` by another name: a second copy of the same reminder
  // replaces the first on the Lock Screen rather than stacking.
  return await postApns(device, kind === "risk" ? "spotter-risk" : "spotter-plan",
    apnsPayload(kind, title, body), cfg, nowMs, originFor);
}

/** The one POST every APNs notification makes; only the collapse id and the body differ. */
async function postApns(
  device: { token: string; bundle: string | null; env: string },
  collapse: string, payload: Record<string, unknown>,
  cfg: Apns, nowMs: number, originFor: (env: string) => string,
): Promise<ApnsResult> {
  const r = await fetch(`${originFor(device.env)}/3/device/${device.token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${await apnsAuth(cfg, nowMs)}`,
      // The topic is the bundle id and Apple binds the token to it: a token
      // minted against the dev bundle answers BadDeviceToken on any other one,
      // so the row's own bundle is used rather than a constant.
      "apns-topic": device.bundle || "",
      "apns-push-type": "alert",
      // 10 = now. A reminder that arrives when the phone next feels like it is
      // not a reminder; this is the one class of push that has a time in it.
      "apns-priority": "10",
      // One hour, the same TTL the web sender uses and for the same reason: a
      // reminder for 17:00 is worthless at 22:00, and Apple would otherwise
      // store it for up to 30 days and deliver it whenever the phone reappears.
      // A ready card an hour late is no better: by then the app offers it itself
      // the next time it opens (readyPick in app.ts).
      "apns-expiration": String(Math.floor(nowMs / 1000) + 3600),
      "apns-collapse-id": collapse,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  // Apple answers an empty body on 200 and `{"reason":"..."}` on everything
  // else. The reason is the only part worth logging: the status alone cannot
  // tell a wrong Team ID from a wrong bundle id, and both are 403/400.
  let reason = "";
  const text = await r.text().catch(() => "");
  if (text) { try { reason = String(JSON.parse(text).reason ?? ""); } catch { reason = text.slice(0, 120); } }
  return { status: r.status, reason, gone: apnsGone(r.status, reason) };
}

/**
 * Which of Apple's two servers will accept this token. Passed into `sendApns`
 * rather than read inside it so the harness can stand a local server in Apple's
 * place and assert the exact bytes that would have gone to Cupertino.
 */
export function apnsOrigin(env: string): string {
  return env === "production" ? APNS_ORIGINS.production : APNS_ORIGINS.sandbox;
}

/**
 * Whether to forget this token. 410 is Apple saying the app is gone, and the
 * four 400 reasons below say the token can never work for this topic — Apple's
 * own guidance is not to retry any of them. Everything else (429, 5xx, a
 * network error) is this minute's problem and keeps the row.
 */
export function apnsGone(status: number, reason: string): boolean {
  if (status === 410) return true;
  return status === 400 &&
    (reason === "BadDeviceToken" || reason === "Unregistered" ||
     reason === "ExpiredToken" || reason === "DeviceTokenNotForTopic");
}

// ---------- the clock, in the user's own zone ----------

export type Local = { ymd: string; hour: number; minute: number };

const FMTS: Record<string, Intl.DateTimeFormat> = {};

function fmtFor(tz: string): Intl.DateTimeFormat {
  if (!FMTS[tz]) {
    // en-CA because its date order is already YYYY-MM-DD; hourCycle h23 because
    // hour12:false still prints "24" for midnight in some ICU builds.
    FMTS[tz] = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  }
  return FMTS[tz];
}

/** The wall clock in `tz` at that instant. An unknown zone falls back to UTC. */
export function localAt(ms: number, tz: string): Local {
  let f: Intl.DateTimeFormat;
  try { f = fmtFor(tz || "UTC"); } catch { f = fmtFor("UTC"); }
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(new Date(ms))) p[part.type] = part.value;
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
  };
}

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

/** 0 = Monday. Calendar arithmetic on a bare date, so DST cannot reach it. */
export function dowOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** The Monday of that date's week, as a date string. The week's identity. */
export function mondayKey(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) - dowOf(ymd) * 86_400_000);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/**
 * Which hourly tick a row belongs to. The job runs on the hour and the user
 * picks a minute, so the reminder lands on the hour NEAREST their time — 17:30
 * arrives at 17:00, 17:31 at 18:00 — never more than half an hour out and never
 * pushed into the next day by rounding.
 */
export function hourFor(remindAt: number): number {
  const m = Math.max(0, Math.min(1439, Math.round(remindAt || 0)));
  return Math.max(0, Math.min(23, Math.ceil(m / 60 - 0.5)));
}

// ---------- the week, re-derived ----------
//
// The same rule as `weekStats` in app.ts, ported: a session is a workout_logs
// row with a non-null completed_at (the app refuses to write one with nothing
// logged in it, so that single column is the whole test); the goal is the user's
// setting, else the number of distinct days their plan asks for this week, else
// three; the streak walks back week by week and lets a week that came up exactly
// one short spend a freeze, one per rolling four weeks and two on Plus.
//
// It is re-derived rather than read because the push copy makes two claims about
// the present — how much is left, and how long the run is — and both of them are
// wrong the moment a session lands that the client never told us about.

export type Week = {
  weekKey: string; done: number; goal: number; needed: number;
  daysLeft: number; atRisk: boolean; streakWeeks: number;
};

function freezesNear(spent: number[], n: number): number {
  let c = 0;
  for (const w of spent) if (w > n - 4 && w < n) c++;
  return c;
}

export function weekState(
  sessionDays: string[], plannedDays: string[], goalSet: number | null,
  todayYmd: string, freeAllowance = 1,
): Week {
  const monday = mondayKey(todayYmd);
  const per: Record<string, number> = {};
  for (const d of sessionDays) {
    const k = mondayKey(d);
    per[k] = (per[k] || 0) + 1;
  }

  const planned: Record<string, boolean> = {};
  let plannedThisWeek = 0;
  for (const d of plannedDays) {
    if (mondayKey(d) !== monday || planned[d]) continue;
    planned[d] = true;
    plannedThisWeek++;
  }

  const goal = Math.max(1, goalSet || plannedThisWeek || 3);
  const done = per[monday] || 0;
  const needed = Math.max(0, goal - done);
  // Today still counts, so Monday has seven days left and Sunday has one.
  const daysLeft = 7 - dowOf(todayYmd);

  const [my, mm, md] = monday.split("-").map(Number);
  const mondayMs = Date.UTC(my, mm - 1, md);
  const spent: number[] = [];
  let streak = done >= goal ? 1 : 0;
  for (let n = 1; n < 260; n++) {
    const back = new Date(mondayMs - n * 7 * 86_400_000);
    const key = `${back.getUTCFullYear()}-${pad2(back.getUTCMonth() + 1)}-${pad2(back.getUTCDate())}`;
    const got = per[key] || 0;
    if (got >= goal) streak++;
    else if (goal - got === 1 && freezesNear(spent, n) < freeAllowance) { spent.push(n); streak++; }
    else break;
  }

  return {
    weekKey: monday, done, goal, needed, daysLeft,
    atRisk: needed > 0 && needed === daysLeft,
    streakWeeks: streak,
  };
}

// ---------- the decision ----------

/**
 * Everything the decision reads, and nothing about how the message travels.
 *
 * Both tables carry exactly these columns because `decide()` is the policy and
 * there is only one policy. A browser row adds its endpoint and the subscriber's
 * keys; a device row adds a token, a bundle and an environment. Splitting the
 * type this way is what makes it impossible to write a rule that applies to one
 * transport and not the other, which is the bug this feature was most likely to
 * ship: two senders, two caps, a phone that buzzes twice.
 */
export type Reminder = {
  id: string;
  user_id: string;
  tz: string;
  remind_plan: boolean;
  remind_risk: boolean;
  remind_at: number;
  last_sent_at: string | null;
  sent_week: number;
  week_key: string | null;
  risk_week: string | null;
};

/** A browser, addressed by the endpoint its push service issued. */
export type Sub = Reminder & {
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** A native install, addressed by the device token Apple issued. */
export type Device = Reminder & {
  token: string;
  bundle: string | null;
  env: string;
};

/** Everything about the user this decision needs, read once per user per tick. */
export type Ctx = {
  sessionDays: string[];        // local ymd of every finished session, newest-first order irrelevant
  plannedDays: string[];        // local ymd of every planned day this week
  todayPlan: { title: string; minutes: number | null } | null;
  goal: number | null;
  freeAllowance: number;        // 1 free, 2 on Plus — the freeze ladder
  lastFinishMs: number | null;  // when the most recent session was completed
};

export type Decision =
  | { send: false; why: string }
  | { send: true; kind: "plan" | "risk"; title: string; body?: string; tag: string; url: string; week: string };

/**
 * The whole policy, as one pure function over one row and one user's facts, so
 * that every rule in it is a line in the harness rather than something you find
 * out about from a stranger's lock screen.
 *
 * Order matters: the cheap refusals first, then the caps, then the two
 * reminders. At-risk wins a tie because the plan-day reminder comes round again
 * tomorrow and the week does not.
 */
export function decide(sub: Reminder, ctx: Ctx, nowMs: number): Decision {
  if (!sub.remind_plan && !sub.remind_risk) return { send: false, why: "off" };

  const now = localAt(nowMs, sub.tz);
  const week = weekState(ctx.sessionDays, ctx.plannedDays, ctx.goal, now.ymd, ctx.freeAllowance);

  // The at-risk reminder is allowed one hour of its own: a user whose chosen
  // time is late in the evening would otherwise never get it, because the design
  // forbids it after 20:00.
  const planHour = hourFor(sub.remind_at);
  const riskHour = Math.min(planHour, 20);
  if (now.hour !== planHour && now.hour !== riskHour) return { send: false, why: "not this hour" };

  // Silence for a day after a finished session. Somebody who trained this
  // morning does not need telling about today's plan, and telling them anyway is
  // exactly the notification people turn off.
  if (ctx.lastFinishMs !== null && nowMs - ctx.lastFinishMs < 86_400_000) {
    return { send: false, why: "trained in the last 24h" };
  }

  // One a day. Compared as local calendar days rather than as 24 elapsed hours,
  // because "one a day" is a promise about the user's day.
  if (sub.last_sent_at && localAt(Date.parse(sub.last_sent_at), sub.tz).ymd === now.ymd) {
    return { send: false, why: "already sent today" };
  }

  // Three a week, counted against the week the counter was last written for: a
  // stale counter from a fortnight ago is not this week's budget.
  const usedThisWeek = sub.week_key === week.weekKey ? (sub.sent_week || 0) : 0;
  if (usedThisWeek >= 3) return { send: false, why: "three already this week" };

  const url = appUrl();

  if (sub.remind_risk && now.hour === riskHour && riskHour <= 20 && week.atRisk &&
      sub.risk_week !== week.weekKey) {
    // "One session left this week." — the plural is mechanical, not new copy,
    // and the streak line is left off at zero rather than reading as a scold.
    const title = week.needed === 1
      ? "One session left this week."
      : `${week.needed} sessions left this week.`;
    return {
      send: true, kind: "risk", title, tag: "spotter-risk", url, week: week.weekKey,
      body: week.streakWeeks > 0 ? `Your streak is at ${week.streakWeeks}.` : undefined,
    };
  }

  if (sub.remind_plan && now.hour === planHour) {
    if (!ctx.todayPlan) return { send: false, why: "nothing planned today" };
    // "Push day is on today's plan. 42 minutes." — split across the two lines a
    // notification actually has, so the sentence survives intact on the lock
    // screen. No duration, no second line: an invented one would be filler.
    return {
      send: true, kind: "plan", tag: "spotter-plan", url, week: week.weekKey,
      title: `${ctx.todayPlan.title} is on today's plan.`,
      body: ctx.todayPlan.minutes ? `${ctx.todayPlan.minutes} minutes.` : undefined,
    };
  }

  return { send: false, why: sub.remind_risk && !week.atRisk ? "week is not at risk" : "nothing due" };
}

// ---------- talking to PostgREST ----------

function rest(table: string): string { return `${SUPABASE_URL}/rest/v1/${table}`; }

async function readRows(table: string, query: string): Promise<Record<string, unknown>[]> {
  const r = await serviceFetch(`${rest(table)}?${query}`, { headers: dbHeaders });
  if (!r.ok) throw new Error(`push db ${table} ${r.status}: ${await r.text()}`);
  return await r.json();
}

async function writeRow(table: string, query: string, body: Record<string, unknown>): Promise<void> {
  const r = await serviceFetch(`${rest(table)}?${query}`, {
    method: "PATCH",
    headers: { ...dbHeaders, prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.error(`push patch ${table}`, r.status, await r.text());
  else await r.body?.cancel();
}

async function dropRow(table: string, query: string): Promise<void> {
  const r = await serviceFetch(`${rest(table)}?${query}`, { method: "DELETE", headers: dbHeaders });
  await r.body?.cancel();
}

// ---------- the send ----------

/** What the push service said, and whether the subscription survived it. */
export type SendResult = { status: number; gone: boolean };

export async function sendPush(
  endpoint: string, p256dh: string, auth: string, payload: unknown,
): Promise<SendResult> {
  const target = await pushEndpoint(endpoint);
  const body = await encryptPayload(p256dh, auth, utf8.encode(JSON.stringify(payload)));
  const r = await fetch(target.toString(), {
    method: "POST",
    // A push service answers 201; it has no reason to redirect, and a redirect
    // is not followed. It comes back as a 3xx and is logged as refused below.
    redirect: "manual",
    headers: {
      authorization: await vapidAuth(endpoint),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "3600",              // one hour: a reminder for 17:00 is worthless at 22:00
      urgency: "normal",
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  await r.body?.cancel();
  // 404 and 410 are the push service saying this endpoint no longer exists —
  // the app was deleted, permission was revoked, the browser reset it. Keeping
  // the row would mean paying for a failing request every day forever.
  return { status: r.status, gone: r.status === 404 || r.status === 410 };
}

// ---------- the hourly tick ----------

/** Every user fact one decision needs, gathered in one round of reads. */
async function contextFor(userId: string, tz: string, todayYmd: string): Promise<Ctx> {
  const monday = mondayKey(todayYmd);
  const [my, mm, md] = monday.split("-").map(Number);
  const sunday = new Date(Date.UTC(my, mm - 1, md) + 6 * 86_400_000);
  const sundayYmd = `${sunday.getUTCFullYear()}-${pad2(sunday.getUTCMonth() + 1)}-${pad2(sunday.getUTCDate())}`;

  // Two years of finished sessions is more streak than anyone has, and two
  // columns of it is a few kilobytes. `entries` is deliberately not selected:
  // the app refuses to write a completed_at over an empty session, so the column
  // already carries the "at least one set" half of the client's rule.
  const since = new Date(Date.parse(`${monday}T00:00:00Z`) - 400 * 86_400_000).toISOString();
  const [logs, plan, prof] = await Promise.all([
    readRows("workout_logs",
      `user_id=eq.${userId}&completed_at=not.is.null&started_at=gte.${since}` +
      `&select=started_at,completed_at&order=started_at.desc&limit=800`),
    readRows("plan",
      `user_id=eq.${userId}&day=gte.${monday}&day=lte.${sundayYmd}` +
      `&select=day,workouts(title,duration_minutes)`),
    readRows("profiles", `id=eq.${userId}&select=plan,settings`),
  ]);

  let lastFinishMs: number | null = null;
  const sessionDays = logs.map((l) => {
    const done = Date.parse(String(l.completed_at));
    if (Number.isFinite(done) && (lastFinishMs === null || done > lastFinishMs)) lastFinishMs = done;
    return localAt(Date.parse(String(l.started_at)), tz).ymd;
  });

  const plannedDays = plan.map((p) => String(p.day));
  const todayRow = plan.find((p) => String(p.day) === todayYmd);
  const w = todayRow ? (todayRow.workouts as { title?: string; duration_minutes?: number } | null) : null;

  const settings = (prof[0]?.settings ?? {}) as Record<string, unknown>;
  const goalRaw = Number(settings.goal);
  const planName = String(prof[0]?.plan ?? "free");

  return {
    sessionDays,
    plannedDays,
    todayPlan: todayRow
      ? { title: (w && w.title) || "Your workout", minutes: (w && w.duration_minutes) || null }
      : null,
    goal: Number.isFinite(goalRaw) && goalRaw > 0 ? goalRaw : null,
    freeAllowance: planName === "free" ? 1 : 2,
    lastFinishMs,
  };
}

/** One live row and the transport that will carry it. */
type Live = { via: "web"; row: Sub } | { via: "apns"; row: Device };

/**
 * One pass over every live reminder — browsers and native installs in the same
 * loop, against the same `decide()`. Called on the hour by pg_cron, and by hand
 * with the worker secret when somebody wants to see it work.
 *
 * The hour gate is applied before anything is read, so a tick at 03:00 with two
 * hundred subscribers on 17:30 costs two queries and nothing else. `dry` returns
 * the decisions without sending, which is what makes this safe to poke at.
 *
 * A user with a browser subscription AND the app installed gets one reminder on
 * each, because the caps are per row and a row is per grant of permission —
 * exactly the answer a phone and a laptop have always had. Folding the caps up
 * to the user would silence whichever device the tick happened to reach second,
 * which is a reminder that stopped working; a duplicate is a reminder that
 * arrived twice, and only one of those two is a bug the user cannot fix from the
 * switches in front of them.
 */
export async function runPushTick(nowMs = Date.now(), dry = false): Promise<{
  looked: number; sent: number; dropped: number; decisions: { user: string; kind: string; why: string }[];
  errors: string[];
}> {
  const apns = apnsCfg();
  const live = "or=(remind_plan.eq.true,remind_risk.eq.true)&select=*&limit=2000";
  // Each table on its own: one that cannot be read this hour costs its own rows
  // this hour, not the other transport's too (it used to throw the whole tick).
  const errors: string[] = [];
  const readLive = (table: string) => readRows(table, live).catch((e) => {
    console.error(`push: could not read ${table}; this tick goes on without it`, e);
    errors.push(table);
    return [] as Record<string, unknown>[];
  });
  const [subs, devices] = await Promise.all([
    readLive("push_subscriptions") as unknown as Promise<Sub[]>,
    // A deployment with no APNs key is not read at all. Those rows are somebody
    // switching a reminder on and waiting for a signing key, not an error worth
    // a log line an hour.
    (apns ? readLive("push_devices") : Promise.resolve([])) as unknown as Promise<Device[]>,
  ]);

  const rows: Live[] = [
    ...subs.map((row) => ({ via: "web", row } as Live)),
    ...devices.map((row) => ({ via: "apns", row } as Live)),
  ];

  const decisions: { user: string; kind: string; why: string }[] = [];
  let sent = 0, dropped = 0;

  // Sequential on purpose. The hour gate has already cut this to the handful of
  // rows whose local time it is, and a burst of parallel requests to Apple and
  // Google from one isolate buys nothing but a rate limit.
  for (const entry of rows) {
    const sub = entry.row;
    const now = localAt(nowMs, sub.tz);
    const planHour = hourFor(sub.remind_at);
    if (now.hour !== planHour && now.hour !== Math.min(planHour, 20)) continue;

    let ctx: Ctx;
    try {
      ctx = await contextFor(sub.user_id, sub.tz, now.ymd);
    } catch (e) {
      console.error("push: could not read context for", sub.user_id, e);
      continue;
    }

    const d = decide(sub, ctx, nowMs);
    if (!d.send) {
      console.log(`push: user ${sub.user_id} skipped(${d.why})`);
      decisions.push({ user: sub.user_id, kind: "-", why: d.why });
      continue;
    }
    if (dry) {
      console.log(`push: user ${sub.user_id} ${d.kind} would send via ${entry.via}`);
      decisions.push({ user: sub.user_id, kind: d.kind, why: "dry run" });
      continue;
    }

    // The same message down two wires. The web payload carries the app's own
    // https address because a service worker opens a window; the APNs one
    // carries a spotter:// link because the shell routes it through
    // openDeepLink, and neither of them is the other's business.
    let gone = false, status = 0, note = "";
    try {
      if (entry.via === "web") {
        const w = entry.row;
        const r = await sendPush(w.endpoint, w.p256dh, w.auth, {
          title: d.title, body: d.body, tag: d.tag, url: d.url,
        });
        gone = r.gone;
        status = r.status;
      } else {
        const r = await sendApns(entry.row, d.kind, d.title, d.body, apns!, nowMs);
        gone = r.gone;
        status = r.status;
        note = r.reason;
      }
    } catch (e) {
      if (e instanceof PushEndpointError) {
        // Skipped, and named by row id: the endpoint itself is never logged.
        console.error(`push: row ${sub.id} endpoint refused (${e.reason}), skipped`);
        decisions.push({ user: sub.user_id, kind: d.kind, why: "endpoint refused" });
        continue;
      }
      console.error(`push: user ${sub.user_id} ${d.kind} failed`, e);
      decisions.push({ user: sub.user_id, kind: d.kind, why: "send failed" });
      continue;
    }

    const table = entry.via === "web" ? "push_subscriptions" : "push_devices";
    if (gone) {
      await dropRow(table, entry.via === "web"
        ? `endpoint=eq.${encodeURIComponent(entry.row.endpoint)}`
        : `token=eq.${encodeURIComponent((entry.row as Device).token)}`);
      dropped++;
      console.log(`push: user ${sub.user_id} ${d.kind} dropped(${status}${note ? " " + note : ""}, device gone)`);
      decisions.push({ user: sub.user_id, kind: d.kind, why: `gone ${status}` });
      continue;
    }
    if (status >= 300) {
      console.error(`push: user ${sub.user_id} ${d.kind} refused ${status}${note ? " " + note : ""}`);
      decisions.push({ user: sub.user_id, kind: d.kind, why: `refused ${status}` });
      continue;
    }

    // The caps are written after the send, not before it: a message the push
    // service never accepted must not spend the day's one slot.
    const used = sub.week_key === d.week ? (sub.sent_week || 0) : 0;
    await writeRow(table, `id=eq.${sub.id}`, {
      last_sent_at: new Date(nowMs).toISOString(),
      week_key: d.week,
      sent_week: used + 1,
      risk_week: d.kind === "risk" ? d.week : sub.risk_week,
    });
    sent++;
    console.log(`push: user ${sub.user_id} ${d.kind === "plan" ? "plan-day" : "week-at-risk"} sent via ${entry.via}`);
    decisions.push({ user: sub.user_id, kind: d.kind, why: "sent" });
  }

  return { looked: rows.length, sent, dropped, decisions, errors };
}

// ---------- a save is ready ----------
//
// The moment a video shared in from TikTok or Instagram becomes a workout is the
// moment a new person is won or lost: the Share sheet said "Saved" a minute ago,
// they have gone back to scrolling, and the card is now something they could
// start or put on a day. So a save made OUTSIDE the app (the Share Extension or
// the Shortcut, which authenticate with the ingest key, and Android's share,
// which says `source: "share"`) is marked on its job, and when that job
// delivers the card, this says so — with two actions, Start Now and Plan It,
// registered by the app as the CARD_READY category (NotificationsHost.swift).
// A save made in the app is not announced: the person is looking at it.
//
// No caps, because the person set this off themselves and the save allowance
// already bounds how often. A burst is folded instead: three shares in a row
// read "3 workouts are ready", and every banner of the burst carries one
// collapse id, so the latest replaces the earlier ones on the Lock Screen rather
// than stacking three. The count is the person's cards that became ready in the
// last two minutes and have not been started: jobs marked this way (finishJob
// stamps the mark back onto the finished job, since finishing clears its meta),
// plus cards that arrived ready at once from the shared cache — those have no
// job to mark, so every cache hit in the window counts, which can only ever
// include a card that really is ready.
//
// Installs only. The web app this would open is retired, and a browser that
// still holds a push_subscriptions row gets nothing it would have to explain.

/** How far back a burst reaches. Two minutes covers three shares made one after
 *  another from the same feed without folding in yesterday's. */
const READY_WINDOW_MS = 2 * 60_000;

/** One card as a notification names it. */
export type ReadyCard = { id: string; title: string | null; exercises: number; minutes: number | null };

/** What a card_ready notification says and where each part of it goes. `url` is
 *  the body tap; `card` is what Start Now and Plan It act on. */
export type ReadyAlert = { title: string; body: string; url: string; card: string };

/** Exercises on a card, counted the way the card's own meta line counts them. */
function exercisesIn(blocks: unknown): number {
  let n = 0;
  for (const b of Array.isArray(blocks) ? blocks : []) {
    const list = (b as { exercises?: unknown })?.exercises;
    if (Array.isArray(list)) n += list.length;
  }
  return n;
}

/** A title short enough that "is ready" is still on the Lock Screen's one line. */
function readyName(title: string | null, max: number): string {
  const t = (title ?? "").replace(/\s+/g, " ").trim() || "Your workout";
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return (space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.:;–—-]+$/, "") + "…";
}

/**
 * The words. One card is named in the title, where it is read at a glance, and
 * its size goes under it; a burst is counted, and the latest card is named in
 * the body because it is the one Start Now and Plan It act on.
 */
export function readyAlert(card: ReadyCard, count: number): ReadyAlert {
  if (count > 1) {
    return {
      title: `${count} workouts are ready`,
      body: `Latest: ${readyName(card.title, 80)} · Start now or plan it`,
      url: "spotter://tab/library",
      card: card.id,
    };
  }
  const bits: string[] = [];
  if (card.exercises > 0) bits.push(`${card.exercises} ${card.exercises === 1 ? "exercise" : "exercises"}`);
  if (card.minutes && card.minutes > 0) bits.push(`~${card.minutes} min`);
  bits.push("Start now or plan it");
  return {
    title: `${readyName(card.title, 30)} is ready`,
    body: bits.join(" · "),
    url: `spotter://ready/${card.id}`,
    card: card.id,
  };
}

/** The exact JSON body APNs carries for a ready card. The simulator fixture
 *  (tools/ios/fixtures/card-ready.apns) is generated from this, as the
 *  reminders' are from apnsPayload. */
export function readyPayload(a: ReadyAlert): Record<string, unknown> {
  return {
    aps: {
      alert: { title: a.title, body: a.body },
      sound: "default",
      // Its own stack in Notification Centre: a reminder and a new workout are
      // different kinds of news.
      "thread-id": "ready",
      // The two actions. An install that predates them has no such category and
      // shows the banner without buttons, which is harmless.
      category: "CARD_READY",
    },
    // Peers of `aps`, as the reminders' link is: APNs drops custom keys inside it.
    url: a.url,
    card: a.card,
  };
}

/** One ready notification to one device, collapsing onto the burst before it. */
export async function sendApnsReady(
  device: { token: string; bundle: string | null; env: string },
  alert: ReadyAlert, cfg: Apns, nowMs = Date.now(), originFor = apnsOrigin,
): Promise<ApnsResult> {
  return await postApns(device, "spotter-ready", readyPayload(alert), cfg, nowMs, originFor);
}

/** A workouts row as the ready query reads it. */
export type ReadyRow = { id: string; title?: string | null; blocks?: unknown; duration_minutes?: number | null };

/**
 * The whole decision, pure, so the harness can hold it: whether to send, how
 * many cards the burst counts, and which one it names. `cards` are the
 * candidates newest first (the card that just became ready among them);
 * `started` the ids with a session, which are no longer news.
 */
export function readyNotice(
  cardId: string, cards: ReadyRow[], started: string[], settings: unknown,
): { send: false; why: string } | { send: true; count: number; alert: ReadyAlert } {
  // Absent means on: the switch is only ever written to say Off.
  if ((settings as { notifyReady?: unknown } | null)?.notifyReady === false) return { send: false, why: "switched off" };
  // The card that set this off has to be one of them, ready; otherwise this
  // would only repeat a banner the burst already showed.
  if (!cards.some((c) => c.id === cardId)) return { send: false, why: "not ready" };
  const gone = new Set(started);
  const fresh = cards.filter((c) => !gone.has(c.id));
  if (!fresh.length) return { send: false, why: "already started" };
  const named = fresh.find((c) => c.id === cardId) ?? fresh[0];
  return {
    send: true,
    count: fresh.length,
    alert: readyAlert({
      id: named.id, title: named.title ?? null, exercises: exercisesIn(named.blocks),
      minutes: typeof named.duration_minutes === "number" ? named.duration_minutes : null,
    }, fresh.length),
  };
}

/**
 * Tell this person's installs that `cardId` is ready. Called in the background
 * by the ingest paths once the card is committed, and never awaited by them: a
 * notification that cannot be sent must not fail the save it is about.
 */
export async function sendReady(
  userId: string, cardId: string, nowMs = Date.now(), originFor = apnsOrigin,
): Promise<{ sent: number; why: string }> {
  const apns = apnsCfg();
  if (!apns) return { sent: 0, why: "no APNs key" };
  // Devices first: most people have none, and then nothing else is worth a read.
  const devices = await readRows("push_devices", `user_id=eq.${userId}&select=token,bundle,env`) as unknown as Device[];
  if (!devices.length) return { sent: 0, why: "no device" };
  const since = new Date(nowMs - READY_WINDOW_MS).toISOString();
  const [prof, jobs] = await Promise.all([
    readRows("profiles", `id=eq.${userId}&select=settings`),
    readRows("ingest_jobs",
      `user_id=eq.${userId}&status=eq.done&finished_at=gte.${since}&meta->>notify_ready=eq.true&select=id`),
  ]);
  const or = [`id.eq.${cardId}`, `and(ingest_job_id.is.null,platform.neq.pumpy,created_at.gte."${since}")`];
  if (jobs.length) or.push(`ingest_job_id.in.(${jobs.map((j) => String(j.id)).join(",")})`);
  const cards = await readRows("workouts",
    `user_id=eq.${userId}&ingest_status=eq.ready&or=(${encodeURIComponent(or.join(","))})` +
    `&select=id,title,blocks,duration_minutes&order=created_at.desc&limit=20`) as unknown as ReadyRow[];
  const ids = cards.map((c) => c.id);
  const started = ids.length
    ? await readRows("workout_logs", `user_id=eq.${userId}&workout_id=in.(${ids.join(",")})&select=workout_id`)
    : [];
  const n = readyNotice(cardId, cards, started.map((s) => String(s.workout_id)), prof[0]?.settings);
  if (!n.send) {
    console.log(`push: user ${userId} ready skipped(${n.why})`);
    return { sent: 0, why: n.why };
  }
  let sent = 0;
  for (const d of devices) {
    try {
      const r = await sendApnsReady(d, n.alert, apns, nowMs, originFor);
      if (r.gone) {
        await dropRow("push_devices", `token=eq.${encodeURIComponent(d.token)}`);
        console.log(`push: user ${userId} ready dropped(${r.status} ${r.reason}, device gone)`);
      } else if (r.status >= 300) {
        console.error(`push: user ${userId} ready refused ${r.status} ${r.reason}`);
      } else sent++;
    } catch (e) {
      console.error(`push: user ${userId} ready failed`, e);
    }
  }
  console.log(`push: user ${userId} ready (${n.count}) sent to ${sent} of ${devices.length} device(s)`);
  return { sent, why: sent ? "sent" : "not delivered" };
}

// Spotter — the two reminders, and nothing else.
//
// There are exactly two notifications in this app and there will not be a third:
//
//   1. **Plan day** — at an hour the user picked. "Push day is on today's plan.
//      42 minutes."
//   2. **Week at risk** — once a week, on the day the goal stops having slack,
//      never after 20:00 local. "One session left this week. Your streak is at 6."
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

function vapidCfg(): Vapid | null {
  const publicKey = (Deno.env.get("VAPID_PUBLIC_KEY") ?? "").trim();
  const privateKey = (Deno.env.get("VAPID_PRIVATE_KEY") ?? "").trim();
  const subject = (Deno.env.get("VAPID_SUBJECT") ?? "").trim() || appUrl();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

/** Is web push set up on this deployment at all? The app asks before it offers. */
export function pushConfigured(): boolean {
  return vapidCfg() !== null;
}

/**
 * What `GET /api/push/config` answers. The public key is not a secret — it ends
 * up in every subscription — but it is read from the environment rather than
 * baked into the page so that rotating the pair is a secret change and a reload,
 * not a deploy of the app.
 */
export function pushConfig(): { configured: boolean; key?: string } {
  const cfg = vapidCfg();
  return cfg ? { configured: true, key: cfg.publicKey } : { configured: false };
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

export async function vapidAuth(endpoint: string, nowMs = Date.now()): Promise<string> {
  const cfg = vapidCfg();
  if (!cfg) throw new Error("push: VAPID keys are not set");
  const head = b64u(utf8.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(utf8.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(nowMs / 1000) + 12 * 3600,
    sub: cfg.subject,
  })));
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, await vapidKey(cfg), utf8.encode(`${head}.${body}`),
  ));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${cfg.publicKey}`;
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

/** The row, as the sender needs it. */
export type Sub = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  tz: string;
  remind_plan: boolean;
  remind_risk: boolean;
  remind_at: number;
  last_sent_at: string | null;
  sent_week: number;
  week_key: string | null;
  risk_week: string | null;
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
export function decide(sub: Sub, ctx: Ctx, nowMs: number): Decision {
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
  const r = await fetch(`${rest(table)}?${query}`, { headers: dbHeaders });
  if (!r.ok) throw new Error(`push db ${table} ${r.status}: ${await r.text()}`);
  return await r.json();
}

async function writeRow(table: string, query: string, body: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${rest(table)}?${query}`, {
    method: "PATCH",
    headers: { ...dbHeaders, prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.error(`push patch ${table}`, r.status, await r.text());
  else await r.body?.cancel();
}

async function dropRow(endpoint: string): Promise<void> {
  const r = await fetch(`${rest("push_subscriptions")}?endpoint=eq.${encodeURIComponent(endpoint)}`, {
    method: "DELETE", headers: dbHeaders,
  });
  await r.body?.cancel();
}

// ---------- the send ----------

/** What the push service said, and whether the subscription survived it. */
export type SendResult = { status: number; gone: boolean };

export async function sendPush(
  endpoint: string, p256dh: string, auth: string, payload: unknown,
): Promise<SendResult> {
  const body = await encryptPayload(p256dh, auth, utf8.encode(JSON.stringify(payload)));
  const r = await fetch(endpoint, {
    method: "POST",
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

/**
 * One pass over every live subscription. Called on the hour by pg_cron, and by
 * hand with the worker secret when somebody wants to see it work.
 *
 * The hour gate is applied before anything is read, so a tick at 03:00 with two
 * hundred subscribers on 17:30 costs one query and nothing else. `dry` returns
 * the decisions without sending, which is what makes this safe to poke at.
 */
export async function runPushTick(nowMs = Date.now(), dry = false): Promise<{
  looked: number; sent: number; dropped: number; decisions: { user: string; kind: string; why: string }[];
}> {
  const rows = await readRows("push_subscriptions",
    "or=(remind_plan.eq.true,remind_risk.eq.true)&select=*&limit=2000") as unknown as Sub[];

  const decisions: { user: string; kind: string; why: string }[] = [];
  let sent = 0, dropped = 0;

  // Sequential on purpose. The hour gate has already cut this to the handful of
  // rows whose local time it is, and a burst of parallel requests to Apple and
  // Google from one isolate buys nothing but a rate limit.
  for (const sub of rows) {
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
      console.log(`push: user ${sub.user_id} ${d.kind} would send`);
      decisions.push({ user: sub.user_id, kind: d.kind, why: "dry run" });
      continue;
    }

    let result: SendResult;
    try {
      result = await sendPush(sub.endpoint, sub.p256dh, sub.auth, {
        title: d.title, body: d.body, tag: d.tag, url: d.url,
      });
    } catch (e) {
      console.error(`push: user ${sub.user_id} ${d.kind} failed`, e);
      decisions.push({ user: sub.user_id, kind: d.kind, why: "send failed" });
      continue;
    }

    if (result.gone) {
      await dropRow(sub.endpoint);
      dropped++;
      console.log(`push: user ${sub.user_id} ${d.kind} dropped(${result.status}, endpoint gone)`);
      decisions.push({ user: sub.user_id, kind: d.kind, why: `gone ${result.status}` });
      continue;
    }
    if (result.status >= 300) {
      console.error(`push: user ${sub.user_id} ${d.kind} refused ${result.status}`);
      decisions.push({ user: sub.user_id, kind: d.kind, why: `refused ${result.status}` });
      continue;
    }

    // The caps are written after the send, not before it: a message the push
    // service never accepted must not spend the day's one slot.
    const used = sub.week_key === d.week ? (sub.sent_week || 0) : 0;
    await writeRow("push_subscriptions", `id=eq.${sub.id}`, {
      last_sent_at: new Date(nowMs).toISOString(),
      week_key: d.week,
      sent_week: used + 1,
      risk_week: d.kind === "risk" ? d.week : sub.risk_week,
    });
    sent++;
    console.log(`push: user ${sub.user_id} ${d.kind === "plan" ? "plan-day" : "week-at-risk"} sent`);
    decisions.push({ user: sub.user_id, kind: d.kind, why: "sent" });
  }

  return { looked: rows.length, sent, dropped, decisions };
}

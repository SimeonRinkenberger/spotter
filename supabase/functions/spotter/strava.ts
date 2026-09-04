// Spotter — Strava. Connect an account, and push one finished session to it as a
// manual WeightTraining activity.
//
// Four rules shape this file, and three of them are Strava's.
//
// **It must not be able to take the rest of the function down.** Same rule, same
// shape as `billing.ts`: nothing is read from the environment at module load
// beyond the Supabase pair every module already needs, the three Strava secrets
// are read on the call that needs them, and a project with none of them set
// behaves exactly as it does today — every route answers `not_configured` and the
// app hides the whole feature. This module imports nothing from `index.ts` and
// talks to PostgREST itself, so there is no cycle and no way for an edit here to
// change a code path over there.
//
// **Refresh tokens rotate, and a lost rotation is permanent.** Strava returns a
// new refresh token every time one is spent and invalidates the old one at once.
// Two isolates refreshing the same connection at the same moment is therefore not
// a wasted round trip, it is a broken connection — whichever write lands second
// stores a refresh token Strava has already thrown away. So the write is a
// compare-and-set: update the row only WHERE the refresh token is still the one we
// read. Zero rows changed means somebody else rotated first, and the answer is to
// re-read and use theirs, never to overwrite it. See `resolveRotation`.
//
// **We are write-only.** The API agreement forbids using Strava data in any AI
// feature — training, embeddings, RAG, all of it — caps caching at seven days and
// bans persistent indexes. Holding nothing but tokens and the id of the activity
// we ourselves created keeps us permanently on the right side of that, and it is
// why `status` returns an athlete id and not a name, a photo or a single activity.
//
// **The photo cannot go.** There is no public photo-upload endpoint; media upload
// is partner-only. So the share card stays in the app and the activity carries a
// link back instead, which is what every other app in this position does.
//
// Nothing here logs a token. The push logs one line: who, which log, which
// activity.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Same rule as index.ts and billing.ts: legacy service keys are JWTs and want a
// Bearer header, new sb_secret_ keys are not JWTs and must go as `apikey` only.
const KEY_IS_JWT = (SERVICE_KEY ?? "").split(".").length === 3;
const dbHeaders: Record<string, string> = KEY_IS_JWT
  ? { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" }
  : { apikey: SERVICE_KEY, "content-type": "application/json" };

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://simeonrinkenberger.github.io,http://localhost:8000,http://127.0.0.1:8000")
  .split(",").map((s) => s.trim()).filter(Boolean);

/** Where the browser is sent after the OAuth hop. The app's own address, always. */
function returnBase(): string {
  return `${ALLOWED_ORIGINS[0]}/spotter/`;
}

const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
// The documented address today. `https://www.strava.com/oauth/token` is the older
// spelling of the same endpoint and still answers; this is the one the reference
// prints, so it is the one used.
const TOKEN_URL = "https://www.strava.com/api/v3/oauth/token";
const DEAUTHORIZE_URL = "https://www.strava.com/oauth/deauthorize";
const ACTIVITIES_URL = "https://www.strava.com/api/v3/activities";

/** The only scope we ask for. More scope is a worse consent screen for no benefit. */
const SCOPE = "activity:write";

/** A signed state is good for ten minutes — long enough to read a consent screen. */
const STATE_TTL_MS = 10 * 60_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A Strava failure that already knows what the user should be told. The route in
 * index.ts answers with its status and code; anything else that escapes is a 500
 * and a log line, which is the right treatment for a surprise.
 */
export class StravaError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "StravaError";
    this.status = status;
    this.code = code;
  }
}

// ---------- configuration ----------

type Cfg = { id: string; secret: string; stateSecret: string };

/** True when the owner has set all three secrets. Every route asks this first. */
export function stravaConfigured(): boolean {
  return !!(
    (Deno.env.get("STRAVA_CLIENT_ID") ?? "").trim() &&
    (Deno.env.get("STRAVA_CLIENT_SECRET") ?? "").trim() &&
    (Deno.env.get("STRAVA_STATE_SECRET") ?? "").trim()
  );
}

/**
 * The three secrets, read on the call that needs them rather than at import.
 *
 * All three or none: a client id with no state secret would mean unsigned states,
 * which is an open "connect this stranger's Strava to my account" redirect, and a
 * half-configured project must fail closed rather than clever.
 */
function cfg(): Cfg {
  const id = (Deno.env.get("STRAVA_CLIENT_ID") ?? "").trim();
  const secret = (Deno.env.get("STRAVA_CLIENT_SECRET") ?? "").trim();
  const stateSecret = (Deno.env.get("STRAVA_STATE_SECRET") ?? "").trim();
  if (!id || !secret || !stateSecret) {
    throw new StravaError(503, "not_configured", "Strava is not switched on yet.");
  }
  return { id, secret, stateSecret };
}

// ---------- PostgREST, the small corner of it this module needs ----------

function rest(table: string): string {
  return `${SUPABASE_URL}/rest/v1/${table}`;
}

async function sSelect(table: string, query: string): Promise<any[]> {
  const r = await fetch(`${rest(table)}?${query}`, { headers: dbHeaders });
  if (!r.ok) throw new Error(`strava db select ${table} ${r.status}: ${await r.text()}`);
  return await r.json();
}

async function sUpsert(table: string, row: Record<string, unknown>): Promise<void> {
  const r = await fetch(rest(table), {
    method: "POST",
    headers: { ...dbHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`strava db upsert ${table} ${r.status}: ${await r.text()}`);
  await r.body?.cancel();
}

/** PATCH that says how many rows it actually changed — the compare-and-set needs that. */
async function sPatchReturning(
  table: string, query: string, body: Record<string, unknown>,
): Promise<any[]> {
  const r = await fetch(`${rest(table)}?${query}`, {
    method: "PATCH",
    headers: { ...dbHeaders, prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`strava db patch ${table} ${r.status}: ${await r.text()}`);
  const text = await r.text();
  return text ? JSON.parse(text) : [];
}

async function sDelete(table: string, query: string): Promise<void> {
  const r = await fetch(`${rest(table)}?${query}`, { method: "DELETE", headers: dbHeaders });
  if (!r.ok) throw new Error(`strava db delete ${table} ${r.status}: ${await r.text()}`);
  await r.body?.cancel();
}

// ---------- the signed state ----------

// The state parameter is the only thing tying the browser that started the OAuth
// hop to the browser that comes back, because Strava arrives at the callback
// holding no Supabase token and never will. If it were a bare user id, anybody
// could paste their own code onto somebody else's id and connect a Strava account
// to an account they do not own. So it is signed, it carries a nonce so two
// connects in the same second are different strings, and it expires.

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// Keyed on the secret's own text: an isolate never sees two, and re-importing the
// key on every callback would be a needless await on a cold path.
let stateKey: { secret: string; key: CryptoKey } | null = null;

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (stateKey && stateKey.secret === secret) return stateKey.key;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
  stateKey = { secret, key };
  return key;
}

/** `<b64url(userId.nonce.expiry)>.<b64url(hmac)>` — opaque to Strava, checkable by us. */
export async function signState(userId: string, now = Date.now()): Promise<string> {
  const { stateSecret } = cfg();
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(9)));
  const payload = `${userId}.${nonce}.${now + STATE_TTL_MS}`;
  const bytes = new TextEncoder().encode(payload);
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(stateSecret), bytes);
  return `${b64url(bytes)}.${b64url(new Uint8Array(sig))}`;
}

/**
 * The user id inside a state, or null if it has been touched or has expired.
 *
 * `crypto.subtle.verify` rather than comparing two strings, because a string
 * compare returns as soon as it finds a difference and that is a timing oracle on
 * a signature. Every failure answers the same null: telling a caller WHICH check
 * failed is telling an attacker which half to work on.
 */
export async function verifyState(state: string, now = Date.now()): Promise<string | null> {
  const { stateSecret } = cfg();
  const parts = String(state ?? "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  let bytes: Uint8Array, sig: Uint8Array;
  try {
    bytes = unb64url(parts[0]);
    sig = unb64url(parts[1]);
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify(
    "HMAC", await hmacKey(stateSecret), sig as unknown as BufferSource, bytes as unknown as BufferSource,
  );
  if (!ok) return null;
  const [userId, , expiry] = new TextDecoder().decode(bytes).split(".");
  if (!UUID_RE.test(userId ?? "")) return null;
  const exp = Number(expiry);
  if (!Number.isFinite(exp) || exp <= now) return null;
  return userId;
}

// ---------- the token row ----------

type TokenRow = {
  user_id: string;
  athlete_id: number | null;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scope: string | null;
};

async function loadTokens(userId: string): Promise<TokenRow | null> {
  const rows = await sSelect(
    "strava_tokens",
    `user_id=eq.${userId}&select=user_id,athlete_id,access_token,refresh_token,expires_at,scope`,
  );
  return (rows[0] as TokenRow) ?? null;
}

/** `{configured, connected, athlete_id}` — everything the app is allowed to know. */
export async function stravaStatus(userId: string): Promise<Record<string, unknown>> {
  if (!stravaConfigured()) return { configured: false, connected: false, athlete_id: null };
  const row = await loadTokens(userId);
  return {
    configured: true,
    connected: !!row,
    athlete_id: row?.athlete_id ?? null,
  };
}

// ---------- connect ----------

/** The function's own address, whatever host it is answering on. */
function functionBase(req: Request): string {
  const u = new URL(req.url);
  const i = u.pathname.indexOf("/spotter");
  const path = i >= 0 ? u.pathname.slice(0, i + "/spotter".length) : "";
  return `${u.origin}${path}`;
}

/** Where Strava sends the browser back to. Its host is the app's callback domain. */
export function callbackUrl(req: Request): string {
  return `${functionBase(req)}/api/strava/callback`;
}

/**
 * The consent URL. `approval_prompt=auto` so somebody who has already said yes is
 * not asked twice — reconnecting after a disconnect still shows the screen,
 * because the disconnect deauthorized us.
 */
export async function connectUrl(userId: string, req: Request): Promise<string> {
  const { id } = cfg();
  const q = new URLSearchParams({
    client_id: id,
    redirect_uri: callbackUrl(req),
    response_type: "code",
    scope: SCOPE,
    approval_prompt: "auto",
    state: await signState(userId),
  });
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

// ---------- the callback ----------

/** A redirect into the static return page, which is the only thing the browser sees. */
function backToApp(outcome: string, why?: string): Response {
  const q = why ? `?strava=${outcome}&why=${encodeURIComponent(why)}` : `?strava=${outcome}`;
  return new Response(null, {
    status: 302,
    headers: { location: `${returnBase()}strava-return.html${q}`, "cache-control": "no-store" },
  });
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  scope?: string;
  athlete?: { id?: number };
};

async function exchange(params: Record<string, string>): Promise<TokenResponse> {
  const { id, secret } = cfg();
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
  });
  const text = await r.text();
  if (!r.ok) {
    // The body is Strava's, and it names the athlete cap when that is what
    // happened — worth carrying out so the return page can say which wall it was.
    const cap = /athlete|capacity|limit/i.test(text) ? "capacity" : "refused";
    console.error("strava: token exchange", r.status, cap);
    throw new StravaError(502, cap, "Strava refused the connection.");
  }
  return JSON.parse(text) as TokenResponse;
}

/** Space- or comma-delimited, depending on where it came from. Both are Strava's. */
function grantedScope(raw: string | null): string[] {
  return String(raw ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * GET /api/strava/callback — matched ABOVE the auth gate, like the Stripe webhook,
 * because Strava arrives holding no Supabase token.
 *
 * Everything it answers is a 302 into a static page in the app's own origin: a
 * user who has just left the app is owed a screen, not JSON, and the app learns
 * the outcome from the query string when it opens again.
 */
export async function handleCallback(req: Request): Promise<Response> {
  if (!stravaConfigured()) return backToApp("error", "not_configured");
  const url = new URL(req.url);

  // The person pressed Cancel on Strava's own screen. Not an error to explain.
  const denied = url.searchParams.get("error");
  if (denied) return backToApp("error", "declined");

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!code || !state) return backToApp("error", "bad_request");

  let userId: string | null = null;
  try {
    userId = await verifyState(state);
  } catch (e) {
    console.error("strava callback: state check failed —", e);
  }
  if (!userId) return backToApp("error", "bad_state");

  // Strava reports what was actually granted on the redirect, and a person can
  // untick a box on the consent screen. Without activity:write there is nothing
  // this connection could ever do, so it is refused here rather than stored and
  // discovered on the first push.
  if (!grantedScope(url.searchParams.get("scope")).includes(SCOPE)) {
    return backToApp("error", "scope");
  }

  let tok: TokenResponse;
  try {
    tok = await exchange({ code, grant_type: "authorization_code" });
  } catch (e) {
    return backToApp("error", e instanceof StravaError ? e.code : "exchange");
  }
  if (!tok.access_token || !tok.refresh_token || !tok.expires_at) {
    return backToApp("error", "exchange");
  }

  try {
    await sUpsert("strava_tokens", {
      user_id: userId,
      athlete_id: tok.athlete?.id ?? null,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: new Date(tok.expires_at * 1000).toISOString(),
      scope: tok.scope ?? SCOPE,
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("strava callback: could not store the connection —", e);
    return backToApp("error", "store");
  }
  console.log("strava: connected", userId, "athlete", tok.athlete?.id ?? "unknown");
  return backToApp("connected");
}

// ---------- keeping the access token alive ----------

type Minted = { access_token: string; refresh_token: string; expires_at: number };

/**
 * Which access token to use after a refresh, given how many rows the
 * compare-and-set actually changed.
 *
 * Split out with the re-read injected because it is the one piece of this file
 * whose bug would be invisible until somebody's connection silently died: zero
 * rows changed means another isolate spent the same refresh token first and has
 * already stored ITS rotation, so ours is the one Strava threw away and theirs is
 * the live one. Taking the minted token there — the obvious-looking thing — leaves
 * a row whose refresh token no longer works, and no amount of retrying fixes it.
 */
export async function resolveRotation(
  minted: Minted, changed: number, reread: () => Promise<TokenRow | null>,
): Promise<string> {
  if (changed > 0) return minted.access_token;
  const stored = await reread();
  if (!stored) {
    throw new StravaError(409, "disconnected", "Strava disconnected this app — reconnect in Settings.");
  }
  return stored.access_token;
}

/**
 * A usable access token, refreshing sixty seconds early so a slow POST cannot
 * expire mid-flight.
 */
async function accessToken(userId: string, row: TokenRow): Promise<string> {
  const expMs = Date.parse(row.expires_at);
  if (Number.isFinite(expMs) && expMs > Date.now() + 60_000) return row.access_token;

  let tok: TokenResponse;
  try {
    tok = await exchange({ grant_type: "refresh_token", refresh_token: row.refresh_token });
  } catch (e) {
    // A refresh token Strava will not accept is a connection that is over — either
    // the athlete revoked us, or we lost a rotation before this guard existed.
    // Drop the row so the app says "reconnect" instead of failing for ever.
    await sDelete("strava_tokens", `user_id=eq.${userId}`).catch(() => {});
    console.error("strava: refresh refused for", userId, "— connection dropped");
    throw new StravaError(409, "disconnected", "Strava disconnected this app — reconnect in Settings.");
  }
  if (!tok.access_token || !tok.refresh_token || !tok.expires_at) {
    throw new StravaError(502, "strava_failed", "Strava did not return a usable token.");
  }
  const minted: Minted = {
    access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: tok.expires_at,
  };

  // The compare-and-set. `refresh_token=eq.<the one we read>` is the whole guard:
  // if another isolate rotated between our read and this write, the filter matches
  // nothing and PostgREST hands back an empty array rather than clobbering theirs.
  const changed = await sPatchReturning(
    "strava_tokens",
    `user_id=eq.${userId}&refresh_token=eq.${encodeURIComponent(row.refresh_token)}&select=user_id`,
    {
      access_token: minted.access_token,
      refresh_token: minted.refresh_token,
      expires_at: new Date(minted.expires_at * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
  );
  return await resolveRotation(minted, changed.length, () => loadTokens(userId));
}

// ---------- what the activity says ----------

const LB_PER_KG = 2.2046226;

/** The same conversion and the same rounding the app does, so the numbers match. */
function inUnit(weight: number, from: string, to: string): number {
  const w = Number(weight) || 0;
  if (!w || !from || from === to) return w;
  return Math.round((to === "kg" ? w / LB_PER_KG : w * LB_PER_KG) * 10) / 10;
}

function num(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function tidy(n: number): string {
  return Number(n.toFixed(1)).toLocaleString("en-US");
}

type LoggedSet = { reps?: number; weight?: number | null; unit?: string; seconds?: number; pr?: boolean };
type LoggedEntry = { name?: string; sets?: LoggedSet[] };

/**
 * One line per exercise, the way a lifter writes it in a notebook: "Goblet Squat
 * 3 x 12 @ 24 kg" when every set matched, and the sets spelled out when they did
 * not, because "3 x 12" for 12/10/8 is a lie about the session.
 */
function exerciseLine(entry: LoggedEntry, unit: string): string {
  const name = String(entry.name ?? "Exercise").trim() || "Exercise";
  const sets = (entry.sets ?? []).filter(Boolean);
  if (!sets.length) return name;

  // A held second logs as a set with no reps — a plank, a dead hang, a carry.
  const holds = sets.filter((s) => !s.reps && s.seconds);
  if (holds.length === sets.length) {
    const secs = holds.map((s) => num(s.seconds));
    const same = secs.every((s) => s === secs[0]);
    return `${name}  ${same ? `${secs.length} x ${secs[0]}s` : secs.map((s) => `${s}s`).join(", ")}`;
  }

  const shown = sets.map((s) => ({
    reps: num(s.reps),
    weight: s.weight ? inUnit(num(s.weight), String(s.unit ?? unit), unit) : 0,
  }));
  const first = shown[0];
  const uniform = shown.every((s) => s.reps === first.reps && s.weight === first.weight);
  if (uniform) {
    return `${name}  ${shown.length} x ${first.reps}` +
      (first.weight ? ` @ ${tidy(first.weight)} ${unit}` : "");
  }
  return `${name}  ` + shown
    .map((s) => `${s.reps}${s.weight ? ` @ ${tidy(s.weight)}` : ""}`)
    .join(", ") + (shown.some((s) => s.weight) ? ` ${unit}` : "");
}

export type PushLog = {
  workout_title?: string | null;
  duration_seconds?: number | null;
  entries?: LoggedEntry[] | null;
};

export type PushOpts = {
  startLocal: string;
  unit?: string;
  prs?: Array<{ name?: string; weight?: number; unit?: string; reps?: number }>;
  permalink?: string;
};

/** Strava wants ISO-8601 local time. Anything else is refused or lands in the wrong hour. */
const LOCAL_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z?$/;

/**
 * The activity, form-encoded, exactly as `POST /api/v3/activities` wants it.
 *
 * `sport_type` only: `type` is deprecated and sending both is how an app ends up
 * with the legacy value winning. No `distance` — a lifting session has none, and a
 * zero would put a 0.00 km on the activity page. The permalink is in the
 * description because there is no photo endpoint open to us, so a link back is the
 * only way the card is reachable from Strava at all.
 */
export function activityBody(log: PushLog, opts: PushOpts): Record<string, string> {
  const unit = opts.unit === "kg" || opts.unit === "lb" ? opts.unit : "lb";
  const entries = (log.entries ?? []).filter(Boolean);

  const lines: string[] = [];
  for (const e of entries) lines.push(exerciseLine(e, unit));

  let volume = 0;
  for (const e of entries) {
    for (const s of e.sets ?? []) {
      if (s && s.reps && s.weight) volume += num(s.reps) * inUnit(num(s.weight), String(s.unit ?? unit), unit);
    }
  }
  if (volume > 0) lines.push("", `Volume ${Math.round(volume).toLocaleString("en-US")} ${unit}`);

  const prs = (opts.prs ?? []).filter(Boolean);
  if (prs.length) {
    lines.push("", ...prs.map((p) => {
      const w = p.weight ? inUnit(num(p.weight), String(p.unit ?? unit), unit) : 0;
      return `New best: ${String(p.name ?? "lift").trim()}` +
        (w ? ` ${tidy(w)} ${unit}` : "") + (p.reps ? ` x ${p.reps}` : "");
    }));
  }

  lines.push("", `Logged with Spotter — ${opts.permalink ?? returnBase()}`);

  // A duration of zero is refused by Strava; a session that somehow has none is
  // still a session, and a minute is the smallest honest floor.
  const elapsed = Math.max(60, Math.round(num(log.duration_seconds)));

  return {
    name: String(log.workout_title ?? "").trim() || "Workout",
    sport_type: "WeightTraining",
    start_date_local: opts.startLocal,
    elapsed_time: String(elapsed),
    // Strava's description field is generous but not infinite, and a 40-exercise
    // session is not worth a 400 from a limit nobody documents.
    description: lines.join("\n").slice(0, 4000),
  };
}

// ---------- push ----------

/** The quarter-hour the 15-minute bucket rolls over on, as a hint worth showing. */
function rateHint(headers: Headers): string {
  const usage = headers.get("x-ratelimit-usage") ?? "";
  const limit = headers.get("x-ratelimit-limit") ?? "";
  const d = new Date();
  const mins = 15 - (d.getUTCMinutes() % 15);
  return `Strava is rate-limiting this app${usage && limit ? ` (${usage.split(",")[0]} of ${limit.split(",")[0]})` : ""}` +
    `. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`;
}

export type PushResult = { activity_id: number; url: string; already?: boolean };

function activityUrl(id: number | string): string {
  return `https://www.strava.com/activities/${id}`;
}

/**
 * POST /api/strava/push — one finished session, once.
 *
 * The log is read owner-scoped rather than trusted from the body, so a log id
 * belonging to somebody else simply does not exist as far as this route is
 * concerned, and `strava_activity_id` on that same row is what makes a second tap,
 * a second tab or a retried request produce one activity instead of two.
 */
export async function pushLog(
  userId: string, logId: string, opts: PushOpts,
): Promise<PushResult> {
  cfg();
  if (!UUID_RE.test(logId)) throw new StravaError(400, "bad_log", "That session could not be read.");
  if (!LOCAL_ISO_RE.test(opts.startLocal)) {
    throw new StravaError(400, "bad_start", "That session could not be read.");
  }

  const rows = await sSelect(
    "workout_logs",
    `id=eq.${logId}&user_id=eq.${userId}` +
    `&select=id,workout_title,duration_seconds,entries,strava_activity_id`,
  );
  const log = rows[0];
  if (!log) throw new StravaError(404, "no_log", "That session is not here any more.");
  if (log.strava_activity_id) {
    return { activity_id: Number(log.strava_activity_id), url: activityUrl(log.strava_activity_id), already: true };
  }

  const row = await loadTokens(userId);
  if (!row) throw new StravaError(409, "not_connected", "Connect Strava in Settings first.");

  const token = await accessToken(userId, row);
  const body = activityBody(log as PushLog, opts);

  const r = await fetch(ACTIVITIES_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });

  if (!r.ok) {
    const text = (await r.text()).slice(0, 400);
    if (r.status === 401) {
      // The athlete revoked us from strava.com, or the token is no longer good.
      // The row is the only thing claiming a connection exists; take it away.
      await sDelete("strava_tokens", `user_id=eq.${userId}`).catch(() => {});
      console.error("strava push: 401 for", userId, "— connection dropped");
      throw new StravaError(409, "disconnected", "Strava disconnected this app — reconnect in Settings.");
    }
    if (r.status === 403) {
      // Every new Strava app is capped at one connected athlete until the owner
      // self-upgrades in the dashboard, so this is the likeliest 403 by far and
      // the one worth naming plainly rather than calling it a failure.
      const cap = /athlete|capacity|limit/i.test(text);
      console.error("strava push: 403 for", userId, cap ? "athlete cap" : text);
      throw new StravaError(403, cap ? "capacity" : "refused",
        cap
          ? "Strava lets this app connect a limited number of athletes right now."
          : "Strava refused that session.");
    }
    if (r.status === 429) {
      console.error("strava push: 429 for", userId);
      throw new StravaError(429, "rate_limited", rateHint(r.headers));
    }
    console.error("strava push:", r.status, text);
    throw new StravaError(502, "strava_failed", "Strava could not take that session — try again in a minute.");
  }

  const created = await r.json().catch(() => ({})) as { id?: number };
  const activityId = Number(created.id);
  if (!Number.isFinite(activityId) || activityId <= 0) {
    throw new StravaError(502, "strava_failed", "Strava took the session but did not say where it went.");
  }

  // Written by the service role, which is the only writer this column has — the
  // client's UPDATE privilege on workout_logs was revoked in the same migration
  // that added it, so a browser cannot mark its own session as already sent.
  try {
    await sPatchReturning("workout_logs", `id=eq.${logId}&user_id=eq.${userId}&select=id`,
      { strava_activity_id: activityId });
  } catch (e) {
    // The activity exists on Strava either way. Losing this write means the next
    // tap would make a second one, which is worth a loud log line.
    console.error("strava push: activity", activityId, "NOT recorded on log", logId, e);
  }
  console.log("strava push:", userId, "log", logId, "-> activity", activityId);
  return { activity_id: activityId, url: activityUrl(activityId) };
}

// ---------- disconnect ----------

/**
 * Tell Strava to forget us, then forget Strava.
 *
 * Best effort in that order and never the other way round: a deauthorize that
 * fails must not leave a row nobody can delete, and a row deleted after a failed
 * deauthorize is at worst a stale grant the athlete can revoke on strava.com.
 * What must not happen is the app still saying "Connected" when it is not.
 */
async function deauthorize(row: TokenRow): Promise<void> {
  await fetch(DEAUTHORIZE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: row.access_token }),
  }).then((r) => r.body?.cancel());
}

export async function disconnectStrava(userId: string): Promise<void> {
  const row = await loadTokens(userId);
  if (!row) return;
  try {
    await deauthorize(row);
  } catch (e) {
    console.error("strava: deauthorize failed for", userId, "— deleting the row anyway", e);
  }
  await sDelete("strava_tokens", `user_id=eq.${userId}`);
  console.log("strava: disconnected", userId);
}

/**
 * The same thing on the way out of an account, and it may never throw.
 *
 * Unlike Stripe, a Strava grant left behind costs nobody anything and the athlete
 * can revoke it themselves; blocking a deletion on Strava being reachable would
 * trade a real right for a tidy third party. The row itself goes with the cascade.
 */
export async function forgetStravaQuietly(userId: string): Promise<void> {
  if (!stravaConfigured()) return;
  try {
    const row = await loadTokens(userId);
    if (row) await deauthorize(row);
  } catch (e) {
    console.error("account delete: strava deauthorize failed for", userId, e);
  }
}

// ---------- the routes ----------
//
// The whole route table lives here rather than in index.ts, so wiring this module
// in is one import and two lines in the router. index.ts owns nine other things
// and should not have to grow a Strava-shaped section to gain a Strava feature.

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Everything under /api/strava/ except the callback, all of it behind the auth
 * gate and all of it about the caller's own account.
 *
 * `status` answers 200 with `configured: false` rather than a 503, for the same
 * reason `billing/prices` does: the app asks it before drawing Settings, and "not
 * switched on" is a screen to paint — an empty one — not an error to report. The
 * rest would be asking Strava to do something, so they say plainly that they
 * cannot.
 */
export async function handleStrava(
  path: string, req: Request, userId: string, cors: Record<string, string>,
): Promise<Response> {
  const route = path.slice("/api/strava/".length);

  try {
    if (req.method === "GET" && route === "status") {
      return json({ status: "ok", ...(await stravaStatus(userId)) }, 200, cors);
    }
    if (!stravaConfigured()) {
      return json({
        status: "error", code: "not_configured", message: "Strava is not switched on yet.",
      }, 503, cors);
    }

    if (req.method === "GET" && route === "connect") {
      return json({ status: "ok", url: await connectUrl(userId, req) }, 200, cors);
    }

    if (req.method === "POST" && route === "push") {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const r = await pushLog(userId, String(body.log_id ?? ""), {
        startLocal: String(body.start_local ?? ""),
        unit: typeof body.unit === "string" ? body.unit : undefined,
        prs: Array.isArray(body.prs) ? body.prs.slice(0, 12) : undefined,
      });
      return json({ status: "ok", ...r }, 200, cors);
    }

    if (req.method === "POST" && route === "disconnect") {
      await disconnectStrava(userId);
      return json({ status: "ok" }, 200, cors);
    }
  } catch (e) {
    if (e instanceof StravaError) {
      return json({ status: "error", code: e.code, message: e.message }, e.status, cors);
    }
    console.error("strava", route, "failed for", userId, e);
    return json({
      status: "error", code: "strava_failed",
      message: "Something went wrong with Strava — try again in a minute.",
    }, 502, cors);
  }

  return json({ status: "error", message: "Not found" }, 404, cors);
}

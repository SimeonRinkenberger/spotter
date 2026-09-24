// Spotter — erasure at third parties, written down before it is attempted.
//
// Deleting an account has to reach the companies that hold part of it: the
// RevenueCat subscriber, a Stripe-era customer, a Strava grant. Those calls can
// fail for reasons nobody can fix inside the request — a key not set yet, a key
// of the wrong kind, an outage — and the person asking to be erased must not be
// held up by any of them. What must not happen instead is the request being
// forgotten, which is what a log line alone did.
//
// So each one goes through the outbox (migration 20260924100500): a row is
// written first, the provider is called, and the row comes out only when the
// provider says done. Otherwise the hourly push tick (index.ts, /api/push/tick)
// calls `runErasureOutbox`, which retries with backoff and, after 8 attempts or
// 7 days, raises an ops alert. The state machine lives in SQL so it is one
// transaction per step and is proved in PGlite (tools/erasure-outbox-check.mjs);
// this file is the thin half that talks to the providers.
//
// Imports nothing from index.ts. The per-provider erasers are passed in, the way
// runOpsAlert takes sendPush, so this module needs no Stripe or Strava code and
// the harness can drive it without either.

import { serviceFetch } from "./rest.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Same rule as index.ts, push.ts and strava.ts: legacy service keys are JWTs and
// want a Bearer header, new sb_secret_ keys are not JWTs and go as `apikey` only.
const KEY_IS_JWT = (SERVICE_KEY ?? "").split(".").length === 3;
const dbHeaders: Record<string, string> = KEY_IS_JWT
  ? { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" }
  : { apikey: SERVICE_KEY, "content-type": "application/json" };

export type Provider = "revenuecat" | "stripe" | "strava";

/** Done, or not yet — with why, and optionally a replacement for the stored detail. */
export type Outcome =
  | { done: true }
  | { done: false; error: string; detail?: Record<string, unknown> };

export type Eraser = (subject: string, detail: Record<string, unknown>) => Promise<Outcome>;

type Row = { id: number; provider: Provider; subject: string; detail: Record<string, unknown> | null };

async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const r = await serviceFetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: dbHeaders,
    body: JSON.stringify(args),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`erasure ${fn} ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function attempt(eraser: Eraser, subject: string, detail: Record<string, unknown>): Promise<Outcome> {
  try {
    return await eraser(subject, detail);
  } catch (e) {
    // A network failure or a thrown provider error is the ordinary "not yet".
    return { done: false, error: String(e).slice(0, 300) };
  }
}

async function settle(id: number, out: Outcome): Promise<string | null> {
  try {
    return await rpc("erasure_settle", {
      p_id: id,
      p_ok: out.done,
      p_error: out.done ? null : out.error,
      p_detail: out.done ? null : (out.detail ?? null),
    }) as string;
  } catch (e) {
    console.error("erasure: could not record the outcome of row", id, e);
    return null;
  }
}

/**
 * Write the request down, then make it. Never throws, and never blocks on the
 * provider: the caller (account deletion) carries on whatever this returns.
 * `row` is the outbox id while the request is still pending, null once done —
 * or when the row could not be written at all (the database is what is
 * failing), in which case the provider was still called, so the outcome is no
 * worse than before the outbox existed.
 */
export async function eraseAtProvider(
  provider: Provider, subject: string, detail: Record<string, unknown>, eraser: Eraser,
): Promise<Outcome & { row: number | null }> {
  let id: number | null = null;
  try {
    const got = await rpc("erasure_enqueue", { p_provider: provider, p_subject: subject, p_detail: detail });
    id = Number(got);
    if (!Number.isFinite(id)) id = null;
  } catch (e) {
    console.error("erasure: could not queue", provider, e);
  }
  const out = await attempt(eraser, subject, detail);
  if (id !== null) await settle(id, out);
  if (!out.done) {
    console.error(`erasure: ${provider} not done yet, ${id === null ? "NOT queued" : "queued as row " + id}: ${out.error}`);
  }
  return { ...out, row: out.done ? null : id };
}

/** One pass over the rows that are due. Called by the hourly push tick. */
export async function runErasureOutbox(
  erasers: Record<Provider, Eraser>, limit = 10,
): Promise<{ due: number; done: number; retry: number }> {
  const rows = (await rpc("erasure_claim", { p_limit: limit }) ?? []) as Row[];
  let done = 0, retry = 0;
  for (const row of rows) {
    const eraser = erasers[row.provider];
    const out: Outcome = eraser
      ? await attempt(eraser, row.subject, row.detail ?? {})
      : { done: false, error: "no eraser for " + row.provider };
    const state = await settle(row.id, out);
    if (out.done) done++;
    else {
      retry++;
      console.error(`erasure: row ${row.id} (${row.provider}) ${state ?? "unsettled"}: ${out.error}`);
    }
  }
  if (rows.length) console.log(`erasure outbox: ${rows.length} due, ${done} done, ${retry} to retry`);
  return { due: rows.length, done, retry };
}

// ---------- RevenueCat ----------
//
// Deleting a subscriber needs a SECRET v1 key. REVENUECAT_API_KEY in production
// is the public SDK key (the purchases function reads customer info with it),
// which RevenueCat answers with 401 on DELETE. REVENUECAT_SECRET_KEY is read for
// this call only; until it is set the public key is tried and the row waits,
// so the queue drains the day the secret is added. 404 is "no such subscriber",
// the ordinary answer for anyone who never opened the native app: done.

export async function deleteRevenueCatSubscriber(appUserId: string, timeoutMs = 15_000): Promise<Outcome> {
  const key = (Deno.env.get("REVENUECAT_SECRET_KEY") ?? "").trim() ||
    (Deno.env.get("REVENUECAT_API_KEY") ?? "").trim();
  if (!key) return { done: false, error: "no RevenueCat key is set" };
  const r = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await r.text();
  if (r.ok || r.status === 404) return { done: true };
  return { done: false, error: `revenuecat ${r.status}: ${body.slice(0, 160)}` };
}

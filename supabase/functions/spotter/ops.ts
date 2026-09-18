/**
 * Spotter — operational alerting and the weekly scorecard reader.
 *
 * Two routes live here and they exist for two different people.
 *
 * `/api/worker/ops-alert` is for the owner asleep at 3 am. pg_cron runs
 * `ops_alert_check()` every fifteen minutes, that function writes at most one
 * row per problem per UTC day into `ops_alerts`, and then this route turns the
 * rows nobody has been told about yet into ONE Web Push per staff device. One
 * push, not one per alert: a night where the queue stalls and spend crosses 80%
 * and a provider cools down is one night, and three notifications for it is how
 * a person learns to swipe the app's notifications away without reading them.
 *
 * `/api/ops/scorecard` is for the same owner on Monday morning, awake. It is the
 * weekly review as JSON because the frontend is frozen this wave — the numbers
 * exist, they are staff-only, and a UI for them is a later decision. Anyone who
 * would rather read SQL runs tools/ops/scorecard.sql instead and gets the same
 * views.
 *
 * Nothing here writes anything except the `notified` mark. A notifier that can
 * change the thing it is reporting on is a notifier that can hide an outage.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Same rule as index.ts, billing.ts, strava.ts and push.ts: legacy service keys
// are JWTs and want a Bearer header, new sb_secret_ keys are not JWTs and must
// go as `apikey` only.
const KEY_IS_JWT = (SERVICE_KEY ?? "").split(".").length === 3;
const dbHeaders: Record<string, string> = KEY_IS_JWT
  ? { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" }
  : { apikey: SERVICE_KEY, "content-type": "application/json" };

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://simeonrinkenberger.github.io,http://localhost:8000,http://127.0.0.1:8000")
  .split(",").map((s) => s.trim()).filter(Boolean);

function rest(table: string): string { return `${SUPABASE_URL}/rest/v1/${table}`; }

async function readRows(table: string, query: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${rest(table)}?${query}`, { headers: dbHeaders });
  if (!r.ok) throw new Error(`ops db ${table} ${r.status}: ${await r.text()}`);
  return await r.json();
}

// ---------- the week ----------

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

/**
 * The Monday of the UTC week containing `ms`, as YYYY-MM-DD.
 *
 * This has to agree with `public.ops_week()` exactly, or the route asks for a
 * week the views have no rows for and reports an empty scorecard as if the week
 * had been quiet. Same definition on both sides: ISO weeks, Monday first, UTC.
 */
export function opsWeekStart(ms: number): string {
  const d = new Date(ms);
  const mondayOffset = (d.getUTCDay() + 6) % 7;   // Sunday is 0 in JS; Monday is 0 here
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
    mondayOffset * 86_400_000);
  return `${monday.getUTCFullYear()}-${pad2(monday.getUTCMonth() + 1)}-${pad2(monday.getUTCDate())}`;
}

// ---------- turning an alert into a sentence ----------

export type Alert = {
  id: number;
  key: string;
  day: string;
  level: string;
  detail: Record<string, unknown>;
  created_at: string;
  acked_at: string | null;
};

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * One alert as the few words a lock screen actually shows.
 *
 * The number goes in the phrase, always. "Queue stalled" makes somebody open a
 * laptop to find out how bad it is; "queue stalled 14 min" is a decision on its
 * own, and at 3 am the difference between those two is whether the owner gets
 * back to sleep.
 *
 * Unknown keys fall through to the key itself rather than being dropped. A new
 * threshold added to the migration must never be silently unreportable because
 * nobody remembered to add it here too.
 */
export function phraseFor(alert: Alert): string {
  const d = alert.detail ?? {};
  switch (alert.key) {
    case "queue_stalled":
      return `queue stalled ${num(d.oldest_minutes) ?? "?"} min`;
    case "reservations_unsettled":
      return `${num(d.count) ?? "?"} AI charges unsettled`;
    case "provider_cooldown": {
      const providers = Array.isArray(d.providers) ? d.providers.join(", ") : "a provider";
      return `${providers} cooling down`;
    }
    case "signup_spike":
      return `${num(d.signups_last_hour) ?? "?"} signups in an hour`;
    case "job_failure_rate":
      return `${num(d.pct) ?? "?"} % of reads failing`;
    case "upload_permits_stale":
      return `${num(d.count) ?? "?"} upload permits unused`;
    case "upload_objects_leaked":
      return `${num(d.count) ?? "?"} uploads not cleaned up`;
    case "jobs_at_max_attempts":
      return `${num(d.count) ?? "?"} reads out of retries`;
    default: {
      const day = alert.key.match(/^spend_day_(\d+)$/);
      if (day) return `day spend ${num(d.pct) ?? day[1]} %`;
      const month = alert.key.match(/^spend_month_(\d+)$/);
      if (month) return `month spend ${num(d.pct) ?? month[1]} %`;
      return alert.key.replace(/_/g, " ");
    }
  }
}

const LEVEL_RANK: Record<string, number> = { critical: 3, warn: 2, info: 1 };

/**
 * The whole notification: a title that says how bad, and a body that is every
 * alert joined by a middle dot.
 *
 * Worst-first, because the body is truncated by the operating system and not by
 * us, and the clause that survives truncation should be the one worth waking up
 * for. Spend bands are collapsed to the highest one that fired — 60, 80 and 95
 * all cross at once on a bad day and three copies of the same fact is noise.
 */
export function summarise(alerts: Alert[]): { title: string; body: string } {
  const worst = alerts.reduce((acc, a) => Math.max(acc, LEVEL_RANK[a.level] ?? 0), 0);
  const ordered = [...alerts].sort((a, b) =>
    (LEVEL_RANK[b.level] ?? 0) - (LEVEL_RANK[a.level] ?? 0) || a.key.localeCompare(b.key));

  const seenBand = new Set<string>();
  const phrases: string[] = [];
  for (const a of ordered) {
    const band = a.key.match(/^(spend_day|spend_month)_\d+$/);
    if (band) {
      if (seenBand.has(band[1])) continue;
      seenBand.add(band[1]);
    }
    phrases.push(phraseFor(a));
  }

  return {
    title: worst >= 3 ? "Spotter ops: needs you now" : worst >= 2 ? "Spotter ops" : "Spotter ops: worth a look",
    body: phrases.join(" · "),
  };
}

// ---------- the notifier ----------

export type OpsAlertResult = {
  alerts: number;
  keys: string[];
  devices: number;
  sent: number;
  dropped: number;
  title?: string;
  body?: string;
};

/**
 * Send one push per staff device for everything that fired and has not been
 * reported yet.
 *
 * Fifteen minutes of lookback, matching the cron interval, so an alert cannot
 * fall between two ticks. `notified` inside `detail` is the mark rather than a
 * column of its own: the row is the alert's permanent record and a delivery
 * attempt is metadata about telling someone, not about the condition.
 *
 * The mark is written AFTER a successful send, one row at a time. If the push
 * service refuses, the rows stay unmarked and the next tick tries again — the
 * failure mode of this route must be "told twice", never "never told".
 *
 * `sendPush` is injected rather than imported so the harness can exercise the
 * decision without a network stack and without VAPID keys; index.ts passes
 * push.ts's real sender.
 */
export async function runOpsAlert(
  send: (endpoint: string, p256dh: string, auth: string, payload: unknown) =>
    Promise<{ status: number; gone: boolean }>,
  nowMs = Date.now(),
  dry = false,
): Promise<OpsAlertResult> {
  const since = new Date(nowMs - 15 * 60_000).toISOString();
  const rows = await readRows("ops_alerts",
    `created_at=gte.${since}&order=created_at.asc&limit=200`) as unknown as Alert[];

  // The `notified` test is done here rather than in the query. PostgREST can
  // filter on a jsonb key, but an alert that has never been notified and an
  // alert whose detail has no `notified` key are the same thing, and expressing
  // "absent or null" in a URL is the kind of cleverness that fails silently.
  const pending = rows.filter((a) => !a.detail || a.detail.notified == null);
  if (!pending.length) return { alerts: 0, keys: [], devices: 0, sent: 0, dropped: 0 };

  const { title, body } = summarise(pending);
  const keys = pending.map((a) => a.key);

  // Staff only. `profiles.plan = 'staff'` is the same marker the rest of the
  // product uses for a comp, and it is the owner's own account here.
  const staff = await readRows("profiles", "plan=eq.staff&select=id") as { id: string }[];
  if (!staff.length) {
    // Worth a log line rather than a silent zero: an alerting system with no
    // subscriber is the single most likely way this whole file quietly does
    // nothing, and the fix is one toggle in the app's own settings.
    console.error("ops: alerts fired but no staff account exists to notify", keys.join(","));
    return { alerts: pending.length, keys, devices: 0, sent: 0, dropped: 0, title, body };
  }

  const ids = staff.map((s) => s.id).join(",");
  const subs = await readRows("push_subscriptions",
    `user_id=in.(${ids})&select=id,user_id,endpoint,p256dh,auth&limit=50`) as unknown as
    { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }[];
  if (!subs.length) console.error("ops: staff account has no push subscription; reminders are off on every device");

  let sent = 0, dropped = 0;
  if (!dry) {
    for (const sub of subs) {
      let result: { status: number; gone: boolean };
      try {
        result = await send(sub.endpoint, sub.p256dh, sub.auth, {
          title, body,
          // One tag for every ops push, so a second alert within the hour
          // replaces the first on the lock screen instead of stacking under it.
          tag: "spotter-ops",
          url: `${ALLOWED_ORIGINS[0]}/spotter/`,
        });
      } catch (e) {
        console.error("ops: push failed", e);
        continue;
      }
      if (result.gone) {
        await fetch(`${rest("push_subscriptions")}?endpoint=eq.${encodeURIComponent(sub.endpoint)}`,
          { method: "DELETE", headers: dbHeaders }).then((r) => r.body?.cancel());
        dropped++;
        continue;
      }
      if (result.status >= 300) { console.error("ops: push refused", result.status); continue; }
      sent++;
    }
  }

  // Marked only if somebody was actually told. A dry run reports and changes
  // nothing, and a night when every endpoint refused should page again in
  // fifteen minutes rather than count itself as delivered.
  if (sent > 0) {
    const stamp = new Date(nowMs).toISOString();
    for (const a of pending) {
      const detail = { ...(a.detail ?? {}), notified: stamp };
      const r = await fetch(`${rest("ops_alerts")}?id=eq.${a.id}`, {
        method: "PATCH",
        headers: { ...dbHeaders, prefer: "return=minimal" },
        body: JSON.stringify({ detail }),
      });
      if (!r.ok) console.error("ops: could not mark alert notified", a.id, r.status, await r.text());
      else await r.body?.cancel();
    }
  }

  console.log(`ops: ${pending.length} alert(s) [${keys.join(",")}] to ${subs.length} device(s), sent ${sent}`);
  return { alerts: pending.length, keys, devices: subs.length, sent, dropped, title, body };
}

// ---------- the weekly scorecard ----------

/**
 * Every scorecard view, in the order a weekly review reads them: who is paying,
 * who showed up, whether the product worked, what it cost, and what broke.
 */
export const SCORECARD_VIEWS = [
  "ops_revenue_week",
  "ops_activation_week",
  "ops_started_week",
  "ops_return_week",
  "ops_imports_week",
  "ops_incidents_week",
  "ops_cost_week",
  "ops_subsidy_week",
  "ops_latency_week",
] as const;

/**
 * One week of every view, plus whatever is currently unacknowledged.
 *
 * The views are read in parallel because they are nine independent aggregates
 * over small tables and the alternative is nine sequential round trips for a
 * page one person looks at once a week.
 *
 * A view that errors returns its error inside the payload instead of failing the
 * whole request. The commonest cause is PostgREST's schema cache not yet knowing
 * about a newly applied migration, and a scorecard that shows eight sections and
 * one honest error is more useful than a 500 that says nothing about which.
 */
export async function opsScorecard(nowMs = Date.now(), week?: string): Promise<Record<string, unknown>> {
  const weekStart = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : opsWeekStart(nowMs);

  const sections = await Promise.all(SCORECARD_VIEWS.map(async (v) => {
    try {
      return [v, await readRows(v, `week_start=eq.${weekStart}&limit=500`)] as const;
    } catch (e) {
      console.error("ops: scorecard view failed", v, e);
      return [v, { error: String(e instanceof Error ? e.message : e) }] as const;
    }
  }));

  let alerts: unknown = [];
  try {
    alerts = await readRows("ops_alerts",
      "acked_at=is.null&order=created_at.desc&limit=50");
  } catch (e) {
    alerts = { error: String(e instanceof Error ? e.message : e) };
  }

  return {
    week_start: weekStart,
    generated_at: new Date(nowMs).toISOString(),
    // Said out loud so nobody reads a partial week as a bad week: the current
    // week is always in progress, and Monday's review is about the week before.
    note: "Weekly aggregates, UTC, Monday-start. Staff and spotter-tw-% fixtures excluded. " +
      "ops_revenue_week is current-state only and cannot be reconstructed for past weeks.",
    open_alerts: alerts,
    ...Object.fromEntries(sections),
  };
}

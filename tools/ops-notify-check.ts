// What the owner's phone actually says, and what the notifier writes back.
//
// Runs the real ops.ts against a stubbed PostgREST, so the whole route is
// exercised — the lookback window, the un-notified filter, the staff lookup, one
// push per device, the mark, and the dry run — with no network, no VAPID keys
// and no database. The alert rows are the shapes ops_alert_check() produces;
// tools/ops-check.mjs is what proves the database produces them.
//
//   deno run --allow-read --allow-env tools/ops-notify-check.ts

import { opsScorecard, opsWeekStart, phraseFor, runOpsAlert, summarise, type Alert } from
  "../supabase/functions/spotter/ops.ts";

// Local rather than std/assert: gtm-check.mjs runs with no external network, and
// a regression harness that needs a download is a regression harness that fails
// on the one machine where it matters.
function assert(ok: unknown, why = "assertion failed"): void {
  if (!ok) throw new Error(why);
}
function assertEquals(actual: unknown, expected: unknown, why = ""): void {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${why}\n  actual:   ${a}\n  expected: ${b}`);
}

// ---------- the week ----------
// Must agree with public.ops_week() exactly or the scorecard asks for a week the
// views have no rows for and reports an empty week as a quiet one.
assertEquals(opsWeekStart(Date.parse("2026-09-17T04:00:00Z")), "2026-09-14", "Thursday belongs to its Monday");
assertEquals(opsWeekStart(Date.parse("2026-09-14T00:00:00Z")), "2026-09-14", "Monday 00:00 UTC is its own week");
assertEquals(opsWeekStart(Date.parse("2026-09-20T23:59:59Z")), "2026-09-14", "Sunday still belongs to that Monday");
assertEquals(opsWeekStart(Date.parse("2026-09-21T00:00:00Z")), "2026-09-21", "the next Monday starts the next week");
// A Sunday evening in Chicago is already Monday in UTC. The scorecard says so
// rather than quietly disagreeing with every other date in this database.
assertEquals(opsWeekStart(Date.parse("2026-09-20T20:00:00-05:00")), "2026-09-21");

// ---------- the sentence ----------
const alert = (key: string, level: string, detail: Record<string, unknown>, id = 1): Alert =>
  ({ id, key, day: "2026-09-17", level, detail, created_at: "2026-09-17T08:00:00Z", acked_at: null });

assertEquals(phraseFor(alert("queue_stalled", "critical", { oldest_minutes: 14 })), "queue stalled 14 min");
assertEquals(phraseFor(alert("spend_day_80", "warn", { pct: 82 })), "day spend 82 %");
assertEquals(phraseFor(alert("spend_month_95", "critical", { pct: 97.4 })), "month spend 97.4 %");
assertEquals(phraseFor(alert("provider_cooldown", "warn", { providers: ["gemini", "openai"] })),
  "gemini, openai cooling down");
// A threshold added to the migration and forgotten here must still be reportable.
assertEquals(phraseFor(alert("some_new_threshold", "warn", {})), "some new threshold");
// And a detail that arrived malformed must not put "NaN" on a lock screen.
assertEquals(phraseFor(alert("queue_stalled", "critical", {})), "queue stalled ? min");

// The line from the brief, assembled from the rows that produce it.
const night = [
  alert("spend_day_60", "info", { pct: 62 }, 1),
  alert("spend_day_80", "warn", { pct: 82 }, 2),
  alert("queue_stalled", "critical", { oldest_minutes: 14 }, 3),
];
const summary = summarise(night);
assertEquals(summary.body, "queue stalled 14 min · day spend 82 %",
  "worst first, and one spend band rather than three copies of the same fact");
assertEquals(summary.title, "Spotter ops: needs you now");
assertEquals(summarise([alert("upload_permits_stale", "info", { count: 3 })]).title, "Spotter ops: worth a look");
assertEquals(summarise([alert("reservations_unsettled", "warn", { count: 2 })]).title, "Spotter ops");
assert(!summary.body.includes("@"), "a notification carries counts, never anybody's content");

// ---------- the route ----------
// A stub PostgREST. Every request is recorded so the assertions can be about
// what the notifier did, not only about what it returned.
type Call = { method: string; url: string; body: unknown };
const calls: Call[] = [];
let alertRows: Alert[] = [];
let staffRows: { id: string }[] = [];
let subRows: Record<string, unknown>[] = [];
let pushResult: { status: number; gone: boolean } = { status: 201, gone: false };
const pushes: { endpoint: string; payload: unknown }[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = init?.method ?? "GET";
  calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
  const table = url.split("/rest/v1/")[1]?.split("?")[0] ?? "";
  if (method !== "GET") return Promise.resolve(new Response(null, { status: 204 }));
  const rows = table === "ops_alerts" ? alertRows : table === "profiles" ? staffRows
    : table === "push_subscriptions" ? subRows : [];
  return Promise.resolve(new Response(JSON.stringify(rows), {
    status: 200, headers: { "content-type": "application/json" },
  }));
}) as typeof fetch;

const send = (endpoint: string, _p: string, _a: string, payload: unknown) => {
  pushes.push({ endpoint, payload });
  return Promise.resolve(pushResult);
};
const reset = () => { calls.length = 0; pushes.length = 0; };

const now = Date.parse("2026-09-17T03:14:00Z");
const device = (id: string, endpoint: string) =>
  ({ id, user_id: "staff-1", endpoint, p256dh: "p", auth: "a" });

// Nothing fired: no reads of anything else, no push, no write.
alertRows = [];
staffRows = [{ id: "staff-1" }];
subRows = [device("d1", "https://push.example/1")];
reset();
assertEquals((await runOpsAlert(send, now)).sent, 0);
assertEquals(pushes.length, 0);
assertEquals(calls.filter((c) => c.method !== "GET").length, 0, "a quiet tick writes nothing");
assertEquals(calls.length, 1, "and does not even look up who staff is");

// Three alerts, two staff devices: one push each, and every row marked once.
alertRows = night;
subRows = [device("d1", "https://push.example/1"), device("d2", "https://push.example/2")];
reset();
let out = await runOpsAlert(send, now);
assertEquals(out.alerts, 3);
assertEquals(out.devices, 2);
assertEquals(out.sent, 2);
assertEquals(pushes.length, 2, "one push per device, not one per alert per device");
const payload = pushes[0].payload as Record<string, string>;
assertEquals(payload.body, "queue stalled 14 min · day spend 82 %");
assertEquals(payload.tag, "spotter-ops", "a second alert replaces the first on the lock screen");
assert(payload.url.endsWith("/spotter/"), "tapping it opens the app");
const marks = calls.filter((c) => c.method === "PATCH");
assertEquals(marks.length, 3, "every alert in the batch is marked, not just the worst one");
assertEquals((marks[0].body as { detail: Record<string, string> }).detail.notified, new Date(now).toISOString());
assertEquals((marks[0].body as { detail: Record<string, number> }).detail.pct, 62,
  "the mark is added to the detail, it does not replace it");

// The lookback window is the cron interval, so nothing falls between two ticks.
const since = decodeURIComponent(calls[0].url.split("created_at=gte.")[1].split("&")[0]);
assertEquals(Date.parse(since), now - 15 * 60_000);

// An alert already reported is not reported again, even inside the window.
alertRows = [{ ...night[2], detail: { oldest_minutes: 14, notified: "2026-09-17T03:00:00Z" } }];
reset();
assertEquals((await runOpsAlert(send, now)).alerts, 0, "the notified mark is the fence");
assertEquals(pushes.length, 0);

// A dry run says what it would send and changes nothing.
alertRows = night;
reset();
out = await runOpsAlert(send, now, true);
assertEquals(out.alerts, 3);
assertEquals(out.body, "queue stalled 14 min · day spend 82 %");
assertEquals(pushes.length, 0);
assertEquals(calls.filter((c) => c.method === "PATCH").length, 0, "a dry run leaves the alerts unreported");

// Every endpoint refusing must leave the rows unmarked, so the next tick retries.
// Being told twice is an annoyance; never being told is the failure this file exists to prevent.
pushResult = { status: 500, gone: false };
reset();
out = await runOpsAlert(send, now);
assertEquals(out.sent, 0);
assertEquals(calls.filter((c) => c.method === "PATCH").length, 0, "a refused push is not a delivery");

// A dead endpoint is dropped rather than retried forever.
pushResult = { status: 410, gone: true };
subRows = [device("d1", "https://push.example/1")];
reset();
out = await runOpsAlert(send, now);
assertEquals(out.dropped, 1);
assertEquals(calls.filter((c) => c.method === "DELETE").length, 1);
assertEquals(calls.filter((c) => c.method === "PATCH").length, 0);

// No staff account, or a staff account with reminders off on every device: the
// alerts still exist in the ledger and the log says why nobody heard about them.
pushResult = { status: 201, gone: false };
staffRows = [];
reset();
out = await runOpsAlert(send, now);
assertEquals(out.devices, 0);
assertEquals(out.sent, 0);
assertEquals(out.alerts, 3, "the ledger is still the record even when nobody is told");
staffRows = [{ id: "staff-1" }];
subRows = [];
reset();
assertEquals((await runOpsAlert(send, now)).sent, 0);

// ---------- the scorecard ----------
// Nine views, one week, read in parallel, plus whatever is unacknowledged.
reset();
alertRows = night;
const card = await opsScorecard(Date.parse("2026-09-17T12:00:00Z")) as Record<string, unknown>;
assertEquals(card.week_start, "2026-09-14");
for (const v of ["ops_revenue_week", "ops_activation_week", "ops_started_week", "ops_return_week",
  "ops_imports_week", "ops_incidents_week", "ops_cost_week", "ops_subsidy_week", "ops_latency_week"]) {
  assert(v in card, `${v} is part of the weekly review`);
  assert(calls.some((c) => c.url.includes(`/${v}?`) && c.url.includes("week_start=eq.2026-09-14")),
    `${v} is read for the requested week`);
}
assertEquals((card.open_alerts as unknown[]).length, 3);
// An explicit week is honoured; anything that is not a date is not passed through.
assertEquals((await opsScorecard(now, "2026-09-07")).week_start, "2026-09-07");
assertEquals((await opsScorecard(now, "'; drop table ops_alerts; --")).week_start, "2026-09-14",
  "a malformed week falls back to this one rather than reaching PostgREST");

globalThis.fetch = realFetch;
console.log("PASS ops notifier: UTC Monday weeks, numbers inside every phrase, worst-first summary with " +
  "collapsed spend bands, one push per staff device, marks only after a successful send, dry run, dead " +
  "endpoint dropped, no-subscriber path, and a nine-view staff scorecard with a validated week.");

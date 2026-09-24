// Spotter — PostgREST as the service role, with the one retry the gateway's clock
// needs.
//
// The hourly push tick (pg_cron at hh:00) failed in 14 of 24 hours on 23–24 Sept
// 2026: its first read, at hh:00:02–05, came back 401 PGRST303 "JWT issued at
// future". The token the API gateway mints for the service key was dated a moment
// ahead of the clock PostgREST checks it against. It is not a credential problem —
// the same request a second or two later succeeds — so exactly that answer gets
// one retry after a short wait, and nothing else is retried here.
//
// Used by the modules that run on the top-of-the-hour ticks: push.ts, ops.ts and
// erasure.ts. The request body, when there is one, is always a string, so the
// same init can be sent twice.

export const pgrstRetry = { waitMs: 1500 };

export async function serviceFetch(input: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(input, init);
  if (r.status !== 401) return r;
  const text = await r.text();
  if (!text.includes("PGRST303")) {
    return new Response(text, { status: r.status, statusText: r.statusText, headers: r.headers });
  }
  console.warn("postgrest: 401 PGRST303 (JWT issued at future), retrying once in", pgrstRetry.waitMs, "ms");
  await new Promise((res) => setTimeout(res, pgrstRetry.waitMs));
  return await fetch(input, init);
}

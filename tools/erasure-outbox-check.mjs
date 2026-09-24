// Account erasure at third parties, end to end over a real database: the real
// handleAccountDelete (index.ts), the real erasure.ts and the real outbox SQL
// (every migration replayed in PGlite). RevenueCat, Stripe and the auth admin
// endpoint are stubbed; PostgREST's /rpc is answered by PGlite as service_role.
//
//   node tools/erasure-outbox-check.mjs
//
// What it proves:
//   - RevenueCat failing at deletion time leaves a queued row and the deletion
//     still answers 200; the hourly tick retries it with backoff and removes it
//     the moment RevenueCat succeeds (fail -> fail -> succeed);
//   - 404 is done; no key at all queues rather than drops; REVENUECAT_SECRET_KEY
//     is preferred for the DELETE over the public REVENUECAT_API_KEY;
//   - with no Stripe key, an account with a billing_customers row is deleted
//     (200) and the customer is left in the outbox; with a key, a Stripe failure
//     still stops everything with 503 and queues nothing;
//   - 8 failures page once (ops_alerts 'erasure_stuck') and a RevenueCat row
//     keeps retrying afterwards; a Strava row gives up and drops its tokens;
//   - an outbox that cannot be written never blocks a deletion on RevenueCat.
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { replaySchema } from './schema-replay.mjs';

const failures = [];
let passed = 0;
function check(ok, what) {
  if (ok) passed++;
  else { failures.push(what); console.error('FAIL ' + what); }
}

const { db } = await replaySchema({ onError: (f, e) => check(false, 'migration applies: ' + f + ' — ' + e.message) });
const hasOutbox = (await db.query(`select to_regclass('public.erasure_outbox') is not null as ok`)).rows[0].ok;
check(hasOutbox, 'the erasure_outbox table exists after every migration');

const SUPA = 'https://db.invalid';
const UID = '11111111-1111-4111-8111-111111111111';

// ---------- the world outside ----------
const world = {
  env: {},                     // Deno.env
  rc: [],                      // RevenueCat answers, consumed in order (last one repeats)
  rcCalls: [],                 // { url, bearer }
  rpcDown: false,              // PostgREST /rpc unreachable
  authDeletes: 0,
  logs: [],
};
async function asService(fn) {
  await db.exec('set role service_role');
  try { return await fn(); } finally { await db.exec('reset role'); }
}
async function rpc(name, args) {
  if (name === 'erasure_enqueue') {
    const r = args.p_account
      ? await asService(() => db.query('select public.erasure_enqueue($1, $2, $3::jsonb, $4::uuid) as v', [args.p_provider, args.p_subject, JSON.stringify(args.p_detail ?? {}), args.p_account]))
      : await asService(() => db.query('select public.erasure_enqueue($1, $2, $3::jsonb) as v', [args.p_provider, args.p_subject, JSON.stringify(args.p_detail ?? {})]));
    return r.rows[0].v;
  }
  if (name === 'erasure_claim') {
    const r = await asService(() => db.query('select * from public.erasure_claim($1)', [args.p_limit ?? 10]));
    return r.rows;
  }
  if (name === 'erasure_settle') {
    const r = await asService(() => db.query('select public.erasure_settle($1, $2, $3, $4::jsonb) as v',
      [args.p_id, args.p_ok, args.p_error, args.p_detail == null ? null : JSON.stringify(args.p_detail)]));
    return r.rows[0].v;
  }
  throw new Error('unknown rpc ' + name);
}
async function fakeFetch(url, init = {}) {
  url = String(url);
  if (url.startsWith(SUPA + '/rest/v1/rpc/')) {
    if (world.rpcDown) return new Response('{"message":"db down"}', { status: 503 });
    try {
      const out = await rpc(url.split('/rpc/')[1], JSON.parse(init.body || '{}'));
      return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ message: e.message }), { status: 400 });
    }
  }
  if (url.startsWith('https://api.revenuecat.com/')) {
    world.rcCalls.push({ url, bearer: String(init.headers?.authorization ?? '').replace(/^Bearer /, '') });
    world.order.push('revenuecat');
    const next = world.rc.length > 1 ? world.rc.shift() : world.rc[0];
    if (next === 'network') throw new TypeError('network down');
    return new Response(next === 401 ? '{"code":7225,"message":"Invalid API Key."}' : '{}', { status: next });
  }
  if (url.includes('/auth/v1/admin/users/')) {
    world.authDeletes++; world.order.push('auth');
    // As the admin API does: the row (and its cascade) goes only when it answers ok.
    if (world.authStatus === 200) await db.query('delete from auth.users where id = $1', [url.split('/').pop()]);
    return new Response('{}', { status: world.authStatus });
  }
  throw new Error('unexpected fetch ' + url);
}

// ---------- the real code, loaded into one context ----------
const erasurePath = 'supabase/functions/spotter/erasure.ts';
const erasureSrc = fs.existsSync(erasurePath) ? fs.readFileSync(erasurePath, 'utf8') : null;
check(erasureSrc !== null, 'erasure.ts exists');
const indexSrc = fs.readFileSync('supabase/functions/spotter/index.ts', 'utf8');
function slice(src, name) {
  const m = src.match(new RegExp('^(?:export )?(?:async )?function ' + name + '\\(', 'm'));
  if (!m) return null;
  return src.slice(m.index, src.indexOf('\n}', m.index) + 2).replace(/^export /, '');
}
function sliceConst(src, name) {
  const i = src.indexOf('const ' + name + ':');
  if (i < 0) return null;
  return src.slice(i, src.indexOf('\n};', i) + 3);
}

const stripe = { configured: false, customer: null, calls: 0, fail: null };
const ctx = vm.createContext({
  console: {
    log: (...a) => world.logs.push(a.join(' ')),
    error: (...a) => world.logs.push(a.join(' ')),
    warn: (...a) => world.logs.push(a.join(' ')),
  },
  AbortSignal, Date, Number, String, JSON, Math, Promise, Error, TypeError, encodeURIComponent, Response,
  Deno: { env: { get: (k) => (k === 'SUPABASE_URL' ? SUPA : k === 'SUPABASE_SERVICE_ROLE_KEY' ? 'service' : world.env[k]) } },
  fetch: fakeFetch,
});
// erasure.ts imports the PostgREST retry helper (rest.ts); both run in this context.
const modules = {};
ctx.require = (spec) => {
  if (modules[spec]) return modules[spec];
  throw new Error('unexpected import ' + spec);
};
function loadModule(path) {
  const m = { exports: {} };
  ctx.module = m; ctx.exports = m.exports;
  vm.runInContext(transformSync(fs.readFileSync(path, 'utf8'), { loader: 'ts', format: 'cjs' }).code, ctx);
  return m.exports;
}
try {
  if (fs.existsSync('supabase/functions/spotter/rest.ts')) {
    modules['./rest.ts'] = loadModule('supabase/functions/spotter/rest.ts');
    modules['./rest.ts'].pgrstRetry.waitMs = 5;
  }
  if (erasureSrc) Object.assign(ctx, loadModule(erasurePath));
} catch (e) { check(false, 'erasure.ts loads: ' + e.message); }

const handler = slice(indexSrc, 'handleAccountDelete');
const erasers = sliceConst(indexSrc, 'ERASERS');
check(handler && erasers, 'index.ts has handleAccountDelete and the ERASERS the tick uses');
// The code before the outbox (main at 6074e07) had these instead; loaded when
// present so the same scenarios run against it and show what it did.
const legacy = slice(indexSrc, 'forgetRevenueCatQuietly');
// Writes an erasure down against its account without attempting it (R-4); absent in older trees.
const queue = slice(indexSrc, 'queueErasure');
const folder = slice(indexSrc, 'deleteUserFolder');
Object.assign(ctx, {
  UUID_RE: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  SUPABASE_URL: SUPA, SERVICE_KEY: 'service', authHeaders: { apikey: 'service' },
  json: (body, status = 200) => ({ body, status }),
  billingConfigured: () => stripe.configured,
  billingCustomerFor: async () => stripe.customer,
  // As billing.ts behaves: nothing to do without a customer, a throw without a key.
  cancelAndDeleteCustomer: async () => {
    if (!stripe.customer) return;
    if (!stripe.configured) throw new Error('billing_customers row exists but STRIPE_SECRET_KEY is unset');
    stripe.calls++; if (stripe.fail) throw stripe.fail;
  },
  forgetStravaQuietly: async () => {},
  eraseStripeCustomer: async () => {
    if (!stripe.configured) return { done: false, error: 'STRIPE_SECRET_KEY is not set' };
    stripe.calls++; return { done: true };
  },
  AppleGrantError: class AppleGrantError extends Error {},
  forgetAppleGrant: async () => {},
  stravaGrantFor: async () => world.stravaGrant ?? null,
  deauthorizeStrava: async () => ({ done: false, error: 'strava deauthorize 503' }),
  dbDelete: async () => {}, dbPatchMany: async () => {},
  listUploads: async () => [], deleteUpload: async () => {},
  // index.ts's own rpc helper, over the same PGlite outbox.
  rpc: async (name, args) => { if (world.rpcDown) throw new Error('rpc ' + name + ' 503'); return await rpc(name, args); },
});
if (handler) {
  vm.runInContext(transformSync([erasers ?? '', legacy ?? '', queue ?? '', folder ?? '', handler].join('\n'), { loader: 'ts', format: 'cjs' }).code
    .replace(/^const ERASERS/m, 'var ERASERS'), ctx);
}
const canRun = !!handler;

const rows = async () => hasOutbox
  ? (await db.query(`select id, provider, subject, attempts, last_error, alerted_at, detail from public.erasure_outbox order by id`)).rows
  : [];
const waitSecs = async () => hasOutbox
  ? (await db.query(`select extract(epoch from next_at - now())::int as s from public.erasure_outbox`)).rows[0]?.s
  : null;
const makeDue = () => hasOutbox ? db.exec(`update public.erasure_outbox set next_at = now() - interval '1 second'`) : null;
const reset = async () => {
  if (hasOutbox) await db.exec(`delete from public.erasure_outbox;`);
  await db.exec(`delete from public.ops_alerts where key = 'erasure_stuck';`);
  world.env = {}; world.rc = [200]; world.rcCalls = []; world.rpcDown = false; world.authDeletes = 0; world.logs = [];
  world.stravaGrant = null; world.authStatus = 200; world.order = [];
  // The account exists until the auth delete removes it.
  await db.query(`insert into auth.users(id, email) values ($1, 'erase@example.com') on conflict do nothing`, [UID]);
  Object.assign(stripe, { configured: false, customer: null, calls: 0, fail: null });
};
const del = () => vm.runInContext(`handleAccountDelete('${UID}', {})`, ctx);
const tick = () => (typeof ctx.runErasureOutbox === 'function' && ctx.ERASERS)
  ? vm.runInContext('runErasureOutbox(ERASERS)', ctx)
  : Promise.resolve({ due: 0, done: 0, retry: 0 });

if (canRun) {
  // ---- RevenueCat fails, fails again, then succeeds ----
  await reset();
  world.env.REVENUECAT_API_KEY = 'appl_public_sdk_key';
  world.rc = [401, 503, 200];
  let out = await del();
  check(out.status === 200, 'deletion answers 200 while RevenueCat refuses (' + out.status + ')');
  check(world.authDeletes === 1, 'and the auth row is deleted');
  let r = await rows();
  check(r.length === 1 && r[0].provider === 'revenuecat' && r[0].subject === UID, 'the RevenueCat request is left in the outbox, by account id');
  check(r[0]?.attempts === 1 && /401/.test(r[0]?.last_error ?? ''), 'with the attempt and the 401 recorded (' + r[0]?.last_error + ')');
  const nextAt = await waitSecs();
  check(nextAt > 200 && nextAt <= 300, 'the first retry waits five minutes (' + nextAt + 's)');
  let t = await tick();
  check(t.due === 0, 'a tick before the row is due calls nobody');
  await makeDue();
  t = await tick();
  r = await rows();
  check(t.due === 1 && t.retry === 1 && r.length === 1 && r[0].attempts === 2, 'the tick retries it; a 503 keeps it with 2 attempts');
  const backoff = await waitSecs();
  check(backoff > 500 && backoff <= 600, 'and the next wait doubles to ten minutes (' + backoff + 's)');
  await makeDue();
  t = await tick();
  r = await rows();
  check(t.done === 1 && r.length === 0, 'RevenueCat succeeds: the row is removed');
  check(world.rcCalls.length === 3 && world.rcCalls.every((c) => c.url.endsWith('/v1/subscribers/' + UID)), 'three DELETEs, all for the account id');

  // ---- 404 is done ----
  await reset();
  world.env.REVENUECAT_API_KEY = 'k';
  world.rc = [404];
  out = await del();
  check(out.status === 200 && (await rows()).length === 0, '404 (never used the native app) is done: nothing queued');

  // ---- no key at all: queued, not dropped, and no call made ----
  await reset();
  out = await del();
  r = await rows();
  check(out.status === 200 && r.length === 1 && r[0].provider === 'revenuecat' && /no RevenueCat key/.test(r[0].last_error ?? ''), 'no key: the request is queued rather than dropped');
  check(world.rcCalls.length === 0, 'and RevenueCat is not called without a key');

  // ---- the secret key is preferred for the DELETE ----
  await reset();
  world.env.REVENUECAT_API_KEY = 'appl_public_sdk_key';
  world.env.REVENUECAT_SECRET_KEY = 'sk_secret_v1_key';
  world.rc = [200];
  out = await del();
  check(out.status === 200 && world.rcCalls[0]?.bearer === 'sk_secret_v1_key', 'REVENUECAT_SECRET_KEY is used for the DELETE when set');

  // ---- Stripe without a key: 200 and an outbox row ----
  await reset();
  world.env.REVENUECAT_API_KEY = 'k';
  stripe.customer = 'cus_TestLeftover123';
  out = await del();
  r = await rows();
  check(out.status === 200, 'no Stripe key: an account with a billing_customers row is deleted (' + out.status + ' ' + JSON.stringify(out.body) + ')');
  check(r.some((x) => x.provider === 'stripe' && x.subject === 'cus_TestLeftover123'), 'and the Stripe customer is left in the outbox');
  check(stripe.calls === 0, 'and Stripe is not called without a key');

  // ---- Stripe with a key: today's behaviour ----
  await reset();
  world.env.REVENUECAT_API_KEY = 'k';
  stripe.configured = true;
  stripe.customer = 'cus_Live';
  stripe.fail = new Error('stripe down');
  out = await del();
  check(out.status === 503 && out.body.code === 'billing_unreachable', 'with a Stripe key, a Stripe failure still answers 503');
  check((await rows()).length === 0 && world.authDeletes === 0 && world.rcCalls.length === 0, 'and nothing is queued, called or deleted');
  stripe.fail = null;
  out = await del();
  check(out.status === 200 && stripe.calls === 2 && !(await rows()).some((x) => x.provider === 'stripe'), 'with a key and Stripe up: cancelled inline, no Stripe row');

  // ---- the outbox cannot be written ----
  await reset();
  world.env.REVENUECAT_API_KEY = 'k';
  world.rpcDown = true;
  world.rc = [401];
  out = await del();
  check(out.status === 200 && world.rcCalls.length === 1, 'an unwritable outbox never blocks deletion on RevenueCat, and RevenueCat is still called');
  check(world.logs.some((l) => /NOT queued/.test(l)), 'and says loudly that the request was not queued');
  stripe.customer = 'cus_TestLeftover123';
  world.authDeletes = 0;
  out = await del();
  check(out.status === 503 && world.authDeletes === 0, 'no Stripe key and an unwritable outbox: 503 before anything is deleted');

  // ---- eight failures page once; RevenueCat keeps trying, Strava gives up ----
  await reset();
  world.env.REVENUECAT_API_KEY = 'appl_public_sdk_key';
  world.rc = [401];
  world.stravaGrant = { subject: '12345', detail: { access_token: 'a', refresh_token: 'r', expires_at: '2020-01-01T00:00:00Z' } };
  out = await del();
  check(out.status === 200, 'deletion with Strava and RevenueCat both failing still answers 200');
  for (let i = 0; i < 7; i++) { await makeDue(); await tick(); }
  r = await rows();
  const alerts = (await db.query(`select key, level, detail from public.ops_alerts where key = 'erasure_stuck'`)).rows;
  check(alerts.length === 1 && alerts[0].level === 'warn', 'eight failed attempts raise one erasure_stuck alert (' + alerts.length + ')');
  check(r.length === 1 && r[0].provider === 'revenuecat' && r[0].attempts === 8 && r[0].alerted_at, 'the RevenueCat row stays, alerted, to drain when the secret key arrives');
  check(!r.some((x) => x.provider === 'strava'), 'the Strava row gave up and its tokens are gone');
  const cap = await waitSecs();
  check(cap > 10 * 3600 && cap <= 24 * 3600, 'retries after the alert keep backing off, toward the one-day cap (' + cap + 's)');
  await makeDue(); await tick();
  check((await db.query(`select count(*)::int as n from public.ops_alerts where key = 'erasure_stuck'`)).rows[0].n === 1, 'and a ninth failure does not page again');
  world.env.REVENUECAT_SECRET_KEY = 'sk_now_set';
  world.rc = [200];
  await makeDue(); await tick();
  check((await rows()).length === 0, 'the day the secret key is set, the next tick drains it');

  // ---- R-4: nothing is erased while the account still exists ----
  await reset();
  world.env.REVENUECAT_API_KEY = 'k';
  world.rc = [503];
  world.stravaGrant = { subject: '98765', detail: { access_token: 'a', refresh_token: 'r', expires_at: '2020-01-01T00:00:00Z' } };
  world.authStatus = 500;
  out = await del();
  check(out.status === 500 && world.rcCalls.length === 0, 'R-4: the auth delete fails: no provider was called before the account was gone (' + world.rcCalls.length + ' RevenueCat calls)');
  r = await rows();
  check(r.length >= 2 && r.every((x) => x.provider !== 'revenuecat' || x.attempts === 0), 'R-4: the requests are written down, unattempted');
  await makeDue();
  t = await tick();
  check(t.due === 0 && world.rcCalls.length === 0, 'R-4: the next tick makes no provider call while the account exists (' + t.due + ' due)');
  if (hasOutbox) await db.exec(`update public.erasure_outbox set created_at = now() - interval '2 days'`);
  await makeDue();
  t = await tick();
  check(t.due === 0 && (await rows()).length === 0, 'R-4: a deletion that never finished is withdrawn after a day, unattempted');
  // The person tries again and it goes through: now, and only now, the providers hear.
  world.authStatus = 200; world.rc = [200]; world.order = [];
  out = await del();
  check(out.status === 200 && world.order.indexOf('auth') >= 0 && world.order.indexOf('revenuecat') > world.order.indexOf('auth'),
    'R-4: a deletion that completes tells RevenueCat after the auth row is gone (' + world.order.join(' → ') + ')');
  r = await rows();
  check(r.length === 1 && r[0].provider === 'strava', 'R-4: and the Strava row (deauthorize failing) is left due for the tick');
  await makeDue();
  t = await tick();
  check(t.due === 1, 'R-4: with the account gone, the tick claims it');

  // ---- R-4: a new grant for the athlete withdraws a pending Strava erasure ----
  await reset();
  if (hasOutbox) {
    await rpc('erasure_enqueue', { p_provider: 'strava', p_subject: '555', p_detail: { access_token: 'old' } });
    await rpc('erasure_enqueue', { p_provider: 'strava', p_subject: '556', p_detail: { access_token: 'other' } });
    const OTHER = '33333333-3333-4333-8333-333333333333';
    await db.query(`insert into auth.users(id, email) values ($1, 'b@example.com') on conflict do nothing`, [OTHER]);
    await asService(() => db.query(`insert into public.strava_tokens(user_id, athlete_id, access_token, refresh_token, expires_at)
      values ($1, 555, 'new', 'new-r', now() + interval '6 hours')`, [OTHER]));
    r = await rows();
    check(!r.some((x) => x.subject === '555') && r.some((x) => x.subject === '556'),
      'R-4: athlete 555 connects to another account: their pending Strava erasure is withdrawn (others untouched)');
    await db.query(`delete from public.erasure_outbox where subject = '556'`);
    await rpc('erasure_enqueue', { p_provider: 'strava', p_subject: '555', p_detail: { access_token: 'x' } });
    await asService(() => db.query(`update public.strava_tokens set access_token = 'rotated' where user_id = $1`, [OTHER]));
    check((await rows()).length === 0, 'R-4: and a token refresh for that athlete does the same');
    await db.query(`delete from auth.users where id = $1`, [OTHER]);
  } else check(false, 'R-4: the outbox exists');

  // ---- a deletion retried by the person refreshes the row, it does not add one ----
  await reset();
  world.env.REVENUECAT_API_KEY = 'k';
  world.rc = [401];
  await del(); await del();
  check((await rows()).length === 1, 'two deletion attempts for one account leave one row');
}

// ---------- the Strava step on its own (strava.ts deauthorizeStrava) ----------
{
  const stravaSrc = fs.readFileSync('supabase/functions/spotter/strava.ts', 'utf8');
  const sv = { env: {}, token: [], deauth: [], calls: [] };
  const sctx = vm.createContext({
    console: { log() {}, error() {}, warn() {} },
    AbortSignal, Date, Number, String, JSON, Math, Promise, Error, URLSearchParams, Response, TextEncoder, crypto, atob, btoa,
    Deno: { env: { get: (k) => (k === 'SUPABASE_URL' ? SUPA : k === 'SUPABASE_SERVICE_ROLE_KEY' ? 'service' : sv.env[k]) } },
    fetch: async (url, init = {}) => {
      url = String(url);
      const body = String(init.body ?? '');
      sv.calls.push(url.includes('/oauth/token') ? 'refresh' : url.includes('/deauthorize') ? 'deauthorize:' + new URLSearchParams(body).get('access_token') : url);
      if (url.includes('/oauth/token')) {
        const [status, json] = sv.token.shift();
        return new Response(JSON.stringify(json), { status });
      }
      if (url.includes('/deauthorize')) return new Response('{}', { status: sv.deauth.shift() });
      throw new Error('unexpected ' + url);
    },
  });
  sctx.module = { exports: {} }; sctx.exports = sctx.module.exports;
  let deauth = null;
  try {
    vm.runInContext(transformSync(stravaSrc, { loader: 'ts', format: 'cjs' }).code, sctx);
    deauth = sctx.module.exports.deauthorizeStrava ?? null;
  } catch (e) { check(false, 'strava.ts loads: ' + e.message); }
  check(typeof deauth === 'function', 'strava.ts exports the outbox step deauthorizeStrava');
  if (deauth) {
    const future = new Date(Date.now() + 3600e3).toISOString();
    const past = '2020-01-01T00:00:00Z';
    const configured = { STRAVA_CLIENT_ID: '1', STRAVA_CLIENT_SECRET: 's', STRAVA_STATE_SECRET: 'x'.repeat(32) };
    const go = async (env, detail, token, deauthStatuses) => {
      sv.env = env; sv.token = token; sv.deauth = deauthStatuses; sv.calls = [];
      return await deauth('12345', detail);
    };
    let o = await go(configured, { access_token: 'live', refresh_token: 'r1', expires_at: future }, [], [200]);
    check(o.done && sv.calls.join() === 'deauthorize:live', 'strava: a live token is deauthorized as is (' + sv.calls + ')');
    o = await go(configured, { access_token: 'old', refresh_token: 'r1', expires_at: past },
      [[200, { access_token: 'new', refresh_token: 'r2', expires_at: Math.floor(Date.now() / 1000) + 21600 }]], [200]);
    check(o.done && sv.calls.join() === 'refresh,deauthorize:new', 'strava: an expired token is refreshed first (' + sv.calls + ')');
    o = await go(configured, { access_token: 'old', refresh_token: 'revoked', expires_at: past },
      [[400, { message: 'Bad Request', errors: [{ resource: 'RefreshToken', field: 'refresh_token', code: 'invalid' }] }]], []);
    check(o.done && sv.calls.join() === 'refresh', 'strava: a refused refresh token means the grant is already gone');
    o = await go(configured, { access_token: 'old', refresh_token: 'r1', expires_at: past },
      [[200, { access_token: 'new', refresh_token: 'r2', expires_at: Math.floor(Date.now() / 1000) + 21600 }]], [503]);
    check(!o.done && o.detail?.refresh_token === 'r2', 'strava: a failed deauthorize after a refresh keeps the rotated pair for the retry');
    o = await go(configured, { access_token: 'stale', refresh_token: 'r1', expires_at: future }, [], [401]);
    check(!o.done && Date.parse(o.detail?.expires_at) === 0, 'strava: a 401 marks the token stale so the retry refreshes');
    o = await go({}, { access_token: 'old', refresh_token: 'r1', expires_at: past }, [], []);
    check(!o.done && sv.calls.length === 0, 'strava: expired and no client secrets: waits, calls nobody');
  }
}

await db.close();
if (failures.length) {
  console.error('\n' + failures.length + ' of ' + (failures.length + passed) + ' erasure outbox checks FAILED');
  process.exit(1);
}
console.log('PASS ' + passed + ' erasure outbox checks: RevenueCat fail/fail/succeed drains, 404 done, no key queues, secret key preferred, Stripe without a key deletes (200) and queues, Stripe with a key still 503, one page after 8 attempts, Strava gives up, deletion never blocked by RevenueCat.');

// Erasure leaves nothing behind at a third party. No network, no database.
//
// The gap this closes: /api/account/delete cancelled Stripe, deauthorized Strava
// and deleted the auth row, but never told RevenueCat. The native shells identify
// RevenueCat with the Supabase user id (native/purchases.js passes it as
// appUserID to configure and to logIn), so the subscriber outlived the account —
// purchase history and aliases kept, and a reused id would inherit somebody
// else's entitlements.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';

const src = fs.readFileSync('supabase/functions/spotter/index.ts', 'utf8');
const erasureSrc = fs.readFileSync('supabase/functions/spotter/erasure.ts', 'utf8');
function fn(name, from = src) {
  const m = from.match(new RegExp('^(?:export )?(?:async )?function ' + name + '\\(', 'm'));
  assert(m, name);
  return from.slice(m.index, from.indexOf('\n}', m.index) + 2).replace(/^export /, '');
}

// The subscriber id is the account id, and that is a fact about the SHELLS, not
// about this file: if the native adapter ever identifies with something else,
// this delete addresses a subscriber that does not exist.
const shell = fs.readFileSync('native/purchases.js', 'utf8');
assert.match(shell, /Purchases\.configure\(\{ apiKey: config\[platform\], appUserID: userId \}\)/,
  'the native shell identifies RevenueCat with the Supabase user id');
assert.match(shell, /Purchases\.logIn\(\{ appUserID: userId \}\)/, 'and re-identifies with it on account change');

// The uploads bucket as storage lists it: a folder is an entry with a null id.
const bucket = (paths) => {
  const objects = new Set(paths);
  return {
    objects,
    list: async (prefix) => {
      const seen = new Map();
      for (const p of objects) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const name = rest.split('/')[0];
        if (!seen.has(name)) seen.set(name, { name, id: rest.includes('/') ? null : 'obj-' + name });
      }
      return [...seen.values()];
    },
    remove: async (path) => { objects.delete(path); },
  };
};

const run = ({ key, revenueCat = { ok: true, status: 200 }, stripe = null, apple = null, auth = { ok: true, status: 200 }, storage = bucket([]) }) => {
  const calls = [];
  const logs = [];
  const c = vm.createContext({
    console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')) },
    AbortSignal, Date, Number, String, JSON, encodeURIComponent,
    UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    SUPABASE_URL: 'https://db.invalid', SERVICE_KEY: 'service', authHeaders: { apikey: 'service' },
    Deno: { env: { get: (name) => (name === 'REVENUECAT_API_KEY' ? key : undefined) } },
    json: (body, status) => ({ body, status }),
    billingConfigured: () => true,
    billingCustomerFor: async () => null,
    eraseStripeCustomer: async () => ({ done: true }),
    cancelAndDeleteCustomer: async () => { calls.push('stripe'); if (stripe) throw stripe; },
    AppleGrantError: class AppleGrantError extends Error {},
    forgetAppleGrant: async () => { calls.push('apple'); if (apple) throw apple; },
    stravaGrantFor: async () => { calls.push('strava'); return null; },
    deauthorizeStrava: async () => ({ done: true }),
    // The outbox itself is proved against the real SQL in erasure-outbox-check.mjs;
    // here it only has to record that the request was written down, then make it.
    eraseAtProvider: async (provider, subject, detail, eraser) => {
      calls.push('queue:' + provider + ':' + subject);
      const out = await eraser(subject, detail);
      if (!out.done) logs.push('erasure: ' + provider + ' not done yet, queued: ' + out.error);
      return { ...out, row: out.done ? null : 1 };
    },
    // index.ts writes each erasure down against the account before the auth
    // delete (R-4), and attempts it only after.
    rpc: async (name, args) => { calls.push('enqueue:' + args.p_provider + ':' + args.p_subject + ':' + args.p_account); return 1; },
    dbDelete: async (table) => { calls.push('delete:' + table); },
    dbPatchMany: async (table) => { calls.push('patch:' + table); },
    listUploads: (prefix) => storage.list(prefix),
    deleteUpload: (path) => storage.remove(path),
    fetch: async (url, opts) => {
      if (String(url).includes('api.revenuecat.com')) {
        calls.push(opts.method + ' ' + url);
        return { ...revenueCat, text: async () => 'body', body: null };
      }
      calls.push(opts.method + ' auth');
      return { ...auth, text: async () => 'body', body: null };
    },
  });
  const queue = /^async function queueErasure\(/m.test(src) ? fn('queueErasure') : '';
  const folder = /^async function deleteUserFolder\(/m.test(src) ? fn('deleteUserFolder') : '';
  vm.runInContext(transformSync([fn('deleteRevenueCatSubscriber', erasureSrc), queue, folder, fn('handleAccountDelete')].join('\n'), { loader: 'ts', format: 'cjs' }).code, c);
  c.uid = '11111111-1111-4111-8111-111111111111';
  return { calls, logs, result: vm.runInContext('handleAccountDelete(uid, {})', c) };
};

// ---- the subscriber is deleted, by id, after Stripe has agreed ----
{
  const t = run({ key: 'sk_test' });
  const out = await t.result;
  assert.equal(out.status, 200);
  const rc = t.calls.indexOf('DELETE https://api.revenuecat.com/v1/subscribers/11111111-1111-4111-8111-111111111111');
  assert(rc > 0, 'the subscriber is deleted by the account id');
  assert(t.calls.indexOf('queue:revenuecat:11111111-1111-4111-8111-111111111111') === rc - 1, 'and the request is written down just before it is made');
  assert(rc > t.calls.indexOf('stripe'), 'after Stripe has said the deletion may go ahead');
  // R-4: written down against the account while it exists, attempted once it is gone.
  const early = t.calls.indexOf('enqueue:revenuecat:11111111-1111-4111-8111-111111111111:11111111-1111-4111-8111-111111111111');
  assert(early > 0 && early < t.calls.indexOf('DELETE auth'), 'R-4: the request is written down, against the account, before the auth row goes');
  assert(rc > t.calls.indexOf('DELETE auth'), 'R-4: and made only after the auth row is gone');
}

// ---- R-7: nothing is left in the person's folder, contact sheets included ----
{
  const uid = '11111111-1111-4111-8111-111111111111';
  const storage = bucket([uid + '/aaaaaaaa-0000-4000-8000-000000000001.mp4', uid + '/pack/tt-1/sheet-1.jpg',
    uid + '/pack/tt-1/sheet-2.jpg', uid + '/pack/tt-2/sheet-1.jpg', '22222222-2222-4222-8222-222222222222/pack/tt-1/sheet-1.jpg']);
  const t = run({ key: 'sk_test', storage });
  assert.equal((await t.result).status, 200);
  assert.deepEqual([...storage.objects].filter((p) => p.startsWith(uid + '/')), [],
    'R-7: after deletion the folder is empty, pack/<shortcode>/sheet-N.jpg included (left: ' + [...storage.objects].join(', ') + ')');
  assert.deepEqual([...storage.objects], ['22222222-2222-4222-8222-222222222222/pack/tt-1/sheet-1.jpg'], 'R-7: and nobody else\'s objects are touched');
}

// ---- R-4: a deletion that stops before the auth row goes erases nothing ----
{
  const t = run({ key: 'sk_test', auth: { ok: false, status: 500 } });
  assert.equal((await t.result).status, 500);
  assert(!t.calls.some((x) => x.includes('api.revenuecat.com') || x.startsWith('queue:')),
    'R-4: the auth delete failed: no third party was called (' + t.calls.join(', ') + ')');
}

// ---- best effort, in the same direction as Strava ----
for (const revenueCat of [{ ok: false, status: 401 }, { ok: false, status: 500 }]) {
  const t = run({ key: 'sk_test', revenueCat });
  assert.equal((await t.result).status, 200, 'a RevenueCat outage does not block an erasure (' + revenueCat.status + ')');
  assert(t.logs.some((l) => l.includes('revenuecat not done yet, queued')), 'but it is queued for retry, and says so');
}
{
  const t = run({ key: 'sk_test', revenueCat: { ok: false, status: 404 } });
  assert.equal((await t.result).status, 200);
  assert(!t.logs.some((l) => l.includes('revenuecat')), '404 is the ordinary answer for a web-only account, not an error');
}

// ---- no key, no call; and Stripe still stops everything ----
{
  const t = run({ key: undefined });
  await t.result;
  assert(!t.calls.some((x) => x.includes('api.revenuecat.com')), 'a deploy without the secret makes no call at all');
  assert(t.calls.includes('queue:revenuecat:11111111-1111-4111-8111-111111111111'), 'but the request is queued rather than dropped');
}
{
  const t = run({ key: 'sk_test', stripe: new Error('stripe down') });
  assert.equal((await t.result).status, 503);
  assert.deepEqual(t.calls, ['stripe'], 'Stripe is still the one step that stops the whole deletion');
}

console.log('PASS account deletion forgets the RevenueCat subscriber by account id, through the outbox, written down before the auth row goes and made after it.');

{
  const t = run({ key: 'sk_test', apple: new Error('Apple unavailable') });
  assert.equal((await t.result).status, 503);
  assert.deepEqual(t.calls, ['stripe', 'apple'], 'Apple failure preserves all account data for retry');
}

// Offline checks for creator codes on the client, run against the real source.
//
// The pure pieces are lifted out of app.ts the way tools/midadd-harness.mjs
// lifts its own: no browser, no network. What is checked is everything a code
// puts on the screen or on the wire — how ?code= comes off the address bar and
// into the stash, what the stash gives back, the toast, the paywall line on each
// platform, the Settings row, the creator's three lines, what /api/creator/redeem
// is sent from each door and what boot does with each answer — and the native
// adapter's redeemOfferCode against a fake store SDK, the way
// tools/ios/purchases-check.mjs drives the rest of that file.
//
// The server routes are mocked at api(): the shapes here are the ones in the
// build contract, and tools/creator-db-check.mjs is where the server proves them.
//
//   node tools/creator-client-harness.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const src = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const markup = fs.readFileSync('supabase/functions/spotter/markup.ts', 'utf8');

// A function at the IIFE's own indent. A one-liner is its one line; anything
// else runs to the first line that is exactly the closing brace at that indent.
function fn(name) {
  const a = src.indexOf('  function ' + name + '(');
  assert(a >= 0, 'not found in app.ts: ' + name);
  const eol = src.indexOf('\n', a);
  const first = src.slice(a, eol);
  const opens = (first.match(/{/g) || []).length, closes = (first.match(/}/g) || []).length;
  if (opens && opens === closes) return first;
  const b = src.indexOf('\n  }', a);
  assert(b > a, 'unterminated in app.ts: ' + name);
  return src.slice(a, b + 4);
}

function block(start, end) {
  const a = src.indexOf(start);
  assert(a >= 0, 'not found in app.ts: ' + start);
  const b = src.indexOf(end, a);
  assert(b > a, 'unterminated in app.ts: ' + start);
  return src.slice(a, b + end.length);
}

const LIFTED = ['creatorCode', 'stashCreator', 'creatorStash', 'captureCreator', 'monthsWord',
  'offerWords', 'creatorOffer', 'creatorToast', 'paywallLine', 'creatorRowText', 'creatorLines',
  'creatorSays', 'loadCreator', 'redeemCreator', 'consumeCreator', 'authCodeChange', 'money', 'num'];
const VARS = [block('  var CREATOR_KEY = ', ';'), block('  var CREATOR_SAYS = {', '\n  };')];

// The world the lifted code reaches for. localStorage is a plain object, api()
// answers from a table, and every painter and toast only counts or records.
const store = {}, replaced = [], calls = [], toasts = [], nodes = { authcode: { value: '' } };
const paints = { creator: 0, plan: 0 };
let answers = {};
const ctx = vm.createContext({
  assert, Date, Math, String, Number, JSON, Object, Array, Promise, Error, RegExp, Intl, URLSearchParams, console,
  localStorage: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  },
  location: { search: '', pathname: '/spotter/', hash: '' },
  history: { replaceState: (a, b, url) => { replaced.push(url); } },
  native: null,
  state: { user: { id: 'u1' } },
  billing: { cc: null, ccWaiting: null, ccRev: 0, redeeming: false },
  accountEpoch: 0,
  $: (id) => nodes[id],
  toast: (m) => { toasts.push(m); },
  haptic: () => {},
  paintCreator: () => { paints.creator++; },
  paintPlanCode: () => { paints.plan++; },
  api: (path, opts) => {
    calls.push([path, strip(opts)]);   // a plain copy: the vm's objects have another realm's prototype
    const a = answers[path];
    if (a instanceof Error) return Promise.reject(a);
    return Promise.resolve(typeof a === 'function' ? a(opts) : a);
  }
});
vm.runInContext(
  'function accountNow(e, u) { return e === accountEpoch && state.user && state.user.id === u; }\n' +
  VARS.join('\n') + '\n' + LIFTED.map(fn).join('\n'), ctx);

// Plain data comes back as plain data; a promise comes back as itself, settled
// to plain data, so the async checks can await it.
const strip = (v) => {
  if (!v || typeof v !== 'object') return v;
  try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
};
const run = (code) => {
  const v = vm.runInContext(code, ctx);
  return v && typeof v.then === 'function' ? v.then(strip) : strip(v);
};
const set = (name, value) => vm.runInContext(name + ' = ' + JSON.stringify(value) + ';', ctx);
const tick = () => new Promise((r) => setTimeout(r, 0));
function reset() {
  for (const k of Object.keys(store)) delete store[k];
  replaced.length = 0; calls.length = 0; toasts.length = 0;
  paints.creator = 0; paints.plan = 0; answers = {};
  nodes.authcode.value = '';
  vm.runInContext('billing.cc = null; billing.ccWaiting = null; billing.ccRev = 0; state.user = { id: "u1" }; native = null; location.search = ""; location.hash = "";', ctx);
}

let checks = 0;
function ok(what, f) { f(); checks++; console.log('  ok  ' + what); }
async function okAsync(what, f) { await f(); checks++; console.log('  ok  ' + what); }

const REF = { code: 'MARIA', creator_name: 'Maria', redeemed_at: '2026-09-18T10:00:00Z' };
const DISC = { percent_off: 10, months: 12 };
const usd = (v) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD',
  minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(v);

// ---------- the code itself ----------

console.log('what counts as a code');

ok('capitals and digits, three to twenty, whitespace and case forgiven', () => {
  assert.equal(run('creatorCode(" maria ")'), 'MARIA');
  assert.equal(run('creatorCode("ma ria")'), 'MARIA');
  assert.equal(run('creatorCode("fit2026")'), 'FIT2026');
  assert.equal(run('creatorCode("ab")'), '');
  assert.equal(run('creatorCode("A23456789012345678901")'), '');
  assert.equal(run('creatorCode("MAR-IA")'), '');
  assert.equal(run('creatorCode(null)'), '');
});

ok('an OAuth ?code= is a UUID and is never a creator code', () => {
  assert.equal(run('creatorCode("8f3c2a10-5f1e-4b7a-9d0e-1c2b3a4d5e6f")'), '');
});

// ---------- the stash ----------

console.log('the stash');

ok('round trip keeps the code and the door it came in by', () => {
  reset();
  run('stashCreator("MARIA", "signup")');
  assert.equal(store['spotter.creator.code'], 'MARIA|signup');
  assert.deepEqual(run('creatorStash()'), { code: 'MARIA', source: 'signup' });
  run('stashCreator(null)');
  assert.equal(run('creatorStash()'), null);
});

ok('a stash that is not a code reads as nothing, and a bare code is a link', () => {
  reset();
  store['spotter.creator.code'] = 'no-code|link';
  assert.equal(run('creatorStash()'), null);
  store['spotter.creator.code'] = 'MARIA';
  assert.deepEqual(run('creatorStash()'), { code: 'MARIA', source: 'link' });
});

// ---------- the address bar ----------

console.log('the referral link');

ok('?code= is stashed as a link and comes off the address, alone', () => {
  reset();
  set('location.search', '?code=maria&share&url=https%3A%2F%2Fx.test%2Fv');
  set('location.hash', '#h');
  run('captureCreator()');
  assert.equal(store['spotter.creator.code'], 'MARIA|link');
  assert.equal(replaced.length, 1);
  assert(replaced[0].startsWith('/spotter/?'), replaced[0]);
  assert(!/code=/.test(replaced[0]), 'code is still on the address: ' + replaced[0]);
  assert(/url=https/.test(replaced[0]), 'the share came off with it: ' + replaced[0]);
  assert(replaced[0].endsWith('#h'), 'the hash was lost');
});

ok('a code alone leaves a clean address with no question mark', () => {
  reset();
  set('location.search', '?code=MARIA');
  run('captureCreator()');
  assert.deepEqual(replaced, ['/spotter/']);
});

ok('a UUID in ?code= is left for the auth library, and no code means no touch', () => {
  reset();
  set('location.search', '?code=8f3c2a10-5f1e-4b7a-9d0e-1c2b3a4d5e6f');
  run('captureCreator()');
  assert.equal(store['spotter.creator.code'], undefined);
  assert.equal(replaced.length, 0);
  set('location.search', '?share&url=https%3A%2F%2Fx.test');
  run('captureCreator()');
  assert.equal(replaced.length, 0);
});

// ---------- the sign-up field ----------

console.log('the sign-up field');

ok('typed is stashed as signup once it is a code, and emptying takes only that back', () => {
  reset();
  nodes.authcode.value = 'ma';
  run('authCodeChange()');
  assert.equal(store['spotter.creator.code'], undefined, 'two letters stashed');
  nodes.authcode.value = 'mar';
  run('authCodeChange()');
  assert.equal(store['spotter.creator.code'], 'MAR|signup');
  nodes.authcode.value = '';
  run('authCodeChange()');
  assert.equal(store['spotter.creator.code'], undefined, 'an emptied field left its code behind');
});

ok('emptying the field never takes back a code that came in on the link', () => {
  reset();
  store['spotter.creator.code'] = 'MARIA|link';
  nodes.authcode.value = '';
  run('authCodeChange()');
  assert.equal(store['spotter.creator.code'], 'MARIA|link');
});

// ---------- the words ----------

console.log('the words');

ok('the offer is the config row, and null is no promise at all', () => {
  assert.equal(run('creatorOffer(' + JSON.stringify(DISC) + ')'), '10% off for 12 months');
  assert.equal(run('creatorOffer({ percent_off: 15, months: 1 })'), '15% off for 1 month');
  assert.equal(run('creatorOffer({ percent_off: 10 })'), '10% off');
  assert.equal(run('creatorOffer(null)'), '');
  assert.equal(run('creatorOffer({ percent_off: 0, months: 12 })'), '');
});

ok('the toast', () => {
  assert.equal(run('creatorToast(' + JSON.stringify(REF) + ', ' + JSON.stringify(DISC) + ')'),
    'Maria’s code applied. 10% off Plus for 12 months.');
  assert.equal(run('creatorToast(' + JSON.stringify(REF) + ', null)'), 'Maria’s code applied.');
});

ok('the paywall line on each platform, with and without a discount', () => {
  const line = (d, store) => run('paywallLine(' + JSON.stringify(REF) + ', ' + JSON.stringify(d) + ', ' + JSON.stringify(store) + ')');
  assert.equal(line(DISC, 'the App Store'),
    'Maria’s code: 10% off for 12 months. Redeem it in the App Store to get the price.');
  assert.equal(line(DISC, 'Google Play'),
    'Maria’s code: 10% off for 12 months. Redeem it in Google Play to get the price.');
  assert.equal(line(DISC, ''),
    'Maria’s code: 10% off for 12 months. It is saved to your account, and the discount is redeemed in the Spotter app on your phone.');
  assert.equal(line(null, 'the App Store'), 'Maria’s code is saved to your account. Redeem it in the App Store.');
  assert.equal(line(null, ''), 'Maria’s code is saved to your account.');
});

ok('the Settings row', () => {
  assert.equal(run('creatorRowText(' + JSON.stringify(REF) + ', ' + JSON.stringify(DISC) + ')'), 'MARIA · 10% off for 12 months');
  assert.equal(run('creatorRowText(' + JSON.stringify(REF) + ', null)'), 'MARIA');
});

ok('the creator’s three lines, money in the price card’s own formatter', () => {
  const c = { code: 'MARIA', active: true, signups: 12, subscribers: 5, earned_cents: 4820, paid_cents: 2000,
    owed_cents: 2820, currency: 'usd', commission_bps: 2000, commission_months: 12 };
  const lines = run('creatorLines(' + JSON.stringify(c) + ')');
  assert.deepEqual(lines, [
    '12 signed up · 5 subscribed',
    usd(48.2) + ' earned · ' + usd(20) + ' paid · ' + usd(28.2) + ' owed',
    'Paid by Simeon by hand. 20% of every payment for 12 months.'
  ]);
  // The rate and window are the code's own columns, not the config default.
  const other = run('creatorLines(' + JSON.stringify(Object.assign({}, c, { commission_bps: 1250, commission_months: 6 })) + ')');
  assert.equal(other[2], 'Paid by Simeon by hand. 12.5% of every payment for 6 months.');
});

ok('every refusal has a sentence, and an unknown one has the honest generic', () => {
  for (const code of ['bad_code', 'unknown_code', 'code_closed', 'own_code', 'already_redeemed', 'already_subscribed']) {
    const s = run('creatorSays(' + JSON.stringify(code) + ')');
    assert(s && s !== run('creatorSays("nope")'), 'no sentence for ' + code);
    assert(!/—|!/.test(s), 'house voice: ' + s);
  }
  assert.equal(run('creatorSays("nope")'), 'Could not apply the code just now.');
  assert.equal(run('creatorSays("bad_code")'), 'That does not look like a creator code.');
});

// ---------- the wire ----------

console.log('/api/creator/me');

await okAsync('one read per session, cached on the billing object', async () => {
  reset();
  answers['creator/me'] = { status: 'ok', referral: REF, creator: null, discount: DISC };
  const a = await run('loadCreator()');
  assert.deepEqual(a, { referral: REF, creator: null, discount: DISC });
  await run('loadCreator()');
  assert.equal(calls.length, 1, 'asked twice');
  assert.deepEqual(calls[0], ['creator/me', { method: 'GET' }]);
});

await okAsync('force reads again, and an older answer in flight is dropped, not painted over', async () => {
  reset();
  let releaseOld;
  answers['creator/me'] = () => new Promise((r) => { releaseOld = r; });
  const old = run('loadCreator()');
  answers['creator/me'] = { status: 'ok', referral: REF, creator: null, discount: DISC };
  const fresh = await run('loadCreator(true)');
  assert.deepEqual(fresh.referral, REF);
  releaseOld({ status: 'ok', referral: null, creator: null, discount: null });
  await old;
  assert.deepEqual(run('billing.cc.referral'), REF, 'the stale read overwrote the fresh one');
  assert.equal(calls.length, 2);
});

await okAsync('a route that is not there, or a dead wire, leaves what was known', async () => {
  reset();
  answers['creator/me'] = { status: 'error', message: 'Not found' };
  assert.equal(await run('loadCreator()'), null);
  answers['creator/me'] = new Error('offline');
  assert.equal(await run('loadCreator(true)'), null);
  assert.equal(run('billing.ccWaiting'), null, 'a failed read is still marked in flight');
  vm.runInContext('state.user = null;', ctx);
  assert.equal(await run('loadCreator()'), null);
});

console.log('/api/creator/redeem');

await okAsync('posts the code and the door, and a success reads the account back for the discount', async () => {
  reset();
  answers['creator/redeem'] = { status: 'ok', referral: REF };
  answers['creator/me'] = { status: 'ok', referral: REF, creator: null, discount: DISC };
  const r = await run('redeemCreator("MARIA", "app")');
  assert.deepEqual(calls[0], ['creator/redeem', { method: 'POST', body: '{"code":"MARIA","source":"app"}' }]);
  assert.equal(calls[1][0], 'creator/me');
  assert.deepEqual(r, { ok: true, code: null, referral: REF, discount: DISC });
});

await okAsync('already_redeemed also reads the account back, so the row can show which code', async () => {
  reset();
  answers['creator/redeem'] = { status: 'error', code: 'already_redeemed', referral: REF };
  answers['creator/me'] = { status: 'ok', referral: REF, creator: null, discount: null };
  const r = await run('redeemCreator("OTHER", "app")');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'already_redeemed');
  assert.equal(calls.length, 2);
});

await okAsync('any other refusal is handed back as its code, with no second read', async () => {
  reset();
  answers['creator/redeem'] = { status: 'error', code: 'code_closed', message: 'Closed.' };
  const r = await run('redeemCreator("MARIA", "signup")');
  assert.deepEqual(r, { ok: false, code: 'code_closed', referral: null, discount: null });
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0][1].body).source, 'signup');
});

// ---------- boot ----------

console.log('what boot does with the stash');

await okAsync('a stashed link code is redeemed as a link, toasted, and the stash is cleared', async () => {
  reset();
  store['spotter.creator.code'] = 'MARIA|link';
  answers['creator/redeem'] = { status: 'ok', referral: REF };
  answers['creator/me'] = { status: 'ok', referral: REF, creator: null, discount: DISC };
  run('consumeCreator()');
  await tick();
  assert.deepEqual(JSON.parse(calls[0][1].body), { code: 'MARIA', source: 'link' });
  assert.deepEqual(toasts, ['Maria’s code applied. 10% off Plus for 12 months.']);
  assert.equal(store['spotter.creator.code'], undefined);
  assert.equal(paints.creator, 1);
  assert.equal(paints.plan, 1);
});

await okAsync('a typed sign-up code goes as signup, and says nothing about a discount there is none of', async () => {
  reset();
  store['spotter.creator.code'] = 'MARIA|signup';
  answers['creator/redeem'] = { status: 'ok', referral: REF };
  answers['creator/me'] = { status: 'ok', referral: REF, creator: null, discount: null };
  run('consumeCreator()');
  await tick();
  assert.equal(JSON.parse(calls[0][1].body).source, 'signup');
  assert.deepEqual(toasts, ['Maria’s code applied.']);
});

await okAsync('already_redeemed clears the stash and says nothing', async () => {
  reset();
  store['spotter.creator.code'] = 'OTHER|link';
  answers['creator/redeem'] = { status: 'error', code: 'already_redeemed', referral: REF };
  answers['creator/me'] = { status: 'ok', referral: REF, creator: null, discount: DISC };
  run('consumeCreator()');
  await tick();
  assert.deepEqual(toasts, []);
  assert.equal(store['spotter.creator.code'], undefined);
});

await okAsync('any other refusal toasts once and clears, so the next boot is quiet', async () => {
  reset();
  store['spotter.creator.code'] = 'MARIA|link';
  answers['creator/redeem'] = { status: 'error', code: 'code_closed' };
  run('consumeCreator()');
  await tick();
  assert.deepEqual(toasts, ['That code is no longer open.']);
  assert.equal(store['spotter.creator.code'], undefined);
  run('consumeCreator()');
  await tick();
  assert.equal(calls.length, 1, 'asked again with nothing stashed');
});

await okAsync('a dead wire is not an answer: the stash waits, and nothing is said', async () => {
  reset();
  store['spotter.creator.code'] = 'MARIA|link';
  answers['creator/redeem'] = new Error('offline');
  run('consumeCreator()');
  await tick();
  assert.deepEqual(toasts, []);
  assert.equal(store['spotter.creator.code'], 'MARIA|link');
});

await okAsync('nothing stashed, or nobody signed in, asks nothing', async () => {
  reset();
  run('consumeCreator()');
  store['spotter.creator.code'] = 'MARIA|link';
  vm.runInContext('state.user = null;', ctx);
  run('consumeCreator()');
  await tick();
  assert.equal(calls.length, 0);
});

// ---------- the native adapter ----------

console.log('native/purchases.js redeemOfferCode');

const psrc = fs.readFileSync('native/purchases.js', 'utf8').replace(/^import .*;\n/gm, '').replace('export function', 'function');
const sdkCalls = [];
const sdk = {
  configure: async ({ appUserID }) => { sdkCalls.push(['configure', appUserID]); },
  logIn: async ({ appUserID }) => { sdkCalls.push(['login', appUserID]); },
  logOut: async () => { sdkCalls.push(['logout']); },
  getOfferings: async () => ({ current: {} }),
  purchasePackage: async () => {},
  restorePurchases: async () => {},
  presentCodeRedemptionSheet: async () => { sdkCalls.push(['sheet']); }
};
const create = new Function('Purchases', 'config', psrc + '\nreturn createPurchases;')(sdk, { ios: 'public-test', android: 'public-test' });

await okAsync('iOS identifies the account first, then presents Apple’s sheet', async () => {
  const ios = create('ios');
  await ios.redeemOfferCode('u1');
  assert.deepEqual(sdkCalls, [['configure', 'u1'], ['sheet']]);
  sdkCalls.length = 0;
  await ios.redeemOfferCode('u2');
  assert.deepEqual(sdkCalls, [['login', 'u2'], ['sheet']]);
});

await okAsync('Android has no sheet and says where the code goes; nobody signed in is refused', async () => {
  sdkCalls.length = 0;
  await assert.rejects(create('android').redeemOfferCode('u1'), /Google Play/);
  await assert.rejects(create('ios').redeemOfferCode(null), /Sign in/);
  assert.equal(sdkCalls.length, 0);
});

await okAsync('a sign-out invalidates a queued sheet the same way it does a restore', async () => {
  sdkCalls.length = 0;
  const ios = create('ios');
  const queued = ios.redeemOfferCode('u1');
  await ios.clear();
  await assert.rejects(queued, /account changed/i);
  assert.equal(sdkCalls.filter((c) => c[0] === 'sheet').length, 0);
});

// ---------- the wiring, by source ----------
//
// Shape only: the painters need a screen. These assert the doors exist and are
// wired in the order the behaviour needs.

console.log('the wiring');

ok('every node the painters write to is in the markup', () => {
  for (const id of ['authcodewrap', 'authcodeask', 'authcodefield', 'authcode', 'plancodeask', 'plancodeform',
    'plancodein', 'plancodego', 'plancodeline', 'planredeem', 'setcoderow', 'setcode', 'setcreator',
    'setcreatorcode', 'setcreatorshare', 'setcreatoruse']) {
    assert(markup.includes('id="' + id + '"'), 'markup has no #' + id);
  }
});

ok('the code comes off the address before the card is drawn and before the other captures', () => {
  // Anchored on the newline: these are the calls at the IIFE's own indent, at
  // the foot of the file, not the same names called from inside a function.
  const at = src.indexOf('\n  captureCreator();');
  assert(at > 0);
  assert(at < src.indexOf('\n  setAuthMode("signup");'), 'the sign-up face is drawn before the code is stashed');
  assert(at < src.indexOf('\n  captureShare();'), 'captureShare would strip the code with the query');
});

// A function at the IIFE's own indent, by name, anchored on the newline so a
// deeper function of the same name (there is another idle) cannot be the one.
function from(name) {
  const at = src.indexOf('\n  function ' + name + '(');
  assert(at >= 0, 'not found in app.ts: ' + name);
  return at;
}
const between = (a, b) => src.slice(from(a), from(b));

ok('boot redeems the stash once there is a session, on both sign-in paths', () => {
  assert(between('boot', 'idle').includes('consumeCreator()'), 'boot never consumes the stash');
});

ok('the paywall paints the code line with the cards, and the Refresh row re-reads the creator', () => {
  assert(between('paintPlans', 'paintCtx').includes('paintPlanCode();'));
  assert(between('paintPlanCode', 'askPlanCode').includes('paywallLine(ref, cc.discount, store)'));
  assert(between('refreshBilling', 'creatorCode').includes('loadCreator(true).then(paintCreator)'));
});

ok('the store button goes to Play by link on Android and to Apple’s sheet on iOS, restoring on the way back', () => {
  const redeem = between('redeemInStore', 'paintCreator');
  assert(redeem.includes('native.open("https://play.google.com/redeem?code=" + ref.code)'));
  assert(redeem.includes('native.purchases.redeemOfferCode(uid)'));
  assert(redeem.includes('billing.redeeming = true'));
  const watch = between('watchBilling', 'unbusy');
  assert(watch.includes('billing.redeeming') && watch.includes('nativePurchase(true, null)'));
});

ok('the three sources the app sends are the three the contract names', () => {
  assert(src.includes('redeemCreator(s.code, s.source)'));
  assert(src.includes('stashCreator(code, "link")'));
  assert(src.includes('stashCreator(code, "signup")'));
  // The paywall and the Settings sheet share one writer, and it applies as "app".
  assert.equal((src.match(/redeemCreator\(code, "app"\)/g) || []).length, 1);
  assert.equal((src.match(/(?<!function )applyCode\(code, /g) || []).length, 2, 'the paywall and Settings both go through applyCode');
});

console.log('\n' + checks + ' checks passed.');

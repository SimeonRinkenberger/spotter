// The Plus page, rendered from the real app.ts in its four states and from each
// way into it. No browser, no network, no store: the page's functions are lifted
// out of app.ts the way tools/rest-wheel-harness.mjs lifts its own and run in a
// vm over a fake DOM just big enough for them; the server is answered at api()
// with the shape tools/plus-server-check.ts proves the server sends, and the
// store is a stub with the shape native/purchases.js returns.
//
// What has to hold (brief GTMH-PLUS §6):
// - every state shows the Basic | Plus comparison, at least five rows, and every
//   figure in it is the cap that was passed in;
// - no "beta" anywhere on the page;
// - no price in the store-unavailable state or on the web;
// - Settings shows Upgrade for a Basic account in every state, and Manage for a
//   store subscriber even when the store gave no products;
// - planCtxLine({kind:"pumpy"}) never says "used up";
// - the entry points: the library counter from the caps, a cap refusal, the
//   preview refusal, the card's spent-previews button, Pumpy, adoptPlan's repaint.
//
//   node tools/plus-page-harness.mjs        (in gtm:check, so in verify:local and CI)
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const APP = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const MARKUP = fs.readFileSync('supabase/functions/spotter/markup.ts', 'utf8');
const STYLE = fs.readFileSync('supabase/functions/spotter/style.ts', 'utf8');

// A function at the IIFE's own indent, one-liners included.
function fn(name) {
  const head = '  function ' + name + '(';
  const a = APP.indexOf(head);
  assert(a >= 0, 'not found in app.ts: ' + name);
  const eol = APP.indexOf('\n', a), line = APP.slice(a, eol);
  if (line.trimEnd().endsWith('}')) return line;
  const b = APP.indexOf('\n  }\n', a);
  assert(b > a, 'unterminated in app.ts: ' + name);
  return APP.slice(a, b + 4);
}
function block(start, end) {
  const a = APP.indexOf(start);
  assert(a >= 0, 'not found in app.ts: ' + start);
  return APP.slice(a, APP.indexOf(end, a) + end.length);
}

// ---------- the fake DOM ----------
class El {
  constructor(tag, text) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this.cls = new Set();
    this.text = text || ''; this.parentNode = null; this.disabled = false; this.onclick = null; this.value = '';
    this.style = {};
  }
  get className() { return [...this.cls].join(' '); }
  set className(v) { this.cls = new Set(String(v).split(' ').filter(Boolean)); }
  get classList() {
    const c = this.cls;
    return { add: (...x) => x.forEach((y) => c.add(y)), remove: (...x) => x.forEach((y) => c.delete(y)), contains: (x) => c.has(x),
      toggle: (x, on) => (on === undefined ? (c.has(x) ? c.delete(x) : c.add(x)) : on ? c.add(x) : c.delete(x)) };
  }
  // As in a browser: text set on an element is a text node child of it.
  get textContent() { return this.tagName === '#TEXT' ? this.text : this.children.map((n) => n.textContent).join(''); }
  set textContent(v) {
    if (this.tagName === '#TEXT') { this.text = String(v); return; }
    this.children = [];
    if (String(v)) this.appendChild(new El('#text', String(v)));
  }
  set innerHTML(v) { this.children = []; this.text = ''; }
  get firstChild() { return this.children[0] || null; }
  get offsetWidth() { return 100; }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  focus() {}
  matches(sel) { return sel[0] === '.' ? this.cls.has(sel.slice(1)) : this.tagName === sel.toUpperCase(); }
  querySelectorAll(sel) { const out = []; const walk = (n) => n.children.forEach((c) => { if (c.matches(sel)) out.push(c); walk(c); }); walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  // What a person sees: hidden subtrees and screen-reader-only text left out.
  seen() {
    if (this.cls.has('hide') || this.cls.has('sr-only')) return '';
    if (this.tagName === '#TEXT') return this.text;
    return this.children.map((n) => n.seen()).join(this.tagName === 'TR' ? ' | ' : ' ');
  }
  click() { if (this.onclick) this.onclick({ target: this }); }
}

// Every id the page code touches, each checked against the real markup.
const IDS = ['plansheet', 'planctx', 'plangood', 'planbox', 'plancards', 'plantrial', 'plansoon', 'planbuy', 'planredeem',
  'plannot', 'planfine', 'planrestore', 'planmanage', 'plandot2', 'plandot3', 'plancodeask', 'plancodeform', 'plancodein',
  'plancodeline', 'setplan', 'setplanwarn', 'setupgrade', 'setmanage', 'setpay', 'setplanbtns', 'setrefresh', 'setplanhow',
  'libcount', 'detail'];
for (const id of IDS) assert(MARKUP.includes('id="' + id + '"'), 'the markup no longer has #' + id);
const nodes = {};
function freshDom() {
  for (const id of IDS) nodes[id] = new El('div');
  nodes.planbuy.appendChild(new El('b'));
  // What the markup starts hidden.
  for (const id of ['planctx', 'plantrial', 'plansoon', 'planbuy', 'planredeem', 'setupgrade', 'setmanage', 'setpay',
    'setplanbtns', 'setrefresh', 'setplanhow', 'libcount', 'setplanwarn']) nodes[id].classList.add('hide');
}

const LIFTED = ['num', 'capNum', 'capMany', 'planWord', 'money', 'dayMonth', 'billOn', 'myPlan', 'isFree', 'loadPrices',
  'loadCaps', 'loadUse', 'loadSub', 'planRows', 'paintTable', 'pumpyRoom', 'planCtxLine', 'skelRow', 'priceCard', 'goneCard',
  'setBuyLabel', 'finePrint', 'paintChoice', 'pickInterval', 'planState', 'paintPlans', 'paintSoon', 'retryPrices', 'paintCtx',
  'openPlans', 'paintPlanGroup', 'adoptPlan', 'shelf', 'withShelf', 'renderLibCount', 'limitHit', 'storeName', 'nativePurchase',
  'syncNativePurchase', 'absorbPlan', 'setPending'];
const VARS = [block('  var billing = {', '\n  };'), block('  var AWARDS_KEPT = ', ';'), block('  var CAP_WORDS = {', '\n  };'),
  block('  var MULT = ', ';'), block('  var PLAN_RESET = ', '";'), block('  var BILL_FLAG = ', ';')];

const STUBS = `
var native = null, accountEpoch = 1, current = null, motionLess = false;
var state = { user: { id: "u1" }, profile: { plan: "free" }, workouts: [] };
var calls = { api: [], pumpy: 0, detail: 0, toasts: [], sheets: [], portal: 0 };
var answers = {};
var sbRows = { subscriptions: null, store_entitlements: null };
var sb = {
  from: function (t) { var q = { select: function () { return q; }, maybeSingle: function () { return Promise.resolve({ data: sbRows[t], error: null }); } }; return q; },
  auth: { getSession: function () { return Promise.resolve({ data: { session: { user: { id: state.user.id }, access_token: "t" } } }); } },
  functions: { invoke: function () { return Promise.resolve({ data: answers.verify, error: null }); } }
};
var document = { createTextNode: function (t) { return new El("#text", String(t)); } };
function $(id) { return nodes[id]; }
function el(tag, cls, text) { var n = new El(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
function ic(name) { var n = new El("svg"); n.className = "ic"; n.setAttribute("data-i", name); return n; }
function accountNow(e, u) { return e === accountEpoch && state.user && state.user.id === u; }
function api(path) { calls.api.push(path); var a = answers[path]; return a instanceof Error ? Promise.reject(a) : Promise.resolve(typeof a === "function" ? a() : a); }
function lessMotion() { return motionLess; }
function haptic() {}
function toast(m) { calls.toasts.push(m); }
function openSheet(id) { $(id).classList.add("open"); calls.sheets.push(id); }
function closeSheet(id) { $(id).classList.remove("open"); }
function paintPlanCode() {}
function loadCreator() { return Promise.resolve(null); }
function loadProfile() {}
function renderPumpy() { calls.pumpy++; }
function refreshDetail(w, force) { calls.detail++; calls.forced = force; }
function openPortal() { calls.portal++; }
`;
const warned = [];
const ctx = vm.createContext({ El, nodes, console: { log: console.log, error: console.error, warn: (...a) => warned.push(a.join(' ')) }, Date, Math, Intl, JSON, Object, Array, String, Number, Promise, Error, setTimeout, clearTimeout });
vm.runInContext(STUBS + VARS.join('\n') + '\n' + LIFTED.map(fn).join('\n'), ctx);
const run = (code) => vm.runInContext(code, ctx);
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ---------- the server and the store ----------
// The caps block exactly as the branch's server sends it (plus-server-check.ts),
// and deliberately NOT the production numbers in a few places, so a figure that
// came from anywhere but the caps would show up as wrong.
const CAPS = {
  free: { library: 17, saves: 30, extract: 10, media: 15, uploads: 1, helper: 25, pumpy_month: 1500,
    month_reads: 3, month_answers: 0, month_helpers: 19, month_uploads: 2 },
  plus: { library: null, saves: 200, extract: 60, media: 15, uploads: 10, helper: 60, pumpy_month: 5000,
    month_reads: 21, month_answers: 300, month_helpers: 1000, month_uploads: 11 },
};
const FEATURES = { pumpy: ['plus'], awards_all: ['plus'] };
const LIMITS = { status: 'ok', plan: 'free', library_count: 5,
  month: { reads: 2, reads_cap: 3, answers: 0, answers_cap: 0, helpers: 19, helpers_cap: 19, uploads: 0, uploads_cap: 2 } };
const STORE_OK = { configured: true, nativeStore: true, currency: 'usd', trial_days: 0,
  plans: { plus: { month: { amount: 699, localized: '$6.99', trial_days: 0 }, year: { amount: 4999, localized: '$49.99', trial_days: 0 } } } };
let storeAnswer = STORE_OK;
function setNative(platform, mode) {
  if (!platform) { ctx.native = null; return; }
  ctx.native = { platform, purchases: {
    prices: () => (mode === 'fail' || storeAnswer instanceof Error ? Promise.reject(new Error('StoreKit: no products')) : Promise.resolve(JSON.parse(JSON.stringify(storeAnswer)))),
    purchase: () => Promise.resolve(), restore: () => Promise.resolve(),
    managementUrl: () => 'https://apps.apple.com/account/subscriptions',
  } };
}
function reset({ plan = 'free', platform = 'ios', mode = 'ok', sub = null, workouts = 5 } = {}) {
  freshDom();
  run('accountEpoch++; billing.prices = null; billing.caps = null; billing.capsWaiting = null; billing.asking = false; billing.fails = 0;' +
    'billing.shown = null; billing.sub = null; billing.subAsked = false; billing.limits = null; billing.ctx = null; billing.busy = false;' +
    'calls.api = []; calls.pumpy = 0; calls.detail = 0; calls.toasts = []; calls.sheets = []; calls.portal = 0; current = null;');
  ctx.state.profile = { plan };
  ctx.state.workouts = Array.from({ length: workouts }, (_, i) => ({ id: 'w' + i }));
  ctx.sbRows.subscriptions = null;
  ctx.sbRows.store_entitlements = sub;
  storeAnswer = STORE_OK;
  ctx.answers = { 'billing/prices': { status: 'ok', configured: false, caps: CAPS, features: FEATURES }, limits: { ...LIMITS, plan } };
  setNative(platform, mode);
}
async function open(ctxArg = null) { run('openPlans(' + JSON.stringify(ctxArg) + ')'); await tick(); await tick(); await tick(); }

// ---------- reading the page ----------
const page = () => ['planctx', 'plangood', 'planbox', 'planbuy', 'plannot', 'planfine']
  .map((id) => nodes[id].seen()).join(' \n ').replace(/[ \t]+/g, ' ');
const shown = (id) => !nodes[id].classList.contains('hide');
function table() {
  const t = nodes.plangood.querySelector('table');
  assert(t, 'no comparison table');
  return t.querySelector('tbody').children.map((tr) => ({
    label: tr.children[0].textContent,
    basic: tr.children[1].children.filter((c) => c.tagName !== 'SMALL').map((c) => c.seen()).join('').trim(),
    plus: tr.children[2].seen().trim(),
    used: (tr.children[1].querySelector('small') || { textContent: '' }).textContent,
    hdr: tr.children[0].getAttribute('scope'),
  }));
}
const PRICE = /\$\s?\d|\d+\.\d\d|US dollars|a year\b|per year|per month/;

// The renewal date as this machine's locale writes it, which is what the page does.
const END = new Date('2099-10-24T12:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

let checks = 0;
async function ok(what, f) { await f(); checks++; console.log('  ok  ' + what); }

// Every figure the table shows, each from the caps above and nothing else.
function assertTable(mine) {
  const rows = table();
  assert(rows.length >= 5, 'at least five comparison rows, got ' + rows.length);
  const by = Object.fromEntries(rows.map((r) => [r.label, r]));
  const month = (n) => n === null ? 'No limit' : n === 0 ? '—' : n.toLocaleString() + ' a month';
  assert.equal(by['Saved workouts'].basic, String(CAPS.free.library));
  assert.equal(by['Saved workouts'].plus, 'No limit');
  assert.equal(by['Full video reads'].basic, month(CAPS.free.month_reads));
  assert.equal(by['Full video reads'].plus, month(CAPS.plus.month_reads));
  assert.equal(by['Explanations and swaps'].basic, month(CAPS.free.month_helpers));
  assert.equal(by['Explanations and swaps'].plus, month(CAPS.plus.month_helpers));
  assert.equal(by['Uploads'].basic, month(CAPS.free.month_uploads));
  assert.equal(by['Uploads'].plus, month(CAPS.plus.month_uploads));
  assert.equal(by['Pumpy coach'].basic, '—');
  assert.equal(by['Pumpy coach'].plus, 'Included');
  assert.equal(by['Awards history'].basic, 'Latest 12');
  assert.equal(by['Awards history'].plus, 'All');
  assert(rows.every((r) => r.hdr === 'row'), 'every label is a row header');
  if (mine) {
    assert.equal(by['Saved workouts'].used, '5 saved');
    assert.equal(by['Full video reads'].used, '2 of 3 used');
    assert.equal(by['Explanations and swaps'].used, '19 of 19 used');
    assert.equal(by['Uploads'].used, '0 of 2 used');
  } else assert(rows.every((r) => !r.used), 'no Basic usage on a Plus account');
  assert(/Always free: logging, Workout Mode, your plan, progress and export/.test(nodes.plangood.seen().replace(/\s+/g, ' ')));
}
function noBeta() { assert(!/beta/i.test(page()), 'no "beta" on the page: ' + page()); }

console.log('the four states');

await ok('app, store answered: table, annual first and chosen, CTA, store terms, Restore and Manage', async () => {
  reset();
  await open();
  assertTable(true);
  const cards = nodes.plancards.querySelectorAll('.pcard');
  assert.deepEqual(cards.map((c) => c.getAttribute('data-iv')), ['year', 'month']);
  assert.equal(cards[0].getAttribute('aria-checked'), 'true');
  assert(shown('planbuy') && !shown('plansoon'));
  assert.equal(nodes.planbuy.textContent, 'Subscribe for $49.99 a year');
  assert(/^Renews automatically at \$49\.99 per year until cancelled\./.test(nodes.planfine.textContent), nodes.planfine.textContent);
  assert(!shown('plantrial'), 'no trial line without an eligible store offer');
  assert(shown('planrestore') && shown('planmanage') && shown('plandot2') && shown('plandot3'));
  noBeta();
});

await ok('the trial line comes only from the store’s eligible offer, per period', async () => {
  reset();
  storeAnswer = JSON.parse(JSON.stringify(STORE_OK));
  storeAnswer.plans.plus.year.trial_days = 7; storeAnswer.trial_days = 7;
  await open();
  assert(shown('plantrial'));
  assert(/^Free for 7 days\. We will not charge you before /.test(nodes.plantrial.textContent), nodes.plantrial.textContent);
  assert.equal(nodes.planbuy.textContent, 'Start 7 free days');
  assert(/^After the 7-day free trial, it renews automatically at \$49\.99 per year/.test(nodes.planfine.textContent));
  nodes.plancards.querySelectorAll('.pcard')[1].click();
  assert(!shown('plantrial'), 'the monthly plan has no offer');
  await tick(200);
  assert.equal(nodes.planbuy.textContent, 'Subscribe for $6.99 a month');
});

await ok('one period from the store: the other is shown, disabled, and the page still sells', async () => {
  reset();
  storeAnswer = JSON.parse(JSON.stringify(STORE_OK));
  delete storeAnswer.plans.plus.month;
  await open();
  const cards = nodes.plancards.querySelectorAll('.pcard');
  assert.equal(cards.length, 2);
  assert(cards[1].cls.has('off') && cards[1].disabled && /Not available right now/.test(cards[1].textContent));
  assert(shown('planbuy'));
  assert.equal(nodes.planbuy.textContent, 'Subscribe for $49.99 a year');
});

await ok('app, store not answering: table, honest card, Try again, Restore, no price', async () => {
  reset({ mode: 'fail' });
  await open();
  assertTable(true);
  assert.equal(run('planState()'), 'down');
  assert(shown('plansoon') && !shown('planbuy') && !shown('plancards'));
  assert(/The App Store isn’t answering right now, so we can’t show a price\. Nothing has been charged\./.test(nodes.plansoon.seen()));
  assert(!/update Spotter/.test(nodes.plansoon.seen()), 'not on the first miss');
  assert(shown('planrestore'), 'Restore is there');
  assert(!PRICE.test(page()), 'no price when the store gave none: ' + page());
  noBeta();
});

await ok('Try again re-asks the store, spins, and cross-fades the cards in', async () => {
  reset({ mode: 'fail' });
  await open();
  const retry = nodes.plansoon.querySelector('button');
  assert.equal(retry.textContent, 'Try again');
  setNative('ios', 'ok');
  retry.click();
  assert(retry.disabled && retry.firstChild.cls.has('spin'), 'the spinner runs while the store is asked');
  await tick(560);
  assert.equal(run('planState()'), 'buy');
  assert(shown('planbuy') && !shown('plansoon'));
  assert(nodes.planbox.cls.has('planswap') && nodes.planbuy.cls.has('planswap'), 'the cards cross-fade in');
});

await ok('a second miss adds the update line; Android names Google Play', async () => {
  reset({ platform: 'android', mode: 'fail' });
  await open();
  nodes.plansoon.querySelector('button').click();
  await tick(560);
  assert.equal(run('billing.fails'), 2);
  assert(/^Google Play isn’t answering right now/.test(nodes.plansoon.seen()), nodes.plansoon.seen());
  assert(/If this keeps happening, update Spotter from Google Play\./.test(nodes.plansoon.seen()));
  assert(!/App Store/.test(page()));
});

await ok('web: the same table, bought in the app, no price, no checkout, no Restore', async () => {
  reset({ platform: null });
  await open();
  assertTable(true);
  assert.equal(run('planState()'), 'web');
  assert(/Spotter Plus is bought in the Spotter app\./.test(nodes.plansoon.seen()));
  assert(!shown('planbuy') && !shown('planrestore') && !shown('planmanage'));
  assert(!PRICE.test(page()), 'no price on the web: ' + page());
  noBeta();
});

await ok('web, even when the server has Stripe prices: still no price and no checkout', async () => {
  reset({ platform: null });
  ctx.answers['billing/prices'] = { status: 'ok', configured: true, currency: 'usd', plans: { plus: { month: { amount: 699 }, year: { amount: 4999 } } }, caps: CAPS, features: FEATURES };
  await open();
  assert.equal(run('planState()'), 'web');
  assert(!PRICE.test(page()) && !shown('planbuy'));
});

await ok('already Plus: the table, renewal or end date, Manage and Restore; no Basic usage, nothing sold', async () => {
  reset({ plan: 'plus', sub: { active: true, source: 'apple', expires_at: '2099-10-24T12:00:00Z', will_renew: false } });
  await open();
  assertTable(false);
  assert.equal(run('planState()'), 'plus');
  assert(/You have Spotter Plus\./.test(nodes.plansoon.seen()));
  assert(nodes.plansoon.seen().includes('Ends ' + END + '.'), nodes.plansoon.seen());
  assert.equal(nodes.plansoon.querySelector('button').textContent, 'Manage subscription');
  assert(!shown('planbuy') && shown('planrestore'));
  assert.equal(nodes.plannot.textContent, 'Done');
  reset({ plan: 'plus', sub: { active: true, source: 'apple', expires_at: '2099-10-24T12:00:00Z', will_renew: true } });
  await open();
  assert(nodes.plansoon.seen().includes('Renews ' + END + '.'));
  reset({ plan: 'plus', platform: null, sub: { active: true, source: 'google', expires_at: '2099-10-24T12:00:00Z', will_renew: true } });
  await open();
  assert(/Manage it in Google Play on your phone\./.test(nodes.plansoon.seen()));
  assert(!nodes.plansoon.querySelector('button'), 'the web has nothing to press');
  assert(!PRICE.test(page()));
});

await ok('the table is drawn as waiting while it loads, and says so if it could not', async () => {
  reset();
  let release;
  ctx.answers['billing/prices'] = () => new Promise((r) => { release = r; });
  run('openPlans(null)');
  assert.equal(nodes.plangood.querySelectorAll('.skel').length, 4, 'skeleton rows, not an empty box');
  release({ status: 'ok', configured: false, caps: CAPS, features: FEATURES });
  await tick(); await tick(); await tick();
  assertTable(true);
  reset({ platform: null });
  ctx.answers['billing/prices'] = new Error('offline');
  await open();
  assert(/did not load/.test(nodes.plangood.seen()) && nodes.plangood.querySelector('button'), nodes.plangood.seen());
});

console.log('Settings › Plan');

async function settings(opts) {
  reset(opts);
  if (opts.platform !== null) await run('loadPrices()');
  else await run('loadCaps()');
  await run('loadSub()');
  run('paintPlanGroup()');
}
await ok('Upgrade for every Basic account in every state; the web says See Spotter Plus', async () => {
  for (const [opts, label] of [[{ mode: 'ok' }, 'Upgrade to Plus'], [{ mode: 'fail' }, 'Upgrade to Plus'],
    [{ platform: 'android', mode: 'fail' }, 'Upgrade to Plus'], [{ platform: null }, 'See Spotter Plus']]) {
    await settings(opts);
    assert(shown('setupgrade') && shown('setplanbtns'), JSON.stringify(opts));
    assert.equal(nodes.setupgrade.textContent, label);
    assert(!shown('setmanage'));
  }
});
await ok('Manage for a store subscriber, products or not; the web names the store instead', async () => {
  const sub = { active: true, source: 'apple', expires_at: '2099-10-24T12:00:00Z', will_renew: true };
  for (const mode of ['ok', 'fail']) {
    await settings({ plan: 'plus', mode, sub });
    assert(shown('setmanage') && !shown('setupgrade'), mode);
  }
  await settings({ plan: 'plus', platform: null, sub });
  assert(!shown('setmanage') && shown('setplanhow'));
  assert.equal(nodes.setplanhow.textContent, 'Manage it in the App Store on your iPhone.');
  await settings({ plan: 'plus', mode: 'fail', sub: { ...sub, will_renew: false } });
  assert(/^Plus · ends /.test(nodes.setplan.textContent), nodes.setplan.textContent);
});

console.log('what opens it, and what it says');

await ok('planCtxLine for Pumpy never says used up without a cap that is used up', () => {
  for (const c of [{ kind: 'pumpy' }, { kind: 'pumpy', plan: 'free', next_plan: 'plus' },
    { kind: 'pumpy', plan: 'free', upgrade: true, message: 'Pumpy coaching is included with Spotter Plus' },
    { kind: 'pumpy', cap: 1500, used: 3 }]) {
    const line = run('planCtxLine(' + JSON.stringify(c) + ')');
    assert(!/used up/.test(line), JSON.stringify(c) + ': ' + line);
    assert.equal(line, 'Pumpy is part of Spotter Plus.');
  }
  run('billing.caps = ' + JSON.stringify({ free: CAPS.free, plus: CAPS.plus }));
  assert(/^That is this month’s coaching used up/.test(run('planCtxLine({ kind: "pumpy", cap: 5000, used: 5000, plan: "plus" })')));
});
await ok('Pumpy’s offer and send open the page with that line, and the attachments promise is gone', () => {
  const offer = fn('renderPumpy'), send = fn('sendPumpy');
  assert(/upgrade\.onclick = function \(\) \{ openPlans\(\{ kind: "pumpy" \}\); \};/.test(offer));
  assert(/if \(isFree\(\)\) \{ openPlans\(\{ kind: "pumpy" \}\); return; \}/.test(send));
  assert(!/attachments/.test(offer), 'Basic has no Pumpy, with or without attachments');
});
await ok('a Basic refusal with upgrade opens the page on the reason; without, it is a toast', async () => {
  reset({ platform: null });
  const hit = run('limitHit(' + JSON.stringify({ status: 'limit', kind: 'library', plan: 'free', cap: 17, used: 17, upgrade: true, next_plan: 'plus', next_cap: null }) + ', "x")');
  assert.equal(hit, true);
  assert(nodes.plansheet.cls.has('open'));
  assert(/^That is 17 saved workouts, which is the Basic plan’s shelf\. Plus takes the lid off/.test(nodes.planctx.textContent), nodes.planctx.textContent);
  reset({ platform: null });
  assert.equal(run('limitHit({ status: "limit", kind: "saves", upgrade: false, message: "That is the ceiling." }, "x")'), false);
  assert.deepEqual([...ctx.calls.toasts], ['That is the ceiling.']);
});
await ok('a refused preview carries its month, so the page says what ran out and what Plus reads', async () => {
  reset();
  // The body previewLimit() sends (tools/plus-server-check.ts).
  run('limitHit(' + JSON.stringify({ status: 'limit', kind: 'media', upgrade: true, plan: 'free', cap: 3, used: 3, scope: 'month',
    next_plan: 'plus', next_cap: 21, resets_at: '2026-10-01T00:00:00.000Z', message: 'You have used all four…' }) + ', null)');
  assert.equal(nodes.planctx.textContent,
    'That is 3 video reads this month, the Basic plan’s whole allowance. It comes back on the 1st. Plus reads 21 a month.');
  assert.equal(run('planCtxLine({ kind: "media", plan: "free", cap: 3, used: 3, scope: "month" })'),
    'That is 3 video reads this month, the Basic plan’s whole allowance. It comes back on the 1st.',
    'a context that does not know Plus’s number claims none');
});
await ok('the card’s spent-previews button opens with the same context; See everything opens plainly', () => {
  // The card's offer box belongs to the save-flow work; what this page needs of
  // it is only that its Plus links open this page, and that the spent-previews
  // one says what ran out.
  const src = APP.slice(APP.indexOf('var pv = billing.limits && billing.limits.video_previews;'), APP.indexOf('var waiting = pausedDraft();'));
  assert(/openPlans\(\{ kind: "media" \}\)/.test(src), 'See everything in Plus opens the page');
  assert(/openPlans\(\{ kind: "media", plan: "free", scope: "month", cap: r\.video_previews\.cap, used: r\.video_previews\.used,/.test(src),
    'the spent-previews button opens it on the previews');
  assert.equal(run('planCtxLine({ kind: "media" })'), '', 'no count, no line');
});
await ok('the library counter and the save receipt read the server’s caps, on every platform', async () => {
  for (const platform of [null, 'ios', 'android']) {
    reset({ platform, workouts: 14 });
    run('renderLibCount()');
    assert(!shown('libcount'), 'nothing before the caps land');
    await run('loadCaps()');
    run('renderLibCount()');
    assert(shown('libcount'));
    assert.equal(nodes.libcount.textContent, '14 of 17 saved · Plus');
    assert(nodes.libcount.cls.has('near'), 'ember from four fifths');
    assert.equal(run('withShelf("Saved")'), 'Saved. That is 14 of your 17 saved workouts.');
  }
  reset({ plan: 'plus', workouts: 40 });
  await run('loadCaps()');
  run('renderLibCount()');
  assert(!shown('libcount'), 'Plus has no shelf to count');
});
await ok('adoptPlan repaints Pumpy, the open card and the page, without a relaunch', async () => {
  reset();
  await open();
  assert.equal(run('planState()'), 'buy');
  ctx.current = { id: 'w1' };
  nodes.detail.classList.add('open');
  ctx.sbRows.store_entitlements = { active: true, source: 'apple', expires_at: '2099-10-24T12:00:00Z', will_renew: true };
  run('billing.subAsked = false;');
  await run('loadSub()');
  run('adoptPlan("plus")');
  assert.equal(ctx.calls.pumpy, 1, 'Pumpy’s tab');
  assert.equal(ctx.calls.detail, 1, 'the open card');
  assert.equal(ctx.calls.forced, true, 'redrawn although the card itself did not change');
  assert.equal(run('planState()'), 'plus');
  assert(nodes.plansoon.seen().includes('You have Spotter Plus. Renews ' + END + '.'), nodes.plansoon.seen());
  assert(!shown('planbuy'));
  run('adoptPlan("plus")');
  assert.equal(ctx.calls.pumpy, 1, 'an unchanged plan repaints nothing');
});
await ok('a restore that made a Basic account Plus says it may have moved; a purchase keeps its welcome', async () => {
  reset();
  await open();
  ctx.answers.verify = { status: 'ok', plan: 'plus', subscription: { source: 'apple', status: 'active', plan: 'plus', current_period_end: '2099-10-24T12:00:00Z' } };
  run('nativePurchase(true, null)');
  await tick(); await tick(); await tick(); await tick();
  assert.equal(ctx.calls.toasts.at(-1), 'Plus is on this account now. If it was bought on another Spotter account, that one is back on Basic.');
  reset();
  await open();
  ctx.answers.verify = { status: 'ok', plan: 'plus', subscription: { source: 'apple', status: 'active', plan: 'plus', current_period_end: '2099-10-24T12:00:00Z' } };
  run('nativePurchase(false, null)');
  await tick(); await tick(); await tick(); await tick();
  assert.deepEqual([...ctx.calls.toasts], ['Welcome to Plus.'], 'not overwritten by "up to date"');
  assert(!nodes.plansheet.cls.has('open'), 'the page closes on a purchase');
});

console.log('the words and the layout');

await ok('no "beta" in anything the page can say', () => {
  for (const name of ['finePrint', 'paintChoice', 'paintPlans', 'paintSoon', 'planRows', 'paintTable', 'planCtxLine'])
    assert(!/beta/i.test(fn(name)), name + ' says beta');
  assert(!/beta/i.test(block('  var PLAN_RESET = ', '";')));
  const sheet = MARKUP.slice(MARKUP.indexOf('id="plansheet"'), MARKUP.indexOf('id="aiconsentsheet"'));
  assert(!/beta/i.test(sheet));
});
await ok('below 360px each row stacks, and the cross-fade is still under reduced motion', () => {
  const narrow = STYLE.slice(STYLE.indexOf('@media (max-width: 359px)'));
  assert(/\.ptable thead \{ display: none; \}/.test(narrow) && /content: attr\(data-l\)/.test(narrow), 'the stacked layout');
  const reduce = STYLE.slice(STYLE.indexOf('.planbtn:active, .segbtn, .mcell, .copyweek { transition: none; }') - 400);
  assert(/\.planswap \{ animation: none; \}/.test(reduce), 'planswap has a reduced-motion rule');
  assert(/\.plansoon \.btn \{ margin-top: 12px; min-height: 44px; \}/.test(STYLE), 'Try again is a 44px target');
});

console.log('\n' + checks + ' Plus page checks passed');

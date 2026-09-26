// "Pull Day Routine is ready": the notification with two buttons, and the sheet
// it opens, checked without a phone.
//
// A saved video becoming a workout reaches a person by four doors — the card
// turning ready with the app up, a save that comes back ready at once, the app
// opening on one that turned ready while it was away, and the notification — and
// all four end in one sheet with one set of manners: never over a set, never on
// top of another sheet, once per card, and not at all for the card already open.
// Those manners are easy to break from anywhere in app.ts, and a regression is a
// sheet that interrupts a workout or never appears, neither of which any build
// would notice. So the real functions come out of app.ts and run against stubs,
// as push-check.mjs and live-state-check.mjs do; the Swift, the payload and the
// fixtures are held as text, because CI has no Xcode and no Deno on this step.
//
// Node-only, like every other tools/ios/*-check.mjs.

import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const app = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const markup = fs.readFileSync('supabase/functions/spotter/markup.ts', 'utf8');
const push = fs.readFileSync('supabase/functions/spotter/push.ts', 'utf8');
const host = fs.readFileSync('ios/App/App/NotificationsHost.swift', 'utf8');

// Brace counting, as the other checks do. None of the functions pulled below has
// a brace inside a string or a regex.
function fn(name) {
  const start = app.indexOf('\n  function ' + name + '(');
  assert(start >= 0, 'app.ts has no ' + name + '()');
  let depth = 0;
  for (let i = app.indexOf('{', start); i < app.length; i++) {
    if (app[i] === '{') depth++;
    else if (app[i] === '}' && --depth === 0) return app.slice(start, i + 1) + '\n';
  }
  throw new Error('unbalanced braces in ' + name);
}

// ---------- the Swift half ----------

assert.match(host, /center\.setNotificationCategories\(\[Self\.readyCategory\]\)/,
  'install() must register the ready category, or the banner arrives without its buttons');
assert(host.indexOf('setNotificationCategories') > host.indexOf('func install()') &&
  host.indexOf('setNotificationCategories') < host.indexOf('func handle('),
  'the category is registered in install(), at launch, beside the delegate');
assert.match(host, /identifier: "CARD_READY"/, 'the category id the payload names');
assert.match(host, /UNNotificationAction\(identifier: "START_NOW", title: "Start Now", options: \[\.foreground\]/,
  'Start Now opens the app into Workout Mode');
assert.match(host, /UNNotificationAction\(identifier: "PLAN_IT", title: "Plan It", options: \[\.foreground\]/,
  'Plan It opens the app on the ready sheet');
assert(host.indexOf('"START_NOW"') < host.indexOf('"PLAN_IT"'),
  'Start Now first: a Watch double tap answers with the first non-destructive action');
assert.match(host, /case "START_NOW": id = "spotter:\/\/start\/" \+ card/, 'Start Now must route to spotter://start/<card>');
assert.match(host, /case "PLAN_IT": id = "spotter:\/\/ready\/" \+ card/, 'Plan It must route to spotter://ready/<card>');
assert.match(host, /default: break/, 'a tap on the banner itself follows its url, as every notification does');
assert.match(host, /id: "spotter:\/\/ready\/" \+ card \+ "\?auto=1"/,
  'in the foreground the card goes to the page as the quiet door (?auto=1)');
assert.match(host, /completionHandler\(active \? \[\] : \[\.banner, \.sound\]\)/,
  'no banner while the app is in front, a banner otherwise — unchanged');
assert.match(host, /\$0\.isASCII && \(\$0\.isLetter \|\| \$0\.isNumber \|\| \$0 == "-"\)/,
  'the card id is checked before it goes into a link');

// ---------- the payload the server sends, and the fixtures made from it ----------

assert.match(push, /category: "CARD_READY"/, 'push.ts and the app must name the same category');
assert.match(push, /"thread-id": "ready"/, 'ready cards get their own stack in Notification Centre');
assert.match(push, /postApns\(device, "spotter-ready", readyPayload\(alert\)/, 'one collapse id for every banner of a burst');
for (const [name, url, title] of [
  ['card-ready', /^spotter:\/\/ready\/[0-9a-f-]{36}$/, / is ready$/],
  ['card-ready-burst', /^spotter:\/\/tab\/library$/, /^\d+ workouts are ready$/],
]) {
  const path = 'tools/ios/fixtures/' + name + '.apns';
  assert(fs.existsSync(path), path + ' is missing — run npm run push:harness');
  const f = JSON.parse(fs.readFileSync(path, 'utf8'));
  assert(f['Simulator Target Bundle'], 'simctl needs a target bundle when none is given on the command line');
  assert.equal(f.aps.category, 'CARD_READY', name + ': the category the buttons hang on');
  assert.equal(f.aps['thread-id'], 'ready');
  assert.match(f.aps.alert.title, title, name + ': the title');
  assert.match(f.url, url, name + ': the banner tap');
  assert.match(f.card, /^[0-9a-f-]{36}$/, name + ': the card the buttons act on');
  assert.equal(f.aps.card, undefined, 'custom keys inside aps are dropped by APNs');
}

// ---------- the page: markup, and where the sheet sits ----------

const ready = markup.indexOf('id="readysheet"');
const sched = markup.indexOf('id="schedulesheet"');
assert(ready > 0, 'markup.ts has no #readysheet');
assert(ready > markup.indexOf('</div></div>', sched),
  '#readysheet must sit beside the other sheets: nested in a sheet body it is inside that transform and never shows');
assert.match(markup, /aria-labelledby="readykick readytitle"/, 'VoiceOver hears "Ready to train" and the title');
assert.match(markup, /id="remready"/, 'Settings has the "When a saved video is ready" switch');
assert(app.includes('if (remind.ready === false) s.notifyReady = false; else if (remind.ready) delete s.notifyReady;'),
  'notifyReady is written only to say Off, and left alone until the profile has said which');
// B.2: a session that closes a program week says so first (sumCheck), then the same two.
assert(/if \(!past\) \[(sumCheck\(payload\), )?sumNext\(w\), sumOffer\(w\)\]/.test(app) &&
  app.indexOf('sumNext(w), sumOffer(w)]') < app.indexOf('main.appendChild(shareRow(payload, logged, past));'),
  'the recap: the week\'s check-in, the next step, then the offer, under the figures and above the share row');
assert(app.includes('if (fromShare) body.source = "share";'), 'a share from another app says so to /api/ingest');

// ---------- the rules, run ----------

const PULL = ['seenReady', 'readyMark', 'offerReady', 'readyArrived', 'readyLink', 'readyOnOpen', 'cardLink',
  'readyPick', 'isPending', 'isFailed', 'planWorkout', 'showCard', 'openDeepLink', 'openLink'];

const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

function page(opts = {}) {
  const calls = { shown: [], toast: [], closed: [], timers: [], fetched: [], detail: [], started: [], views: [] };
  const open = { workout: false, detail: false, sheets: [] };
  const store = opts.store || {};
  const el = (id) => ({
    id,
    classList: {
      contains: (c) => c === 'open' && (id === 'workout' ? open.workout : id === 'detail' ? open.detail : open.sheets.includes(id)),
      add: () => {}, remove: () => {},
    },
  });
  const ctx = vm.createContext({
    state: {
      user: { id: 'u1' },
      workouts: opts.workouts || [
        { id: 'w-new', title: 'Pull Day Routine', ingest_status: 'ready', created_at: iso(60_000) },
        { id: 'w-old', title: 'Leg Day', ingest_status: 'ready', created_at: iso(3 * 86_400_000) },
        { id: 'w-read', title: 'Still reading', ingest_status: 'processing', created_at: iso(30_000) },
      ],
      logs: opts.logs || [], plan: [],
    },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    $: el,
    document: {
      activeElement: opts.focused ? { tagName: 'INPUT' } : null,
      querySelectorAll: (sel) => (sel === '.sheet.open' ? open.sheets.map((id) => ({ id })) : []),
    },
    anySheet: () => open.sheets.length > 0,
    current: null,
    wo: null,
    pausedDraft: () => null,
    showReadySheet: (w) => { calls.shown.push(w.id); if (!open.sheets.includes('readysheet')) open.sheets.push('readysheet'); ctx.readyMark(w.id); },
    toast: (m) => calls.toast.push(m),
    closeSheet: (id) => { calls.closed.push(id); open.sheets = open.sheets.filter((s) => s !== id); },
    setTimeout: (f) => { calls.timers.push(f); },
    openDetail: (w) => calls.detail.push(w.id),
    startWorkout: (w) => { calls.started.push(w.id); ctx.wo = { finished: false, workout: w }; open.workout = true; },
    setView: (v) => calls.views.push(v),
    woForward: () => {},
    openSetLink: () => {},
    loadLogs: () => Promise.resolve(),
    fullLogs: () => ctx.state.logs,
    idle: (f) => f(),
    accountEpoch: 1,
    accountNow: () => true,
    CARD_COLS: '*',
    OPEN_KEY: 'spotter_open_pending',
    // The row read openLink makes for a card this page has not seen.
    sb: {
      from: () => {
        const q = { id: null };
        const chain = {
          select: () => chain,
          eq: (c, v) => { if (c === 'id') q.id = v; return chain; },
          maybeSingle: () => {
            calls.fetched.push(q.id);
            return Promise.resolve({ data: (opts.server || {})[q.id] || null, error: null });
          },
        };
        return chain;
      },
    },
    onWorkoutChange: (p) => { ctx.state.workouts.unshift(p.new); },
    READY_KEY: 'spotter_ready_seen:',
    linkAt: 0,
    Date, JSON, Array, String, Object, Math, Promise, decodeURIComponent,
  });
  vm.runInContext(PULL.map(fn).join(''), ctx);
  return { ctx, calls, open, store };
}
const run = (p, js) => vm.runInContext(js, p.ctx);
const tick = () => new Promise((r) => setTimeout(r, 0));

// A new save, with the screen free: the sheet, once.
{
  const p = page();
  run(p, 'offerReady(planWorkout("w-new"))');
  assert.deepEqual(p.calls.shown, ['w-new']);
  p.open.sheets = [];
  run(p, 'offerReady(planWorkout("w-new"))');
  assert.deepEqual(p.calls.shown, ['w-new'], 'once per card: a card already offered is not offered again');
}
// Once per card outlives the page: the memory is this account's, on this phone.
{
  const store = {};
  const a = page({ store });
  run(a, 'offerReady(planWorkout("w-new"))');
  const b = page({ store });
  run(b, 'offerReady(planWorkout("w-new"))');
  assert.deepEqual(b.calls.shown, [], 'a reload must not show the same card again');
  assert.deepEqual(JSON.parse(store['spotter_ready_seen:u1']), ['w-new'], 'kept per account');
}
// Bounded: forty ids at most.
{
  const p = page();
  for (let i = 0; i < 45; i++) run(p, 'readyMark("id-' + i + '")');
  const kept = JSON.parse(p.store['spotter_ready_seen:u1']);
  assert.equal(kept.length, 40, 'the seen list is bounded');
  assert.equal(kept[0], 'id-5', 'the oldest go first');
}
// Never over a set; and the card stays unseen, so the next open can offer it.
{
  const p = page();
  p.open.workout = true;
  run(p, 'offerReady(planWorkout("w-new"))');
  assert.deepEqual(p.calls.shown, [], 'never over Workout Mode');
  assert.equal(p.calls.timers.length, 0, 'and not held for after it either');
  assert.equal(run(p, 'seenReady().indexOf("w-new")'), -1, 'not spent: readyOnOpen may still offer it');
}
// Over another sheet it waits, then shows when that one has gone.
{
  const p = page();
  p.open.sheets = ['settingssheet'];
  run(p, 'offerReady(planWorkout("w-new"))');
  assert.deepEqual(p.calls.shown, [], 'never on top of another sheet');
  assert.equal(p.calls.timers.length, 1, 'held for a moment and tried again');
  p.open.sheets = [];
  p.calls.timers.shift()();
  assert.deepEqual(p.calls.shown, ['w-new'], 'shown once the other sheet has closed');
}
// Not while somebody is typing.
{
  const p = page({ focused: true });
  run(p, 'offerReady(planWorkout("w-new"))');
  assert.deepEqual(p.calls.shown, [], 'a field with the keyboard up is not interrupted');
  assert.equal(p.calls.timers.length, 1);
}
// The card already being read is its own answer.
{
  const p = page();
  p.open.detail = true;
  run(p, 'current = planWorkout("w-new"); offerReady(current)');
  assert.deepEqual(p.calls.shown, [], 'no sheet over the card it is about');
  assert.notEqual(run(p, 'seenReady().indexOf("w-new")'), -1, 'and the moment counts as had');
}
// A card still being read is not ready.
{
  const p = page();
  run(p, 'offerReady(planWorkout("w-read"))');
  assert.deepEqual(p.calls.shown, []);
}
// Turning ready with the app up: a new save gets the sheet, a second read of a
// card known for days keeps the old line, a card already trained too.
{
  const p = page({ logs: [{ workout_id: 'w-done', started_at: iso(86_400_000) }] });
  run(p, 'readyArrived(planWorkout("w-new"))');
  assert.deepEqual(p.calls.shown, ['w-new']);
  run(p, 'readyArrived(planWorkout("w-old"))');
  assert.deepEqual(p.calls.toast, ['Ready: Leg Day'], 'an old card read again is not the ready moment');
  run(p, 'state.workouts.push({ id: "w-done", title: "Done before", ingest_status: "ready", created_at: new Date().toISOString() }); readyArrived(planWorkout("w-done"))');
  assert.deepEqual(p.calls.toast, ['Ready: Leg Day', 'Ready: Done before'], 'a card with a session is not news');
  run(p, 'readyArrived(planWorkout("w-new"))');
  assert.deepEqual(p.calls.toast.length, 2, 'and a card already offered says nothing at all');
}
// The notification, tapped: asked for, so it shows even for a card already
// offered, and moves the sheet that was in the way — after, so the one history
// entry is handed over rather than given back.
{
  const p = page();
  run(p, 'readyMark("w-new")');
  p.open.sheets = ['settingssheet'];
  run(p, 'openDeepLink("spotter://ready/w-new")');
  assert.deepEqual(p.calls.shown, ['w-new'], 'a tap shows the card even when it has been offered');
  assert.deepEqual(p.calls.closed, ['settingssheet'], 'what was in the way goes');
  assert.deepEqual(p.open.sheets, ['readysheet']);
}
{
  const p = page();
  p.open.workout = true;
  run(p, 'openDeepLink("spotter://ready/w-new")');
  assert.deepEqual(p.calls.shown, [], 'never over a set, even asked for');
  assert.equal(p.calls.toast.length, 1, 'it says why instead');
}
// The quiet door, from the foreground (?auto=1): the ordinary manners.
{
  const p = page();
  run(p, 'readyMark("w-new"); openDeepLink("spotter://ready/w-new?auto=1")');
  assert.deepEqual(p.calls.shown, [], 'a card already offered is not shown again by a push');
  run(p, 'openDeepLink("spotter://ready/w-old?auto=1")');
  assert.deepEqual(p.calls.shown, ['w-old'], 'an unseen one is');
}
// A card this page has never seen: the row is read first, then the link followed.
{
  const p = page({ server: { 'w-shared': { id: 'w-shared', title: 'Shared in', ingest_status: 'ready', created_at: iso(10_000) } } });
  run(p, 'openLink("spotter://ready/w-shared")');
  assert.deepEqual(p.calls.fetched, ['w-shared'], 'one row, by id');
  await tick(); await tick();
  assert.deepEqual(p.calls.shown, ['w-shared'], 'then the sheet, for the card that just arrived');
}
{
  const p = page({ server: { 'w-shared': { id: 'w-shared', title: 'Shared in', ingest_status: 'ready', created_at: iso(10_000) } } });
  run(p, 'openLink("spotter://start/w-shared")');
  await tick(); await tick();
  assert.deepEqual(p.calls.started, ['w-shared'], 'Start Now on a card saved while the app slept starts it, not "no longer in Workouts"');
}
// Start Now with the ready sheet up: the session opens and the sheet goes.
{
  const p = page();
  p.open.sheets = ['readysheet'];
  run(p, 'openLink("spotter://start/w-new")');
  assert.deepEqual(p.calls.started, ['w-new']);
  assert(p.calls.closed.includes('readysheet'), 'the sheet does not stay over the session');
}
// A reminder or a tab link touches none of this.
{
  const p = page();
  run(p, 'openLink("spotter://tab/plan")');
  assert.deepEqual(p.calls.fetched, []);
  assert.deepEqual(p.calls.views, ['plan']);
}
// Opening the app: the newest unseen card from the last day, once — unless the
// open came with an errand of its own.
{
  const p = page();
  run(p, 'readyOnOpen()');
  await tick(); await tick();
  assert.deepEqual(p.calls.shown, ['w-new'], 'readyPick greets with the newest ready save');
  const q = page();
  run(q, 'linkAt = Date.now(); readyOnOpen()');
  await tick(); await tick();
  assert.deepEqual(q.calls.shown, [], 'not when a notification, a widget or a link opened the app');
}
// A burst greets once: the next open does not start with the second card of it.
{
  const store = {};
  const burst = () => [
    { id: 'b3', title: 'Third', ingest_status: 'ready', created_at: iso(30_000) },
    { id: 'b2', title: 'Second', ingest_status: 'ready', created_at: iso(60_000) },
    { id: 'b1', title: 'First', ingest_status: 'ready', created_at: iso(90_000) },
  ];
  const a = page({ store, workouts: burst() });
  run(a, 'readyOnOpen()');
  await tick(); await tick();
  assert.deepEqual(a.calls.shown, ['b3'], 'the newest of the burst');
  const b = page({ store, workouts: burst() });
  run(b, 'readyOnOpen()');
  await tick(); await tick();
  assert.deepEqual(b.calls.shown, [], 'one greeting per burst, not one per open');
}

console.log('PASS the ready card: CARD_READY registered at launch with Start Now and Plan It routed to start/ and ' +
  'ready/, the foreground hand-off (?auto=1), the payload and its fixtures, the sheet beside the others; ' +
  'once per card (kept, bounded), never over a set, waiting behind a sheet or a keyboard, not over its own card, ' +
  'a re-read keeps its line, a tap shows and moves what is in the way, an unseen card is read first, ' +
  'Start Now closes the sheet, and the open greets once (once per burst) unless it came with an errand.');

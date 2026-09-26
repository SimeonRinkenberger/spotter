// Pumpy's new-chat screen, run against the real app.ts over a fake DOM just big
// enough for it (no linkedom, so it runs in CI):
//
//   node tools/pumpy-fresh-harness.mjs
//
// 1. After five minutes away the page opens on a new chat; the old one stays in
//    Chats, nothing is written, and an answer still streaming, a proposal waiting
//    on a yes or no, or Pumpy opened from a card ("Ask Pumpy") keeps it.
// 2. The two bar buttons carry their words while the chat is empty and fold them
//    away on the first message.
// 3. The empty chat is the goal starters' (B.2), and the icons are the ones the owner asked for.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const APP = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const STYLE = fs.readFileSync('supabase/functions/spotter/style.ts', 'utf8');
const MARKUP = fs.readFileSync('supabase/functions/spotter/markup.ts', 'utf8');

function fn(name) {
  const head = '  function ' + name + '(';
  const a = APP.indexOf(head);
  assert(a >= 0, 'not found in app.ts: ' + name);
  const line = APP.slice(a, APP.indexOf('\n', a));
  if (line.trimEnd().endsWith('}')) return line;
  const b = APP.indexOf('\n  }\n', a);
  return APP.slice(a, b + 4);
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.cls = new Set(); this.attrs = {};
    this.textContent = ''; this.value = ''; this.style = {}; this.disabled = false; this.inert = false;
    this.scrollTop = 0; this.scrollHeight = 900; this.onclick = null; this.parentNode = null;
  }
  get className() { return [...this.cls].join(' '); }
  set className(v) { this.cls = new Set(String(v).split(' ').filter(Boolean)); }
  get classList() {
    const c = this.cls;
    return { add: (...x) => x.forEach((y) => c.add(y)), remove: (...x) => x.forEach((y) => c.delete(y)), contains: (x) => c.has(x),
      toggle: (x, on) => { const want = on === undefined ? !c.has(x) : !!on; if (want) c.add(x); else c.delete(x); return want; } };
  }
  appendChild(n) {
    if (n.tagName === '#FRAGMENT') { n.children.forEach((k) => { k.parentNode = this; this.children.push(k); }); n.children = []; return n; }
    n.parentNode = this; this.children.push(n); return n;
  }
  get firstChild() { return this.children[0] || null; }
  set innerHTML(v) { this.children = []; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  focus() {}
  all() { return this.children.flatMap((k) => [k, ...k.all()]); }
  find(cls) { return this.all().filter((k) => k.cls.has(cls)); }
}

function setup(opts = {}) {
  const ids = {};
  for (const id of ['pumpylog', 'pumpybar', 'pumpyview', 'pumpyinput', 'pumpysend', 'pumpyannounce', 'pumpyctx']) ids[id] = new El('div');
  const clock = { now: Date.parse('2026-09-24T16:00:00Z') };
  const timers = [], writes = [], sent = [];
  const FakeDate = function (...a) { return a.length ? new Date(...a) : new Date(clock.now); };
  FakeDate.now = () => clock.now; FakeDate.parse = Date.parse;
  const ctx = vm.createContext({
    console, JSON, Math, Object, Array, String, Number, Promise, isNaN, Date: FakeDate,
    document: { createDocumentFragment: () => new El('#fragment'), hidden: false },
    state: { user: { id: 'u1' }, view: opts.view || 'pumpy' },
    $: (id) => ids[id],
    el: (tag, cls, text) => { const n = new El(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; },
    isFree: () => false, lessMotion: () => true, NO_TOUCH: false, MAX_REFS: 6, PUMPY_CAPS: ['ask', 'program'], pumpyReset: null,
    pumpyArt: () => new El('span'), pumpyMark: () => new El('span'),
    renderPumpyCtx() {}, renderPumpyCredits() {}, guidePage() {}, guideLearn() {}, haptic() {},
    // B.2: the empty chat's goal starters draw themselves (goals-harness holds
    // goalStarters); Basic's free-plan state is not this harness's business.
    pumpyHello: () => { const n = new El('div'); n.className = 'pumpyhello'; return n; },
    freeProgram: () => null, setFree() {}, msgCards() {},
    renderMsg: (m) => { const n = new El('div'); n.className = 'msg ' + m.role; n.textContent = m.content || ''; return n; },
    setView: (v) => { ctx.state.view = v; ctx.opened = v; },
    absorbMeter() {}, liveEvent() {}, toast() {}, ensurePumpyMeter() {},
    apiStream: (path, payload, receive) => { sent.push(payload); ctx.receive = receive; return { then() { return { catch() {} }; } }; },
    // Any database write from the idle rule would be a thread row nobody asked for.
    sb: { from: (t) => { writes.push(t); throw new Error('no database call expected: ' + t); } },
    setTimeout: (f, ms) => { const t = { f, ms, at: clock.now + ms }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cancelled = true; },
  });
  const names = ['pumpyLastAt', 'pumpyHolds', 'pumpyStale', 'freshenPumpy', 'pumpyAway', 'pumpyBack', 'pumpyBlank',
    'cancelPumpyReset', 'newPumpyThread', 'settlePumpy', 'lastRefs', 'openPumpy', 'renderPumpy', 'sendPumpy'];
  vm.runInContext('var PUMPY_IDLE = ' + /var PUMPY_IDLE = ([^,;]+)/.exec(APP)[1] + ', pumpyIdleTimer = 0;\n' +
    'var pumpy = { thread: null, messages: [], busy: false, refs: [], refsRev: 0, loaded: false, meter: null, live: null, stick: true, wired: true };\n' +
    names.map(fn).join('\n'), ctx);
  // Out of the vm as plain data: its arrays have their own prototype.
  const run = (code) => { const v = vm.runInContext(code, ctx); return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v; };
  const ago = (ms) => new Date(clock.now - ms).toISOString();
  const bar = ids.pumpybar, log = ids.pumpylog;
  return { ctx, run, clock, timers, writes, sent, ago, bar, log, ids };
}

const MIN = 60000;
let checks = 0;
function test(name, work) { work(); checks++; console.log('PASS', name); }

// A conversation as loadPumpy hands it over: the newest thread with its messages.
function thread(x, lastAgo, extra) {
  return { id: 't-old', title: 'Leg day ideas', updated_at: x.ago(lastAgo), workout_id: null, pumpy_messages: [
    { id: 1, role: 'user', content: 'What should I add to leg day?', created_at: x.ago(lastAgo + 30000) },
    Object.assign({ id: 2, role: 'assistant', content: 'Walking lunges.', created_at: x.ago(lastAgo) }, extra || {}),
  ] };
}

test('the empty chat opens on the goal starters (B.2): the four fixed asks are retired', () => {
  const x = setup();
  assert(!/QUICK_ASKS/.test(APP), 'no QUICK_ASKS left in app.ts');
  x.run('settlePumpy(null)');
  assert.equal(x.log.find('pumpyhello').length, 1, 'pumpyHello draws the empty chat');
});

test('opening Pumpy on a conversation quiet for more than five minutes shows a new chat', () => {
  const x = setup();
  x.run('settlePumpy(' + JSON.stringify(thread(x, 5 * MIN + 1000)) + ')');
  assert.equal(x.run('pumpy.thread'), null, 'the old one is not opened');
  assert.equal(x.run('pumpy.messages.length'), 0);
  assert(x.log.find('pumpyhello').length, 'the greeting is on the page');
  assert.equal(x.writes.length, 0, 'and nothing was written: no empty thread row');
});

test('under five minutes the conversation is still the one on the page', () => {
  const x = setup();
  x.run('settlePumpy(' + JSON.stringify(thread(x, 5 * MIN - 1000)) + ')');
  assert.equal(x.run('pumpy.thread.id'), 't-old');
  assert.equal(x.run('pumpy.messages.length'), 2);
});

test('the rule follows the last message sent or received, not the thread row', () => {
  const x = setup();
  const t = thread(x, 30 * MIN);
  t.updated_at = x.ago(10 * 1000);   // a rename, say: not a message
  x.run('settlePumpy(' + JSON.stringify(t) + ')');
  assert.equal(x.run('pumpy.thread'), null);
});

test('a proposal waiting on a yes or no keeps the chat, however long ago', () => {
  const x = setup();
  x.run('settlePumpy(' + JSON.stringify(thread(x, 2 * 60 * MIN,
    { meta: { proposal: { kind: 'create_workout' }, status: 'pending' } })) + ')');
  assert.equal(x.run('pumpy.thread.id'), 't-old');
  assert.equal(x.run('freshenPumpy()'), false);
  // Answered, it no longer holds anything.
  const y = setup();
  y.run('settlePumpy(' + JSON.stringify(thread(y, 2 * 60 * MIN,
    { meta: { proposal: { kind: 'create_workout' }, status: 'done' } })) + ')');
  assert.equal(y.run('pumpy.thread'), null);
});

test('an answer still streaming is never replaced', () => {
  const x = setup();
  x.run('settlePumpy(' + JSON.stringify(thread(x, 1000)) + ')');
  x.run('sendPumpy("And a warm-up?")');
  x.clock.now += 20 * MIN;   // a very slow answer, or a phone in a pocket
  assert.equal(x.run('pumpy.busy'), true);
  assert.equal(x.run('freshenPumpy()'), false);
  assert.equal(x.run('pumpy.thread.id'), 't-old');
  x.run('pumpy.live = {}; pumpy.busy = false');
  assert.equal(x.run('freshenPumpy()'), false, 'a live row counts too');
});

test('"Ask Pumpy" from a card keeps the conversation and puts the card on it', () => {
  const x = setup({ view: 'library' });
  x.run('settlePumpy(' + JSON.stringify(thread(x, 4 * MIN)) + ')');
  x.clock.now += 20 * MIN;   // stale by now
  x.run('openPumpy({ id: "w-card" })');
  assert.equal(x.ctx.opened, 'pumpy');
  assert.equal(x.run('freshenPumpy()'), false, 'the opening counts as the latest moment');
  assert.equal(x.run('pumpy.thread.id'), 't-old');
  assert.deepEqual(x.run('pumpy.refs'), ['w-card']);
  // It is a moment, not a pin: five minutes after it the rule applies again.
  x.clock.now += 5 * MIN + 1000;
  assert.equal(x.run('freshenPumpy()'), true);
});

test('this session\'s own sends and replies count as activity', () => {
  const x = setup();
  x.run('settlePumpy(' + JSON.stringify(thread(x, 4 * MIN)) + ')');
  x.run('sendPumpy("One more thing")');
  x.ctx.receive({ t: 'final', status: 'ok', thread_id: 't-old', messages: [{ id: 5, role: 'assistant', content: 'Sure.' }] });
  x.clock.now += 4 * MIN;
  assert.equal(x.run('freshenPumpy()'), false, 'four minutes after the reply');
  x.clock.now += 1 * MIN + 1000;
  assert.equal(x.run('freshenPumpy()'), true, 'five after it');
});

test('away on another tab, the chat is swapped when the time comes, off screen', () => {
  const x = setup({ view: 'library' });
  x.run('settlePumpy(' + JSON.stringify(thread(x, 2 * MIN)) + ')');
  x.run('pumpyAway()');
  assert.equal(x.run('pumpy.thread.id'), 't-old');
  const t = x.timers.filter((k) => !k.cancelled).at(-1);
  assert(t && Math.abs(t.ms - (3 * MIN + 250)) < 50, 'scheduled for the five-minute mark, got ' + (t && t.ms));
  x.clock.now = t.at; t.f();
  assert.equal(x.run('pumpy.thread'), null, 'swapped while nobody was looking');
  assert.equal(x.ids.pumpyview.scrollTop, 0);
  // On the Pumpy page itself the timer does nothing: a reader is not interrupted.
  const y = setup({ view: 'pumpy' });
  y.run('settlePumpy(' + JSON.stringify(thread(y, 2 * MIN)) + ')');
  y.run('pumpyAway()');
  y.clock.now += 10 * MIN;
  assert.equal(y.run('pumpy.thread.id'), 't-old');
  // Coming back to the app on the Pumpy page is going back to Pumpy.
  y.run('pumpyBack()');
  assert.equal(y.run('pumpy.thread'), null);
});

test('a new chat sends without a thread id: the row is made by the first message', () => {
  const x = setup();
  x.run('settlePumpy(' + JSON.stringify(thread(x, 30 * MIN)) + ')');
  x.run('sendPumpy("Build me a push day")');
  assert.equal(x.sent.at(-1).thread_id, null);
  assert.equal(x.writes.length, 0);
});

test('labels: on the empty chat, folded by the first message, back on New chat', () => {
  const x = setup();
  x.run('renderPumpy()');
  assert.equal(x.bar.classList.contains('labelled'), false, 'not before the first fetch has said the chat is empty');
  x.run('settlePumpy(null)');
  assert.equal(x.bar.classList.contains('labelled'), true, 'empty chat: words beside the icons');
  x.run('sendPumpy("Plan my week")');
  assert.equal(x.bar.classList.contains('labelled'), false, 'the first message folds them');
  x.ctx.receive({ t: 'final', status: 'ok', thread_id: 't-new', messages: [{ id: 7, role: 'assistant', content: 'Here is a plan.' }] });
  assert.equal(x.bar.classList.contains('labelled'), false, 'and a conversation keeps them folded');
  x.run('newPumpyThread()');
  assert.equal(x.bar.classList.contains('labelled'), true, 'New chat brings them back');
  const y = setup();
  y.run('settlePumpy(' + JSON.stringify(thread(y, 1000)) + ')');
  assert.equal(y.bar.classList.contains('labelled'), false, 'a loaded conversation opens folded');
});

test('style and markup: the icons, the words, the motion', () => {
  const bar = /<div class="pumpybar" id="pumpybar">([\s\S]*?)<\/div>/.exec(MARKUP);
  assert(bar, 'the bar has its id');
  assert.match(bar[1], /id="pumpychats"[^>]*aria-label="Chats"><svg class="ic"><use href="#i-chats"><\/use><\/svg><span class="pblabel" aria-hidden="true">Chats<\/span>/);
  assert.match(bar[1], /id="pumpynew"[^>]*aria-label="New chat"><svg class="ic"><use href="#i-compose"><\/use><\/svg><span class="pblabel" aria-hidden="true">New chat<\/span>/);
  // Lucide square-pen and message-circle (ISC), stroked by the sprite's .ic rule.
  assert(MARKUP.includes('<symbol id="i-compose" viewBox="0 0 24 24"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>'));
  assert(MARKUP.includes('<symbol id="i-chats" viewBox="0 0 24 24"><path d="M2.992 16.342'));
  assert.match(STYLE, /\.pumpybar button \{ min-width: 44px; height: 44px;/, '44px targets');
  assert.match(STYLE, /\.pblabel \{[^}]*max-width: 0;[^}]*opacity: 0;[^}]*transition: max-width var\(--t-3\) var\(--e-soft\)/);
  assert.match(STYLE, /\.pumpybar\.labelled \.pblabel \{[^}]*opacity: 1;[^}]*var\(--e-out\)/);
  assert.match(STYLE, /prefers-reduced-motion: reduce\) \{\s*\.pumpybar button \{ transition: none; \}\s*\.pblabel, \.pumpybar\.labelled \.pblabel \{ transition: opacity/);
});

console.log('PASS Pumpy new-chat screen: ' + checks + ' groups (five-minute rule with its three exceptions, no empty thread row, labels fold on the first message, goal starters, icons)');

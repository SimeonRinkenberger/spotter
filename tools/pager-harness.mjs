// Offline checks for the tab pager (Workouts · Train · Pumpy): a sideways drag on
// every page turns it, and a drag that belongs to something else does not. Run
// against the real source:
//
//   node tools/pager-harness.mjs
//
// The pager section of app.ts ("the pager" through "the tab bar") is lifted out
// whole and run in a vm over a fake DOM just big enough for it — pages, a chip
// row, the week bar, the search field, a swipe row in the card overlay — with
// the clock, the animation frames and the timers driven by hand, so "the spring
// settled on Train" is a step in a test and not a sleep.
//
// A drag that never hears its end used to switch the pager off until the app
// was killed, so every way the phone can take a touch away (a render, the app
// sent away, a system sheet, a cancel, plain silence) is a case below that has
// to let go of the drag and leave the next swipe working.
//
// What no harness can reach is WebKit's side of the gesture: whether a page's
// own UIScrollView begins a pan (and cancels our pointer) before the drag has
// locked. On the iPhone 16e simulator it did not, but the CSS that keeps a page
// from ever scrolling sideways is asserted here as text, in the source and in
// the built page, where it cannot quietly go.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const APP = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const STYLE = fs.readFileSync('supabase/functions/spotter/style.ts', 'utf8');
const PAGE = fs.readFileSync('docs/index.html', 'utf8');

function between(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  assert(i >= 0 && j > i, 'section not found in app.ts: ' + a);
  return src.slice(i, j);
}
// A top-level function, one-liners included.
function fn(name) {
  const head = '  function ' + name + '(';
  const a = APP.indexOf(head);
  assert(a >= 0, 'not found in app.ts: ' + name);
  const b = APP.indexOf('\n  }\n', a);
  return APP.slice(a, b + 4);
}
const PAGER = between(APP, '  // ---------- the pager ----------', '  // ---------- the frame ----------');

// ---------- the fake DOM ----------
let T = 0;
class El {
  constructor(tag, opts = {}) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.attrs = {};
    this.on = {}; this.cls = new Set(); this.id = ''; this.inert = false; this.tabIndex = -1;
    this.css = { overflowX: 'visible', overflowY: 'visible' };
    this.scrollWidth = 0; this.clientWidth = 0; this.scrollLeft = 0;
    this.scrollHeight = 0; this.clientHeight = 0; this.scrollTop = 0; this.height = 0;
    this.captured = null;
    const self = this;
    this.style = { transform: '', props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; } };
    this.classList = {
      add: (...c) => c.forEach((x) => self.cls.add(x)), remove: (...c) => c.forEach((x) => self.cls.delete(x)),
      contains: (x) => self.cls.has(x),
      toggle: (x, on) => { const want = on === undefined ? !self.cls.has(x) : !!on; if (want) self.cls.add(x); else self.cls.delete(x); return want; }
    };
    Object.assign(this, opts);
  }
  set className(v) { this.cls = new Set(String(v).split(' ').filter(Boolean)); }
  get className() { return [...this.cls].join(' '); }
  add(...kids) { kids.forEach((k) => { k.parentElement = this; this.children.push(k); }); return this; }
  remove() { if (this.parentElement) { const p = this.parentElement; p.children = p.children.filter((c) => c !== this); } this.parentElement = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener(t, f, o) { (this.on[t] = this.on[t] || []).push({ f, passive: !!(o && o.passive) }); }
  removeEventListener(t, f) { this.on[t] = (this.on[t] || []).filter((l) => l.f !== f); }
  getBoundingClientRect() { return { height: this.height, width: this.clientWidth, top: 0, left: 0 }; }
  setPointerCapture(id) { this.captured = id; }
  releasePointerCapture() { this.captured = null; }
  focus() {}
  scrollTo(o) { this.scrollTop = o.top; }
  matches(sel) {
    return sel.split(',').map((s) => s.trim()).some((s) => {
      if (/^\[[\w-]+\]$/.test(s)) return this.hasAttribute(s.slice(1, -1));
      const m = s.match(/^([a-z]*)((?:[.#][\w-]+)*)$/i);
      if (!m) throw new Error('fake DOM cannot match ' + s);
      if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
      return (m[2].match(/[.#][\w-]+/g) || []).every((p) => p[0] === '.' ? this.cls.has(p.slice(1)) : this.id === p.slice(1));
    });
  }
  closest(sel) { for (let n = this; n; n = n.parentElement) if (n.matches(sel)) return n; return null; }
  all(sel) { const out = []; const walk = (n) => n.children.forEach((c) => { if (c.matches(sel)) out.push(c); walk(c); }); walk(this); return out; }
  querySelector(sel) { return this.all(sel)[0] || null; }
  querySelectorAll(sel) { return this.all(sel); }
}
const mk = (tag, cls, opts) => { const n = new El(tag, opts); if (cls) n.className = cls; return n; };

function build() {
  const doc = mk('html');
  const body = mk('body'); doc.add(body);
  const app = mk('div', '', { id: 'app' });
  const header = mk('header', '', { height: 92 });
  const tabbar = mk('nav', 'tabbar', { height: 78 });
  const tabs = [0, 1, 2].map((i) => mk('button', i ? 'tab' : 'tab active', { id: 'tab' + i }));
  tabbar.add(...tabs);
  header.add(...[0, 1, 2, 0, 1, 2].map(() => mk('span', 'ts')));
  const searchwrap = mk('div', 'searchwrap', { id: 'searchwrap' });
  const search = mk('input', '', { id: 'search' });
  searchwrap.add(search);
  const pages = mk('div', 'pages', { id: 'pages', clientWidth: 390 });
  const track = mk('div', 'track', { id: 'track' });
  // Every page scrolls (the owner's do): 2000px of content in a 700px window.
  const page = (id) => mk('div', 'page', { id, clientWidth: 390, scrollWidth: 390, clientHeight: 700, scrollHeight: 2000,
    css: { overflowX: 'hidden', overflowY: 'auto' } });
  const lib = page('libpage'), train = page('trainview'), pumpy = page('pumpyview');
  const card = mk('div', 'card'); const cardArt = mk('div', 'noimg'); card.add(cardArt);
  // A chip row with somewhere to go: 800px of chips in a 354px strip.
  const chips = mk('div', 'chips', { clientWidth: 354, scrollWidth: 800, css: { overflowX: 'auto', overflowY: 'hidden' } });
  const chip = mk('button', 'chip'); chips.add(chip);
  lib.add(searchwrap, chips, card);
  const weekbar = mk('div', 'wstrip'); weekbar.setAttribute('data-noswipe', '');
  const wday = mk('button', 'wday'); weekbar.add(wday);
  const planrow = mk('div', 'daycard');
  train.add(weekbar, planrow);
  const bubble = mk('div', 'msg'); const composer = mk('textarea', '', { id: 'pumpyinput' });
  pumpy.add(bubble, composer);
  track.add(lib, train, pumpy); pages.add(track);
  app.add(header, pages, tabbar);
  // The card overlay, a sibling of #app, with a swipe-to-delete row in it.
  const detail = mk('div', 'overlay', { id: 'detail' });
  const exrow = mk('div', 'exrow delete-swipe'); const exmain = mk('div', 'exmain'); exrow.add(exmain); detail.add(exrow);
  const workout = mk('div', '', { id: 'workout' });
  const sheet = mk('div', 'sheet', { id: 'settingssheet' });
  body.add(app, detail, workout, sheet);
  const byId = {};
  const index = (n) => { if (n.id) byId[n.id] = n; n.children.forEach(index); };
  index(doc);
  return { doc, body, app, header, tabbar, tabs, pages, track, lib, train, pumpy, card, cardArt, chips, chip,
    weekbar, wday, planrow, bubble, composer, search, detail, exrow, exmain, workout, sheet, byId };
}

function world(opts = {}) {
  const d = build();
  T = 1000;
  const frames = [], timers = [];
  const docListeners = {};
  const document = {
    querySelector: (s) => d.doc.querySelector(s), querySelectorAll: (s) => d.doc.querySelectorAll(s),
    addEventListener: (t, f) => { (docListeners[t] = docListeners[t] || []).push(f); },
    removeEventListener: (t, f) => { docListeners[t] = (docListeners[t] || []).filter((x) => x !== f); },
    documentElement: mk('html')
  };
  const winListeners = {};
  const window = {
    performance: { now: () => T },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener: (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); },
    navigator: { standalone: false }, innerWidth: 390
  };
  const sandbox = {
    Math, String, Number, JSON, Object, Array, Date, console,
    window, document,
    $: (id) => d.byId[id] || null,
    getComputedStyle: (n) => n.css,
    requestAnimationFrame: (f) => { frames.push(f); return frames.length; },
    cancelAnimationFrame: (id) => { if (id) frames[id - 1] = null; },
    setTimeout: (f, ms) => { timers.push({ f, at: T + (ms || 0) }); return timers.length; },
    clearTimeout: (id) => { if (id) timers[id - 1] = null; },
    ResizeObserver: function () { return { observe() {}, disconnect() {} }; },
    native: opts.native ? { keyboardVisible: false, keyboardMoving: false } : null,
    state: { view: 'library', user: { id: 'u' } },
    guide: { visit: null }, pumpyReset: false, ptrPulling: false,
    drawn: {}, heroPct: 0, planSig: '', statsCounted: false, trainSeg: null, trainLean: null, trainSwap: false,
    guideClear() {}, guideStill() {}, guidePage() {}, haptic() {}, renderToday() {}, countStats() {},
    restorePlan() {}, prepareTrain() {}, quietly() {}, loadPumpy() {}, renderPumpy() {}, paintSeg() {}, drawTrainBody() {},
    // The Pumpy new-chat clock (gtm-owner-ux): setView starts it when Pumpy is left.
    pumpyAway() {}, pumpyBack() {}, freshenPumpy() {}, pumpyIdleTimer: 0
  };
  vm.createContext(sandbox);
  vm.runInContext('(function () {\n' + fn('overlayShowing') + fn('standalone') + PAGER +
    '\n  this.h = { idx: function () { return idx; }, pos: function () { return pos; }, held: function () { return drag; },' +
    ' measure: measureChrome, setView: setView };\n}).call(this);', sandbox);
  const h = sandbox.h;
  h.measure();

  // Frames and timers at 60 Hz until nothing is left to run: the spring lands.
  function run(ms = 1500) {
    const end = T + ms;
    while (T < end) {
      T += 16;
      const q = frames.splice(0); q.forEach((f) => f && f(T));
      timers.forEach((t, i) => { if (t && t.at <= T) { timers[i] = null; t.f(); } });
    }
  }
  // Pointer events go to the node the finger went down on until something
  // captures them — which is how WebKit addresses a touch, and why a node
  // taken out of the page mid-touch takes its pointerup with it.
  function fire(target, type, e) {
    const ev = Object.assign({ type, target, cancelable: true, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }, e);
    for (let n = target; n; n = n.parentElement) (n.on[type] || []).forEach((l) => l.f.call(n, ev));
    return ev;
  }
  let nextId = 1;
  // A drag of (dx, dy) over `ms`, one move a frame, a touchmove after each
  // pointermove as the engines order them. Returns what the touchmoves were told.
  function drag(target, dx, dy, o = {}) {
    const id = nextId++, x0 = o.x ?? (dx < 0 ? 330 : 60), y0 = o.y ?? 400, steps = Math.max(1, Math.round((o.ms ?? 200) / 16));
    const base = { pointerType: 'touch', pointerId: id, isPrimary: o.primary ?? true };
    fire(target, 'pointerdown', { ...base, clientX: x0, clientY: y0 });
    let prevented = 0, to = target;
    for (let i = 1; i <= steps; i++) {
      T += 16;
      const q = frames.splice(0); q.forEach((f) => f && f(T));
      to = d.pages.captured === id ? d.pages : target;
      fire(to, 'pointermove', { ...base, clientX: x0 + dx * i / steps, clientY: y0 + dy * i / steps });
      if (fire(target, 'touchmove', {}).defaultPrevented) prevented++;
    }
    if (o.lose) return { prevented };   // the lift never arrives
    to = d.pages.captured === id ? d.pages : target;
    fire(to, 'pointerup', { ...base, clientX: x0 + dx, clientY: y0 + dy });
    run();
    return { prevented };
  }
  const page = () => h.idx();
  const tab = () => d.tabs.findIndex((t) => t.cls.has('active'));
  // An event on the window or the document, the way the phone raises them when
  // something takes the screen away from the page.
  function emit(where, type, e = {}) {
    const ev = Object.assign({ type, detail: {} }, e);
    ((where === 'document' ? docListeners : winListeners)[type] || []).forEach((f) => f(ev));
  }
  // Time passing with no frames or timers run: what a throttled or suspended
  // page does to setTimeout.
  function idle(ms) { T += ms; }
  return { d, h, run, drag, fire, page, tab, emit, idle };
}

let checks = 0, failed = 0;
function ok(what, f) {
  try { f(); checks++; console.log('  ok  ' + what); }
  catch (err) { failed++; console.log('  FAIL ' + what + '\n       ' + String(err.message).split('\n')[0]); }
}

for (const mode of ['native shell', 'browser tab']) {
  const native = mode === 'native shell';
  console.log('a sideways drag turns every page (' + mode + ')');

  ok('Workouts → Train → Pumpy → Train → Workouts, one page a swipe, tab bar agreeing', () => {
    const w = world({ native });
    assert.equal(w.page(), 0);
    w.drag(w.d.cardArt, -260, 6); assert.equal(w.page(), 1, 'Workouts → Train'); assert.equal(w.tab(), 1);
    w.drag(w.d.planrow, -260, -4); assert.equal(w.page(), 2, 'Train → Pumpy'); assert.equal(w.tab(), 2);
    w.drag(w.d.bubble, 260, 5); assert.equal(w.page(), 1, 'Pumpy → Train');
    w.drag(w.d.planrow, 260, 0); assert.equal(w.page(), 0, 'Train → Workouts'); assert.equal(w.tab(), 0);
    assert.equal(w.h.pos(), 0, 'the track lands exactly on the page');
    assert.equal(w.d.train.inert, true, 'pages nobody is on stay inert');
  });

  ok('the lock holds the touch: every touchmove after it is prevented', () => {
    const w = world({ native });
    const r = w.drag(w.d.cardArt, -260, 0);
    assert(r.prevented >= 10, 'prevented ' + r.prevented + ' of 13');
  });

  ok('a thumb\'s arc (30° off the line) on a page that can scroll still turns it', () => {
    const w = world({ native });
    w.drag(w.d.cardArt, -220, -127);
    assert.equal(w.page(), 1);
  });

  ok('a slow drag past two fifths commits; a quick short flick commits; a small nudge springs back', () => {
    let w = world({ native });
    w.drag(w.d.cardArt, -170, 0, { ms: 1200 }); assert.equal(w.page(), 1, 'slow 44%');
    w = world({ native });
    w.drag(w.d.cardArt, -60, 0, { ms: 80 }); assert.equal(w.page(), 1, 'flick');
    w = world({ native });
    w.drag(w.d.cardArt, -60, 0, { ms: 1200 }); assert.equal(w.page(), 0, 'nudge');
  });

  ok('a mostly vertical drag is the page scrolling, not a page turn', () => {
    const w = world({ native });
    const r = w.drag(w.d.cardArt, -60, -300);
    assert.equal(w.page(), 0); assert.equal(r.prevented, 0, 'the scroll is left alone');
  });

  console.log('a drag that belongs to something else does not turn a page (' + mode + ')');

  ok('a chip row with room to scroll keeps the drag; at its end it hands it on', () => {
    let w = world({ native });
    const r = w.drag(w.d.chip, -260, 0);
    assert.equal(w.page(), 0); assert.equal(r.prevented, 0, 'the row scrolls natively');
    w = world({ native });
    w.d.chips.scrollLeft = 800 - 354;   // at its end, finger still going left
    w.drag(w.d.chip, -260, 0);
    assert.equal(w.page(), 1);
  });

  ok('the week bar (data-noswipe) steps the week and never the page', () => {
    const w = world({ native });
    w.h.setView('train'); w.run();
    assert.equal(w.page(), 1);
    const r = w.drag(w.d.wday, -260, 0);
    assert.equal(w.page(), 1); assert.equal(r.prevented, 0);
    w.drag(w.d.wday, 260, 0);
    assert.equal(w.page(), 1);
  });

  ok('a field (the search, Pumpy\'s composer) is never a place a swipe starts', () => {
    const w = world({ native });
    w.drag(w.d.search, -260, 0); assert.equal(w.page(), 0);
    w.h.setView('pumpy'); w.run();
    w.drag(w.d.composer, 260, 0); assert.equal(w.page(), 2);
  });

  ok('a swipe row in the open card overlay deletes, it does not page — nor does any drag under an overlay', () => {
    const w = world({ native });
    w.d.detail.classList.add('open');
    w.drag(w.d.exmain, -260, 0); assert.equal(w.page(), 0, 'the row is outside the pages');
    w.drag(w.d.cardArt, -260, 0); assert.equal(w.page(), 0, 'the pager defers to the overlay');
    w.d.detail.classList.remove('open');
    w.d.sheet.classList.add('open');
    w.drag(w.d.cardArt, -260, 0); assert.equal(w.page(), 0, 'or to a sheet');
    w.d.sheet.classList.remove('open');
    w.drag(w.d.cardArt, -260, 0); assert.equal(w.page(), 1, 'and pages again once it is gone');
  });

  ok(native ? 'installed, the left edge is the pager\'s too' : 'in a tab, the left 24px are Safari\'s back gesture', () => {
    const w = world({ native });
    w.h.setView('train'); w.run();
    w.drag(w.d.planrow, 260, 0, { x: 10 });
    assert.equal(w.page(), native ? 0 : 1);
  });

  console.log('a lost end does not strand the pager (' + mode + ')');

  ok('the node under the finger is re-rendered away mid-touch: the next swipe still pages', () => {
    const w = world({ native });
    w.drag(w.d.cardArt, -4, 0, { lose: true });   // down, a twitch under the slop
    w.d.card.remove();                             // a render replaces the card
    w.fire(w.d.cardArt, 'pointerup', { pointerType: 'touch', pointerId: 99, isPrimary: true, clientX: 326, clientY: 400 });
    assert(w.h.held(), 'the drag is still held: the lift went to a detached node');
    w.drag(w.d.lib, -260, 0);                      // the next swipe, anywhere on Workouts
    assert.equal(w.page(), 1);
  });

  ok('a drag left locked mid-track settles on the nearest page when the next touch lands', () => {
    const w = world({ native });
    w.drag(w.d.cardArt, -150, 0, { lose: true, ms: 300 });
    assert(w.h.held() && w.h.held().lock);
    w.drag(w.d.cardArt, -2, 0, { ms: 32 });        // a tap
    assert.equal(w.page(), 0, 'settled back on Workouts, 38% across');
    assert.equal(w.h.pos(), 0);
  });

  ok('a second finger joining a drag is not a new drag', () => {
    const w = world({ native });
    w.drag(w.d.cardArt, -150, 0, { lose: true, ms: 300 });
    const held = w.h.held();
    w.fire(w.d.cardArt, 'pointerdown', { pointerType: 'touch', pointerId: 500, isPrimary: false, clientX: 200, clientY: 300 });
    assert.equal(w.h.held(), held);
  });

  // Each way the phone can take a touch away without its end reaching .pages.
  // A drag left 38% across the track, its lift lost: the trigger alone has to
  // let go of it and settle the track, before any new touch lands — and the
  // swipe after it has to page.
  const away = [
    ['the app sent to the background (visibilitychange)', (w) => w.emit('document', 'visibilitychange')],
    ['the app coming back (visibilitychange)', (w) => w.emit('document', 'visibilitychange')],
    ['Notification Centre, Control Centre or an alert over it (window blur)', (w) => w.emit('window', 'blur')],
    ['the shell going inactive (spotter:native-state)', (w) => w.emit('window', 'spotter:native-state', { detail: { isActive: false } })],
    ['a page restored from the back-forward cache (pageshow)', (w) => w.emit('window', 'pageshow')],
    ['a touchcancel whose pointercancel never reached .pages', (w) => w.emit('window', 'touchcancel')]
  ];
  for (const [what, trigger] of away) {
    ok(what + ': the held drag is let go, the track settles, the next swipe pages', () => {
      const w = world({ native });
      w.drag(w.d.cardArt, -150, 0, { lose: true, ms: 300 });
      assert(w.h.held() && w.h.held().lock, 'set-up: a locked drag whose end was lost');
      trigger(w);
      assert.equal(w.h.held(), null, 'still held after the trigger');
      w.run();
      // Settled on a page. A cancel ends a drag on a lift's terms, so this one,
      // still moving when it was cut off, may carry on to Train; the rest land
      // on the page nearest the track.
      const at = w.page();
      assert.equal(w.h.pos(), at * 390, 'the track is not left between pages');
      if (!/touchcancel/.test(what)) assert.equal(at, 0, 'settled back on Workouts, 38% across');
      w.drag(at === 0 ? w.d.cardArt : w.d.planrow, -260, 0);
      assert.equal(w.page(), at + 1, 'the next swipe pages');
    });
  }

  ok('two seconds with no word from the pointer: an unlocked drag is let go on its own', () => {
    let w = world({ native });
    w.drag(w.d.cardArt, -4, 0, { lose: true });     // a touch that never locked
    w.run(1900);
    assert(w.h.held(), 'still held at 1.9 s: a resting finger is a finger');
    w.run(300);
    assert.equal(w.h.held(), null, 'let go by 2.2 s');
  });

  ok('a drag that has locked sideways is never let go by the clock; the next touch lets it go and pages', () => {
    const w = world({ native });
    w.drag(w.d.cardArt, -150, 0, { lose: true, ms: 300 });
    w.run(5000);
    assert(w.h.held() && w.h.held().lock, 'a page held half-turned stays held, however still');
    // The lift was lost; the next first finger is the proof, and that swipe pages.
    w.drag(w.d.cardArt, -260, 0);
    assert.equal(w.h.held(), null);
    assert.equal(w.page(), 1, 'the next swipe pages');
  });

  ok('a slow drag that keeps moving is never cut off by the two seconds', () => {
    const w = world({ native });
    const r = w.drag(w.d.cardArt, -180, 0, { ms: 3200 });
    assert(r.prevented > 150, 'held for the whole drag');
    assert.equal(w.page(), 1);
  });

  ok('an engine that still counts the lost touch as down: a later finger, even a non-primary one, pages', () => {
    const w = world({ native });
    w.drag(w.d.cardArt, -4, 0, { lose: true });
    w.idle(2100);                                   // timers throttled: the watchdog has not run
    w.drag(w.d.cardArt, -260, 0, { primary: false });
    assert.equal(w.page(), 1);
  });
}

console.log('the CSS that keeps WebKit from taking the drag');

function rule(src, sel) {
  const esc = sel.split(',').map((s) => s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*,\\s*');
  const re = new RegExp('(?:^|[}\\s])' + esc + '\\s*\\{([^}]*)\\}');
  const m = src.match(re);
  assert(m, 'rule not found: ' + sel);
  return m[1].replace(/\s+/g, ' ');
}

for (const [where, src] of [['style.ts', STYLE], ['docs/index.html', PAGE]]) {
  ok(where + ': a page cannot scroll sideways and hands sideways drags to its parent', () => {
    const p = rule(src, '.page');
    assert.match(p, /overflow-x: ?hidden/);
    assert.match(p, /overflow-y: ?auto/);
    assert.match(p, /overscroll-behavior-x: ?auto/, 'contain here is transfersHorizontalScrollingToParent = NO on the phone');
    assert.match(p, /overscroll-behavior-y: ?contain/);
    assert.doesNotMatch(p, /overscroll-behavior: ?(contain|none)/);
    assert.doesNotMatch(p, /touch-action/);
  });
  ok(where + ': .pages declares no touch-action, and the root stops sideways overscroll', () => {
    assert.doesNotMatch(rule(src, '.pages'), /touch-action/);
    assert.match(rule(src, 'html, body'), /overscroll-behavior: ?none/);
  });
}

ok('app.ts: the touchmove that holds a locked drag is non-passive', () => {
  assert.match(PAGER, /pagesEl\.addEventListener\("touchmove", function \(e\) \{\s*if \(drag && drag\.lock && e\.cancelable\) e\.preventDefault\(\);\s*\}, \{ passive: false \}\);/);
});

console.log('\n' + checks + ' pager checks passed' + (failed ? ', ' + failed + ' FAILED.' : '.'));
if (failed) process.exitCode = 1;

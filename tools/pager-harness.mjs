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
// to let go of the drag and leave the next swipe working. The week bar, a sheet
// pushed down and Workout Mode's exercise swipe hold a touch the same way and
// take the same releases; they are wired onto the fake DOM too (gestures: true).
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
const PAGE = fs.readFileSync('web-dist/index.html', 'utf8');

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
  get firstChild() { return this.children[0] || null; }
  get nextSibling() { const p = this.parentElement; return p ? p.children[p.children.indexOf(this) + 1] || null : null; }
  get isConnected() { let n = this; while (n.parentElement) n = n.parentElement; return n.tagName === 'HTML'; }
  insertBefore(n, ref) {
    if (n.parentElement) n.remove();
    n.parentElement = this;
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at < 0) this.children.push(n); else this.children.splice(at, 0, n);
    return n;
  }
  removeChild(n) { n.remove(); return n; }
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
      // A descendant selector: the last part here, the rest on the way up.
      const parts = s.split(/\s+/);
      if (parts.length > 1) {
        if (!this.matches(parts.pop())) return false;
        let n = this.parentElement;
        for (let i = parts.length - 1; i >= 0; i--) {
          while (n && !n.matches(parts[i])) n = n.parentElement;
          if (!n) return false;
          n = n.parentElement;
        }
        return true;
      }
      if (/^\[[\w-]+\]$/.test(s)) return this.hasAttribute(s.slice(1, -1));
      const av = s.match(/^\[([\w-]+)=([\w-]+)\]$/);
      if (av) return this.getAttribute(av[1]) === av[2];
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
  // The app's order since Option B: Train first, then Workouts, then Pumpy.
  track.add(train, lib, pumpy); pages.add(track);
  app.add(header, pages, tabbar);
  // The card overlay, a sibling of #app, with a swipe-to-delete row in it.
  const detail = mk('div', 'overlay', { id: 'detail' });
  const exrow = mk('div', 'exrow delete-swipe'); const exmain = mk('div', 'exmain'); exrow.add(exmain); detail.add(exrow);
  const workout = mk('div', '', { id: 'workout' });
  // Workout Mode's swipe surface, and the week's lean and title the week bar moves.
  const wmain = mk('div', 'wmain', { id: 'wmain', offsetWidth: 390 }); const wset = mk('button', 'wset'); wmain.add(wset);
  workout.add(wmain);
  weekbar.offsetWidth = 390;
  const trainlean = mk('div', 'trainlean'), wtitle = mk('div', 'wbtitle');
  train.add(trainlean, wtitle);
  // A sheet: its body, the grabber band, a button, and a list of its own that scrolls.
  const sheet = mk('div', 'sheet', { id: 'settingssheet' });
  const sbody = mk('div', 'sheetbody', { clientHeight: 700, scrollHeight: 700, offsetHeight: 700 });
  const grabber = mk('div', 'grabber'); const sbtn = mk('button', 'btn'); const sline = mk('p', 'lede');
  const slist = mk('div', 'slist', { clientHeight: 200, scrollHeight: 600 }); const sitem = mk('div', 'sitem'); slist.add(sitem);
  sbody.add(grabber, sline, sbtn, slist); sheet.add(sbody);
  body.add(app, detail, workout, sheet);
  const byId = {};
  const index = (n) => { if (n.id) byId[n.id] = n; n.children.forEach(index); };
  index(doc);
  return { doc, body, app, header, tabbar, tabs, pages, track, lib, train, pumpy, card, cardArt, chips, chip,
    weekbar, wday, planrow, bubble, composer, search, detail, exrow, exmain, workout, sheet, byId,
    wmain, wset, trainlean, wtitle, sbody, grabber, sbtn, sline, slist, sitem };
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
    state: { view: 'train', user: { id: 'u' } },
    guide: { visit: null }, pumpyReset: false, ptrPulling: false,
    drawn: {}, heroPct: 0, planSig: '', statsCounted: false, trainSeg: null, trainLean: null, trainSwap: false,
    guideClear() {}, guideStill() {}, guidePage() {}, haptic() {}, renderGrid() {}, countStats() {},
    restorePlan() {}, prepareTrain() {}, quietly() {}, loadPumpy() {}, renderPumpy() {}, paintSeg() {}, drawTrainBody() {},
    // The Pumpy new-chat clock (gtm-owner-ux): setView starts it when Pumpy is left.
    pumpyAway() {}, pumpyBack() {}, freshenPumpy() {}, pumpyIdleTimer: 0,
    // What the week bar, a sheet and Workout Mode call when a drag lands.
    steps: [], closed: [], moves: [],
    paintTrainBar() {}, closeSheet(id) { sandbox.closed.push(id); d.byId[id].classList.remove('open'); },
    wo: { i: 1, finished: false }, endStop: () => 3, stopOf: (i) => i, woGo(n) { sandbox.moves.push(n); }
  };
  vm.createContext(sandbox);
  // The three other drags that hold a touch, wired onto the fake DOM only when a
  // test asks: the week bar's own drag would otherwise answer the pager's
  // week-bar case above, which is about the pager leaving it alone.
  const wire = !opts.gestures ? '' : ['wireWeekBar', 'wireSheet', 'wireWmain'].map(fn).join('') +
    /  var WB_LEAD = [^;]*;/.exec(APP)[0] + /  var SH_FLING = [^;]*;/.exec(APP)[0] + /  var WM_LEAD = [^;]*;/.exec(APP)[0] +
    '\n  wireWeekBar($("trainview").querySelector(".wstrip"), { bar: $("trainview").querySelector(".wstrip"),' +
    ' lean: document.querySelector(".trainlean"), title: document.querySelector(".wbtitle"), step: function (n) { steps.push(n); } });' +
    '\n  wireSheet("settingssheet");\n  wireWmain($("wmain"));\n';
  vm.runInContext('(function () {\n' + fn('overlayShowing') + fn('standalone') + PAGER + wire +
    '\n  this.h = { idx: function () { return idx; }, pos: function () { return pos; }, held: function () { return drag; },' +
    ' measure: measureChrome, setView: setView,' +
    ' loose: function () { return typeof looseDrags === "undefined" ? null : looseDrags.filter(function (g) { return g.held(); }).length; } };' +
    '\n}).call(this);', sandbox);
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
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } }, e);
    // The window's capture listeners hear a pointerdown before the node does, and
    // the document's hear a click (swallowClick eats one there).
    if (type === 'pointerdown') (winListeners[type] || []).forEach((f) => f(ev));
    if (type === 'click') (docListeners[type] || []).slice().forEach((f) => f(ev));
    if (ev.stopped) return ev;
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
  // A drag on a sheet, down by dy, with WebKit's side of it modelled: a touch
  // whose FIRST touchmove is not cancelled lets the sheet body's own scroller
  // pan, and a scroller that pans (the body taller than its frame, or a list in
  // it with somewhere to go) takes the touch with a pointercancel once the
  // finger has gone 10px. Returns whether the first touchmove was cancelled and
  // whether the scroller took the touch.
  function sheetDrag(target, dy, o = {}) {
    const id = nextId++, x0 = 200, y0 = o.y ?? 120, steps = Math.max(1, Math.round((o.ms ?? 200) / 16));
    const base = { pointerType: 'touch', pointerId: id, isPrimary: true };
    fire(target, 'pointerdown', { ...base, clientX: x0, clientY: y0 });
    let first = null, taken = false;
    for (let i = 1; i <= steps; i++) {
      T += 16;
      // A finger starts from rest, so the first move is a pixel or two, as it is
      // on the phone: the first touchmove comes long before any lock can.
      const k = (i / steps) * (i / steps);
      const x = x0 + (o.dx ?? 0) * k, y = y0 + dy * k;
      fire(target, 'pointermove', { ...base, clientX: x, clientY: y });
      const ev = fire(target, 'touchmove', { touches: [{ clientX: x, clientY: y }] });
      if (first === null) first = ev.defaultPrevented;
      const scroller = (n) => n.scrollHeight > n.clientHeight + 1;
      let owner = null;
      for (let n = target; n; n = n.parentElement) { if (scroller(n)) { owner = n; break; } if (n === d.sbody) break; }
      if (!first && owner && Math.abs(y - y0) >= 10) {
        fire(d.sbody.captured === id ? d.sbody : target, 'pointercancel', { ...base, clientX: x, clientY: y });
        taken = true;
        break;
      }
    }
    if (!taken && !o.lose) fire(d.sbody.captured === id ? d.sbody : target, 'pointerup', { ...base, clientX: x0 + (o.dx ?? 0), clientY: y0 + dy });
    run(400);
    return { first, taken };
  }
  return { d, h, run, drag, fire, page, tab, emit, idle, sheetDrag, sb: sandbox };
}

let checks = 0, failed = 0;
function ok(what, f) {
  try { f(); checks++; console.log('  ok  ' + what); }
  catch (err) { failed++; console.log('  FAIL ' + what + '\n       ' + String(err.message).split('\n')[0]); }
}

for (const mode of ['native shell', 'browser tab']) {
  const native = mode === 'native shell';
  console.log('a sideways drag turns every page (' + mode + ')');

  ok('Train → Workouts → Pumpy → Workouts → Train, one page a swipe, tab bar agreeing', () => {
    const w = world({ native });
    assert.equal(w.page(), 0);
    w.drag(w.d.planrow, -260, 6); assert.equal(w.page(), 1, 'Train → Workouts'); assert.equal(w.tab(), 1);
    w.drag(w.d.cardArt, -260, -4); assert.equal(w.page(), 2, 'Workouts → Pumpy'); assert.equal(w.tab(), 2);
    w.drag(w.d.bubble, 260, 5); assert.equal(w.page(), 1, 'Pumpy → Workouts');
    w.drag(w.d.cardArt, 260, 0); assert.equal(w.page(), 0, 'Workouts → Train'); assert.equal(w.tab(), 0);
    assert.equal(w.h.pos(), 0, 'the track lands exactly on the page');
    assert.equal(w.d.lib.inert, true, 'pages nobody is on stay inert');
  });

  ok('the lock holds the touch: every touchmove after it is prevented', () => {
    const w = world({ native });
    const r = w.drag(w.d.planrow, -260, 0);
    assert(r.prevented >= 10, 'prevented ' + r.prevented + ' of 13');
  });

  ok('a thumb\'s arc (30° off the line) on a page that can scroll still turns it', () => {
    const w = world({ native });
    w.drag(w.d.planrow, -220, -127);
    assert.equal(w.page(), 1);
  });

  ok('a slow drag past two fifths commits; a quick short flick commits; a small nudge springs back', () => {
    let w = world({ native });
    w.drag(w.d.planrow, -170, 0, { ms: 1200 }); assert.equal(w.page(), 1, 'slow 44%');
    w = world({ native });
    w.drag(w.d.planrow, -60, 0, { ms: 80 }); assert.equal(w.page(), 1, 'flick');
    w = world({ native });
    w.drag(w.d.planrow, -60, 0, { ms: 1200 }); assert.equal(w.page(), 0, 'nudge');
  });

  ok('a mostly vertical drag is the page scrolling, not a page turn', () => {
    const w = world({ native });
    const r = w.drag(w.d.planrow, -60, -300);
    assert.equal(w.page(), 0); assert.equal(r.prevented, 0, 'the scroll is left alone');
  });

  console.log('a drag that belongs to something else does not turn a page (' + mode + ')');

  ok('a chip row with room to scroll keeps the drag; at its end it hands it on', () => {
    let w = world({ native });
    w.h.setView('library'); w.run();
    const r = w.drag(w.d.chip, -260, 0);
    assert.equal(w.page(), 1); assert.equal(r.prevented, 0, 'the row scrolls natively');
    w = world({ native });
    w.h.setView('library'); w.run();
    w.d.chips.scrollLeft = 800 - 354;   // at its end, finger still going left
    w.drag(w.d.chip, -260, 0);
    assert.equal(w.page(), 2);
  });

  ok('the week bar (data-noswipe) steps the week and never the page', () => {
    const w = world({ native });
    w.h.setView('train'); w.run();
    assert.equal(w.page(), 0);
    const r = w.drag(w.d.wday, -260, 0);
    assert.equal(w.page(), 0); assert.equal(r.prevented, 0);
    w.drag(w.d.wday, 260, 0);
    assert.equal(w.page(), 0);
  });

  ok('a field (the search, Pumpy\'s composer) is never a place a swipe starts', () => {
    const w = world({ native });
    w.h.setView('library'); w.run();
    w.drag(w.d.search, -260, 0); assert.equal(w.page(), 1);
    w.h.setView('pumpy'); w.run();
    w.drag(w.d.composer, 260, 0); assert.equal(w.page(), 2);
  });

  ok('a swipe row in the open card overlay deletes, it does not page — nor does any drag under an overlay', () => {
    const w = world({ native });
    w.d.detail.classList.add('open');
    w.drag(w.d.exmain, -260, 0); assert.equal(w.page(), 0, 'the row is outside the pages');
    w.drag(w.d.planrow, -260, 0); assert.equal(w.page(), 0, 'the pager defers to the overlay');
    w.d.detail.classList.remove('open');
    w.d.sheet.classList.add('open');
    w.drag(w.d.planrow, -260, 0); assert.equal(w.page(), 0, 'or to a sheet');
    w.d.sheet.classList.remove('open');
    w.drag(w.d.planrow, -260, 0); assert.equal(w.page(), 1, 'and pages again once it is gone');
  });

  ok(native ? 'installed, the left edge is the pager\'s too' : 'in a tab, the left 24px are Safari\'s back gesture', () => {
    const w = world({ native });
    w.h.setView('library'); w.run();
    w.drag(w.d.cardArt, 260, 0, { x: 10 });
    assert.equal(w.page(), native ? 0 : 1);
  });

  console.log('a lost end does not strand the pager (' + mode + ')');

  ok('the node under the finger is re-rendered away mid-touch: the next swipe still pages', () => {
    const w = world({ native });
    w.drag(w.d.planrow, -4, 0, { lose: true });   // down, a twitch under the slop
    w.d.planrow.remove();                          // a render replaces the day card
    w.fire(w.d.planrow, 'pointerup', { pointerType: 'touch', pointerId: 99, isPrimary: true, clientX: 326, clientY: 400 });
    assert(w.h.held(), 'the drag is still held: the lift went to a detached node');
    w.drag(w.d.train, -260, 0);                    // the next swipe, anywhere on Train
    assert.equal(w.page(), 1);
  });

  ok('a drag left locked mid-track settles on the nearest page when the next touch lands', () => {
    const w = world({ native });
    w.drag(w.d.planrow, -150, 0, { lose: true, ms: 300 });
    assert(w.h.held() && w.h.held().lock);
    w.drag(w.d.planrow, -2, 0, { ms: 32 });        // a tap
    assert.equal(w.page(), 0, 'settled back on Train, 38% across');
    assert.equal(w.h.pos(), 0);
  });

  ok('a second finger joining a drag is not a new drag', () => {
    const w = world({ native });
    w.drag(w.d.planrow, -150, 0, { lose: true, ms: 300 });
    const held = w.h.held();
    w.fire(w.d.planrow, 'pointerdown', { pointerType: 'touch', pointerId: 500, isPrimary: false, clientX: 200, clientY: 300 });
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
      w.drag(w.d.planrow, -150, 0, { lose: true, ms: 300 });
      assert(w.h.held() && w.h.held().lock, 'set-up: a locked drag whose end was lost');
      trigger(w);
      assert.equal(w.h.held(), null, 'still held after the trigger');
      w.run();
      // Settled on a page. A cancel ends a drag on a lift's terms, so this one,
      // still moving when it was cut off, may carry on to Workouts; the rest land
      // on the page nearest the track.
      const at = w.page();
      assert.equal(w.h.pos(), at * 390, 'the track is not left between pages');
      if (!/touchcancel/.test(what)) assert.equal(at, 0, 'settled back on Train, 38% across');
      w.drag(at === 0 ? w.d.planrow : w.d.cardArt, -260, 0);
      assert.equal(w.page(), at + 1, 'the next swipe pages');
    });
  }

  ok('two seconds with no word from the pointer: an unlocked drag is let go on its own', () => {
    let w = world({ native });
    w.drag(w.d.planrow, -4, 0, { lose: true });     // a touch that never locked
    w.run(1900);
    assert(w.h.held(), 'still held at 1.9 s: a resting finger is a finger');
    w.run(300);
    assert.equal(w.h.held(), null, 'let go by 2.2 s');
  });

  ok('a drag that has locked sideways is never let go by the clock; the next touch lets it go and pages', () => {
    const w = world({ native });
    w.drag(w.d.planrow, -150, 0, { lose: true, ms: 300 });
    w.run(5000);
    assert(w.h.held() && w.h.held().lock, 'a page held half-turned stays held, however still');
    // The lift was lost; the next first finger is the proof, and that swipe pages.
    w.drag(w.d.planrow, -260, 0);
    assert.equal(w.h.held(), null);
    assert.equal(w.page(), 1, 'the next swipe pages');
  });

  ok('a slow drag that keeps moving is never cut off by the two seconds', () => {
    const w = world({ native });
    const r = w.drag(w.d.planrow, -180, 0, { ms: 3200 });
    assert(r.prevented > 150, 'held for the whole drag');
    assert.equal(w.page(), 1);
  });

  ok('an engine that still counts the lost touch as down: a later finger, even a non-primary one, pages', () => {
    const w = world({ native });
    w.drag(w.d.planrow, -4, 0, { lose: true });
    w.idle(2100);                                   // timers throttled: the watchdog has not run
    w.drag(w.d.planrow, -260, 0, { primary: false });
    assert.equal(w.page(), 1);
  });
}

// ---------- the other drags that hold a touch ----------
//
// The week bar, a sheet pushed down and Workout Mode's swipe each refused every
// touch while a drag was held, the pager's old fault. Each gets the pager's
// releases; each case below loses a lift and then asks the gesture to work again.

for (const mode of ['native shell', 'browser tab']) {
  const native = mode === 'native shell';
  const G = () => world({ native, gestures: true });
  const lean = (w) => w.d.trainlean.style.transform;
  const surfaces = [
    // [name, start a drag that locks and loses its lift, the swipe that proves it works, did it work?, looks let go?]
    ['the week bar',
      (w) => w.drag(w.d.wday, -150, 0, { lose: true, ms: 300 }),
      (w) => w.drag(w.d.wday, -260, 0),
      (w) => w.sb.steps.length === 1,
      (w) => lean(w) === '' && !w.d.weekbar.cls.has('wbdrag')],
    ['a sheet pushed down',
      (w) => w.sheetDrag(w.d.grabber, 150, { lose: true, y: 20, ms: 300 }),
      (w) => w.sheetDrag(w.d.grabber, 300, { y: 20 }),
      (w) => w.sb.closed.length === 1,
      (w) => w.d.sbody.style.transform === '' && !w.d.sbody.cls.has('dragging')],
    ['Workout Mode\'s exercise swipe',
      (w) => w.drag(w.d.wset, -150, 0, { lose: true, ms: 300 }),
      (w) => w.drag(w.d.wset, -260, 0),
      (w) => w.sb.moves.length === 1,
      (w) => w.d.wmain.style.transform === '']
  ];
  console.log('a lost lift does not strand the other drags (' + mode + ')');
  for (const [name, lose, swipe, worked, letGo] of surfaces) {
    ok(name + ': a new first finger lets the held drag go, and its own swipe works', () => {
      const w = G();
      lose(w);
      assert.equal(w.h.loose(), 1, 'set-up: one drag held, its lift lost');
      swipe(w);
      assert(worked(w), 'the next swipe did nothing');
      assert.equal(w.h.loose(), 0);
    });
    for (const [what, trigger] of [
      ['the app sent away or back (visibilitychange)', (w) => w.emit('document', 'visibilitychange')],
      ['a page restored (pageshow)', (w) => w.emit('window', 'pageshow')],
      ['the window losing focus (blur)', (w) => w.emit('window', 'blur')],
      ['the shell going inactive', (w) => w.emit('window', 'spotter:native-state', { detail: { isActive: false } })],
      ['a touchcancel that never reached it', (w) => w.emit('window', 'touchcancel')]
    ]) {
      ok(name + ', ' + what + ': let go and put back, and the next swipe works', () => {
        const w = G();
        lose(w);
        trigger(w);
        assert.equal(w.h.loose(), 0, 'still held after the trigger');
        w.run();
        assert(letGo(w), 'left leaning where the finger was');
        swipe(w);
        assert(worked(w), 'the next swipe did nothing');
      });
    }
  }

  ok('the week bar: two quiet seconds let go of a drag that never locked; a locked one is left to the finger', () => {
    let w = G();
    w.drag(w.d.wday, -4, 0, { lose: true });          // a touch that never cleared the slop
    w.run(1900);
    assert.equal(w.h.loose(), 1, 'still held at 1.9 s: a resting finger is a finger');
    w.run(300);
    assert.equal(w.h.loose(), 0, 'let go by 2.2 s');
    w = G();
    w.drag(w.d.wday, -150, 0, { lose: true, ms: 300 });
    w.run(5000);
    assert.equal(w.h.loose(), 1, 'a week held half-turned stays held, however still');
    assert.notEqual(lean(w), '');
  });

  ok('Workout Mode and a sheet: the same two seconds, only before the lock', () => {
    let w = G();
    w.drag(w.d.wset, 3, 2, { lose: true });
    w.run(2200);
    assert.equal(w.h.loose(), 0);
    w = G();
    w.sheetDrag(w.d.grabber, 4, { lose: true, y: 20 });
    w.run(2200);
    assert.equal(w.h.loose(), 0);
    w = G();
    w.sheetDrag(w.d.grabber, 150, { lose: true, y: 20, ms: 300 });
    w.run(5000);
    assert.equal(w.h.loose(), 1, 'a sheet held half-way down stays held');
  });

  ok('a slow week-bar drag that keeps moving is never cut off by the clock', () => {
    const w = G();
    w.drag(w.d.wday, -240, 0, { ms: 3200 });
    assert.equal(w.sb.steps.length, 1);
  });

  ok('a lost lift lets go without eating the next tap\'s click; a real lift still eats its own', () => {
    const w = G();
    let clicks = 0;
    w.d.wday.addEventListener('click', () => { clicks++; });
    w.drag(w.d.wday, -150, 0, { lose: true, ms: 300 });
    const tap = { pointerType: 'touch', pointerId: 900, isPrimary: true, clientX: 100, clientY: 400 };
    w.fire(w.d.wday, 'pointerdown', tap);
    w.fire(w.d.wday, 'pointerup', tap);
    w.fire(w.d.wday, 'click', {});
    assert.equal(clicks, 1, 'the tap after a lost lift is a tap');
    // The swallow itself is unchanged: a drag that lifts eats the click behind it.
    const p = { pointerType: 'touch', pointerId: 901, isPrimary: true, clientY: 400 };
    w.fire(w.d.wday, 'pointerdown', { ...p, clientX: 300 });
    for (const x of [290, 260, 200, 120]) w.fire(w.d.wday, 'pointermove', { ...p, clientX: x });
    w.fire(w.d.wday, 'pointerup', { ...p, clientX: 120 });
    w.fire(w.d.wday, 'click', {});
    assert.equal(clicks, 1, 'the click behind a real drag is still eaten');
    assert.equal(w.sb.steps.length, 1);
  });
}

// ---------- a sheet taller than the phone ----------
//
// The Plus page did not close on a drag down from the grabber, on main too: its
// body is taller than its frame, so it scrolls, and WebKit let that scroller take
// the touch (sheetDrag models it) before the drag had locked. A short sheet has
// no scroller and always closed.
console.log('a sheet taller than the phone pushes away like a short one');
{
  const tall = (w, top = 0) => { w.d.sbody.scrollHeight = 1400; w.d.sbody.scrollTop = top; return w; };
  const G = () => world({ native: true, gestures: true });

  ok('a short sheet closes from the grabber and from its content, as it always did', () => {
    let w = G();
    w.sheetDrag(w.d.grabber, 300, { y: 20 }); assert.deepEqual(w.sb.closed, ['settingssheet']);
    w = G();
    w.sheetDrag(w.d.sline, 300); assert.deepEqual(w.sb.closed, ['settingssheet']);
  });

  ok('the tall sheet at its top: the first move down is claimed, the scroller never takes it, it closes', () => {
    for (const [from, y] of [['grabber', 20], ['sline', 120], ['sbtn', 160]]) {
      const w = tall(G());
      const r = w.sheetDrag(w.d[from], 300, { y });
      assert.equal(r.first, true, from + ': first touchmove cancelled');
      assert.equal(r.taken, false, from + ': the scroller did not take the touch');
      assert.deepEqual(w.sb.closed, ['settingssheet'], from + ': closed');
    }
  });

  ok('the tall sheet scrolled down: its content scrolls; the grabber band still pulls it down', () => {
    let w = tall(G(), 300);
    let r = w.sheetDrag(w.d.sline, 300, { y: 120 });
    assert.equal(r.first, false); assert.equal(w.sb.closed.length, 0, 'a drag in the content is the list scrolling');
    w = tall(G(), 300);
    r = w.sheetDrag(w.d.grabber, 300, { y: 20 });
    assert.equal(r.first, true); assert.deepEqual(w.sb.closed, ['settingssheet']);
  });

  ok('what is not the sheet\'s is left to scroll: a finger heading up, a sideways first move, a list in it with room above', () => {
    let w = tall(G());
    let r = w.sheetDrag(w.d.sline, -300);
    assert.equal(r.first, false, 'up at the top is the list coming up');
    assert.equal(w.sb.closed.length, 0);
    w = tall(G());
    r = w.sheetDrag(w.d.sline, 30, { dx: 60 });
    assert.equal(r.first, false, 'sideways first');
    w = tall(G());
    w.d.slist.scrollTop = 120;
    r = w.sheetDrag(w.d.sitem, 300, { y: 300 });
    assert.equal(r.first, false, 'the inner list scrolls back up');
    assert.equal(w.sb.closed.length, 0);
  });

  ok('app.ts: the claim is made on the first touchmove only, and the lock still holds every one after', () => {
    const wire = fn('wireSheet');
    assert(wire.includes('if (sd.lock || claims(e)) e.preventDefault();'));
    assert(wire.includes('if (sd.first) return false;'));
  });
}

// ---------- a card that re-renders under the finger ----------
//
// On the 16e a card renamed three times a second while pressed lost its tap: the
// render swapped its node, the touch's end went with the old one and WebKit
// dropped the click. renderGrid and the press it keeps are lifted and run over
// the fake DOM; cardNode is stubbed to a button that carries the title it drew.
console.log('a card that re-renders under the finger');
{
  // Absent, the grid simply renders as it did before the fix, and the checks say so.
  const MARK = '  // A card under a finger keeps its node until the finger lifts.';
  const PRESS = APP.includes(MARK) ? between(APP, MARK, '  function renderGrid() {') : '';
  function grid() {
    T = 1000;
    const doc = mk('html'), body = mk('body'); doc.add(body);
    const g = mk('div', 'grid', { id: 'grid' }), empty = mk('div', '', { id: 'empty' }), other = mk('button', 'tab');
    body.add(g, empty, other);
    const byId = { grid: g, empty }, timers = [], winL = {}, docL = {}, opened = [];
    const sandbox = {
      Math, String, Number, JSON, Object, Array, console,
      window: { addEventListener: (t, f) => { (winL[t] = winL[t] || []).push(f); } },
      document: { addEventListener: (t, f) => { (docL[t] = docL[t] || []).push(f); },
        documentElement: { style: { setProperty() {} } } },
      $: (id) => byId[id],
      setTimeout: (f, ms) => { timers.push({ f, at: T + (ms || 0) }); return timers.length; },
      clearTimeout: (id) => { if (id) timers[id - 1] = null; },
      state: { user: { id: 'u' }, workouts: [] }, accountEpoch: 1, gridCards: {}, newThisPass: 0,
      pendingMotion: null, sortMode: 'new', visible: () => sandbox.state.workouts,
      cardNode: (w) => { const n = mk('button', 'carditem'); n.setAttribute('data-id', w.id); n.drawn = w.title; n.add(mk('div', 'thumbwrap')); return n; },
      cardMeta: () => '', cardBadge: () => null, openDetail: (w) => opened.push(w.title),
      isByFilter: () => false, isMgFilter: () => false
    };
    vm.createContext(sandbox);
    vm.runInContext(PRESS + fn('renderGrid'), sandbox);
    const cards = () => g.children.slice();
    const at = (id) => g.children.find((c) => c.getAttribute('data-id') === id);
    const press = (target, type, e = {}) => (winL[type] || []).forEach((f) => f(Object.assign({ type, target }, e)));
    const run = (ms) => { const end = T + ms; while (T < end) { T += 16; timers.forEach((t, i) => { if (t && t.at <= T) { timers[i] = null; t.f(); } }); } };
    const set = (list) => { sandbox.state.workouts = list; vm.runInContext('renderGrid()', sandbox); };
    return { g, other, cards, at, press, run, set, opened, docL };
  }
  const A = (title) => ({ id: 'a', title }), B = (title) => ({ id: 'b', title });

  ok('the pressed card keeps its node through a render, and its tap opens what the card now is', () => {
    const x = grid();
    x.set([A('Leg day'), B('Push')]);
    const node = x.at('a');
    x.press(node.firstChild, 'pointerdown');
    x.set([A('Leg day (1)'), B('Push')]);
    x.set([A('Leg day (2)'), B('Push')]);
    assert.equal(x.at('a'), node, 'the node under the finger was replaced');
    assert(node.isConnected);
    node.onclick();
    assert.deepEqual(x.opened, ['Leg day (2)'], 'the tap opens the card as it is now');
  });

  ok('after the lift, one render brings the pressed card up to date', () => {
    const x = grid();
    x.set([A('Leg day'), B('Push')]);
    const node = x.at('a');
    x.press(node, 'pointerdown');
    x.set([A('Leg day (1)'), B('Push')]);
    x.press(node, 'pointerup');
    assert.equal(x.at('a'), node, 'not before the click has had its moment');
    x.run(400);
    assert.notEqual(x.at('a'), node);
    assert.equal(x.at('a').drawn, 'Leg day (1)');
  });

  ok('a card nobody is pressing redraws at once; a press elsewhere changes nothing', () => {
    const x = grid();
    x.set([A('Leg day'), B('Push')]);
    const a = x.at('a'), b = x.at('b');
    x.press(a, 'pointerdown');
    x.set([A('Leg day'), B('Push day')]);
    assert.equal(x.at('a'), a);
    assert.notEqual(x.at('b'), b);
    assert.equal(x.at('b').drawn, 'Push day');
    const y = grid();
    y.set([A('Leg day')]);
    const n = y.at('a');
    y.press(y.other, 'pointerdown');
    y.set([A('Leg day (1)')]);
    assert.notEqual(y.at('a'), n);
  });

  ok('a lift that never came holds a card back only until the next press, or a cancel, or the app going away', () => {
    for (const end of [(x) => x.press(x.other, 'pointerdown'), (x) => x.press(x.other, 'pointercancel'),
      (x) => (x.docL.visibilitychange || []).forEach((f) => f({}))]) {
      const x = grid();
      x.set([A('Leg day')]);
      const node = x.at('a');
      x.press(node, 'pointerdown');
      x.set([A('Leg day (1)')]);
      end(x);
      x.run(400);
      assert.equal(x.at('a').drawn, 'Leg day (1)');
    }
  });

  ok('a pressed card that leaves the grid still goes', () => {
    const x = grid();
    x.set([A('Leg day'), B('Push')]);
    x.press(x.at('a'), 'pointerdown');
    x.set([B('Push')]);
    assert.equal(x.at('a'), undefined);
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

for (const [where, src] of [['style.ts', STYLE], ['web-dist/index.html', PAGE]]) {
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

// Found along the way on the simulator: a held thumbnail opened iOS's image menu
// (Share / Save to Photos / Copy) over the Library. Card art is not for saving.
for (const [where, src] of [['style.ts', STYLE], ['web-dist/index.html', PAGE]]) {
  ok(where + ': card art (grid, Train rows and pickers, the detail\'s source chips) has no image menu or drag', () => {
    const art = rule(src, '.thumbwrap img, .tthumb, .planitem img, .pickrow img, .fromthumb img');
    assert.match(art, /-webkit-touch-callout: ?none/);
    assert.match(art, /-webkit-user-drag: ?none/);
    assert.match(art, /(^|[^-])user-select: ?none/);
    // The source photo and the share card are pictures; keeping one stays possible.
    for (const keep of ['.dphoto', '.scprev img', '#proof img']) assert.doesNotMatch(rule(src, keep), /touch-callout/);
  });
}

ok('app.ts: the touchmove that holds a locked drag is non-passive', () => {
  assert.match(PAGER, /pagesEl\.addEventListener\("touchmove", function \(e\) \{\s*if \(drag && drag\.lock && e\.cancelable\) e\.preventDefault\(\);\s*\}, \{ passive: false \}\);/);
});

console.log('\n' + checks + ' pager checks passed' + (failed ? ', ' + failed + ' FAILED.' : '.'));
if (failed) process.exitCode = 1;

// Offline checks for the rest wheel (wave 0923, brief WHEEL): the one component
// every rest is chosen on now that the chip grid is gone. Run against the real
// source:
//
//   node tools/rest-wheel-harness.mjs
//
// restWheel is lifted out of app.ts the way the other harnesses lift their
// functions and run in a vm over a fake DOM just big enough for it: elements
// with children, classes, attributes, listeners and a scrollTop. The scroll
// events, the settle timer, the ResizeObserver and the clock are all driven by
// hand, so "the wheel settled on a new notch" is a step in a test and not a
// sleep. What a harness cannot reach — WebKit's momentum, the snap, the drum,
// the Taptic Engine — is the simulator's and the pane's to show; the CSS that
// makes them is asserted here as text so it cannot quietly go.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const APP = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const STYLE = fs.readFileSync('supabase/functions/spotter/style.ts', 'utf8');
const MARKUP = fs.readFileSync('supabase/functions/spotter/markup.ts', 'utf8');
const PAGE = fs.readFileSync('web-dist/index.html', 'utf8');

// A top-level function, one-liners included (the midadd lift assumes a body).
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

// ---------- the fake DOM ----------
class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.on = {}; this.cls = new Set();
    this.textContent = ''; this.scrollTop = 0; this.parentNode = null; this.tabIndex = -1; this.disabled = false;
    this.shown = true; this.onclick = null; this.scrolls = [];
  }
  get className() { return [...this.cls].join(' '); }
  set className(v) { this.cls = new Set(String(v).split(' ').filter(Boolean)); }
  get classList() {
    const c = this.cls;
    return { add: (x) => c.add(x), remove: (x) => c.delete(x), contains: (x) => c.has(x),
      toggle: (x, on) => (on === undefined ? (c.has(x) ? c.delete(x) : c.add(x)) : on ? c.add(x) : c.delete(x)) };
  }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  get firstChild() { return this.children[0] || null; }
  set innerHTML(v) { this.children = []; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }
  fire(t, e) { const ev = Object.assign({ target: this, preventDefault() { ev.prevented = true; } }, e || {}); (this.on[t] || []).forEach((f) => f(ev)); return ev; }
  click(target) { if (this.onclick) this.onclick({ target: target || this }); }
  // Laid out only while shown: display:none is a zero box, as in a browser.
  get offsetHeight() { return this.shown ? 44 : 0; }
  get clientHeight() { return this.shown ? 220 : 0; }
  scrollTo(o) { this.scrolls.push({ top: o.top, behavior: o.behavior }); this.scrollTop = o.top; }
  closest(sel) { const want = sel.replace('.', ''); for (let n = this; n; n = n.parentNode) if (n.cls.has(want)) return n; return null; }
  all(cls) { const out = []; const walk = (n) => { n.children.forEach((c) => { if (c.cls.has(cls)) out.push(c); walk(c); }); }; walk(this); return out; }
}

const STUBS = `
var REST_FALLBACK = 90, T = 1000, timers = [], ticks = [], ros = [], motionLess = false;
var window = { ResizeObserver: function (cb) { var o = { cb: cb, els: [], observe: function (e) { o.els.push(e); }, disconnect: function () { o.gone = true; } }; ros.push(o); return o; } };
var ResizeObserver = window.ResizeObserver;
function now() { return T; }
function lessMotion() { return motionLess; }
function haptic(kind) { ticks.push(kind); }
function setTimeout(f, ms) { timers.push(f); return timers.length; }
function clearTimeout(id) { if (id) timers[id - 1] = null; }
function flush() { var q = timers; timers = []; q.forEach(function (f) { if (f) f(); }); }
function el(tag, cls, text) { var n = new El(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
`;
const ctx = vm.createContext({ El, assert, Math, String, Number, JSON, Object, Array, console, Set });
vm.runInContext(STUBS + ['clamp', 'clock', 'restWord', 'restVal', 'restDetent', 'restSpoken', 'restWheel'].map(fn).join('\n'), ctx);
// Values out of the vm come back through JSON: its arrays have their own
// prototype, and deepStrictEqual would call [] and [] different.
const run = (code) => { const v = vm.runInContext(code, ctx); return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v; };

let checks = 0;
function ok(what, f) { f(); checks++; console.log('  ok  ' + what); }

// A wheel in a box, and handles on its parts.
function wheel(value) {
  run('picks = []; ticks = []; timers = []; T = 1000;');
  const box = new El('div');
  ctx.box = box;
  run('restWheel(box, ' + JSON.stringify(value) + ', function (v) { picks.push(v); })');
  const cols = box.all('wsc');
  return {
    box, cols,
    say: () => box.all('wsay')[0].textContent,
    use: box.all('wdef')[0],
    lit: () => cols.map((c) => c.children.findIndex((r) => r.cls.has('on'))),
    picks: () => run('picks'),
    // The finger (or momentum) moving a column to a scroll position.
    scroll: (i, top) => { cols[i].scrollTop = top; cols[i].fire('scroll'); },
    settle: () => run('flush()'),
    text: () => cols.map((c) => c.getAttribute('aria-valuetext')),
    now: () => cols.map((c) => c.getAttribute('aria-valuenow'))
  };
}
const detent = (t) => run('restDetent(' + t + ')');

console.log('value and notch');

ok('every notch the wheel has is its own value: 0, 5 … 600 and on to 10:55', () => {
  for (let t = 0; t <= 655; t += 5) assert.equal(detent(t), t);
  const w = wheel(0);
  assert.equal(w.cols[0].children.length, 11, 'minutes 0–10');
  assert.equal(w.cols[1].children.length, 12, 'seconds 00–55 in fives');
  assert.deepEqual(w.cols[1].children.map((r) => r.children[0].textContent).slice(0, 3), ['00', '05', '10']);
  assert.deepEqual(w.cols[0].children.map((r) => r.children[0].textContent).slice(-2), ['9', '10']);
});

ok('a value opens on its notch: 600 is 10:00, 45 is 0:45, 0 is 0:00 and says No rest', () => {
  let w = wheel(600);
  assert.deepEqual(w.lit(), [10, 0]);
  assert.deepEqual(w.cols.map((c) => c.scrollTop), [440, 0]);
  assert.equal(w.say(), 'Rest 10:00');
  w = wheel(45);
  assert.deepEqual(w.lit(), [0, 9]);
  assert.equal(w.say(), 'Rest 0:45');
  w = wheel(0);
  assert.deepEqual(w.lit(), [0, 0]);
  assert.equal(w.say(), 'No rest');
  assert.equal(w.use.disabled, false, 'no rest is not the default');
});

ok('off the grid: 97 s shows 1:35, says 1:37, and is not rewritten by opening or a nudge', () => {
  assert.equal(detent(97), 95);
  assert.equal(detent(98), 100);
  assert.equal(detent(3600), 655, 'an hour sits on the last notch');
  const w = wheel(97);
  assert.deepEqual(w.lit(), [1, 7]);
  assert.equal(w.say(), 'Rest 1:37');
  assert.deepEqual(w.text(), ['1 minute 37 seconds', '1 minute 37 seconds']);
  // Placing the wheel is a scroll too; it must be no news.
  w.cols.forEach((c) => c.fire('scroll'));
  w.settle();
  // A drag that lets go where it started.
  w.scroll(1, 7 * 44 + 10);
  w.scroll(1, 7 * 44);
  w.settle();
  assert.deepEqual(w.picks(), [], '97 stays 97 until the wheel lands somewhere else');
  assert.deepEqual(run('ticks'), []);
  // Moved off and back: now it has been chosen, and it is the notch.
  w.scroll(1, 8 * 44); w.settle();
  w.scroll(1, 7 * 44); w.settle();
  assert.deepEqual(w.picks(), [100, 95]);
  assert.equal(w.say(), 'Rest 1:35');
});

ok('the default: "" sits on 1:30, reads "Default · 1:30", and moving the wheel leaves it', () => {
  const w = wheel('');
  assert.deepEqual(w.lit(), [1, 6]);
  assert.equal(w.say(), 'Default · 1:30');
  assert.equal(w.use.disabled, true, 'Use default is put away while it is the default');
  assert.equal(w.use.textContent, 'Use default (1:30)');
  assert.deepEqual(w.text(), ['Default, 1 minute 30 seconds', 'Default, 1 minute 30 seconds']);
  w.scroll(1, 7 * 44); w.settle();
  assert.deepEqual(w.picks(), [95]);
  assert.equal(w.say(), 'Rest 1:35');
  assert.equal(w.use.disabled, false);
  // Even back on 1:30 it is a chosen 90, not the default.
  w.scroll(1, 6 * 44); w.settle();
  assert.deepEqual(w.picks(), [95, 90]);
  assert.equal(w.say(), 'Rest 1:30');
});

ok('Use default snaps both columns to 1:30, reports "" at once, and ticks no notch on the way', () => {
  const w = wheel(305);
  assert.deepEqual(w.lit(), [5, 1]);
  w.use.click();
  assert.deepEqual(w.picks(), ['']);
  assert.equal(w.say(), 'Default · 1:30');
  assert.deepEqual(w.cols.map((c) => c.scrolls.at(-1).top), [44, 264]);
  // The glide passes notches; they are the button's, not the person's.
  run('ticks = []; T += 100;');
  w.scroll(0, 3 * 44); w.scroll(0, 44); w.scroll(1, 4 * 44); w.scroll(1, 6 * 44);
  w.settle();
  assert.deepEqual(run('ticks'), [], 'no selection ticks while Use default moves the wheel');
  assert.deepEqual(w.picks(), [''], 'landing where it was sent is not a second pick');
});

console.log('feel');

ok('a tick per notch passed, at most one per 45 ms, so a fling flutters rather than buzzes', () => {
  const w = wheel(0);
  // A slow drag: a notch every 150 ms, a tick each.
  for (let k = 1; k <= 4; k++) { run('T += 150'); w.scroll(1, k * 44); }
  assert.deepEqual(run('ticks'), ['select', 'select', 'select', 'select']);
  // A fling across the rest of the column in 110 ms: eleven notches, three ticks.
  run('ticks = []');
  for (let k = 5; k <= 11; k++) { run('T += 16'); w.scroll(1, k * 44); }
  assert(run('ticks.length') <= 3, 'throttled: ' + run('ticks.length'));
  assert(run('ticks.length') >= 2, 'still felt');
  w.settle();
  assert.deepEqual(w.picks(), [55], 'one pick, when it settles — not one per notch');
});

ok('onPick waits for the wheel to settle', () => {
  const w = wheel(60);
  w.scroll(0, 2 * 44);
  assert.deepEqual(w.picks(), [], 'nothing while it is still moving');
  w.scroll(0, 3 * 44);
  w.settle();
  assert.deepEqual(w.picks(), [180]);
});

ok('a tapped row comes to the band', () => {
  const w = wheel(90);
  const row = w.cols[1].children[3];
  w.cols[1].click(row.children[0]);
  assert.deepEqual(w.cols[1].scrolls.at(-1), { top: 3 * 44, behavior: 'smooth' });
  run('motionLess = true');
  w.cols[1].click(w.cols[1].children[4]);
  assert.equal(w.cols[1].scrolls.at(-1).behavior, 'auto', 'reduced motion jumps');
  run('motionLess = false');
});

ok('arrow keys step a focused column, up is more, and a second press mid-glide steps on', () => {
  const w = wheel(90);
  let e = w.cols[1].fire('keydown', { key: 'ArrowUp' });
  assert.equal(e.prevented, true);
  assert.equal(w.cols[1].scrolls.at(-1).top, 7 * 44);
  // Still gliding (no scroll event yet): the next press goes from where it is headed.
  w.cols[1].fire('keydown', { key: 'ArrowUp' });
  assert.equal(w.cols[1].scrolls.at(-1).top, 8 * 44);
  w.scroll(1, 8 * 44); w.settle();
  assert.deepEqual(w.picks(), [100]);
  w.cols[0].fire('keydown', { key: 'ArrowDown' });
  assert.equal(w.cols[0].scrolls.at(-1).top, 0);
  // Clamped at the ends, and other keys are left alone.
  w.cols[0].scrollTop = 0; w.cols[0].fire('scroll'); w.settle();
  w.cols[0].fire('keydown', { key: 'ArrowDown' });
  assert.equal(w.cols[0].scrolls.at(-1).top, 0);
  e = w.cols[0].fire('keydown', { key: 'Tab' });
  assert.equal(e.prevented, undefined);
});

ok('a pane shown from display:none gets its wheel back on the notch', () => {
  const box = new El('div');
  ctx.box2 = box;
  run('ros = []');
  box.shown = false;
  // Hidden: nothing is laid out, so nothing is placed.
  const hide = (n) => { n.shown = false; n.children.forEach(hide); };
  const show = (n) => { n.shown = true; n.children.forEach(show); };
  run('restWheel(box2, 125, function () {})');
  hide(box);
  const cols = box.all('wsc');
  cols.forEach((c) => { c.scrollTop = 0; });
  show(box);
  run('ros[ros.length - 1].cb()');
  assert.deepEqual(cols.map((c) => c.scrollTop), [2 * 44, 1 * 44]);
  // A second wheel in the same box retires the first one's observer.
  run('restWheel(box2, 0, function () {})');
  assert.equal(run('ros[ros.length - 2].gone'), true);
});

console.log('accessibility');

ok('each column is a spinbutton with its range and the whole rest as its valuetext', () => {
  const w = wheel(90);
  const [m, s] = w.cols;
  assert.equal(m.getAttribute('role'), 'spinbutton');
  assert.equal(s.getAttribute('role'), 'spinbutton');
  assert.equal(m.tabIndex, 0);
  assert.equal(m.getAttribute('aria-label'), 'Minutes');
  assert.equal(s.getAttribute('aria-label'), 'Seconds');
  assert.deepEqual([m.getAttribute('aria-valuemin'), m.getAttribute('aria-valuemax')], ['0', '10']);
  assert.deepEqual([s.getAttribute('aria-valuemin'), s.getAttribute('aria-valuemax')], ['0', '55']);
  assert.deepEqual(w.now(), ['1', '30']);
  assert.deepEqual(w.text(), ['1 minute 30 seconds', '1 minute 30 seconds']);
  assert.equal(run('restSpoken(60)'), '1 minute');
  assert.equal(run('restSpoken(5)'), '5 seconds');
  assert.equal(run('restSpoken(121)'), '2 minutes 1 second');
  assert.equal(run('restSpoken(0)'), 'No rest');
  assert.equal(w.box.all('wunit')[0].getAttribute('aria-hidden'), 'true', 'the unit is not read twice');
  assert.equal(w.box.all('wsay')[0].getAttribute('aria-live'), 'polite');
});

console.log('gestures');

ok('the wheel owns its drags: data-noswipe on the box, and wireSheet and the pager honour it', () => {
  const w = wheel(90);
  assert.equal(w.box.getAttribute('data-noswipe'), '');
  assert(fn('noDragIn').includes('[data-noswipe]'));
  const ws = fn('wireSheet');
  assert(ws.includes('if (sd || !e.isPrimary || noDragIn(e.target)) return;'), 'wireSheet still asks noDragIn first');
});

ok('the stylesheet keeps the snap, the containment, and the tilt off the snapping row', () => {
  const rule = (sel) => { const m = new RegExp('\\n  ' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}').exec(STYLE); assert(m, 'no rule ' + sel); return m[1]; };
  const wsc = rule('.wsc');
  assert(wsc.includes('scroll-snap-type: y mandatory'));
  assert(wsc.includes('overscroll-behavior: contain'), 'a column at its end must not scroll the sheet');
  assert(wsc.includes('touch-action: pan-y'));
  const wit = rule('.wit');
  assert(wit.includes('scroll-snap-align: center'));
  assert(!/animation|transform/.test(wit), 'a snap area is the transformed box: the row must not tilt itself');
  assert(STYLE.includes('.wit span { animation: wdrum linear both; animation-timeline: --wit; }'));
  assert(/@media \(prefers-reduced-motion: no-preference\) \{\s*@supports \(animation-timeline: view\(\)\)/.test(STYLE),
    'the drum only where motion is welcome and the browser can draw it');
  assert(rule('.restpick.short').includes('--rows: 3'));
});

console.log('commit rules and callers');

ok('restChips is gone and every rest is chosen on restWheel', () => {
  for (const [name, src] of [['app.ts', APP], ['style.ts', STYLE], ['markup.ts', MARKUP], ['web-dist/index.html', PAGE]]) {
    assert(!/restChips|restchips|restcustom|REST_STEPS|"Custom…"/.test(src), 'chip grid left in ' + name);
  }
  const calls = [...APP.matchAll(/restWheel\(\$\("(\w+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(calls.sort(), ['exeditrest', 'sectionrest', 'sectionrest', 'woarest'].sort());
  assert(PAGE.includes('function restWheel(box, value, onPick)'), 'the built page carries it');
  // The card's own rest sheet went with the rest pill (Simplify-B): a rest is
  // set in Edit exercise, one tap from the row's sheet. Three rows everywhere.
  assert(!/id="restwheel"|id="restsheet"|function openRest\b/.test(MARKUP + APP), 'the rest sheet is gone');
  for (const id of ['woarest', 'exeditrest', 'sectionrest']) assert(MARKUP.includes('<div class="restpick short" id="' + id + '"></div>'), id);
});

ok('the dose panes and the section sheet only hold the value; their own buttons save it', () => {
  // Each caller's onPick is an assignment, never a write.
  assert(APP.includes('restWheel($("exeditrest"), exEdit.rest, function (v) { if (exEdit) exEdit.rest = v; });'));
  assert(APP.includes('restWheel($("woarest"), woa.rest, function (v) { if (woa) woa.rest = v; });'));
  assert.equal(APP.split('restWheel($("sectionrest"), sec.rest, function (v) { if (sec) sec.rest = v; });').length - 1, 2);
  // And the value held is the one those buttons send.
  assert(fn('saveExEdit').includes('rest_seconds: exEdit.rest'));
  assert(fn('sectionFields').includes('rest_seconds: u.rounds ? sec.rest : ""'));
  assert(/rest_seconds: woa\.rest/.test(APP), 'the add picker sends woa.rest');
});

console.log('\n' + checks + ' rest wheel checks passed');

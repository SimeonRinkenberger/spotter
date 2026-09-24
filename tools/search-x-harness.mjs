// The Library search's X, run against the real app.ts wiring:
//
//   node tools/search-x-harness.mjs
//
// On a phone the X left the keyboard up: the field and the X shared a <label>,
// and the click WebKit makes for a finger can land on that label, which puts the
// focus back in the field. The X now acts on touchend (and cancels the click
// that would follow), clears the query and blurs the field; click is still the
// door for a mouse, a keyboard and VoiceOver, and the two never both act.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const APP = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const MARKUP = fs.readFileSync('supabase/functions/spotter/markup.ts', 'utf8');
const STYLE = fs.readFileSync('supabase/functions/spotter/style.ts', 'utf8');

const a = APP.indexOf('  var searchXAt = 0;');
const b = APP.indexOf('  // Search on the keyboard means the same thing');
assert(a > 0 && b > a, 'the X wiring is in app.ts');
const wiring = APP.slice(a, b);

function el() {
  return { value: '', on: {}, blurred: 0, onclick: null,
    addEventListener(t, f, o) { (this.on[t] = this.on[t] || []).push({ f, o }); },
    blur() { this.blurred++; },
    getBoundingClientRect() { return { left: 305, right: 357, top: 70, bottom: 134 }; } };
}
function setup() {
  const ids = { search: el(), searchx: el() }, clock = { now: 1000 };
  const ctx = vm.createContext({ $: (id) => ids[id], state: { q: '' }, renders: 0, Date: { now: () => clock.now } });
  ctx.renderGrid = () => { ctx.renders++; };
  vm.runInContext(wiring, ctx);
  const x = ids.searchx, f = ids.search;
  const fire = (type, e) => { const ev = Object.assign({ prevented: false, preventDefault() { this.prevented = true; } }, e);
    (x.on[type] || []).forEach((h) => h.f.call(x, ev)); return ev; };
  const click = () => { const ev = { prevented: false, preventDefault() { this.prevented = true; } }; x.onclick.call(x, ev); return ev; };
  return { ctx, ids, x, f, fire, click, clock };
}
let n = 0;
function test(name, work) { work(); n++; console.log('PASS', name); }

test('a finger on the X clears the query and puts the keyboard away', () => {
  const s = setup();
  s.f.value = 'upper'; s.ctx.state.q = 'upper';
  assert.equal(s.fire('pointerdown', {}).prevented, true, 'the press keeps the field focused until the lift');
  const ev = s.fire('touchend', { changedTouches: [{ clientX: 330, clientY: 100 }] });
  assert.equal(ev.prevented, true, 'the click WebKit would aim at the field is cancelled');
  assert.equal(s.f.value, ''); assert.equal(s.ctx.state.q, ''); assert.equal(s.ctx.renders, 1);
  assert.equal(s.f.blurred, 1, 'keyboard down');
  assert.equal(s.x.on.touchend[0].o.passive, false, 'a passive listener could not cancel it');
});

test('the gap beside the circle is the button too (the lift is judged against its box)', () => {
  const s = setup();
  s.f.value = 'leg'; s.ctx.state.q = 'leg';
  s.fire('touchend', { changedTouches: [{ clientX: 306, clientY: 72 }] });
  assert.equal(s.f.value, ''); assert.equal(s.f.blurred, 1);
});

test('a finger that slid off before lifting changed its mind', () => {
  const s = setup();
  s.f.value = 'leg'; s.ctx.state.q = 'leg';
  const ev = s.fire('touchend', { changedTouches: [{ clientX: 200, clientY: 100 }] });
  assert.equal(ev.prevented, false); assert.equal(s.f.value, 'leg'); assert.equal(s.f.blurred, 0);
});

test('a click after a handled lift does not act twice; a click on its own does', () => {
  const s = setup();
  s.f.value = 'leg'; s.ctx.state.q = 'leg';
  s.fire('touchend', { changedTouches: [{ clientX: 330, clientY: 100 }] });
  s.clock.now += 300;
  const ev = s.click();
  assert.equal(ev.prevented, true, 'and it never reaches anything that would refocus the field');
  assert.equal(s.f.blurred, 1); assert.equal(s.ctx.renders, 1);
  s.clock.now += 5000;
  s.f.value = 'push'; s.ctx.state.q = 'push';
  s.click();   // VoiceOver, a mouse, a hardware keyboard
  assert.equal(s.f.value, ''); assert.equal(s.f.blurred, 2); assert.equal(s.x.blurred, 2, 'the X itself lets go of focus');
});

test('an empty field is not re-rendered for nothing', () => {
  const s = setup();
  s.fire('touchend', { changedTouches: [{ clientX: 330, clientY: 100 }] });
  assert.equal(s.ctx.renders, 0); assert.equal(s.f.blurred, 1);
});

test('markup and style: no label round the X, a wide target, one X only', () => {
  const wrap = /<div class="searchwrap" id="searchwrap" role="search">([\s\S]*?)<\/div>/.exec(MARKUP);
  assert(wrap, 'the wrap is a div');
  assert(!/<label class="searchwrap"/.test(MARKUP));
  assert.match(wrap[1], /<button class="searchx" id="searchx" type="button" aria-label="Clear search"><span>/);
  assert.match(STYLE, /#searchwrap:focus-within \.searchx \{ width: 52px;/, 'the strip from the field to the circle');
  assert.match(STYLE, /\.searchx \{[^}]*height: 64px; margin: -8px 0 -12px;/, 'and the bar\'s full height');
  assert.match(STYLE, /\.searchx > span \{ flex: 0 0 44px; height: 44px;/, 'a 44px circle');
  assert.match(STYLE, /#search::-webkit-search-cancel-button \{[^}]*display: none;/);
});

console.log('PASS search X: ' + n + ' groups (clears and blurs on the lift, cancels the refocusing click, slide-off, click fallback, no double action)');

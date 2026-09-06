// npm install --prefix /tmp/spotter-qa linkedom
// SPOTTER_DOM_MODULE=/tmp/spotter-qa/node_modules/linkedom/esm/index.js node tools/pumpy-harness.mjs
// Exercises real guide code against a DOM, with deterministic visibility/time.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { parseHTML } = await import(pathToFileURL(process.env.SPOTTER_DOM_MODULE || '/private/tmp/spotter-qa/node_modules/linkedom/esm/index.js'));
const app = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const markup = fs.readFileSync('supabase/functions/spotter/markup.ts', 'utf8');
const { document } = parseHTML('<html><body>' + markup.slice(markup.indexOf('export const MARKUP_BODY')) + '</body></html>');
document.hidden = false;
const timers = [], observers = [], storage = new Map();
let clock = 1000000, reduced = false, checks = 0;
class Observer {
  constructor(fn) { this.fn = fn; this.disconnected = false; observers.push(this); }
  observe(node) { this.node = node; }
  disconnect() { this.disconnected = true; }
  show() { if (!this.disconnected) this.fn([{ isIntersecting: true, intersectionRatio: 1 }]); }
}
const context = vm.createContext({
  document, console, location: { hostname: 'localhost' },
  window: { IntersectionObserver: Observer, matchMedia: () => ({ matches: reduced, addEventListener() {} }) },
  IntersectionObserver: Observer,
  Date: { now: () => clock },
  localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
  setTimeout: (fn, ms) => { timers.push({fn,ms}); },
  state: { user: { id: 'alice' }, view: 'library', logs: [] },
  pumpy: { loaded: true, messages: [], refs: [] }, planBody: document.createElement('div'),
  $: id => document.getElementById(id),
  el: (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; },
  icon: n => n, lessMotion: () => reduced,
  overlayShowing: () => !!document.querySelector('.sheet.open, #detail.open'),
  toast() {}, openSheet() {}, closeSheet() {}
});
function run(s) { return vm.runInContext(s, context); }
function check(name, fn) { fn(); checks++; console.log('PASS', name); }
function showTip() { run('guide.observer.show()'); }
function reset() { run('guideClear(); guide.seen = {}; guide.count = 0; guide.last = 0; guide.off = false;'); }
vm.runInContext(app.slice(app.indexOf('  // ---------- Pumpy · a little help'), app.indexOf('  // ---------- sheets ----------')), context);
run('guideUser()');
const plan = document.getElementById('planview'); plan.appendChild(context.planBody);
check('warm rendering is not a visit', () => {
  run('state.view = "plan"; guidePage("plan")');
  assert.equal(run('guide.active'), null);
});
check('a visit creates one tip, not an impression yet', () => {
  run('guide.visit = "plan"; guidePage("plan")');
  assert.equal(run('guide.active.id'), 'plan'); assert.equal(run('guide.count'), 0);
});
check('an inert page cannot spend an impression', () => {
  plan.inert = true; showTip(); assert.equal(run('guide.count'), 0); plan.inert = false;
});
check('visible tip is counted and persisted once', () => {
  showTip(); assert.equal(run('guide.count'), 1); assert.equal(run('guide.seen.plan'), true);
  assert.equal(JSON.parse(storage.get('spotter_pumpy_v1:alice')).seen.plan, true);
});
check('redraw reattaches same tip without counting twice', () => {
  const node = run('guide.active.node'); context.planBody.innerHTML = '';
  run('guidePage("plan")'); assert.equal(run('guide.active.node'), node); assert.equal(run('guide.count'), 1);
});
check('a tip does not repeat after leaving and returning', () => {
  run('guideClear(); guidePage("plan")'); assert.equal(run('guide.active'), null);
});
check('an existing plan retires introductory planning help', () => {
  run('state.plan = [{}]; guidePage("plan")');
  assert.equal(run('guide.active'), null); assert.equal(run('guide.seen.plan'), true);
  run('state.plan = []');
});
check('cooldown prevents a second tip on the next action', () => {
  run('guideSheet("addsheet")'); assert.equal(run('guide.active'), null);
});
check('closed sheets do not count a prepared tip', () => {
  clock += 91000; run('guideSheet("addsheet")'); showTip(); assert.equal(run('guide.count'), 1);
});
check('opening the sheet makes its tip eligible', () => {
  document.getElementById('addsheet').classList.add('open'); showTip(); assert.equal(run('guide.count'), 2);
  document.getElementById('addsheet').classList.remove('open');
});
check('session cap holds even after cooldown', () => {
  clock += 91000; run('guideClear(); guideSheet("setsheet")'); assert.equal(run('guide.active'), null);
});
check('learned action retires an unseen tip', () => {
  reset(); run('guideLearn("set"); guideSheet("setsheet")'); assert.equal(run('guide.active'), null);
});
check('all tips can be disabled', () => {
  reset(); run('guide.off = true; guideSheet("addsheet")'); assert.equal(run('guide.active'), null);
});
check('account switch clears active DOM and preferences', () => {
  reset(); run('guide.off = true; guide.motion = false; guideSave(); state.user.id = "bob"; guideUser()');
  assert.equal(run('guide.off'), false); assert.equal(run('guide.motion'), true); assert.equal(run('guide.count'), 0);
});
check('returning account gets its own preferences', () => {
  run('state.user.id = "alice"; guideUser()'); assert.equal(run('guide.off'), true); assert.equal(run('guide.motion'), false);
});
check('storage failure does not break a tip', () => {
  context.localStorage.setItem = () => { throw new Error('private'); };
  run('guideLearn("detail")'); assert.equal(run('guide.seen.detail'), true);
});
check('hidden tab cannot offer a tip', () => {
  reset(); document.hidden = true; run('guideSheet("addsheet")'); assert.equal(run('guide.active'), null); document.hidden = false;
});
check('reduced motion never requests the GIF', () => {
  reduced = true; run('var art = pumpyArt("proud", true); document.body.appendChild(art)');
  while(timers.length) timers.shift().fn(); observers.at(-1).show();
  assert.match(run('art.firstChild.src'), /proud\.webp$/); reduced = false;
});
check('one visible wing beat returns to its still', () => {
  run('guide.motion = true; var art2 = pumpyArt("proud", true); document.body.appendChild(art2)');
  while(timers.length) timers.shift().fn(); observers.at(-1).show();
  assert.match(run('art2.firstChild.src'), /proud-wing\.gif$/);
  while(timers.length) timers.shift().fn(); assert.match(run('art2.firstChild.src'), /proud\.webp$/);
});
check('in-flight motion stops when requested', () => {
  run('art2.firstChild.setAttribute("data-pumpy-still", "proud.webp"); art2.firstChild.src = "proud-wing.gif"; guideStill()');
  assert.equal(run('art2.firstChild.src'), 'proud.webp');
});
check('wing motion waits for visibility and stops offscreen', () => {
  run('var art3 = pumpyArt("proud", true); document.body.appendChild(art3)');
  while(timers.length) timers.shift().fn();
  const observer = observers.at(-1);
  observer.fn([{isIntersecting:true, intersectionRatio:0.1}]);
  assert.match(run('art3.firstChild.src'), /proud\.webp$/);
  observer.show(); assert.match(run('art3.firstChild.src'), /proud-wing\.gif$/);
  observer.fn([{isIntersecting:false, intersectionRatio:0}]);
  assert.match(run('art3.firstChild.src'), /proud\.webp$/); assert.equal(observer.disconnected, true);
});
check('guide stays available even when automatic tips are off', () => {
  run('guide.off = true; openPumpyGuide()'); assert.equal(document.querySelectorAll('.guide-topic').length, 6);
});
check('saving a preference preserves other profile settings', () => {
  let written;
  context.sb = {from: () => ({update: value => { written = value; return {eq: () => ({then: fn => fn({})})}; }})};
  context.goalSetting = () => 4;
  context.remind = {plan:true, risk:false, at:'17:00'};
  context.tzName = () => 'America/Indiana/Indianapolis';
  run('state.profile = {settings:{futurePreference:"keep"}}; state.unit="kg"; state.sounds=false; state.haptics=true;');
  run(app.slice(app.indexOf('  function saveSettings()'), app.indexOf('  function toggleUnit()')));
  run('saveSettings()');
  assert.equal(written.settings.futurePreference, 'keep'); assert.equal(written.settings.unit, 'kg');
  assert.equal(written.settings.goal, 4); assert.equal(written.settings.remind.plan, true);
});
check('built page equals edge-function page', () => {
  const generated = fs.readFileSync('supabase/functions/spotter/page.gen.ts', 'utf8');
  assert.equal(JSON.parse(generated.slice(generated.indexOf('"'), generated.lastIndexOf('"') + 1)), fs.readFileSync('docs/index.html', 'utf8'));
});
console.log(checks + ' checks passed');

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
const { document, HTMLElement } = parseHTML('<html><body>' + markup.slice(markup.indexOf('export const MARKUP_BODY')) + '</body></html>');
document.hidden = false;
HTMLElement.prototype.getBoundingClientRect = function () { return {height:160,width:320,top:0}; };
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
  Date: { now: () => clock, parse: Date.parse },
  localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
  setTimeout: (fn, ms) => { const timer = {fn,ms}; timers.push(timer); return timer; },
  clearTimeout: timer => { const i = timers.indexOf(timer); if (i >= 0) timers.splice(i,1); },
  state: { user: { id: 'alice' }, view: 'library', logs: [], workouts: [] },
  pumpy: { loaded: true, messages: [], refs: [], refsRev: 0 }, planBody: document.createElement('div'),
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
check('reduced motion never requests animation', () => {
  reduced = true; run('var art = pumpyArt("proud", true); document.body.appendChild(art)');
  while(timers.length) timers.shift().fn(); observers.at(-1).show();
  assert.match(run('art.firstChild.src'), /proud\.webp\?v=12$/); reduced = false;
});
check('one visible wing beat returns to its still', () => {
  run('guide.motion = true; var art2 = pumpyArt("proud", true); document.body.appendChild(art2)');
  while(timers.length) timers.shift().fn(); observers.at(-1).show();
  assert.match(run('art2.firstChild.src'), /proud-wing\.webp\?v=12$/);
  run('art2.firstChild.onload()');
  while(timers.length) timers.shift().fn(); assert.match(run('art2.firstChild.src'), /proud\.webp\?v=12$/);
});
check('in-flight motion stops when requested', () => {
  run('art2.firstChild.setAttribute("data-pumpy-still", "proud.webp"); art2.firstChild.src = "proud-wing.gif"; guideStill()');
  assert.equal(run('art2.firstChild.src'), 'proud.webp');
});
check('wing motion waits for visibility and stops offscreen', () => {
  run('guide.played = {}; var art3 = pumpyArt("proud", true); document.body.appendChild(art3)');
  while(timers.length) timers.shift().fn();
  const observer = observers.at(-1);
  observer.fn([{isIntersecting:true, intersectionRatio:0.1}]);
  assert.match(run('art3.firstChild.src'), /proud\.webp\?v=12$/);
  observer.show(); assert.match(run('art3.firstChild.src'), /proud-wing\.webp\?v=12$/);
  observer.fn([{isIntersecting:false, intersectionRatio:0}]);
  assert.match(run('art3.firstChild.src'), /proud\.webp\?v=12$/); assert.equal(observer.disconnected, true);
});
check('guide stays available even when automatic tips are off', () => {
  run('guide.off = true; openPumpyGuide()'); assert.equal(document.querySelectorAll('.guide-topic').length, 6);
});
check('a rerender cannot restart the same decorative animation', () => {
  run('var art4 = pumpyArt("proud", true); document.body.appendChild(art4)');
  while(timers.length) timers.shift().fn(); observers.at(-1).show();
  assert.match(run('art4.firstChild.src'), /proud\.webp\?v=12$/);
});
check('slow animation loading gets a full playback window', () => {
  run('guide.played = {}; var slow = pumpyArt("proud", true); document.body.appendChild(slow)');
  while(timers.length) timers.shift().fn(); observers.at(-1).show();
  assert.equal(timers.length, 0); run('slow.firstChild.onload()');
  assert.equal(timers.at(-1).ms, 2400);
  while(timers.length) timers.shift().fn();
  assert.match(run('slow.firstChild.src'), /proud\.webp\?v=12$/);
});
check('failed animation falls back to its still illustration', () => {
  run('guide.played = {}; var failed = pumpyArt("hello", true); document.body.appendChild(failed)');
  while(timers.length) timers.shift().fn(); observers.at(-1).show();
  run('failed.firstChild.onerror()'); assert.match(run('failed.firstChild.src'), /hello\.webp\?v=12$/);
  assert.equal(run('failed.classList.contains("artfailed")'), false);
});
check('closing a sheet keeps the tip geometry through its exit', () => {
  reset(); run('guideSheet("addsheet"); var leaving = guide.active.node; guideClear("hold")');
  assert.equal(run('guide.active'), null); assert.equal(run('leaving.isConnected'), true);
  assert.equal(run('leaving.inert'), true);
  while(timers.length) timers.shift().fn(); assert.equal(run('leaving.isConnected'), false);
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
context.localStorage.setItem = (k,v) => storage.set(k,v);
context.history = {pushState(){}, back(){}};
run(app.slice(app.indexOf('  var closeTimers ='), app.indexOf('  // ---------- pushing a sheet away')));
check('an existing account is not interrupted by a new introduction', () => {
  run('state.user.created_at="2026-09-01T12:00:00Z"; guide.welcome=false;');
  assert.equal(run('welcomeEligible()'), false);
});
check('a new account gets exactly three introduction steps', () => {
  run('state.user.created_at="2026-09-06T15:00:00Z"; state.view="library"; welcomeMaybe()');
  assert.equal(document.querySelectorAll('.welcome-page').length, 3);
  assert.equal(document.getElementById('welcomesheet').classList.contains('open'), true);
  assert.equal(document.getElementById('welcomeback').disabled, true);
});
check('next and back show one accessible step without rebuilding it', () => {
  const first = document.querySelector('.welcome-page');
  document.getElementById('welcomenext').onclick();
  assert.equal(document.querySelectorAll('.welcome-page.on').length, 1);
  assert.equal(first.inert, true); assert.equal(run('welcomeStep'), 1);
  document.getElementById('welcomeback').onclick(); assert.equal(run('welcomeStep'), 0);
  assert.equal(first, document.querySelector('.welcome-page'));
});
check('finishing retires the intro locally and on the profile', () => {
  document.getElementById('welcomenext').onclick(); document.getElementById('welcomenext').onclick();
  assert.equal(document.getElementById('welcomenext').textContent, 'Let’s go');
  document.getElementById('welcomenext').onclick();
  assert.equal(run('guide.welcome'), true); assert.equal(run('state.profile.settings.pumpyWelcome'), 1);
  assert.equal(run('state.profile.settings.futurePreference'), 'keep');
  assert.equal(JSON.parse(storage.get('spotter_pumpy_v1:alice')).welcome, true);
  assert.equal(run('welcomeEligible()'), false);
});
check('manual replay remains available after completion', () => {
  run('openSheet("settingssheet"); openPumpyGuide()');
  document.getElementById('welcomereplay').onclick();
  assert.equal(document.getElementById('welcomesheet').classList.contains('open'), true);
  assert.equal(run('welcomeStep'), 0);
  assert.deepEqual(Array.from(document.querySelectorAll('.sheet.open')).map(n => n.id), ['welcomesheet']);
  assert.equal(run('welcomeReturn.id'), 'addbtn');
});
check('skip also completes the intro and keeps contextual tips enabled', () => {
  run('guide.off=false; guide.welcome=false; delete state.profile.settings.pumpyWelcome;');
  document.getElementById('welcomeskip').onclick();
  assert.equal(run('guide.welcome'), true); assert.equal(run('guide.off'), false);
  assert.equal(document.getElementById('welcomesheet').classList.contains('open'), false);
});
check('an account already using the library does not get interrupted', () => {
  run('guide.welcome=false; delete state.profile.settings.pumpyWelcome; state.workouts=[{}];');
  assert.equal(run('welcomeEligible()'), false);
});
check('height transitions cancel and retarget safely', () => {
  const node = document.createElement('div'); let cancelled = 0, done = 0;
  const animations = [];
  node.animate = (frames) => { const a = {frames,cancel(){cancelled++;}}; animations.push(a); return a; };
  context.motionNode = node; context.finishSize = () => done++;
  run('sizeMotion(motionNode, 40, 180, finishSize); sizeMotion(motionNode, 90, 40, finishSize)');
  assert.equal(cancelled, 1); assert.equal(animations[1].frames[0].height, '90px');
  animations[0].onfinish(); assert.equal(done, 0);
  animations[1].onfinish(); assert.equal(done, 1);
});
check('arriving on a warmed Pumpy tab preserves the greeting and its animation', () => {
  let redraws = 0, meters = 0;
  context.renderPumpy = () => redraws++;
  context.ensurePumpyMeter = () => meters++;
  run(app.slice(app.indexOf('  function loadPumpy(warm)'), app.indexOf('  function settlePumpy(t)')));
  run('pumpy.loaded=true; loadPumpy(true); loadPumpy()');
  assert.equal(redraws, 0); assert.equal(meters, 1);
});
check('the greeting loops without a timer or repeat network requests', () => {
  run('guide.motion=true; var idleArt=pumpyArt("hello",true); document.getElementById("pumpyview").inert=false; document.getElementById("pumpyview").appendChild(idleArt)');
  while(timers.length) timers.shift().fn(); observers.at(-1).show();
  assert.match(run('idleArt.firstChild.src'), /hello-idle\.webp\?v=12$/);
  run('idleArt.firstChild.onload()'); assert.equal(timers.length, 0);
  const source = run('idleArt.firstChild.src'); run('guideWake(); guideWake()');
  assert.equal(run('idleArt.firstChild.src'), source);
  assert.equal(run('guide.played.hello'), undefined);
});
check('the greeting pauses offscreen and resumes on a later visit', () => {
  const observer = observers.at(-1);
  observer.fn([{isIntersecting:false, intersectionRatio:0}]);
  assert.match(run('idleArt.firstChild.src'), /hello\.webp\?v=12$/);
  assert.equal(observer.disconnected, false); run('guideWake()');
  assert.equal(run('idleArt.firstChild.hasAttribute("data-pumpy-still")'), false);
  observer.show(); assert.match(run('idleArt.firstChild.src'), /hello-idle\.webp\?v=12$/);
  run('document.getElementById("pumpyview").inert=true; guideWake()');
  assert.equal(run('idleArt.firstChild.hasAttribute("data-pumpy-still")'), false);
  run('document.getElementById("pumpyview").inert=false; guideWake()');
  assert.equal(run('idleArt.firstChild.hasAttribute("data-pumpy-still")'), true);
});
check('backgrounding, overlays, and motion preferences pause the repeating blink', () => {
  document.hidden=true; run('guideStill(); guideWake()');
  assert.equal(run('idleArt.firstChild.hasAttribute("data-pumpy-still")'), false);
  document.hidden=false; run('guideWake()');
  assert.equal(run('idleArt.firstChild.hasAttribute("data-pumpy-still")'), true);
  run('openSheet("settingssheet"); guideWake()');
  assert.equal(run('idleArt.firstChild.hasAttribute("data-pumpy-still")'), false);
  run('closeSheet("settingssheet")'); while(timers.length) timers.shift().fn();
  assert.equal(run('idleArt.firstChild.hasAttribute("data-pumpy-still")'), true);
  reduced=true; run('guideWake()'); assert.equal(run('idleArt.firstChild.hasAttribute("data-pumpy-still")'), false);
  reduced=false; run('guide.motion=false; guideWake()'); assert.equal(run('idleArt.firstChild.hasAttribute("data-pumpy-still")'), false);
  run('guide.motion=true; guideWake()'); assert.equal(run('idleArt.firstChild.hasAttribute("data-pumpy-still")'), true);
});
check('a failed idle asset stays on its still without a retry loop', () => {
  run('idleArt.firstChild.onerror(); guideWake()');
  assert.match(run('idleArt.firstChild.src'), /hello\.webp\?v=12$/);
  assert.equal(observers.at(-1).disconnected, true);
});
check('the idle asset changes only the existing animation loop header', () => {
  const once=fs.readFileSync('docs/assets/pumpy/hello-motion.webp');
  const idle=fs.readFileSync('docs/assets/pumpy/hello-idle.webp');
  let i=12; while(once.toString('ascii',i,i+4)!=='ANIM') { const n=once.readUInt32LE(i+4); i+=8+n+(n%2); assert.ok(i<once.length); }
  assert.equal(once.readUInt16LE(i+12),1); assert.equal(idle.readUInt16LE(i+12),0);
  const expected=Buffer.from(once); expected.writeUInt16LE(0,i+12); assert.deepEqual(idle,expected);
});

// Use the real reference renderer, request builder and cold-load completion.
context.MAX_REFS=6; context.ctxSeen={}; context.NO_TOUCH=false;
context.srcById=id=>context.state.workouts.find(w=>w.id===id);
context.setView=v=>{context.state.view=v;};
context.renderPumpy=()=>run('renderPumpyCtx()');
run(app.slice(app.indexOf('  function openPumpy(w)'),app.indexOf('  // sizePumpy()')));
run(app.slice(app.indexOf('  function settlePumpy(t)'),app.indexOf('  // ---------- Pumpy · the thread list')));
run(app.slice(app.indexOf('  function renderPumpyCtx()'),app.indexOf('  function openRefSheet()')));
run(app.slice(app.indexOf('  function sendPumpy(text)'),app.indexOf('  function confirmPumpy(')));
const chosen={id:'chosen',title:'Kettlebell strength'}, other={id:'old',title:'Earlier workout'};
context.state.workouts=[chosen,other]; context.chosen=chosen;
const past={id:'thread',title:'Old chat',workout_id:'old',pumpy_messages:[{role:'user',meta:{refs:['old']}}]};
context.past=past;
check('Ask Pumpy shows the chosen workout chip without rebuilding the conversation', () => {
  run('pumpy.refs=[]; pumpy.refsRev=0; openPumpy(chosen)');
  assert.equal(context.state.view,'pumpy'); assert.deepEqual(Array.from(context.pumpy.refs),['chosen']);
  assert.equal(document.querySelector('#pumpyctx .refchip b').textContent,chosen.title);
  assert.equal(document.getElementById('pumpyctx').classList.contains('hide'),false);
});
check('asking about an already attached workout puts it first without duplicates', () => {
  run('pumpy.refs=["old","chosen","a","b","c","d"]; openPumpy(chosen)');
  assert.deepEqual(Array.from(context.pumpy.refs),['chosen','old','a','b','c','d']);
  run('pumpy.refs=["old","a","b","c","d","e"]; openPumpy(chosen)');
  assert.equal(context.pumpy.refs.length,6); assert.equal(context.pumpy.refs[0],'chosen');
});
check('a selection made before or during initial chat loading wins over old context', () => {
  run('pumpy.refs=[]; pumpy.refsRev=0; openPumpy(chosen); settlePumpy(past)');
  assert.deepEqual(Array.from(context.pumpy.refs),['chosen']);
  assert.equal(document.querySelector('#pumpyctx .refchip b').textContent,chosen.title);
});
check('removing a pending attachment cannot be undone by late chat history', () => {
  document.querySelector('#pumpyctx .refchip button').onclick();
  while(timers.length) timers.shift().fn(); run('settlePumpy(past)');
  assert.deepEqual(Array.from(context.pumpy.refs),[]);
  assert.equal(document.getElementById('pumpyctx').classList.contains('hide'),true);
});
check('existing context still loads when no new reference was selected', () => {
  run('pumpy.refs=[]; pumpy.refsRev=0; settlePumpy(past)');
  assert.deepEqual(Array.from(context.pumpy.refs),['old']);
});
check('the next question sends the selected workout IDs to Pumpy', () => {
  let sent;
  context.apiStream=(path,payload)=>{sent={path,payload}; return {then(){return {catch(){}};}};};
  run('pumpy.busy=false; openPumpy(chosen); sendPumpy("How should I warm up for this?")');
  assert.equal(sent.path,'pumpy/chat'); assert.equal(sent.payload.workout_id,'chosen');
  assert.deepEqual(Array.from(sent.payload.workout_ids),['chosen','old']);
  assert.equal(sent.payload.message,'How should I warm up for this?');
});
check('reopening a chat preserves an explicitly cleared attachment list', () => {
  assert.equal(run('lastRefs([{role:"user",meta:{refs:["old"]}},{role:"user",meta:{refs:[]}}], "old").length'), 0);
});

check('built page equals edge-function page', () => {
  const generated = fs.readFileSync('supabase/functions/spotter/page.gen.ts', 'utf8');
  assert.equal(JSON.parse(generated.slice(generated.indexOf('"'), generated.lastIndexOf('"') + 1)), fs.readFileSync('docs/index.html', 'utf8'));
});
console.log(checks + ' checks passed');

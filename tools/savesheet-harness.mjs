// The Save workout sheet leads with sharing in the app and with the link box on
// the web. Checked here, per platform (iOS app, Android app, web):
//   - which block comes first when the sheet opens, and that a link put back
//     after a failed share still opens the box-first sheet;
//   - that the link box and the upload row are still wired as before;
//   - what the empty library, the replayed welcome and Pumpy's tip say;
//   - which Settings lines each platform shows (the Shortcut set-up is web only);
//   - that "Open TikTok" leaves by a top-level navigation and closes the sheet
//     only once the phone has actually gone to the other app.
//
//   node tools/savesheet-harness.mjs
//
// Functions are lifted out of app.ts the way tools/share-client-harness.mjs does
// it and run in a vm over a small fake DOM built from markup.ts's own tags. No
// browser, no server, no network.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const APP = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const MARKUP = fs.readFileSync('supabase/functions/spotter/markup.ts', 'utf8');
const STYLE = fs.readFileSync('supabase/functions/spotter/style.ts', 'utf8');
function fn(name) {
  const head = '  function ' + name + '(';
  const a = APP.indexOf(head);
  assert(a >= 0, 'app.ts no longer declares ' + name);
  const b = APP.indexOf('\n  }\n', a);
  return APP.slice(a, b + 4);
}
function between(src, from, to, what) {
  const a = src.indexOf(from), b = src.indexOf(to, a + from.length);
  assert(a >= 0 && b > a, (what || 'source') + ' section moved: ' + from);
  return src.slice(a, b);
}
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&rsquo;|’/g, '\'').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

let checks = 0;
const ok = (cond, label) => { assert.ok(cond, label); checks++; };

// ---- a fake DOM: text, classes, attributes, children, listeners ----
function node(tag, attrs, txt) {
  const classes = new Set(String((attrs && attrs.class) || '').split(/\s+/).filter(Boolean));
  const n = {
    tagName: tag, attrs: Object.assign({}, attrs || {}), textContent: txt || '', value: '', children: [],
    hidden: false, disabled: false, listeners: {}, clicked: 0,
    classList: {
      toggle(c, on) { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); },
      add(c) { classes.add(c); }, remove(c) { classes.delete(c); }, contains(c) { return classes.has(c); },
    },
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
    set innerHTML(v) { assert.equal(v, '', 'the fake DOM only empties'); this.children.length = 0; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    click() { this.clicked++; if (this.onclick) this.onclick({}); },
    all() { return this.children.flatMap((c) => [c, ...c.all()]); },
    querySelectorAll(sel) {
      assert.equal(sel, '[data-on]', 'the fake DOM only answers [data-on]');
      return this.all().filter((c) => c.getAttribute('data-on') !== null);
    },
    querySelector(sel) { return this.all().find((c) => c.classList.contains(sel.replace(/^\./, ''))) || null; },
    cloneNode() {
      const copy = node(this.tagName, this.attrs, this.textContent);
      copy.className = this.className;
      this.children.forEach((c) => copy.appendChild(c.cloneNode(true)));
      return copy;
    },
  };
  return n;
}
const visible = (n) => !n.classList.contains('hide');

// Every element markup.ts marks with data-on, as a node carrying the words it shows.
function dataOnNodes(html) {
  const out = [];
  const re = /<(\w+)([^>]*?)\sdata-on="([^"]+)"([^>]*)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(html))) {
    const cls = /class="([^"]+)"/.exec(m[2] + m[4]);
    const id = /id="([^"]+)"/.exec(m[2] + m[4]);
    const n = node(m[1], { 'data-on': m[3], class: cls ? cls[1] : '', id: id ? id[1] : '' }, text(m[5]));
    out.push(n);
  }
  return out;
}

// ---- the markup: order and wiring of the add sheet ----
const SHEET = between(MARKUP, '<div class="sheet" id="addsheet">', '<div class="sheet" id="setsheet">', 'markup.ts');
const at = (s) => { const i = SHEET.indexOf(s); assert(i >= 0, 'the add sheet lost ' + s); return i; };
ok(at('id="addlede"') < at('class="sharehow"') && at('class="sharehow"') < at('class="orpaste"') &&
  at('class="orpaste"') < at('id="addurl"') && at('id="addurl"') < at('id="addgo"') && at('id="addgo"') < at('id="uploadrow"'),
  'the add sheet reads: title, lede, the share row, "Or paste a link", the box, Save workout, Upload');
ok(/<div class="orpaste">Or paste a link<\/div>/.test(SHEET), 'the box is headed as the second way: "Or paste a link"');
const FLOW = between(SHEET, '<ol class="shareflow">', '</ol>', 'the share row');
const steps = [...FLOW.matchAll(/<li([^>]*)>([\s\S]*?)<\/li>/g)].map((m) => ({ on: (/data-on="([^"]+)"/.exec(m[1]) || [])[1] || null, words: text(m[2]) }));
ok(JSON.stringify(steps) === JSON.stringify([
  { on: null, words: 'Tap Share' }, { on: 'ios', words: 'Tap More' }, { on: null, words: 'Tap Spotter' }]),
  'the row is Share, More (iPhone only), Spotter, and a screen reader hears "Tap" before each');
ok(/<span class="sfmark app" aria-hidden="true"><img src="icon\.png" alt=""/.test(FLOW),
  'the last step is Spotter\'s own icon, the thing to look for in the share sheet');
ok(!/<img[^>]+src="(?!icon\.png)/.test(between(SHEET, '<div class="sharehow">', '<div class="orpaste">')),
  'no picture of another company\'s screen: the only image is Spotter\'s icon');
ok(/data-app="https:\/\/www\.tiktok\.com\/"/.test(SHEET) && /data-app="https:\/\/www\.instagram\.com\/"/.test(SHEET),
  'Open TikTok and Open Instagram go by the sites\' own addresses');

// ---- the stylesheet: the share row shows only in share mode ----
ok(STYLE.includes('.sharehow, .orpaste { display: none; }') && STYLE.includes('#addsheet.share .sharehow { display: block; }') &&
  STYLE.includes('#addsheet.share .orpaste { display: flex; }'),
  'the share row and its "Or paste a link" are hidden unless the sheet is in share mode');
ok((STYLE.match(/\.sharehow[^{]*\{[^}]*display/g) || []).length === 2,
  'nothing else decides whether the share row shows');
ok(/#addsheet\.share:has\(#addurl:placeholder-shown\) #addgo \{ background: var\(--sand\)/.test(STYLE),
  'in share mode Save workout is quiet until a link is in the box, and ember once one is');
ok(/@media \(prefers-reduced-motion: reduce\) \{\s*#addsheet\.open \.sfmark::after, #addsheet\.open \.sfmark\.app::after \{ animation: none; \}/.test(STYLE),
  'the ring that walks the row stands still under reduced motion');
ok(/#addsheet\.attach \.field, #addsheet\.attach #addgo \{ display: none; \}/.test(STYLE) && /#addsheet\.attach \.webnote \{ display: none; \}/.test(STYLE),
  '"Add the video" keeps its picker-only sheet');

// ---- addMode, per platform ----
const dom = {
  addsheet: node('div', { class: 'sheet' }), addtitle: node('h2', {}, 'Add a workout'),
  addlede: node('p', {}, 'Paste a link to a TikTok, Instagram reel, YouTube video, or any workout page.'),
  uptitle: node('b', {}, 'Upload a video from your phone'), upsub: node('small', {}, 'Spotter watches and listens…'),
  addfile: node('input'), addurl: node('input'),
};
const ctx = vm.createContext({ console, Math, String, Array, Object, JSON, setTimeout, clearTimeout });
vm.runInContext('var native = null; var DOM = {}; function $(id) { return DOM[id]; }\n' +
  [fn('addMode'), fn('saveOn'), fn('paintSaveOn'), fn('shareWords')].join('\n') + '\nvar attachTo = null, addWords = null;', ctx);
ctx.DOM = dom;
const run = (code) => vm.runInContext(code, ctx);
const IOS = { platform: 'ios' }, ANDROID = { platform: 'android' };
function open(nativeShell, link) {
  ctx.native = nativeShell; dom.addurl.value = link || '';
  run('addMode(null)');
  return { share: dom.addsheet.classList.contains('share'), title: dom.addtitle.textContent, lede: dom.addlede.textContent };
}
let s = open(IOS);
ok(s.share && s.title === 'Save from any app' && /TikTok, Instagram, YouTube/.test(s.lede),
  'iOS app: the sheet opens in share mode, headed "Save from any app"');
s = open(ANDROID);
ok(s.share && s.title === 'Save from any app', 'Android app: the same share-first sheet');
s = open(null);
ok(!s.share && s.title === 'Add a workout' && /^Paste a link/.test(s.lede),
  'web: no share extension exists, so the link box leads, word for word as before');
s = open(IOS, 'https://www.tiktok.com/@a/video/1');
ok(!s.share && s.title === 'Add a workout',
  'a share that failed and was put back in the box reopens box-first, so the retry is the first thing seen');
s = open(IOS, '   ');
ok(s.share, 'a box of spaces is an empty box');
ctx.native = IOS; dom.addurl.value = '';
run('addMode({ title: "Core day" })');
ok(!dom.addsheet.classList.contains('share') && dom.addsheet.classList.contains('attach') && dom.addtitle.textContent === 'Add the video',
  '"Add the video" is never share mode');
run('addMode(null)');
ok(dom.addsheet.classList.contains('share') && !dom.addsheet.classList.contains('attach') && dom.upsub.textContent === 'Spotter watches and listens…',
  'and the ordinary sheet comes back from it whole');
ctx.native = { takeParkedShare() {} };
ok(run('saveOn()') === 'ios', 'a shell that names no platform is treated as the iPhone one (the older shells)');

// ---- paintSaveOn: which lines each platform shows ----
function paint(shell) {
  ctx.native = shell;
  const root = node('div');
  dataOnNodes(MARKUP).forEach((n) => root.appendChild(n));
  ctx.ROOT = root; run('paintSaveOn(ROOT)');
  return root.children.filter(visible).map((n) => n.attrs.id || n.textContent);
}
const ios = paint(IOS), android = paint(ANDROID), web = paint(null);
const has = (list, re) => list.some((t) => re.test(t));
const sheetOnly = (list) => list.filter((t) => !/^In TikTok, Instagram, YouTube or any app/.test(t));
ok(has(ios, /^Tap More$/) && has(sheetOnly(ios), /^Not in the row\? Scroll down to Save to Spotter\.$/) &&
  has(sheetOnly(ios), /^One tap next time: in More, tap Edit and add Spotter to Favorites\.$/) && !has(ios, /under More/),
  'iOS: the More step, "Save to Spotter" further down, and the Favorites tip');
ok(!has(android, /^Tap More$/) && has(android, /In TikTok, Spotter is under More/) && !has(android, /Favorites/),
  'Android: Share then Spotter, with TikTok\'s More as a note, and no iPhone-only tip');
ok(!has(web, /^Tap More$/) && has(web, /In the Spotter app you save straight from the Share button/) && !has(ios, /In the Spotter app you save/),
  'web: a line that the app saves from the share sheet, which the app itself does not show');
ok(has(web, /^shortcutsetup$/) && !has(ios, /^shortcutsetup$/) && !has(android, /^shortcutsetup$/),
  'Settings: the legacy iPhone Shortcut set-up is web only; the app has the Share extension');
ok(has(ios, /tap Share, then More, then Spotter/) && has(android, /tap Share, then Spotter\. In TikTok it is under More/) &&
  has(web, /In the Spotter app — tap Share/) && !has(web, /then More, then Spotter/),
  'Settings › Save from your phone says what the sheet says, per platform');
const PHONE = between(MARKUP, '<details class="disclosure" id="phonesave">', '<h3 class="seth">Data', 'Settings');
ok(/<p class="lede"><b>Or<\/b> copy the video’s link and paste it into <b>Save workout<\/b>\.<\/p>/.test(PHONE),
  'and on every platform, the link box as the other way');
ok(!/nativesharehelp|Android<\/b> — install Spotter/.test(MARKUP) && !/shortcutsetup"\)\.classList/.test(APP),
  'the old per-platform toggles are gone, so nothing re-shows a line paintSaveOn hid');
ok(/\n  paintSaveOn\(document\);\n/.test(APP), 'the page is painted once at start-up');
ok(run('(native = { platform: "ios" }, shareWords())') === 'tap Share, then More, then Spotter' &&
  run('(native = { platform: "android" }, shareWords())') === 'tap Share, then Spotter', 'the words for the steps, per platform');

// ---- the empty library, first run ----
{
  const snippet = between(APP, '      if (!state.workouts.length) {', '      } else {', 'renderGrid') + '}';
  const c = vm.createContext({ console, Array, String });
  const flow = node('ol', { class: 'shareflow' });
  steps.forEach((st) => flow.appendChild(node('li', st.on ? { 'data-on': st.on } : {}, st.words)));
  const sheet = node('div'); sheet.appendChild(flow);
  vm.runInContext('var native = null, state = { workouts: [] }; var D = {};' +
    'function $(id) { return D[id]; } function el(t, cls, txt) { return MK(t, { class: cls || "" }, txt); }\n' +
    fn('saveOn') + fn('paintSaveOn') + '\nfunction paintEmpty(empty) {\n' + snippet + '\n}', c);
  c.MK = node; c.D = { addsheet: sheet, addbtn: node('button') };
  const emptyFor = (shell) => {
    c.native = shell;
    const empty = node('div');
    vm.runInContext('paintEmpty(E)', Object.assign(c, { E: empty }));
    return empty;
  };
  const e1 = emptyFor(IOS), e2 = emptyFor(ANDROID), e3 = emptyFor(null);
  const words = (e) => e.children.map((n) => n.textContent).join(' | ');
  const flowOf = (e) => e.children.find((n) => n.classList.contains('shareflow'));
  ok(/Share it to Spotter/.test(words(e1)) && flowOf(e1) && flowOf(e1) !== flow &&
    JSON.stringify(flowOf(e1).children.filter(visible).map((n) => n.textContent)) === '["Tap Share","Tap More","Tap Spotter"]',
    'iOS first run: the empty library shows the share row (a copy of the sheet\'s), Share › More › Spotter');
  ok(flowOf(e2) && JSON.stringify(flowOf(e2).children.filter(visible).map((n) => n.textContent)) === '["Tap Share","Tap Spotter"]',
    'Android first run: Share › Spotter');
  ok(!flowOf(e3) && /Paste a TikTok, Instagram, or YouTube link to get started\./.test(words(e3)),
    'web first run: paste a link, as before');
  ok([e1, e2, e3].every((e) => e.children.some((n) => n.textContent === 'Save your first workout')),
    'every platform keeps the one button into the sheet');
  ok(steps.length === 3 && flow.children.every(visible), 'the sheet\'s own row is copied, never moved or repainted');
}

// ---- the replayed welcome and Pumpy's tip ----
{
  const c = vm.createContext({ console, Array, String, MK: node });
  vm.runInContext('var native = null, welcomeReturn = null, document = { activeElement: null };' +
    'var D = { welcomestage: MK("div"), welcomecount: MK("span"), welcomenext: MK("button") }; D.welcomenext.focus = function () {};' +
    'function $(id) { return D[id]; } function el(t, cls, txt) { return MK(t, { class: cls || "" }, txt); }' +
    'function pumpyArt() { return MK("span"); } function openSheet() {}\n' +
    fn('saveOn') + fn('shareWords') + fn('openWelcome'), c);
  const welcome = (shell) => { c.native = shell; vm.runInContext('openWelcome()', c); return c.D.welcomestage.children[0].children.map((n) => n.textContent).join(' | '); };
  ok(/In TikTok, Instagram or YouTube, tap Share, then More, then Spotter\./.test(welcome(IOS)) &&
    /tap Share, then Spotter\./.test(welcome(ANDROID)) && /Paste a TikTok, Instagram, or YouTube link\./.test(welcome(null)),
    '"How to save a workout" teaches the share row in the app and the link on the web');
  const tips = (shell) => vm.runInContext('(function (native) {' + between(APP, '  var GUIDE_TIPS = {', '  function guideKey()', 'GUIDE_TIPS') + ' return GUIDE_TIPS.save.text; })(N)', Object.assign(c, { N: shell }));
  ok(/^Share it from TikTok or Instagram, or paste its link below\./.test(tips(IOS)) && /^Paste the workout link/.test(tips(null)),
    'Pumpy\'s first save tip matches the platform');
  ok(fn('guideSheet').includes('b.querySelector(".orpaste, .field, .stepper")'),
    'and sits under the share row, not above it (above the box on the web, as before)');
}

// ---- the link box and the upload row are wired as they were ----
{
  const wiring = between(APP, '  $("addbtn").onclick = function ()', '  $("exeditsave").onclick', 'wiring');
  const ids = ['addbtn', 'addurl', 'addgo', 'uploadrow', 'addfile'];
  const d = {}; ids.forEach((id) => { d[id] = node('button', { id }); });
  const apps = [node('button', { 'data-app': 'https://www.tiktok.com/' }), node('button', { 'data-app': 'https://www.instagram.com/' })];
  const c = vm.createContext({ console, Array, String, D: d, APPS: apps });
  vm.runInContext('var calls = [], opened = []; function $(id) { return D[id]; }' +
    'var document = { querySelectorAll: function (sel) { return sel === "[data-app]" ? APPS : []; } };' +
    'function resetUpload() { calls.push("resetUpload"); } function addMode(w) { calls.push("addMode:" + w); }' +
    'function openSheet(id) { calls.push("open:" + id); } function doAdd(fromShare) { calls.push("doAdd:" + fromShare); }' +
    'function upError(m) { calls.push("upError:" + m); } function doUpload(f) { calls.push("doUpload:" + f.name); }' +
    'function paintSaveOn(root) { calls.push(root === document ? "paint:document" : "paint:?"); }' +
    'function openSourceApp(u) { opened.push(u); }\n' + wiring, c);
  vm.runInContext('D.addbtn.value = ""; D.addurl.value = "https://x"; calls = []', c);
  d.addbtn.onclick();
  ok(JSON.stringify(c.calls) === '["resetUpload","addMode:null","open:addsheet"]' && d.addurl.value === '',
    '+ Save workout empties the box, resets the upload, picks the mode, then opens the sheet');
  vm.runInContext('calls = []', c); d.addgo.onclick({ type: 'click' });
  d.addurl.listeners.keydown.forEach((f) => f({ key: 'Enter' }));
  d.addurl.listeners.keydown.forEach((f) => f({ key: 'a' }));
  ok(JSON.stringify(c.calls) === '["doAdd:undefined","doAdd:undefined"]',
    'Save workout and Enter in the box both save the link (never as a share)');
  vm.runInContext('calls = []', c); d.uploadrow.onclick();
  ok(d.addfile.clicked === 1 && c.calls[0] === 'upError:', 'the upload row still opens the file picker');
  d.addfile.onchange.call({ files: [{ name: 'clip.mp4' }] });
  ok(c.calls.includes('doUpload:clip.mp4'), 'and a picked file still uploads');
  apps[1].onclick();
  ok(JSON.stringify(c.opened) === '["https://www.instagram.com/"]', 'each Open button hands its own address over');
  ok(/\n  paintSaveOn\(document\);/.test(wiring), 'the platform lines are painted with the rest of the wiring');
}

// ---- Open TikTok / Instagram ----
{
  const c = vm.createContext({ console });
  vm.runInContext('var native = null, closed = [], wopen = [], timers = [];' +
    'var location = { href: "capacitor://localhost/" };' +
    'function Target() { this.l = {}; } Target.prototype.addEventListener = function (t, f) { (this.l[t] = this.l[t] || []).push(f); };' +
    'Target.prototype.removeEventListener = function (t, f) { this.l[t] = (this.l[t] || []).filter(function (g) { return g !== f; }); };' +
    'Target.prototype.fire = function (t, e) { (this.l[t] || []).slice().forEach(function (f) { f(e); }); };' +
    'var document = new Target(); document.hidden = false; var window = new Target();' +
    'window.open = function (u, t, f) { wopen.push([u, t, f]); };' +
    'function setTimeout(f) { timers.push(f); } function closeSheet(id) { closed.push(id); }\n' + fn('openSourceApp'), c);
  const r = (code) => vm.runInContext(code, c);
  r('openSourceApp("https://www.tiktok.com/")');
  ok(r('JSON.stringify(wopen)') === '[["https://www.tiktok.com/","_blank","noopener"]]' && r('location.href') === 'capacitor://localhost/',
    'on the web it opens a tab and leaves Spotter where it is');
  r('native = { platform: "ios", open: function () { throw new Error("native.open would load the site inside Spotter"); } }');
  r('openSourceApp("https://www.tiktok.com/")');
  ok(r('location.href') === 'https://www.tiktok.com/', 'in the app it is a top-level navigation the shell hands to the system');
  r('document.fire("visibilitychange")');
  ok(r('closed.length') === 0, 'the sheet stays open while Spotter is still on screen (nothing opened)');
  r('document.hidden = true; document.fire("visibilitychange")');
  ok(r('JSON.stringify(closed)') === '["addsheet"]', 'and closes once the phone has gone to TikTok, so coming back lands on the library');
  r('document.fire("visibilitychange")');
  ok(r('closed.length') === 1 && !(r('document.l.visibilitychange') || []).length, 'once, and the listener is gone');
  r('closed = []; document.hidden = false; openSourceApp("https://www.instagram.com/")');
  r('window.fire("spotter:native-state", { detail: { isActive: true } })');
  ok(r('closed.length') === 0, 'the shell saying it is active is not leaving');
  r('window.fire("spotter:native-state", { detail: { isActive: false } })');
  ok(r('JSON.stringify(closed)') === '["addsheet"]', 'the shell saying it went inactive is');
  r('closed = []; openSourceApp("https://www.tiktok.com/"); timers[timers.length - 1](); document.hidden = true; document.fire("visibilitychange")');
  ok(r('closed.length') === 0, 'a later, unrelated trip away does not close a sheet opened since');
}

console.log('PASS savesheet harness: ' + checks + ' checks (share-first in the app, link-first on the web, paste and upload wired).');

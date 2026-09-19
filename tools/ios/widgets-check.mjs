// The four ways a Spotter widget can be wrong without anyone noticing.
//
// A widget extension is a separate process that draws on a Home Screen nobody
// is looking at while they develop. It does not crash loudly; it shows the
// wrong thing, or nothing, and the build stays green. So the four failures that
// are invisible from inside Xcode are pinned here:
//
//   1. A family declared in `supportedFamilies` with no branch drawing it —
//      WidgetKit falls through to whatever `default` says, which is how a Lock
//      Screen ends up wearing the rectangular layout at forty points across.
//   2. A `widgetURL`/`Link` pointing at a route `openDeepLink` does not handle,
//      which opens the app and then does nothing at all.
//   3. A field name in `WidgetSummary.swift` that the page never publishes, or
//      a published key with no Swift property — a silently empty widget.
//   4. A widget written but never listed in the bundle, so it exists in the
//      source and not in the gallery.
//
// Node-only, like every other tools/ios/*-check.mjs: CI runs it on a macOS box
// with no Xcode step.

import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const APP = 'supabase/functions/spotter/app.ts';
const WIDGETS = 'ios/App/SpotterWidgets';
const SUMMARY = 'ios/App/Shared/WidgetSummary.swift';

const app = fs.readFileSync(APP, 'utf8');
const read = path => fs.readFileSync(path, 'utf8');

// Every Swift file the widget extension compiles, as one string for the checks
// that do not care which file a thing is in, and as a map for the ones that do.
const sources = {};
for (const name of fs.readdirSync(WIDGETS)) {
  if (name.endsWith('.swift')) sources[name] = read(WIDGETS + '/' + name);
}
const nested = WIDGETS + '/Widgets';
for (const name of fs.existsSync(nested) ? fs.readdirSync(nested) : []) {
  if (name.endsWith('.swift')) sources['Widgets/' + name] = read(nested + '/' + name);
}
const allSwift = Object.values(sources).join('\n');

// ---------- 1. every declared family is drawn ----------
//
// A family is "drawn" when some file switches on it or names it in a
// comparison. That is deliberately loose: the point is to catch a family added
// to supportedFamilies and then forgotten, not to parse SwiftUI.

const FAMILY_HOMES = ['systemSmall', 'systemMedium', 'systemLarge', 'systemExtraLarge'];

const declared = new Map();
for (const [file, src] of Object.entries(sources)) {
  const re = /\.supportedFamilies\(\[([^\]]*)\]\)/g;
  let m;
  while ((m = re.exec(src))) {
    const families = [...m[1].matchAll(/\.([A-Za-z]+)/g)].map(x => x[1]);
    assert(families.length, file + ' declares an empty supportedFamilies');
    declared.set(file, (declared.get(file) || []).concat(families));
  }
}
assert(declared.size >= 2, 'no widget declares supportedFamilies — is the extension still there?');

for (const [file, families] of declared) {
  for (const family of families) {
    // A single-family widget is drawn by its whole body; a widget with more
    // than one has to say which is which somewhere in the extension.
    if (families.length === 1) continue;
    assert(new RegExp('case \\.' + family + '\\b|family == \\.' + family + '\\b').test(allSwift),
      file + ' declares .' + family + ' but nothing in SpotterWidgets draws it');
  }
  // A Home Screen family and an accessory family in one kind would need two
  // container backgrounds and two layouts; Spotter keeps them in separate kinds.
  const homes = families.filter(f => FAMILY_HOMES.includes(f));
  const accessories = families.filter(f => f.startsWith('accessory'));
  assert(!(homes.length && accessories.length),
    file + ' mixes Home Screen and accessory families in one widget kind');
}

const everyFamily = [...declared.values()].flat();
for (const family of ['systemSmall', 'systemMedium', 'accessoryCircular', 'accessoryRectangular', 'accessoryInline']) {
  assert(everyFamily.includes(family), 'no widget declares .' + family + ' any more');
}

console.log('PASS ' + declared.size + ' widget kinds, ' + everyFamily.length +
  ' declared families, each drawn and none mixing Home Screen with the Lock Screen.');

// ---------- 2. every link lands somewhere openDeepLink handles ----------

// The routes the page actually implements, read out of openDeepLink rather than
// copied from the brief: a route deleted there must fail here.
const linkFn = (() => {
  const start = app.indexOf('\n  function openDeepLink(');
  assert(start >= 0, APP + ' has no openDeepLink()');
  let depth = 0;
  for (let i = app.indexOf('{', start); i < app.length; i++) {
    if (app[i] === '{') depth++;
    else if (app[i] === '}' && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error('unbalanced braces in openDeepLink');
})();

const heads = new Set([...linkFn.matchAll(/head === "([a-z]+)"/g)].map(m => m[1]));
// `head === "workout"` and `"start"` are tested through the `card` variable, so
// pick those up too, and add the one route that is a no-op by design.
for (const m of linkFn.matchAll(/head === "([a-z]+)"/g)) heads.add(m[1]);
assert(/head === "workout"/.test(linkFn) && /head === "start"/.test(linkFn),
  'openDeepLink no longer routes workout/start');
const tabs = (linkFn.match(/\^\(([a-z|]+)\)\$/) || [, ''])[1].split('|').filter(Boolean);
assert(tabs.length >= 4, 'openDeepLink no longer whitelists the tab names');

const urls = [...allSwift.matchAll(/"spotter:\/\/([^"]*)"/g)].map(m => m[1]);
assert(urls.length >= 5, 'the widgets link to only ' + urls.length + ' routes — did they lose their taps?');

for (const raw of urls) {
  // "start/" is a prefix the widget completes with an id at runtime.
  const head = raw.split('/')[0];
  const arg = raw.slice(head.length + 1).replace(/\/+$/, '');
  assert(heads.has(head) || head === 'open',
    'a widget links to spotter://' + raw + ', which openDeepLink does not handle');
  if (head === 'tab') {
    assert(tabs.includes(arg), 'spotter://' + raw + ' names a tab openDeepLink rejects (' + tabs.join('|') + ')');
  }
  if (head === 'start' || head === 'workout') {
    assert(arg === '' || /^[A-Za-z0-9-]+$/.test(arg),
      'spotter://' + raw + ' has a hardcoded id that is not an id');
  }
}

// One widgetURL per view hierarchy: Apple documents more than one as undefined
// behaviour, and the failure is a tap that goes somewhere at random.
for (const [file, src] of Object.entries(sources)) {
  const count = (src.match(/\.widgetURL\(/g) || []).length;
  assert(count <= 1, file + ' sets widgetURL ' + count + ' times; the behaviour of more than one is undefined');
}
// Every widget kind has a background destination.
for (const file of declared.keys()) {
  assert(/\.widgetURL\(/.test(sources[file]), file + ' has no widgetURL — tapping it opens the app nowhere');
}

console.log('PASS ' + urls.length + ' widget links, all of them routes openDeepLink handles (' +
  [...heads].sort().join(', ') + '; tabs ' + tabs.join('/') + '), one widgetURL per kind.');

// ---------- 3. the Swift struct and the published keys are the same set ----------

const summary = read(SUMMARY);

// What the page actually sends, run out of app.ts the way F2's check does.
function fn(name) {
  const start = app.indexOf('\n  function ' + name + '(');
  assert(start >= 0, APP + ' has no ' + name + '()');
  let depth = 0;
  for (let i = app.indexOf('{', start); i < app.length; i++) {
    if (app[i] === '{') depth++;
    else if (app[i] === '}' && --depth === 0) return app.slice(start, i + 1) + '\n';
  }
  throw new Error('unbalanced braces in ' + name);
}

const published = (() => {
  const sent = [];
  const timers = [];
  const ctx = vm.createContext({
    wo: null, today: { rows: [] }, pubTimer: null, pubOut: false,
    state: {
      user: { id: 'u1' }, goal: 3, profile: null, logs: [], plan: [],
      workouts: [{ id: 'w1', title: 'Push day', duration_minutes: 42 },
                 { id: 'w2', title: 'Pull day', duration_minutes: 40 }]
    },
    native: { live: { publish: x => sent.push(x) } },
    myPlan: () => 'free',
    GOAL_FALLBACK: 3, WEEK_MS: 7 * 86400000,
    setTimeout: f => { timers.push(f); return timers.length; },
    clearTimeout: id => { if (id) timers[id - 1] = null; },
    Math, Date, Object, String, Number, Boolean, JSON
  });
  vm.runInContext(['ymd', 'addDays', 'mondayOf', 'weekKey', 'planMap', 'isSession', 'fzIn',
    'isFree', 'goalSetting', 'weekStats', 'thisWeek', 'rowsFor', 'planWorkout',
    'publishSummary', 'sendSummary', 'publishSignedOut'].map(fn).join(''), ctx);
  const today = vm.runInContext('ymd(new Date())', ctx);
  const ahead = vm.runInContext('ymd(addDays(new Date(), 2))', ctx);
  const past = vm.runInContext('ymd(addDays(new Date(), -1))', ctx);
  ctx.state.plan = [{ id: 'p1', day: today, workout_id: 'w1' }, { id: 'p2', day: ahead, workout_id: 'w2' }];
  // One finished session, so `last` is a shape rather than a null and its two
  // field names are checked against Swift like every other published key.
  ctx.state.logs = [{
    id: 'l1', workout_title: 'Leg day', started_at: past + 'T17:00:00.000Z',
    completed_at: past + 'T18:00:00.000Z', entries: [{ sets: [{ reps: 10, done: true }] }]
  }];
  vm.runInContext('sendSummary()', ctx);
  assert.equal(sent.length, 1, 'sendSummary published nothing');
  return { summary: JSON.parse(JSON.stringify(sent[0])), today, ahead };
})();

// Every key the page sends, flattened, must be a property on the Swift side.
// Names only: the contract says no CodingKeys renames, so a missing name is a
// field that silently decodes to nil and a widget that silently omits a line.
function keysOf(object, prefix, into) {
  for (const [key, value] of Object.entries(object)) {
    into.push(prefix + key);
    if (value && typeof value === 'object' && !Array.isArray(value)) keysOf(value, prefix + key + '.', into);
  }
  return into;
}
const sentKeys = keysOf(published.summary, '', []);
assert(sentKeys.length >= 12, 'the fixture published only ' + sentKeys.length + ' keys');

for (const path of sentKeys) {
  const leaf = path.split('.').pop();
  assert(new RegExp('\\bvar ' + leaf + ':').test(summary),
    SUMMARY + ' has no `var ' + leaf + '` for the published key ' + path);
}

// And the reverse: a Swift property the page never fills is a widget drawing a
// blank. Only STORED properties count — a computed `var dayFlags: [Bool] { … }`
// is a reading of the payload, not part of it — so the trailing `{` is what
// separates the two. `signedOut` is the exception: it appears only in the
// payload sign-out publishes.
const stored = [...summary.matchAll(/^ *var ([A-Za-z]+): ([A-Za-z0-9<>\[\], ]+?)(\?)? *$/gm)]
  .map(([, name, type, optional]) => ({ name, type: type.trim(), optional: !!optional }));
assert(stored.length >= 12, 'only ' + stored.length + ' stored properties found — did the struct move?');

const leaves = new Set(sentKeys.map(p => p.split('.').pop()));
for (const { name } of stored) {
  if (name === 'signedOut') continue;
  assert(leaves.has(name), SUMMARY + ' declares `' + name + '`, which sendSummary never publishes');
}

// The two shapes the widgets actually read, spelled out so a rename is loud.
assert.equal(published.summary.week.days.length, 7, 'week.days is not seven days');
assert.equal(published.summary.week.planned.length, 7, 'week.planned is not seven days');
assert(published.summary.week.planned.every(x => typeof x === 'boolean'), 'week.planned is not booleans');
assert(published.summary.week.days.every(x => typeof x === 'boolean'), 'week.days is not booleans');
assert(!published.summary.week.days.some((d, i) => d && published.summary.week.planned[i]),
  'a day is both trained and still planned — the dot row would draw two states at once');
assert.equal(published.summary.today.minutes, 42, "today.minutes is not the plan row's duration");
assert.match(published.summary.next.day, /^\d{4}-\d{2}-\d{2}$/,
  'next.day stopped being a date — Glance.dayLabel formats it into a weekday');
assert.equal(published.summary.next.day, published.ahead, 'next no longer skips today');
assert.notEqual(published.summary.today.id, published.summary.next.id);

// The sign-out payload is `{ v, updatedAt, signedOut }` and has to decode into
// this same struct, so every OTHER top-level field must be optional. Nested
// structs are exempt: they are only reached through an optional of their own.
const top = summary.slice(summary.indexOf('struct WidgetSummary'),
  summary.indexOf('    struct Week'));
const required = [...top.matchAll(/^ {4}var ([A-Za-z]+): ([A-Za-z0-9<>\[\], ]+?)(\?)? *$/gm)]
  .filter(([, name, , optional]) => !optional && !['v', 'updatedAt'].includes(name))
  .map(m => m[1]);
assert.equal(required.length, 0,
  'these WidgetSummary fields are not optional, so the sign-out payload will not decode: ' +
  required.join(', '));

console.log('PASS ' + sentKeys.length + ' published keys all have Swift properties and back, seven-day ' +
  'dot rows that never overlap, and a WidgetSummary the sign-out payload still decodes into.');

// ---------- 4. the bundle lists everything that was written ----------

const bundle = sources['SpotterWidgetsBundle.swift'];
assert(bundle, WIDGETS + '/SpotterWidgetsBundle.swift is gone');

const written = [...allSwift.matchAll(/struct ([A-Za-z]+): Widget \{/g)].map(m => m[1]);
assert(written.length >= 3, 'only ' + written.length + ' widgets are defined');
for (const name of written) {
  assert(bundle.includes(name + '()'), 'SpotterWidgetsBundle does not list ' + name);
}
assert(written.includes('WorkoutLiveActivity'), 'the Live Activity left the bundle');
for (const name of ['WeekWidget', 'TodayWidget', 'LockWidget']) {
  assert(written.includes(name), name + ' is gone');
}
assert(/@main/.test(bundle), 'the widget bundle lost its @main');

// Every widget kind string is distinct: two kinds sharing one string makes the
// gallery show one of them and the other never reload.
const kinds = [...allSwift.matchAll(/let kind = "([^"]+)"/g)].map(m => m[1]);
assert.equal(new Set(kinds).size, kinds.length, 'two widgets share a kind string: ' + kinds.join(', '));

// The extension is added to the project, or none of the above ships.
const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
for (const file of Object.keys(sources)) {
  const base = file.split('/').pop();
  assert(pbx.includes(base), base + ' is not in project.pbxproj — add it with tools/ios/add-file.mjs');
}

console.log('PASS the bundle lists all ' + written.length + ' widgets (' + written.join(', ') +
  '), kinds are distinct, and every source file is in the project.');

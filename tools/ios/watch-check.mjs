// The phone-watch seam, checked without Xcode.
//
// Four halves have to agree here and none of them can see the others: the watch
// target's membership list in project.pbxproj, the Swift on each side of
// WatchConnectivity, and the JavaScript that receives what the wrist sends.
// Every disagreement between them fails the same way — silently, as a watch
// that shows nothing and reports nothing — so each one is asserted rather than
// assumed.
//
// Node-only, like every other tools/ios/*-check.mjs: CI runs it on a macOS box
// with no Xcode step.

import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');

const PROJECT = 'ios/App/App.xcodeproj/project.pbxproj';
const SINK = 'ios/App/App/WatchLinkSink.swift';
const LINK = 'ios/App/SpotterWatch/WatchLink.swift';
const STATE = 'ios/App/Shared/LiveState.swift';
const APP = 'supabase/functions/spotter/app.ts';
const WATCH_DIR = 'ios/App/SpotterWatch';

const project = read(PROJECT);
const sink = read(SINK);
const link = read(LINK);
const state = read(STATE);
const app = read(APP);

// ---------- 1. what the watch target compiles ----------
//
// The watch app is a second target that shares files with the phone. A shared
// file that is in the project but not in THIS target's Sources phase compiles
// everywhere except on the wrist, and the error arrives at build time on
// somebody else's machine.

function targetNamed(name) {
  const section = /\/\* Begin PBXNativeTarget section \*\/([\s\S]*?)\/\* End PBXNativeTarget section \*\//.exec(project);
  assert(section, 'no PBXNativeTarget section in ' + PROJECT);
  for (const block of section[1].matchAll(/\n\t\t([0-9A-F]{24})\b[^\n]*= \{([\s\S]*?)\n\t\t\};/g)) {
    if (new RegExp('\\n\\t\\t\\tname = "?' + name + '"?;').test(block[2])) {
      const phases = /buildPhases = \(([\s\S]*?)\);/.exec(block[2]);
      return { id: block[1], phases: phases ? [...phases[1].matchAll(/([0-9A-F]{24})/g)].map(m => m[1]) : [] };
    }
  }
  return null;
}

function objectBody(id) {
  const match = new RegExp('\\n\\t\\t' + id + '\\b[^\\n]*= \\{([\\s\\S]*?)\\n\\t\\t\\};').exec(project);
  return match ? match[1] : null;
}

const watch = targetNamed('SpotterWatch');
assert(watch, PROJECT + ' has no SpotterWatch target');

const sources = watch.phases
  .map(objectBody)
  .find(body => body && body.includes('isa = PBXSourcesBuildPhase;'));
assert(sources, 'the SpotterWatch target has no Sources build phase');

// Shared code the watch cannot draw a screen without: the contract, the
// palette, and the summary the idle face reads.
['LiveState.swift', 'WidgetTheme.swift', 'WidgetSummary.swift'].forEach(file => {
  assert(sources.includes('/* ' + file + ' in Sources */'),
    'the SpotterWatch target does not compile ' + file + ' — add it with tools/ios/add-file.mjs');
});

// And every Swift file that lives in the watch folder, because one written and
// never registered is the quietest possible way to ship nothing.
fs.readdirSync(WATCH_DIR).filter(name => name.endsWith('.swift')).forEach(file => {
  assert(sources.includes('/* ' + file + ' in Sources */'),
    WATCH_DIR + '/' + file + ' is not in the SpotterWatch Sources phase');
});

// A watch app with no companion identifier installs and then never pairs.
assert(/INFOPLIST_KEY_WKCompanionAppBundleIdentifier = "\$\(SPOTTER_BUNDLE_ID\)";/.test(project),
  'the watch target must set WKCompanionAppBundleIdentifier to $(SPOTTER_BUNDLE_ID)');
assert((project.match(/INFOPLIST_KEY_WKCompanionAppBundleIdentifier/g) || []).length >= 2,
  'WKCompanionAppBundleIdentifier is missing from one of the watch configurations');

console.log('PASS the watch target compiles the shared contract, palette and summary, every file in ' +
  WATCH_DIR + ', and names its companion app.');

// ---------- 2. the wire keys, spelled twice ----------
//
// The phone puts Data under a string key and the watch reads it back out by the
// same string. Nothing checks that at compile time on either side.

function keysOf(source, where) {
  const found = {};
  for (const m of source.matchAll(/static let (live|done|summary|action) = "([a-z]+)"/g)) found[m[1]] = m[2];
  assert.deepEqual(Object.keys(found).sort(), ['action', 'done', 'live', 'summary'],
    where + ' does not declare all four wire keys');
  return found;
}

assert.deepEqual(keysOf(sink, SINK), keysOf(link, LINK),
  'the phone and the watch disagree about the wire keys');

// ---------- 3. the phone side answers the whole protocol ----------

['func update(_ state: LiveState)', 'func end(_ summary: LiveSummary)', 'func publish(_ summary: WidgetSummary)']
  .forEach(signature => assert(sink.includes(signature), SINK + ' does not implement ' + signature));

assert(/updateApplicationContext\(/.test(sink),
  SINK + ' must send state as an application context: it is the only transport delivered to a watch app that is not running');
assert(/LiveStatePlugin\.deliver\(/.test(sink),
  SINK + ' must hand incoming actions to LiveStatePlugin.deliver — the same door the Lock Screen uses');
assert(/didReceiveMessage/.test(sink) && /didReceiveUserInfo/.test(sink),
  SINK + ' must accept both the immediate and the queued action transports');
assert(/func publish\(_ summary: WidgetSummary\) \{\}/.test(read('ios/App/App/LiveStatePlugin.swift')),
  'LiveStateSink.publish must keep its do-nothing default, or every other sink has to implement it');

// The mirror is sent whole. updateApplicationContext REPLACES its payload, so a
// call that hands it one key erases the others — the bug this line exists for.
assert(/updateApplicationContext\(mirror\)/.test(sink),
  SINK + ' must send the whole mirror: updateApplicationContext replaces the dictionary, it does not merge into it');

console.log('PASS the phone sink implements update, end and publish, sends the mirror whole, and delivers actions both ways.');

// ---------- 4. every action the wrist sends has a branch in app.ts ----------

const watchSwift = fs.readdirSync(WATCH_DIR)
  .filter(name => name.endsWith('.swift'))
  .map(name => read(WATCH_DIR + '/' + name))
  .join('\n');

const sent = [...watchSwift.matchAll(/\.send\(\s*\.([A-Za-z]+)/g)].map(m => m[1]);
assert(sent.length >= 4, 'the watch sends fewer actions than it has buttons: ' + sent.join(','));

const liveAction = /function liveAction\(a\) \{[\s\S]*?\n  \}/.exec(app);
assert(liveAction, APP + ' has no liveAction() handler');

[...new Set(sent)].forEach(kind => {
  assert(new RegExp('k === "' + kind + '"').test(liveAction[0]),
    'the watch sends LiveAction kind "' + kind + '" and app.ts has no branch for it');
  assert(new RegExp('case ' + kind + '\\b').test(state) || new RegExp('\\b' + kind + '\\b').test(state),
    'LiveAction.Kind has no case ' + kind);
});

// The adjusted dose, both directions.
assert(/var reps: Int\?/.test(state) && /var weight: Double\?/.test(state),
  'LiveAction must carry optional reps and weight for a dose dialled on the wrist');
assert(/typeof a\.reps === "number"/.test(liveAction[0]) && /typeof a\.weight === "number"/.test(liveAction[0]),
  APP + ' must read a.reps and a.weight as numbers and fall back to its own prefill');

console.log('PASS every action the wrist can send (' + [...new Set(sent)].sort().join(', ') +
  ') has a branch in app.ts, and an adjusted dose survives the trip.');

// ---------- 5. the dose contract ----------
//
// The wrist steps a number; the phone rendered a sentence. These five fields
// are what make the difference, and they are written in two languages.

const doseFields = ['reps', 'weight', 'unit', 'step', 'loggable'];
const doseStruct = /struct Dose: Codable, Hashable \{[\s\S]*?\n    \}/.exec(state);
assert(doseStruct, 'LiveState has no Dose struct');
doseFields.forEach(field => assert(new RegExp('var ' + field + ':').test(doseStruct[0]),
  'LiveState.Dose has no ' + field));

const emitted = /dose: \{[\s\S]*?\n      \}/.exec(app);
assert(emitted, APP + ' liveState() does not emit a dose');
doseFields.forEach(field => assert(new RegExp('\\b' + field + ':').test(emitted[0]),
  APP + ' liveState().dose has no ' + field));

// The one number the wrist must not invent for itself.
assert(/step: plate\(\)/.test(emitted[0]),
  APP + ' must send the account\'s own plate() as the weight step, not a constant the watch guesses');

console.log('PASS the dose crosses as numbers: ' + doseFields.join(', ') + ', with the phone\'s own plate size.');

// ---------- 6. the rest deadline is the watch's own ----------

assert(/rest\.until/.test(link) || /rest\?\.remaining/.test(read(WATCH_DIR + '/RestView.swift')),
  'the watch must count rest from the absolute deadline, not from a tick the phone sends');
assert(/TimelineView/.test(read(WATCH_DIR + '/RestView.swift')),
  'the rest countdown must redraw itself with TimelineView');
assert(/isLuminanceReduced/.test(watchSwift),
  'the watch must answer Always On: an ember that stays lit at full brightness is a battery complaint');
assert(/WKInterfaceDevice\.current\(\)\.play\(\.notification\)/.test(link),
  'the end of rest must reach the wrist as a .notification haptic');

console.log('PASS rest is counted from the deadline, redrawn by TimelineView, dimmed in Always On, and ends on the wrist.');

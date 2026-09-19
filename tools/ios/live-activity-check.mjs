// The Live Activity's load-bearing facts, asserted without Xcode.
//
// Everything checked here is something that fails SILENTLY on a device: an
// activity that never starts because a plist key is missing, a button that
// compiles but can never run because its intent is in the wrong target, a phase
// the widget forgot so the Lock Screen goes blank mid-workout, a rest
// notification that is scheduled and never cancelled. None of those break a
// build and none of them throw — they just leave a card on a Lock Screen saying
// the wrong thing, which is the one outcome this feature cannot have.
//
// Node-only, like every other tools/ios/*-check.mjs: CI runs it on a macOS box
// with no Xcode step.

import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => {
  assert(fs.existsSync(p), 'missing ' + p);
  return fs.readFileSync(p, 'utf8');
};

const appPlist = read('ios/App/App/Info.plist');
const widget = read('ios/App/SpotterWidgets/WorkoutLiveActivity.swift');
const sink = read('ios/App/App/LiveActivitySink.swift');
const intents = read('ios/App/Shared/LiveActivityIntents.swift');
const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
const app = read('supabase/functions/spotter/app.ts');

// ---------- ActivityKit refuses to run without the declaration ----------

assert(/<key>NSSupportsLiveActivities<\/key>\s*<true\/>/.test(appPlist),
  'Info.plist must declare NSSupportsLiveActivities = true, or Activity.request always throws');
console.log('PASS NSSupportsLiveActivities is declared true.');

// ---------- every phase the engine can emit is drawn ----------
//
// LiveState.Phase is the source of truth; the widget must have an opinion about
// each case, or a workout that reaches it renders as whatever `else` happens to
// be. `.unknown` is excluded: it exists precisely so an unrecognised phase
// falls through to the default treatment.

const phases = [...read('ios/App/Shared/LiveState.swift')
  .matchAll(/case (work, rest, timed, complex, done)/g)]
  .flatMap(m => m[1].split(',').map(s => s.trim()));
assert(phases.length === 5, 'LiveState.Phase no longer lists the five phases this check knows');
phases.forEach(p => assert(widget.includes('.' + p),
  'WorkoutLiveActivity.swift never mentions phase .' + p));
console.log('PASS the widget references all five phases: ' + phases.join(', ') + '.');

// ---------- both buttons exist, and can actually run ----------

['SkipRestIntent', 'LogSetIntent'].forEach(name => {
  assert(widget.includes('Button(intent: ' + name + '())'),
    'WorkoutLiveActivity.swift has no Button(intent: ' + name + '())');
  assert(new RegExp('struct ' + name + ':\\s*LiveActivityIntent').test(intents),
    name + ' must adopt LiveActivityIntent so perform() runs in the app process');
});
console.log('PASS both Button(intent:)s are wired to LiveActivityIntents.');

// The membership that makes perform() meaningful. A LiveActivityIntent runs in
// the APP's process; compiled only into the widget extension it would build,
// draw and do nothing. Find the file's build-file ids, then confirm at least one
// of them sits in the App target's Sources phase.
function inTargetSources(fileName, target) {
  const ids = [...pbx.matchAll(new RegExp('([0-9A-F]{24}) /\\* ' + fileName + ' in Sources \\*/', 'g'))]
    .map(m => m[1]);
  assert(ids.length, fileName + ' is in no Sources phase at all');

  // Match the NATIVE TARGET, not the first thing that shares its name. A group
  // in the navigator is called "SpotterWidgets" too, and a lazy match that
  // started there would run on to the next target's buildPhases and cheerfully
  // confirm membership of a target the file is not in. (It did, until this
  // check was tested against a project with the file deliberately removed.)
  const block = new RegExp(
    '/\\* ' + target + ' \\*/ = \\{\\s*isa = PBXNativeTarget;[\\s\\S]*?buildPhases = \\(([\\s\\S]*?)\\);')
    .exec(pbx);
  assert(block, 'no native target named ' + target + ' in project.pbxproj');

  const phaseIds = [...block[1].matchAll(/([0-9A-F]{24})/g)].map(m => m[1]);
  return phaseIds.some(phaseId => {
    const phase = new RegExp(phaseId + ' /\\* Sources \\*/ = \\{[\\s\\S]*?files = \\(([\\s\\S]*?)\\);')
      .exec(pbx);
    return phase && ids.some(id => phase[1].includes(id));
  });
}

assert(inTargetSources('LiveActivityIntents.swift', 'App'),
  'LiveActivityIntents.swift must be in the App target: a LiveActivityIntent runs in the app process');
assert(inTargetSources('LiveActivityIntents.swift', 'SpotterWidgets'),
  'LiveActivityIntents.swift must also be in SpotterWidgets: Button(intent:) needs the type to compile');
console.log('PASS the intents are compiled into both the App and SpotterWidgets targets.');

// ---------- the rest-end nudge is both scheduled and cancelled ----------

assert(/schedule\(id: Self\.nudgeID/.test(sink), 'LiveActivitySink never schedules the rest nudge');
assert(/cancel\(id: Self\.nudgeID\)/.test(sink), 'LiveActivitySink never cancels the rest nudge');
assert(/nudgeID = "rest-end"/.test(sink), 'the rest nudge must use the id "rest-end"');
assert(/func end\(_ summary: LiveSummary\)[\s\S]{0,400}cancelNudge\(\)/.test(sink),
  'end(_:) must cancel the rest nudge, or a saved workout still announces a rest');
console.log('PASS the "rest-end" nudge is scheduled, cancelled, and cancelled again on end().');

// ---------- the rest ends on the card even when the app is asleep ----------
//
// Nothing native runs at the moment a rest ends. The one local wake-up an
// activity gets is its stale date, so a running rest's stale date IS its
// deadline and the widget's `isStale` branch is what draws the rest-over state.
// Both halves fail silently and identically: the card freezes at 0:00 under an
// hourglass until someone opens the app, which is the bug this replaced.

const staleFn = /private static func staleDate\(for state: LiveState\) -> Date \{([\s\S]*?)\n    \}/.exec(sink);
assert(staleFn, 'LiveActivitySink has no staleDate(for:) — the rest-over flip has no alarm clock');
assert(/state\.phase == \.rest \? rest\.deadline\b/.test(staleFn[1]),
  'a running rest\'s staleDate must be the deadline ITSELF: padding it is padding during which ' +
  'the card shows an hourglass over a rest that is over');
assert(/max\(deadline, Date\(\)\.addingTimeInterval\(1\)\)/.test(staleFn[1]),
  'clamp the stale date into the future — ActivityKit ignores one that has already passed, ' +
  'and an update can land after the deadline it describes');
assert(/staleDate: Self\.staleDate\(for: state\)/.test(sink),
  'push(_:) must hand ActivityContent the computed staleDate');
console.log('PASS a running rest\'s staleDate is its own deadline, clamped into the future.');

assert(/isStale: context\.isStale/.test(widget),
  'the widget never reads context.isStale, so nothing happens when the stale date passes');
assert(/var restOver: Bool \{ isStale && state\.phase == \.rest/.test(widget),
  'PhaseLook must name the rest-over state off isStale + .rest');
assert(/var counting: Bool \{\s*guard !restOver else \{ return false \}/.test(widget),
  'restOver must switch `counting` off, or the card keeps drawing a countdown that finished');
assert(/if restOver \{ return "Rest over" \}/.test(widget),
  'the Lock Screen label must say "Rest over" when it is');
assert(/if restOver \{ return \.startSet \}/.test(widget),
  'the rest-over card must offer its own action, not the countdown\'s "Skip rest"');
console.log('PASS the widget draws a rest-over state on isStale, in every presentation.');

// The action behind that button. `set` was the tempting one and it is wrong: a
// circuit's rest carries the owed move to the next station in restThen, and
// saveSet() starts a fresh rest that overwrites it — so a Log set tapped from a
// circuit rest logs an extra set AND loses the advance. skipRest is also the
// only one safe to retain until the web view wakes.
assert(/case \.skipRest, \.startSet: Button\(intent: SkipRestIntent\(\)\)/.test(widget),
  'Start set must send skipRest: `set` from a circuit rest swallows the advance in restThen');
assert(/restThen/.test(app), 'app.ts no longer has restThen — re-check which action the rest-over button should send');
console.log('PASS the rest-over button sends skipRest, which cannot log a set nobody did.');

// ---------- the activity is ended, reconciled, and never asks to exist twice ----------

assert(/areActivitiesEnabled/.test(sink), 'LiveActivitySink must respect areActivitiesEnabled');
assert(/dismissalPolicy: \.immediate/.test(sink) && /dismissalPolicy: policy/.test(sink),
  'end(_:) must choose between an immediate and a delayed dismissal');
assert(/Activity<WorkoutActivityAttributes>\.activities/.test(sink),
  'LiveActivitySink must reconcile against the activities already running at launch');
console.log('PASS the lifecycle guards (authorization, dismissal, launch reconciliation) are present.');

// ---------- the permission sheet is only ever raised by a tap ----------
//
// iOS gives an app exactly one chance to ask. A request() on load — or anywhere
// that is not inside a handler a finger triggered — spends it on a person who
// has not yet seen a rest timer, and the answer is permanent.

const requests = [...app.matchAll(/notifications\.request\(/g)].map(m => m.index);
assert(requests.length, 'app.ts never calls native.live.notifications.request()');

// Finding a handler somewhere above the call is not the same as the call being
// inside it — the first version of this check was fooled by exactly that, and
// passed a request() moved out to the top of the function. So: for each handler
// opener in the file, walk the braces to find where its body ends, and require
// the call to fall inside one of those spans.
function handlerSpans(src) {
  const opener = /(?:\.onclick\s*=\s*function\s*\([^)]*\)|addEventListener\(\s*["']click["']\s*,\s*function\s*\([^)]*\))\s*\{/g;
  const spans = [];
  for (const m of src.matchAll(opener)) {
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) { spans.push([m.index, i]); break; }
    }
  }
  return spans;
}

const spans = handlerSpans(app);
assert(spans.length, 'app.ts has no click handlers at all, which cannot be right');
requests.forEach(at => {
  assert(spans.some(([from, to]) => at > from && at < to),
    'notifications.request() at offset ' + at + ' is not inside a click handler body. ' +
    'iOS grants exactly one permission sheet; it has to be spent on a tap.');
});
console.log('PASS notifications.request() is only called from a click handler (' +
  requests.length + ' call site).');

// The other half of asking once: a refusal has to be remembered.
assert(/spotter_nudge_asked/.test(app), 'app.ts must remember that the nudge was already offered');
console.log('PASS the ask is remembered in localStorage and never repeated.');

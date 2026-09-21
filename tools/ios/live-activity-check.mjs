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
const host = read('ios/App/App/NotificationsHost.swift');
const intents = read('ios/App/Shared/LiveActivityIntents.swift');
const attributes = read('ios/App/Shared/WorkoutActivityAttributes.swift');
const liveState = read('ios/App/Shared/LiveState.swift');
const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
const app = read('supabase/functions/spotter/app.ts');
const fixture = JSON.parse(read('tools/ios/contract-fixture.json'));

// ---------- ActivityKit refuses to run without the declaration ----------

assert(/<key>NSSupportsLiveActivities<\/key>\s*<true\/>/.test(appPlist),
  'Info.plist must declare NSSupportsLiveActivities = true, or Activity.request always throws');
console.log('PASS NSSupportsLiveActivities is declared true.');

// ---------- every phase the engine can emit is drawn ----------
//
// LiveState.Phase is the source of truth; the widget must have an opinion about
// each case, or a workout that reaches it renders as whatever `else` happens to
// be. `.unknown` is excluded: it exists precisely so an unrecognised phase
// falls through to the default treatment. `paused` is declared on its own line
// (it carries a doc comment), so it is asserted by name rather than pattern.

const phases = [...liveState.matchAll(/case (work, rest, timed, complex, done)/g)]
  .flatMap(m => m[1].split(',').map(s => s.trim()));
assert(phases.length === 5, 'LiveState.Phase no longer lists the five phases this check knows');
assert(/\n\s*case paused\n/.test(liveState), 'LiveState.Phase must declare `case paused` (the wire value "paused")');
phases.push('paused');
phases.forEach(p => assert(widget.includes('.' + p),
  'WorkoutLiveActivity.swift never mentions phase .' + p));
console.log('PASS the widget references all six phases: ' + phases.join(', ') + '.');

// ---------- the paused card is stopped, not stale, not clickable ----------
//
// Everything a paused session must NOT do fails silently: a live timer keeps
// counting a stopped session, a near stale date flips the card into "rest
// over", a nudge fires for a rest that is not running, a button offers a set
// nobody is about to do.

assert(/var pausedAt: String\?/.test(liveState), 'LiveState must carry pausedAt (ISO 8601) beside phase "paused"');
assert(/var pausedDate: Date\?/.test(liveState), 'LiveState needs the pausedDate helper, like startedDate');
assert(/var pausedAt: Date\?/.test(attributes), 'ContentState must carry pausedAt: the frozen clock is drawn from it');
assert(/var halted: Bool \{ state\.phase == \.paused \}/.test(widget),
  'PhaseLook must name the paused session off phase .paused');
assert(/if halted \{ return nil \}/.test(widget), 'a paused card must offer no button');
assert(/if halted \{ return "pause\.fill" \}/.test(widget), 'the paused glyph is pause.fill');
assert(/if halted \{ return "Paused" \}/.test(widget), 'the Lock Screen label must say "Paused"');
// The frozen clock is a String rendered from pausedAt − startedAt, never a timer.
const frozen = /if state\.phase == \.paused \{[\s\S]*?Text\(WorkoutActivityAttributes\.clock\(pausedAt\.timeIntervalSince\(attributes\.startedAt\)\)\)/;
assert(frozen.test(widget), 'the paused elapsed must be a static string of pausedAt − startedAt, not a timer');
const staleFn0 = /private static func staleDate\(for state: LiveState\) -> Date \{([\s\S]*?)\n    \}/.exec(sink);
assert(staleFn0 && /if state\.phase == \.paused \{\s*return Date\(\)\.addingTimeInterval\(8 \* 60 \* 60\)/.test(staleFn0[1]),
  'a paused state\'s staleDate must be the far end of the activity\'s life (8 h), or the card can flip to rest over');
assert(/guard state\.phase == \.rest, let rest = state\.rest, !rest\.isPaused else \{\s*cancelNudge\(\)/.test(sink),
  'syncNudge must cancel for anything that is not a running rest — a paused session included');
// A resume shifts startedAt, which is an immutable attribute: the sink must
// replace the activity, and request the new one BEFORE ending the old.
const resume = /if Self\.differs\(activity\.attributes\.startedAt, state\.startedDate\) \{([\s\S]*?)\n            \}/.exec(sink);
assert(resume, 'push(_:) must detect a shifted startedAt (a resume) against the running activity\'s attributes');
assert(resume[1].indexOf('Activity.request(') >= 0 && resume[1].indexOf('activity.end(nil, dismissalPolicy: .immediate)') >= 0
  && resume[1].indexOf('Activity.request(') < resume[1].indexOf('activity.end(nil, dismissalPolicy: .immediate)'),
  'on a resume the new activity is requested first and the old one ended immediately with no closing frame');
console.log('PASS paused: frozen string clock, no button, pause glyph, 8 h stale date, nudge cancelled, resume replaces the activity.');

// ---------- five intents exist, and can actually run ----------

['SkipRestIntent', 'LogSetIntent', 'AdjustSetIntent', 'MarkMoveIntent', 'RoundDoneIntent'].forEach(name => {
  assert(new RegExp('struct ' + name + ':\\s*LiveActivityIntent').test(intents),
    name + ' must adopt LiveActivityIntent so perform() runs in the app process');
  assert(/static let isDiscoverable = false/.test(intents.slice(intents.indexOf('struct ' + name))),
    name + ' must stay undiscoverable: it means nothing outside a running session');
});
['SkipRestIntent', 'LogSetIntent', 'MarkMoveIntent', 'RoundDoneIntent'].forEach(name => {
  assert(widget.includes('Button(intent: ' + name + '())'),
    'WorkoutLiveActivity.swift has no Button(intent: ' + name + '())');
});
assert(/Button\(intent: AdjustSetIntent\(field: field, delta: delta\)\)/.test(widget),
  'the dial\'s ± buttons must be Button(intent: AdjustSetIntent(field:delta:)) — one type, parameterised');
assert(/@Parameter\(title: "Figure"\)\s*var field: DialField/.test(intents) && /@Parameter\(title: "Direction"\)\s*var delta: Int/.test(intents),
  'AdjustSetIntent carries field and delta as @Parameters, which is how the values travel with the button');
assert(/enum DialField: String, AppEnum/.test(intents), 'DialField must be an AppEnum so the parameter serialises');
console.log('PASS the five LiveActivityIntents are wired: four buttons, and one parameterised dial intent behind four more.');

// ---------- the dial never crosses the bridge; Log set carries it ----------
//
// The contract: a press on ± is a native update only. Only the final `.set`
// reaches JavaScript, with the dialled figures on it. Both halves are static
// facts about which router closure each perform() calls.

const performOf = name => {
  const from = intents.indexOf('struct ' + name);
  const body = /func perform\(\) async throws -> some IntentResult \{([\s\S]*?)\n    \}/.exec(intents.slice(from));
  assert(body, name + ' has no perform()');
  return body[1];
};
const adjustPerform = performOf('AdjustSetIntent');
assert(/LiveActionRouter\.adjust\(field, by: delta\)/.test(adjustPerform), 'AdjustSetIntent.perform() must call LiveActionRouter.adjust');
assert(!/LiveActionRouter\.send\(|LiveStatePlugin|deliver\(/.test(adjustPerform),
  'AdjustSetIntent must never send an action or reach LiveStatePlugin.deliver: dial presses stay native');
// Code only — the file's comments are allowed to explain why the plugin is
// not named; the code is not allowed to name it.
const intentsCode = intents.split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');
assert(!/LiveStatePlugin/.test(intentsCode), 'LiveActivityIntents.swift must not name LiveStatePlugin in code (the widget target has no Capacitor)');
const adjustFn = /static func adjust\(_ field: DialField, by delta: Int\) \{([\s\S]*?)\n    \}/.exec(intents);
assert(adjustFn && /adjuster\?\(field, delta\)/.test(adjustFn[1]) && !/handler/.test(adjustFn[1]),
  'LiveActionRouter.adjust must go through the adjuster closure, never the action handler');
const sinkAdjust = /private func adjust\(_ field: DialField, by delta: Int\) \{([\s\S]*?)\n    \}/.exec(sink);
assert(sinkAdjust, 'LiveActivitySink has no adjust(_:by:)');
assert(!/LiveStatePlugin\.deliver|notifyListeners/.test(sinkAdjust[1]),
  'LiveActivitySink.adjust must not deliver anything to JavaScript');
assert(/dose\.stepping\(reps: self\.dial\.reps, by: delta\)/.test(sinkAdjust[1]) && /dose\.stepping\(self\.dial\.weight, by: Double\(delta\)\)/.test(sinkAdjust[1]),
  'the dial must step through Dose.stepping, the one clamp app.ts and the wrist share');
assert(/self\.push\(state\)/.test(sinkAdjust[1]), 'a dial press must push the card at once');
const logPerform = performOf('LogSetIntent');
assert(/LiveActionRouter\.dialled\?\(\)/.test(logPerform) && /LiveActionRouter\.send\(\.set, reps: dial\?\.reps, weight: dial\?\.weight\)/.test(logPerform),
  'LogSetIntent.perform() must send .set WITH the dialled reps and weight');
assert(/static func send\(_ kind: LiveAction\.Kind, reps: Int\? = nil, weight: Double\? = nil\)/.test(intents),
  'LiveActionRouter.send must accept reps and weight');
// The dial belongs to one set: it resets on a different set, movement or phase, and on end.
assert(/if let previous = pending \?\? current, !Self\.sameSet\(previous, state\) \{\s*dial = \(nil, nil\)/.test(sink),
  'update(_:) must reset the dial when the engine moves to a different set, movement or phase');
assert(/func end\(_ summary: LiveSummary\)[\s\S]{0,300}dial = \(nil, nil\)/.test(sink), 'end(_:) must reset the dial');
assert(/case \.set:[\s\S]{0,900}self\.dial = \(nil, nil\)/.test(sink), 'the optimistic .set must reset the dial for the next set');
console.log('PASS dial presses never reach LiveStatePlugin.deliver; Log set carries the dialled figures; the dial resets per set.');

// ---------- the dial is drawn where WidgetKit allows buttons, and only there ----------

assert(/var hasDial: Bool \{ action == \.logSet && state\.dial != nil \}/.test(widget),
  'the dial must only ever sit beside Log set, and only when the engine sent a dose');
assert(/if state\.phase == \.work \{ return state\.loggable \? \.logSet : nil \}/.test(widget),
  'an unloggable work set (the engine\'s own verdict) must show no button and no dial');
const compact = /compactLeading: \{([\s\S]*?)\} compactTrailing: \{([\s\S]*?)\} minimal: \{([\s\S]*?)\}/.exec(widget);
assert(compact, 'the DynamicIsland compact/minimal closures moved');
assert(!/Button\(|Link\(|DialRow|ComplexRow|CardControl/.test(compact[1] + compact[2] + compact[3]),
  'no button, link or dial in the compact or minimal presentations — WidgetKit runs buttons only in the expanded ' +
  'and Lock Screen presentations, and documents Link for the expanded one');
// The compact clock slot is a fixed frame, sized for m:ss, or the island stretches across the status bar.
assert(/IslandClock\(attributes: context\.attributes, state: context\.state, size: 14,\s*isStale: context\.isStale, snug: true/.test(widget),
  'the compact trailing IslandClock must be snug (fixed width): a timer Text otherwise asks for the whole status bar');
assert(/\.frame\(width: snug \? \(size \* 3\)\.rounded\(\.up\) : nil, alignment: \.trailing\)/.test(widget),
  'the snug frame is three digit-widths (m:ss measured at 41.5 pt for 14 pt), fixed, not a minimum');
assert(/Text\(timerInterval: attributes\.startedAt\.\.\.attributes\.startedAt\.addingTimeInterval\(12 \* 60 \* 60\)/.test(widget),
  'the elapsed clock must be Text(timerInterval:): the date-style .timer is not driven on the locked Lock Screen and prints words');
console.log('PASS the dial lives in the expanded and Lock Screen presentations only; the compact clock is a fixed m:ss slot; elapsed is an interval timer.');

// ---------- the complex: two taps, a counter, and a cap that flips to "Time" ----------
//
// Everything here fails the way the owner found it: a complex whose card names
// the movement and offers nothing ("i cant advance rounds or anything"). The
// counter and the cap ride on LiveState.complex; the two taps are the phone's
// own two buttons; the cap's stale date is its deadline like a rest's; and the
// rest-end nudge is never scheduled for a cap.

const complexStruct = /struct Complex: Codable, Hashable \{([\s\S]*?)\n    \}/.exec(liveState);
assert(complexStruct, 'LiveState.swift has no Complex struct');
['rounds', 'marked', 'moves', 'move', 'cap', 'until', 'held', 'over'].forEach(field =>
  assert(new RegExp('var ' + field + ':').test(complexStruct[1]), 'LiveState.Complex has no ' + field));
assert(/var complex: Complex\?/.test(liveState), 'LiveState must carry complex as an optional: older engines send none');
assert(/var complex: LiveState\.Complex\? = nil/.test(attributes),
  'ContentState must carry complex, defaulted so the states that predate it are built as before');
assert(/case round\n/.test(liveState) && /case mark\n/.test(liveState), 'LiveAction.Kind needs .round and .mark');
assert(/LiveActionRouter\.send\(\.mark\)/.test(performOf('MarkMoveIntent')) && /LiveActionRouter\.send\(\.round\)/.test(performOf('RoundDoneIntent')),
  'MarkMoveIntent sends .mark and RoundDoneIntent sends .round, through the same handler as Log set');
// The optimistic frame steps the counter the phone's way, through one helper
// both the sink and the wrist use, so the two mirrors cannot count differently.
assert(/mutating func count\(_ kind: LiveAction\.Kind/.test(complexStruct[1]),
  'LiveState.Complex must own the count(_:) arithmetic (a mark completing the round is the round; either starts the cap)');
assert(/case \.mark, \.round:[\s\S]{0,900}complex\.count\(action\.kind\)/.test(sink),
  'the optimistic .mark/.round frame must step the counter through Complex.count');
assert(/complex\.count\(pending\.kind\)/.test(read('ios/App/SpotterWatch/WatchLink.swift')),
  'the wrist\'s optimistic display must use the same Complex.count');
// The score is the phone's own line, "3 rounds + 2 movements".
assert(/var score: String/.test(complexStruct[1]) && /" movement" : " movements"/.test(complexStruct[1]),
  'Complex.score must write the score the way cxScore() does');
assert(/if let complex = complex \{ return complex\.score \}/.test(widget), 'the complex secondary line must be the score');
assert(/function cxScore\(r, x, bare\)/.test(app) && /" movement" : " movements"/.test(app),
  'app.ts cxScore changed shape — re-check Complex.score against it');
// Two buttons, in every presentation that runs buttons, and nowhere else.
assert(/private struct ComplexRow: View/.test(widget) && /if let complex = look\.complex \{\s*ComplexRow\(complex: complex\)/.test(widget),
  'CardControl must draw ComplexRow for a complex with a counter');
assert(/var complexControl: Bool \{ complex != nil \}/.test(widget),
  'the two buttons must only exist when the engine sent a counter — an older engine\'s complex keeps no control');
assert(/if complexControl \{ return "repeat" \}/.test(widget), 'the complex glyph is repeat (the round is "again")');
// The cap counts down like a rest, freezes like a held rest, and flips to "Time" on its deadline.
assert(/var capOver: Bool \{[\s\S]*?complex\.over \|\| \(isStale && complex\.isRunning\)/.test(widget),
  'capOver must read isStale for a running cap: the cap\'s stale date is its deadline');
assert(/if capRunning \{ return true \}/.test(widget), 'a running cap must count (ember hero, draining bar, ring)');
assert(/if capOver \{ return "Time" \}/.test(widget) && /Text\("Time"\)/.test(widget),
  '"Time" — the phone\'s word for a cap at zero — must be the label on the Lock Screen and the word in the island slots');
assert(/if state\.phase == \.complex, let complex = state\.complex, complex\.isRunning \{\s*return max\(complex\.deadline, Date\(\)\.addingTimeInterval\(1\)\)/.test(staleFn0[1]),
  'a running cap\'s staleDate must be its deadline, clamped into the future, as a rest\'s is');
// And never a nudge: syncNudge's guard is phase == .rest, so a complex lands
// in the cancel branch. Pinned by name so nobody "helpfully" adds one.
const nudgeFn = /private func syncNudge\(_ state: LiveState\) \{([\s\S]*?)\n    \}/.exec(sink);
assert(nudgeFn && !/complex|Complex|cap\b/.test(nudgeFn[1]),
  'syncNudge must know nothing about the cap: the phone\'s own tone (cxTick) is the cap\'s, and a cap ending is not a rest ending');
console.log('PASS the complex: counter + cap on the wire, Next move / Round done wired, the phone\'s score line, "Time" on the deadline, no nudge for a cap.');

// ---------- the figures are links; the weight half exists at zero ----------

assert(/Link\(destination: link\) \{ figure \}/.test(widget), 'the dial figures must be Links, not buttons');
assert(/URL\(string: "spotter:\/\/set\/" \+ field\.rawValue \+ "\?" \+ query\)/.test(widget),
  'the figure link must be spotter://set/<reps|weight>?reps=..&weight=.. — the route openSetLink() answers');
assert(/function openSetLink\(field, url\)/.test(app) && /if \(head === "set"\) \{ openSetLink\(arg, String\(url\)\); return; \}/.test(app),
  'app.ts must route spotter://set/<field> to openSetLink');
assert(/\.frame\(minWidth: 44\)[\s\S]{0,400}\.frame\(height: 44\)/.test(widget),
  'the figure column must be a 44 pt target between the two 44 pt circles');
assert(/weight: dose\.weight == nil \? nil : \(dialWeight \?\? dose\.weight\)/.test(attributes),
  'ContentState.content must treat a weight of 0 as a weight: only nil means bodyweight');
assert(/value == value\.rounded\(\) \? String\(Int\(value\)\)/.test(widget), 'the dial must render 0 as "0", not "—"');
assert(/weight: pre \? pre\.weight : null/.test(app), 'app.ts liveState().dose.weight must be 0, not null, for a movement never loaded');
console.log('PASS the reps and weight figures are spotter://set links with the dial\'s figures; 0 is a weight.');

// ---------- the rest-end nudge breaks through a Focus ----------
//
// The gym is where a Fitness / Do Not Disturb Focus is on, and a rest ending
// under one was delivered silently. Time Sensitive is the level that breaks
// through, and it needs an entitlement in every entitlements file the App
// target can sign with — which are the three named here, read off
// project.pbxproj (CODE_SIGN_ENTITLEMENTS = $(SPOTTER_ENTITLEMENTS)),
// ios/debug.xcconfig (Share), Local.xcconfig.example (Push) and
// App/Release.xcconfig (Release). ReleaseShared and Widgets belong to the
// extensions and are not the App target's.

assert(/if timeSensitive \{ content\.interruptionLevel = \.timeSensitive \}/.test(host),
  'NotificationsHost.schedule must set .timeSensitive when asked');
assert(/timeSensitive: Bool = false/.test(host), 'time sensitivity must be opt-in per notification, off by default');
assert(nudgeFn && /timeSensitive: true/.test(nudgeFn[1]), 'the rest-end nudge must be scheduled time sensitive');
assert((host.match(/timeSensitive: true/g) || []).length === 0 && (sink.match(/timeSensitive: true/g) || []).length === 1,
  'exactly one caller may be time sensitive: the rest-end nudge');
const appTarget = /\/\* App \*\/ = \{\s*isa = PBXNativeTarget;[\s\S]*?buildConfigurationList = ([0-9A-F]{24})/.exec(pbx);
assert(appTarget, 'no App native target');
assert(/CODE_SIGN_ENTITLEMENTS = "\$\(SPOTTER_ENTITLEMENTS\)";/.test(pbx), 'the App target must sign with $(SPOTTER_ENTITLEMENTS)');
assert(/^SPOTTER_ENTITLEMENTS = App\/Share\.entitlements$/m.test(read('ios/debug.xcconfig')));
assert(/^SPOTTER_ENTITLEMENTS = App\/Release\.entitlements$/m.test(read('ios/App/App/Release.xcconfig')));
assert(/SPOTTER_ENTITLEMENTS = App\/Push\.entitlements/.test(read('ios/App/Local.xcconfig.example')));
['Share', 'Push', 'Release'].forEach(name => {
  assert(/<key>com\.apple\.developer\.usernotifications\.time-sensitive<\/key>\s*<true\/>/.test(read('ios/App/App/' + name + '.entitlements')),
    name + '.entitlements is one the App target signs with and lacks com.apple.developer.usernotifications.time-sensitive');
});
console.log('PASS the rest-end nudge is Time Sensitive, the only one that is, and all three App entitlements variants carry the capability.');

// ---------- the 4 KB content budget ----------
//
// ActivityKit refuses an update whose static + dynamic content exceeds 4 KB —
// silently, from the card's point of view. ContentState is a subset of
// LiveState plus the dial and the pause instant; measured off the widest
// fixture with every string padded to a length no workout card reaches.

function contentState(live) {
  return {
    phase: live.phase, exercise: live.exercise, block: live.block, set: live.set, target: live.target,
    weight: live.weight, rest: live.rest, next: live.next, progress: live.progress,
    pausedAt: 780000000.123, dial: { reps: 999, weight: 9999.5, unit: 'kg' }, loggable: true,
    // The complex rides along on every phase here: the measurement is the
    // widest content, not the likeliest.
    complex: { rounds: 999, marked: 99, moves: 99, move: 'x'.repeat(120), cap: 3600000,
      until: 1789751351482.5, held: 3600000, over: false }
  };
}
const widest = Object.values(fixture).filter(v => v && v.phase).map(contentState)
  .map(c => ({ ...c, exercise: 'x'.repeat(120), block: 'x'.repeat(80), target: 'x'.repeat(60), weight: 'x'.repeat(30), next: 'x'.repeat(120) }))
  .map(c => JSON.stringify(c).length + JSON.stringify({ title: 'x'.repeat(120), startedAt: 780000000.123 }).length);
assert(Math.max(...widest) < 4096, 'a padded ContentState + attributes exceeds the 4 KB ActivityKit budget: ' + Math.max(...widest));
console.log('PASS the widest padded ContentState + attributes is ' + Math.max(...widest) + ' bytes, under the 4 KB budget.');

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

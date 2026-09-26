// The rules the Train tab cannot get wrong, run against the real functions in
// app.ts rather than a copy of them: the dot language, a week's name and the
// month's fold, which segment a visit opens on, and the sets-per-day bars.
// No browser and no playwright — node:vm and the fn() slicer from tools/ios/check.mjs.
// Run from the repo root: node tools/train-harness.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const src = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
function fn(name) {
  const start = src.indexOf('  function ' + name + '(');
  assert(start >= 0, 'not found: ' + name);
  return src.slice(start, src.indexOf('\n  }', start) + 4);
}
let checks = 0;
function check(name, body) { body(); checks++; console.log('PASS', name); }

// A session is a finished workout with at least one logged set — isSession is the
// real thing here, because the whole point of the wave is that the strip, the grid
// and the ring answer with it.
function log(day, workoutId, sets) {
  return { started_at: day + 'T12:00:00', completed_at: day + 'T13:00:00',
    workout_id: workoutId, entries: [{ name: 'Squat', sets: sets || [{ reps: 5, weight: 100 }] }] };
}

function ctx(over) {
  const c = vm.createContext(Object.assign({
    Date, JSON, Math, String, Number, console,
    state: { logs: [], plan: [], weekStart: null, profile: null },
    localStorage: { store: {}, getItem(k) { return k in this.store ? this.store[k] : null; },
      setItem(k, v) { this.store[k] = String(v); } }
  }, over));
  for (const name of ['ymd', 'addDays', 'mondayOf', 'isSession', 'sessionsOn', 'knowable', 'dayMark',
    'rowsFor', 'readTrainSeg', 'shortDate', 'weekLabel', 'foldKey', 'foldTo', 'foldP']) vm.runInContext(fn(name), c);
  // Read off app.ts rather than restated: the month left the segments for the strip.
  vm.runInContext(src.match(/\n  var SEGS = [^\n]+/)[0], c);
  return { c, run: s => vm.runInContext(s, c) };
}

// ---------- 1. the dot language ----------
check('a session on a planned day with the planned workout reads "as planned"', () => {
  const x = ctx();
  x.c.state.plan = [{ day: '2026-09-15', workout_id: 'w2' }];
  x.c.state.logs = [log('2026-09-15', 'w2')];
  assert.equal(x.run('dayMark("2026-09-15")'), 'as');
});
check('a session on a day the plan did not ask for reads "done"', () => {
  const x = ctx();
  x.c.state.logs = [log('2026-09-13', 'w3')];
  assert.equal(x.run('dayMark("2026-09-13")'), 'on');
  // Planned, but a different workout: still done, not done as planned.
  x.c.state.plan = [{ day: '2026-09-13', workout_id: 'w9' }];
  assert.equal(x.run('dayMark("2026-09-13")'), 'on');
});
check('a planned day still ahead reads "planned", and behind reads "missed"', () => {
  const x = ctx();
  x.c.state.plan = [{ day: '2026-09-18', workout_id: 'w3' }, { day: '2026-09-14', workout_id: 'w1' }];
  x.c.Date = class extends Date { constructor(...a) { super(...(a.length ? a : ['2026-09-16T12:00:00'])); } };
  assert.equal(x.run('dayMark("2026-09-18")'), 'plan');
  assert.equal(x.run('dayMark("2026-09-14")'), 'miss');
  assert.equal(x.run('dayMark("2026-09-17")'), '');
});
check('an abandoned session with no logged set is not a session', () => {
  const x = ctx();
  x.c.state.logs = [{ started_at: '2026-09-13T12:00:00', completed_at: '2026-09-13T13:00:00',
    entries: [{ name: 'Squat', sets: [] }] }];
  assert.equal(x.run('dayMark("2026-09-13")'), '');
  assert.equal(x.run('sessionsOn("2026-09-13").length'), 0);
});
check('past the 400-log horizon a planned day is unknown, not missed', () => {
  const x = ctx();
  x.c.Date = class extends Date { constructor(...a) { super(...(a.length ? a : ['2026-09-16T12:00:00'])); } };
  x.c.state.plan = [{ day: '2025-01-06', workout_id: 'w1' }, { day: '2026-09-14', workout_id: 'w1' }];
  // 399 logs: the horizon is not reached, so silence is still evidence.
  x.c.state.logs = Array.from({ length: 399 }, () => log('2026-09-01', 'w1'));
  assert.equal(x.run('knowable("2025-01-06")'), true);
  assert.equal(x.run('dayMark("2025-01-06")'), 'miss');
  // 400 logs whose oldest is newer than the day asked about: the truth is unknown.
  x.c.state.logs = Array.from({ length: 400 }, () => log('2026-09-01', 'w1'));
  assert.equal(x.run('knowable("2025-01-06")'), false);
  assert.equal(x.run('dayMark("2025-01-06")'), 'plan');
  // Inside the window a full cache still answers honestly: 14 Sept is planned, in
  // the past, and covered by the logs we hold, so it is a miss.
  assert.equal(x.run('knowable("2026-09-14")'), true);
  assert.equal(x.run('dayMark("2026-09-14")'), 'miss');
});

// ---------- 2. a week's name, and the month's fold ----------
// The header says today's date now (no "Week 39"), and a week is its dates.
check('a week is named by its dates: "Sep 21–27", and across two months both of them', () => {
  const x = ctx();
  const en = new Intl.DateTimeFormat().resolvedOptions().locale.startsWith('en-US');
  const one = x.run('weekLabel(new Date(2026, 8, 21))'), two = x.run('weekLabel(new Date(2026, 8, 28))');
  if (en) {
    assert.equal(one, 'Sep 21–27');
    assert.equal(two, 'Sep 28 – Oct 4');
  }
  assert(one.includes('21') && one.includes('27') && two.includes('28') && two.includes('4'));
});

// RESEARCH-MONTH-PULLDOWN, Recommendation 2-4: the fold follows the finger 1:1,
// gives half speed past the month and nothing past the week; a release at
// 150px/s goes the way it was thrown, slower lands on the nearer end; a closing
// month folds onto the selected day's week, else today's, else its first.
check('the fold: tracking, release and the week a closing month folds onto', () => {
  const x = ctx();
  assert.equal(x.run('foldP(0, 130, 260)'), 0.5, '1:1 across the extra height');
  assert.equal(x.run('foldP(0, 390, 260)'), 1.25, 'past the month at half speed');
  assert.equal(x.run('foldP(1, -400, 260)'), 0, 'nothing past the week');
  assert.equal(x.run('foldTo(0.3, 150)'), 1, 'a throw down opens, however little was pulled');
  assert.equal(x.run('foldTo(0.8, -150)'), 0, 'a throw up closes');
  assert.equal(x.run('foldTo(0.51, 149)'), 1, 'slower: the nearer end');
  assert.equal(x.run('foldTo(0.49, -20)'), 0);
  const from = '2026-08-31', to = '2026-10-04';
  assert.equal(x.run(`foldKey("2026-09-15", "2026-09-25", "${from}", "${to}")`), '2026-09-15', 'the selected day');
  assert.equal(x.run(`foldKey("2026-10-20", "2026-09-25", "${from}", "${to}")`), '2026-09-25', 'else today');
  assert.equal(x.run(`foldKey("2026-10-20", "2026-11-02", "${from}", "${to}")`), from, 'else the first week');
});

// ---------- 3. which segment a visit opens on ----------
check('the profile beats localStorage beats the default; nonsense and the old "calendar" read as Progress', () => {
  const x = ctx();
  assert.equal(x.run('SEGS.map(function (s) { return s[0]; }).join()'), 'progress,records');
  assert.equal(x.run('readTrainSeg()'), 'progress');
  x.c.localStorage.store.spotter_trainseg = 'records';
  assert.equal(x.run('readTrainSeg()'), 'records');
  x.c.state.profile = { settings: { trainSeg: 'progress' } };
  assert.equal(x.run('readTrainSeg()'), 'progress');
  x.c.state.profile = { settings: { trainSeg: 'nonsense' } };
  assert.equal(x.run('readTrainSeg()'), 'progress');
  // Stored before the month moved into the strip.
  x.c.state.profile = { settings: { trainSeg: 'calendar' } };
  assert.equal(x.run('readTrainSeg()'), 'progress');
  x.c.state.profile = null;
  x.c.localStorage.store.spotter_trainseg = 'calendar';
  assert.equal(x.run('readTrainSeg()'), 'progress');
});

// ---------- 4. sets per day ----------
// The counter inside setsCard, lifted out so it can be run without a document:
// the same expression, over sessionsOn, which is what the card calls.
check('sets per day counts logged sets by local day, and holes are not sets', () => {
  const x = ctx();
  x.c.state.weekStart = new Date(2026, 8, 14);
  x.c.state.logs = [
    log('2026-09-15', 'w2', [{ reps: 5, weight: 100 }, { reps: 5, weight: 105 }, null]),
    log('2026-09-15', 'w9', [{ reps: 8, weight: 60 }]),
    log('2026-09-19', 'w3', [{ reps: 10 }, { reps: 10 }])
  ];
  const counts = x.run(`(function () {
    var out = [];
    for (var i = 0; i < 7; i++) {
      var n = 0;
      sessionsOn(ymd(addDays(state.weekStart, i))).forEach(function (l) {
        (l.entries || []).forEach(function (e) { n += (e.sets || []).filter(Boolean).length; });
      });
      out.push(n);
    }
    return out;
  })()`);
  // Array.from, because the counter ran in the vm's realm and its Array is not ours.
  assert.deepEqual(Array.from(counts), [0, 3, 0, 0, 0, 2, 0]);
});

// ---------- 5. the old view names still name a place ----------
function viewCtx(view) {
  const went = [], painted = [];
  const c = vm.createContext({ VIEWS: ['train', 'library', 'pumpy'], trainSeg: null, trainWantMonth: false,
    trainSwap: false, trainLean: {}, state: { view: view || 'library' },
    goTo: (i, animate) => went.push([i, animate]),
    paintSeg: () => painted.push('seg'), drawTrainBody: () => painted.push('body'),
    renderTrain: () => painted.push('train'),
    $: () => ({ classList: { contains: () => false } }) });
  vm.runInContext(fn('setView'), c);
  return { c, went, painted };
}

check('plan opens the month on Train; progress and history land on Train, on Progress', () => {
  const { c, went } = viewCtx('library');
  vm.runInContext('setView("plan")', c);
  assert.equal(c.trainWantMonth, true, 'plan asks the strip to open the month');
  assert.equal(c.trainSeg, null, 'plan leaves the segment where it was');
  for (const name of ['progress', 'history']) {
    c.trainSeg = null;
    vm.runInContext('setView(' + JSON.stringify(name) + ')', c);
    assert.equal(c.trainSeg, 'progress', name);
  }
  // Train is the first page now.
  assert.deepEqual(went.map(w => w[0]), [0, 0, 0]);
  vm.runInContext('setView("library")', c);
  assert.equal(went[went.length - 1][0], 1);
  // A name nothing knows still lands somewhere real rather than off the end.
  vm.runInContext('setView("nonsense")', c);
  assert.equal(went[went.length - 1][0], 0);
});

// goTo() only prepares a page it had to change to, so a deep link naming a
// segment of the page already on screen has to move the control itself.
check('a deep link repaints the segment when Train is already the page', () => {
  const here = viewCtx('train');
  vm.runInContext('setView("progress")', here.c);
  assert.equal(here.c.trainSeg, 'progress');
  assert.deepEqual(here.painted, ['seg', 'body']);
  assert.equal(here.c.trainSwap, true, 'the body crossfades, as a tap does');
  // Coming from another tab, the arrival draws it: painting here as well would
  // build the body twice for one visit.
  const away = viewCtx('library');
  vm.runInContext('setView("progress")', away.c);
  assert.deepEqual(away.painted, []);
  // The plan link on Train itself redraws the strip, which spends the request.
  const month = viewCtx('train');
  vm.runInContext('setView("plan")', month.c);
  assert.deepEqual(month.painted, ['train']);
});

console.log(checks + ' Train checks passed');

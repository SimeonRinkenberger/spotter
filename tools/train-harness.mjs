// The four rules the Train tab cannot get wrong, run against the real functions
// in app.ts rather than a copy of them: the dot language, the ISO week in the
// header, which segment a visit opens on, and the sets-per-day bars.
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
  for (const name of ['ymd', 'addDays', 'mondayOf', 'isSession', 'sessionsOn', 'loggedOn',
    'knowable', 'dayMark', 'isoWeek', 'rowsFor', 'readTrainSeg']) vm.runInContext(fn(name), c);
  vm.runInContext('var SEGS = ' + JSON.stringify([['calendar', 'Calendar'],
    ['progress', 'Progress'], ['records', 'Records']]) + ';', c);
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
  assert.equal(x.run('loggedOn("2026-09-13")'), false);
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

// ---------- 2. the ISO week in the header ----------
check('isoWeek follows the Thursday rule at both ends of the year', () => {
  const x = ctx();
  assert.equal(x.run('isoWeek(new Date(2026, 8, 16))'), 38);
  assert.equal(x.run('isoWeek(new Date(2026, 0, 1))'), 1);
  assert.equal(x.run('isoWeek(new Date(2026, 11, 31))'), 53);
  // 1 Jan 2023 is a Sunday, which belongs to 2022's week 52.
  assert.equal(x.run('isoWeek(new Date(2023, 0, 1))'), 52);
});

// ---------- 3. which segment a visit opens on ----------
check('the profile beats localStorage beats the default, and nonsense is Calendar', () => {
  const x = ctx();
  assert.equal(x.run('readTrainSeg()'), 'calendar');
  x.c.localStorage.store.spotter_trainseg = 'records';
  assert.equal(x.run('readTrainSeg()'), 'records');
  x.c.state.profile = { settings: { trainSeg: 'progress' } };
  assert.equal(x.run('readTrainSeg()'), 'progress');
  x.c.state.profile = { settings: { trainSeg: 'nonsense' } };
  assert.equal(x.run('readTrainSeg()'), 'calendar');
  x.c.state.profile = null;
  x.c.localStorage.store.spotter_trainseg = 'nonsense';
  assert.equal(x.run('readTrainSeg()'), 'calendar');
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

console.log(checks + ' Train checks passed');

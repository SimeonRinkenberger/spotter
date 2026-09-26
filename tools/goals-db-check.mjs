// B.2's database half, on every migration replayed in PGlite (tools/schema-replay.mjs):
// confirm_pumpy_proposal's program kind, undo_pumpy_program, Basic's one free program,
// the goals table's RLS, the library cap's exemptions and the plan column old builds
// never read.
//
//   node tools/goals-db-check.mjs
import { replaySchema } from './schema-replay.mjs';

let passed = 0;
const failures = [];
function check(ok, what) {
  if (ok) passed++;
  else { failures.push(what); console.error('FAIL ' + what); }
}

const { db } = await replaySchema({ onError: (f, e) => check(false, 'migration applies: ' + f + ' — ' + e.message) });
const ok = (await db.query(`select to_regclass('public.goals') is not null as ok`)).rows[0].ok;
check(ok, 'the goals table exists after every migration');

async function as(role, sub, fn) {
  await db.exec(`set role ${role}`);
  if (sub) await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub]);
  try { return await fn(); }
  finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claim.sub', '', false)`); }
}
const svc = (fn) => as('service_role', null, fn);
async function tryQ(fn) { try { await fn(); return null; } catch (e) { return e.message; } }

const BASIC = '11111111-1111-4111-8111-111111111111';
const PLUS = '22222222-2222-4222-8222-222222222222';
const T1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const T2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const TP = 'bbbbbbbb-0000-4000-8000-000000000001';
for (const [id, email] of [[BASIC, 'basic@example.com'], [PLUS, 'plus@example.com']]) {
  await db.query(`insert into auth.users(id, email) values ($1, $2) on conflict do nothing`, [id, email]);
  await db.query(`insert into public.profiles(id) values ($1) on conflict do nothing`, [id]);
}
await db.query(`update public.profiles set plan = 'plus' where id = $1`, [PLUS]);

// A workout for each account to borrow as a template.
const W1 = 'cccccccc-0000-4000-8000-000000000001', W2 = 'cccccccc-0000-4000-8000-000000000002';
await svc(() => db.query(`insert into public.workouts(id, user_id, url, shortcode, platform, title, blocks, ingest_status)
  values ($1, $2, 'https://example.com/a', 'fx-a', 'tiktok', 'Push Day', '[{"exercises":[{"name":"Bench Press","canonical_id":"bench-press"}]}]', 'ready'),
         ($3, $4, 'https://example.com/b', 'fx-b', 'tiktok', 'Push Day', '[{"exercises":[{"name":"Bench Press","canonical_id":"bench-press"}]}]', 'ready')`,
  [W1, BASIC, W2, PLUS]));

const today = new Date().toISOString().slice(0, 10);
const add = (n) => new Date(Date.parse(today + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
function program(workoutId, opts = {}) {
  const rx = (pct, w) => ({ exercise: 'bench-press', sets: 5, reps: '5', pct, weight: w, unit: 'lb', rpe: 8, note: null });
  return {
    kind: 'program', v: 1,
    goal: { type: 'lift', title: opts.title || 'Bench 305', exercise: 'bench-press', exercise_name: 'Bench Press', target: 295, dream: 305,
      unit: 'lb', baseline: 287, start: add(1), end: add(14), weeks: 2, days_per_week: 2, daily: null, weigh_in_dow: null },
    verdict: 'too_fast', verdict_note: '305 usually takes about 4–9 months from an estimated 287.', medical_note: null, sources: [],
    templates: [
      { ref: 't1', workout_id: workoutId, new: false, title: 'Push Day', exercises: 1 },
      { ref: 't2', workout_id: opts.newId || TP, new: true, title: 'Bench Volume', exercises: 1,
        create: { title: 'Bench Volume', category: 'Push', blocks: [{ title: null, type: 'straight', exercises: [{ name: 'Bench Press', canonical_id: 'bench-press', sets: 4, reps: '8' }] }] } },
    ],
    weeks: [
      { week: 1, label: 'Build', days: [{ day: add(1), dow: 1, ref: 't1', title: 'Push Day', rx: rx(0.75, 215) }, { day: add(3), dow: 3, ref: 't2', title: 'Bench Volume', rx: null }] },
      { week: 2, label: 'Heavy', days: [{ day: add(8), dow: 1, ref: 't1', title: 'Push Day', rx: rx(0.85, 245) }] },
    ],
    start: add(1), end: add(14), plate: 5, unit: 'lb', replaces: null, free: true,
    counts: { weeks: 2, sessions: 3, new_templates: 1 }, summary: '2 weeks.',
  };
}
async function thread(user, id) {
  await svc(() => db.query(`insert into public.pumpy_threads(id, user_id, title) values ($1, $2, 'goal')`, [id, user]));
}
async function proposal(user, threadId, p) {
  const r = await svc(() => db.query(`insert into public.pumpy_messages(thread_id, user_id, role, content, meta)
    values ($1, $2, 'assistant', 'here', $3::jsonb) returning id`, [threadId, user, JSON.stringify({ proposal: p, status: 'pending', model: 'harness' })]));
  return r.rows[0].id;
}
async function confirm(user, mid, accept, prepared) {
  const r = await svc(() => db.query(`select public.confirm_pumpy_proposal($1, $2, $3, $4::jsonb) as v`,
    [user, mid, accept, JSON.stringify(prepared)]));
  return r.rows[0].v;
}
async function undo(user, mid) {
  return (await svc(() => db.query(`select public.undo_pumpy_program($1, $2) as v`, [user, mid]))).rows[0].v;
}
const count = async (sql, args) => Number((await db.query(sql, args)).rows[0].n);

// ---------- Basic: the one free program ----------
const FREE_THREAD = 'dddddddd-0000-4000-8000-000000000001';
await thread(BASIC, FREE_THREAD);
let mid = await proposal(BASIC, FREE_THREAD, program(W1));
let r = await confirm(BASIC, mid, true, { goal_id: 'eeeeeeee-0000-4000-8000-000000000001', today });
check(r.status === 'limit' && r.kind === 'goal', 'Basic cannot confirm a program before the server gave it a free thread (' + r.status + ')');
await db.query(`update public.profiles set free_goal_thread = $1, free_goal_at = now() where id = $2`, [FREE_THREAD, BASIC]);
r = await confirm(BASIC, mid, true, { goal_id: 'eeeeeeee-0000-4000-8000-000000000001', today });
check(r.status === 'ok', 'Basic confirms its free program from the free thread (' + JSON.stringify(r).slice(0, 160) + ')');
check(r.program && r.program.goal && r.program.goal.status === 'active', 'the goal row comes back active');
check(Array.isArray(r.plan) && r.plan.length === 3, 'three plan rows written (' + (r.plan || []).length + ')');
check(r.plan && r.plan.every((x) => x.prescription && x.prescription.goal_id === 'eeeeeeee-0000-4000-8000-000000000001'), 'every row carries the goal id');
check(r.plan && r.plan[0].prescription.week === 1 && r.plan[0].prescription.label === 'Build' && r.plan[0].prescription.weight === 215, 'a row carries week, label and load');
check(r.program.workouts.length === 1 && r.program.workouts[0].kind === 'program', 'the new template is a workouts row of kind program');
check(r.undo && r.undo.message_id === mid, 'the answer says how to undo');
const again = await confirm(BASIC, mid, true, { goal_id: 'eeeeeeee-0000-4000-8000-000000000001', today });
check(JSON.stringify(again) === JSON.stringify(r), 'a retried confirm returns the same receipt');
check(await count(`select count(*) n from public.plan where user_id = $1`, [BASIC]) === 3, 'the retry wrote nothing twice');
// A program day moved in the app (Move is a delete and an insert that carries the numbers).
const moved = r.plan[0];
await as('authenticated', BASIC, () => db.query(`delete from public.plan where id = $1`, [moved.id]));
await as('authenticated', BASIC, () => db.query(`insert into public.plan(user_id, day, workout_id, prescription) values ($1, $2, $3, $4)`,
  [BASIC, add(5), moved.workout_id, JSON.stringify(moved.prescription)]));

const mid2 = await proposal(BASIC, FREE_THREAD, program(W1, { newId: 'bbbbbbbb-0000-4000-8000-000000000009', title: 'Bench 315' }));
r = await confirm(BASIC, mid2, true, { goal_id: 'eeeeeeee-0000-4000-8000-000000000002', today });
check(r.status === 'limit' && r.kind === 'goal', 'a second program for Basic is refused (the free plan is used)');
check(await count(`select count(*) n from public.goals where user_id = $1`, [BASIC]) === 1, 'the refusal wrote nothing');

const u = await undo(BASIC, mid);
check(u.status === 'ok' && u.removed.plan === 3 && u.removed.workouts === 1, 'undo takes the days and the new workout back (' + JSON.stringify(u.removed) + ')');
check((await db.query(`select status from public.goals where id = 'eeeeeeee-0000-4000-8000-000000000001'`)).rows[0].status === 'undone', 'the goal reads undone');
check(await count(`select count(*) n from public.plan where user_id = $1 and prescription->>'goal_id' = 'eeeeeeee-0000-4000-8000-000000000001'`, [BASIC]) === 0,
  'a program day moved since the confirm goes with the undo (review 14)');
check(JSON.stringify(await undo(BASIC, mid)) === JSON.stringify(u), 'a repeated undo returns the same receipt');
r = await confirm(BASIC, mid2, true, { goal_id: 'eeeeeeee-0000-4000-8000-000000000002', today });
check(r.status === 'ok', 'after an undo the free thread can confirm again');
await db.query(`update public.pumpy_messages set meta = jsonb_set(meta, '{result,at}', to_jsonb(now() - interval '20 minutes')) where id = $1`, [mid2]);
const late = await undo(BASIC, mid2);
check(late.status === 'conflict', 'undo after 15 minutes is refused');

// ---------- Plus: a new program replaces the active goal, and Undo restores it ----------
const PT = 'dddddddd-0000-4000-8000-000000000002';
await thread(PLUS, PT);
const pm1 = await proposal(PLUS, PT, program(W2, { newId: 'bbbbbbbb-0000-4000-8000-000000000011', title: 'Bench 300' }));
r = await confirm(PLUS, pm1, true, { goal_id: 'eeeeeeee-0000-4000-8000-000000000011', today });
check(r.status === 'ok', 'Plus confirms a program outside any free thread');
const pm2 = await proposal(PLUS, PT, program(W2, { newId: 'bbbbbbbb-0000-4000-8000-000000000012', title: 'Bench 310' }));
r = await confirm(PLUS, pm2, true, { goal_id: 'eeeeeeee-0000-4000-8000-000000000012', today });
check(r.status === 'ok' && r.program.replaced && r.program.replaced.removed === 3, 'the new program ends the old goal and takes its future days off');
check((await db.query(`select status from public.goals where id = 'eeeeeeee-0000-4000-8000-000000000011'`)).rows[0].status === 'ended', 'the old goal reads ended');
check(await count(`select count(*) n from public.goals where user_id = $1 and status = 'active'`, [PLUS]) === 1, 'one active goal');
const pu = await undo(PLUS, pm2);
check(pu.status === 'ok' && pu.restored && pu.restored.plan === 3, 'undo restores the replaced goal\'s days (' + JSON.stringify(pu.restored) + ')');
check((await db.query(`select status from public.goals where id = 'eeeeeeee-0000-4000-8000-000000000011'`)).rows[0].status === 'active', 'and makes it active again');

// A hand-planned day of the same workout takes the program's numbers instead of a copy.
await as('authenticated', PLUS, () => db.query(`insert into public.plan(user_id, day, workout_id) values ($1, $2, $3)`, [PLUS, add(22), W2]));
const PT2 = 'dddddddd-0000-4000-8000-000000000003';
await thread(PLUS, PT2);
const hand = program(W2, { newId: 'bbbbbbbb-0000-4000-8000-000000000013', title: 'Bench 320' });
hand.weeks[1].days[0].day = add(22);
const pm3 = await proposal(PLUS, PT2, hand);
r = await confirm(PLUS, pm3, true, { goal_id: 'eeeeeeee-0000-4000-8000-000000000013', today });
check(r.status === 'ok' && r.program.attached.length === 1, 'a day already planned by hand is attached, not doubled');
check(await count(`select count(*) n from public.plan where user_id = $1 and day = $2`, [PLUS, add(22)]) === 1, 'one row on that day');
const pu3 = await undo(PLUS, pm3);
check(pu3.status === 'ok', 'undo of an attached program');
check((await db.query(`select prescription from public.plan where user_id = $1 and day = $2`, [PLUS, add(22)])).rows[0].prescription === null,
  'the hand-planned day is kept, without the numbers');

// A borrowed workout deleted before confirm: refused, and nothing changes.
const PT3 = 'dddddddd-0000-4000-8000-000000000004';
await thread(PLUS, PT3);
const gone = program('cccccccc-0000-4000-8000-00000000dead', { newId: 'bbbbbbbb-0000-4000-8000-000000000014' });
const pm4 = await proposal(PLUS, PT3, gone);
const before = await count(`select count(*) n from public.goals where user_id = $1`, [PLUS]);
r = await confirm(PLUS, pm4, true, { goal_id: 'eeeeeeee-0000-4000-8000-000000000014', today });
check(r.status === 'conflict', 'a program whose workout is gone is refused');
check(await count(`select count(*) n from public.goals where user_id = $1`, [PLUS]) === before, 'and ended nothing on the way');

// ---------- RLS on goals ----------
const mine = await as('authenticated', PLUS, () => db.query(`select id, status from public.goals`));
check(mine.rows.length > 0 && (await as('authenticated', PLUS, () => db.query(`select count(*) n from public.goals where user_id = $1`, [BASIC]))).rows[0].n == 0,
  'a person reads only their own goals');
const active = (await db.query(`select id from public.goals where user_id = $1 and status = 'active'`, [PLUS])).rows[0].id;
check(!(await tryQ(() => as('authenticated', PLUS, () => db.query(`update public.goals set status = 'ended', ended_at = now() where id = $1`, [active])))),
  'End goal: the owner may set ended');
check(!(await tryQ(() => as('authenticated', PLUS, () => db.query(`update public.goals set status = 'active', ended_at = null where id = $1`, [active])))),
  'Undo of End goal: back to active');
const bad = await as('authenticated', PLUS, () => db.query(`update public.goals set status = 'done' where id = $1 returning id`, [active]).catch((e) => ({ rows: [], err: e.message })));
check(!bad.rows.length, 'the owner cannot mark a goal done (the server\'s word)');
check(!!(await tryQ(() => as('authenticated', PLUS, () => db.query(`update public.goals set target = 999 where id = $1`, [active])))), 'nor change its numbers');
check(!!(await tryQ(() => as('authenticated', PLUS, () => db.query(`insert into public.goals(user_id, kind, title, start_day, end_day, weeks) values ($1, 'lift', 'x', $2, $2, 1)`, [PLUS, today])))),
  'the client cannot insert a goal');
check(!!(await tryQ(() => as('authenticated', PLUS, () => db.query(`delete from public.goals where id = $1`, [active])))), 'the client cannot delete a goal');
check(!!(await tryQ(() => as('authenticated', BASIC, () => db.query(`update public.profiles set free_goal_thread = null where id = $1`, [BASIC])))),
  'the client cannot reset its free program');

// ---------- the library cap and the plan column ----------
// W1 is already on the shelf: nineteen more make twenty, Basic's cap.
for (let i = 0; i < 19; i++) {
  await svc(() => db.query(`insert into public.workouts(user_id, url, shortcode, platform, title, ingest_status) values ($1, 'https://example.com', $2, 'tiktok', 'fill', 'ready')`,
    [BASIC, 'fill-' + i]));
}
check(!!(await tryQ(() => svc(() => db.query(`insert into public.workouts(user_id, url, shortcode, platform, title, ingest_status) values ($1, 'https://example.com', 'fill-21', 'tiktok', 'x', 'ready')`, [BASIC])))),
  'Basic at its cap cannot save another video');
check(!(await tryQ(() => svc(() => db.query(`insert into public.workouts(user_id, url, shortcode, platform, kind, title, ingest_status) values ($1, 'spotter://starter/gym', 'starter-gym', 'spotter', 'starter', 'Gym Starter', 'ready')`, [BASIC])))),
  'a kept starter is not refused at the cap');
check(!(await tryQ(() => svc(() => db.query(`insert into public.workouts(user_id, url, shortcode, platform, kind, title, ingest_status) values ($1, 'spotter://pumpy/x', 'pumpy-x', 'pumpy', 'program', 'Program day', 'ready')`, [BASIC])))),
  'a program workout is not refused at the cap');
await svc(() => db.query(`delete from public.workouts where user_id = $1 and shortcode = 'fill-0'`, [BASIC]));
check(!(await tryQ(() => svc(() => db.query(`insert into public.workouts(user_id, url, shortcode, platform, title, ingest_status) values ($1, 'https://example.com', 'fill-22', 'tiktok', 'x', 'ready')`, [BASIC])))),
  'starters and program workouts are not counted toward the cap');
check(!(await tryQ(() => as('authenticated', BASIC, () => db.query(`insert into public.plan(user_id, day, workout_id) values ($1, $2, $3)`, [BASIC, today, W1])))),
  'an old build\'s plan insert (no prescription) still works');
check(!(await tryQ(() => as('authenticated', BASIC, () => db.query(`insert into public.plan(user_id, day, workout_id, prescription) values ($1, $2, $3, '{"v":1,"week":2}')`, [BASIC, add(2), W1])))),
  'a moved program day carries its prescription');
check(!!(await tryQ(() => as('authenticated', BASIC, () => db.query(`insert into public.plan(user_id, day, workout_id, prescription) values ($1, $2, $3, '[1]')`, [BASIC, add(3), W1])))),
  'a prescription must be an object');
const star = (await db.query(`select * from public.plan where user_id = $1 limit 1`, [BASIC])).rows[0];
check('prescription' in star, 'select * on plan carries the new column (old builds ignore unknown keys)');

console.log((failures.length ? 'FAIL' : 'PASS') + ' goals db: ' + passed + ' passed, ' + failures.length + ' failed');
process.exit(failures.length ? 1 : 0);

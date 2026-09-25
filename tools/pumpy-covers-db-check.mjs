// Pumpy's covers in the database (20260925100000_pumpy_covers): every migration
// replayed in PGlite, then the column, its grants and check, the picker's promises
// (no repeat while a drawing is free, least-shown once all are, uniform within
// tolerance, older cards counted by their fallback, one person's cards only) and
// the confirm path writing a valid key. No network, nothing paid.
//
// node tools/pumpy-covers-db-check.mjs   (PGLITE_MODULE as for every DB check)
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { replaySchema } from './schema-replay.mjs';

const MIGRATION = 'supabase/migrations/20260925100000_pumpy_covers.sql';
const { db } = await replaySchema();
let passed = 0;
function ok(what) { passed++; console.log('PASS ' + what); }
const one = async (sql, args) => (await db.query(sql, args)).rows[0];
const keys = (await one('select public.pumpy_cover_keys() as k')).k;

// ---------- one list: the SQL constant, the files, app.ts ----------
const files = readdirSync('docs/assets/pumpy/covers').filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5)).sort();
assert.deepEqual(keys, files, 'pumpy_cover_keys() is the files in docs/assets/pumpy/covers, in their order');
assert.equal(keys.length, 35);
const APP = readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const lift = (name) => {
  const at = APP.indexOf('\n  function ' + name + '(');
  assert(at >= 0, name);
  return APP.slice(at, APP.indexOf('\n  }\n', at) + 4);
};
const client = vm.createContext({ location: { hostname: 'localhost' } });
vm.runInContext('var pumpyCoverList = null;' + ['pumpyCovers', 'pumpyCover', 'pumpyAsset', 'cardArt'].map(lift).join('\n'), client);
assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(pumpyCovers())', client)), keys, 'app.ts lists the same drawings in the same order');
ok('one list: pumpy_cover_keys(), the 35 files and app.ts PUMPY list agree');

// ---------- the column, its grants, its check ----------
{
  const col = await one(`select data_type, is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'workouts' and column_name = 'pumpy_cover'`);
  assert.deepEqual(col, { data_type: 'text', is_nullable: 'YES' });
  const priv = async (role, p) => (await one(`select has_column_privilege($1, 'public.workouts', 'pumpy_cover', $2) as ok`, [role, p])).ok;
  for (const role of ['anon', 'authenticated']) {
    assert.equal(await priv(role, 'INSERT'), false, role + ' cannot insert it');
    assert.equal(await priv(role, 'UPDATE'), false, role + ' cannot update it');
  }
  assert.equal(await priv('authenticated', 'SELECT'), true, 'the app reads it');
  assert.equal(await priv('service_role', 'UPDATE'), true);
  // The columns the app does write are still the four it always wrote.
  for (const c of ['title', 'category', 'notes', 'favorite']) {
    assert.equal((await one(`select has_column_privilege('authenticated', 'public.workouts', $1, 'UPDATE') as ok`, [c])).ok, true, c);
  }
  const fx = async (role, sig) => (await one(`select has_function_privilege($1, $2, 'execute') as ok`, [role, sig])).ok;
  for (const role of ['anon', 'authenticated']) {
    assert.equal(await fx(role, 'public.pumpy_cover_pick(uuid)'), false, role + ' cannot call the picker');
    assert.equal(await fx(role, 'public.pumpy_cover_fallback(uuid)'), false, role + ' cannot call the fallback');
    assert.equal(await fx(role, 'public.confirm_pumpy_proposal(uuid,bigint,boolean,jsonb)'), false);
    assert.equal(await fx(role, 'public.pumpy_cover_keys()'), true, role + ' can evaluate the check it writes under');
  }
  const cfg = await one(`select proconfig from pg_proc where proname = 'pumpy_cover_pick'`);
  assert.deepEqual(cfg.proconfig, ['search_path=""'], 'picker search_path is pinned');
  ok('column: nullable text, no browser-role INSERT/UPDATE, the four app columns unchanged, picker service-only, search_path pinned');
}

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
await db.exec(`insert into auth.users(id, email) values ('${A}', 'a@example.com'), ('${B}', 'b@example.com');
  update public.profiles set plan = 'plus', limits = '{"library": 100000}' where id in ('${A}', '${B}');`);
let n = 0;
async function card(user, cover, { id = crypto.randomUUID(), platform = 'pumpy' } = {}) {
  n++;
  await db.query(`insert into public.workouts(id, user_id, url, shortcode, platform, title, pumpy_cover)
    values ($1::uuid, $2, 'spotter://pumpy/' || $1::text, 'fx-cover-' || $3::text, $4, 'Fixture', $5)`, [id, user, n, platform, cover]);
  return id;
}
const clear = (user) => db.query(`delete from public.workouts where user_id = $1`, [user]);
const pick = async (user) => (await one('select public.pumpy_cover_pick($1) as k', [user])).k;
const draws = async (user, count) => (await db.query('select public.pumpy_cover_pick($1) as k from generate_series(1, $2)', [user, count])).rows.map((r) => r.k);
const tally = (list) => list.reduce((t, k) => { t[k] = (t[k] || 0) + 1; return t; }, {});
function chiSquare(list, allowed) {
  const t = tally(list), expect = list.length / allowed.length;
  return allowed.reduce((s, k) => s + ((t[k] || 0) - expect) ** 2 / expect, 0);
}
function shuffled(a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

// ---------- the check refuses what is not a drawing ----------
{
  await assert.rejects(() => card(A, 'not-a-cover'), /workouts_pumpy_cover_known/, 'an unknown key is refused');
  await assert.rejects(() => card(A, 'Deadlift'), /workouts_pumpy_cover_known/, 'keys are exact');
  await assert.rejects(() => card(A, ''), /workouts_pumpy_cover_known/);
  const id = await card(A, 'deadlift');
  await assert.rejects(() => db.query(`update public.workouts set pumpy_cover = '../../x' where id = $1`, [id]), /workouts_pumpy_cover_known/);
  await card(A, null);
  // As the person: the column is not theirs to write, and the writes they do make
  // still pass the check (which calls pumpy_cover_keys() as them).
  const as = async (sql) => {
    try { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${A}', false);`); await db.query(sql); return null; }
    catch (e) { return e.message; }
    finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
  };
  assert.match(await as(`update public.workouts set pumpy_cover = 'treadmill' where id = '${id}'`) ?? '', /permission denied/);
  assert.match(await as(`insert into public.workouts(user_id, url, shortcode, platform, title, pumpy_cover) values ('${A}', 'x', 'x', 'pumpy', 'x', 'deadlift')`) ?? '', /permission denied/);
  assert.equal(await as(`update public.workouts set title = 'Renamed', favorite = true where id = '${id}'`), null, 'a rename of a covered card still works');
  assert.equal((await one('select pumpy_cover, title from public.workouts where id = $1', [id])).pumpy_cover, 'deadlift');
  await clear(A);
  ok('check: unknown, mis-cased and empty keys refused; the person cannot write the column; renaming a covered card still works');
}

// ---------- the fallback is app.ts's, and stable ----------
{
  const ids = Array.from({ length: 3000 }, () => crypto.randomUUID());
  ids.push('00000000-0000-4000-8000-000000000000', 'ffffffff-ffff-4fff-bfff-ffffffffffff', '80000000-0000-4000-8000-000000000000');
  const sql = (await db.query('select public.pumpy_cover_fallback(id::uuid) as k from unnest($1::text[]) with ordinality as t(id, i) order by i', [ids])).rows.map((r) => r.k);
  client.ids = ids;
  const inApp = (src) => JSON.parse(vm.runInContext('JSON.stringify(' + src + ')', client));
  const js = inApp('ids.map(function (id) { return pumpyCover({ id: id, platform: "pumpy" }); })');
  assert.deepEqual(js, sql, 'app.ts and pumpy_cover_fallback agree on every id');
  const again = inApp('ids.map(function (id) { return pumpyCover({ id: id, platform: "pumpy", pumpy_cover: null }); })');
  assert.deepEqual(again, js, 'same id, same drawing, however often it is asked');
  assert.equal(new Set(sql).size, 35, 'the fallback reaches every drawing');
  ok('fallback: SQL and app.ts agree on 3,003 ids (incl. 0x00000000, 0xffffffff, 0x80000000), stable, reaches all 35');
}

// ---------- no repeat while a drawing is free ----------
{
  for (let trial = 0; trial < 120; trial++) {
    await clear(A);
    const used = shuffled(keys).slice(0, 1 + Math.floor(Math.random() * 34));
    for (const k of used) await card(A, k);
    // A duplicate of an already-used drawing must not make the others look free.
    if (trial % 3 === 0) await card(A, used[0]);
    const got = await pick(A);
    assert(keys.includes(got), 'a known key');
    assert(!used.includes(got), 'trial ' + trial + ': picked ' + got + ' with ' + (35 - used.length) + ' free');
  }
  ok('no repeat: 120 random libraries of 1-34 covers (some with doubles), the pick was always a free drawing');
}

// ---------- the free set, uniformly ----------
{
  await clear(A);
  const used = shuffled(keys).slice(0, 30), free = keys.filter((k) => !used.includes(k));
  for (const k of used) await card(A, k);
  const got = await draws(A, 6000);
  assert(got.every((k) => free.includes(k)), 'only free drawings');
  const x2 = chiSquare(got, free);
  // df = 4; 18.47 is the p = 0.001 critical value.
  assert(x2 < 18.47, 'uniform over the five free drawings, chi-square ' + x2.toFixed(2));
  const t = tally(got);
  for (const k of free) assert(Math.abs(t[k] - 1200) < 180, k + ' drawn ' + t[k] + ' of 6000 (expected 1200 ± 15%)');
  ok('uniform over the free set: 6,000 draws over 5 free drawings, chi-square ' + x2.toFixed(2) + ' < 18.47 (df 4, p 0.001), each within ±15%');
}

// ---------- all in use: the least shown, uniformly ----------
{
  await clear(A);
  for (const k of keys) await card(A, k);
  const twice = shuffled(keys).slice(0, 25), least = keys.filter((k) => !twice.includes(k));
  for (const k of twice) await card(A, k);
  const got = await draws(A, 5000);
  assert(got.every((k) => least.includes(k)), 'only the least-shown drawings');
  const x2 = chiSquare(got, least);
  // df = 9; 27.88 is the p = 0.001 critical value.
  assert(x2 < 27.88, 'uniform over the ten least shown, chi-square ' + x2.toFixed(2));
  // Every drawing shown exactly twice: every drawing is least shown again.
  for (const k of least) await card(A, k);
  assert.equal(new Set(await draws(A, 2000)).size, 35, 'a level field is all 35 again');
  ok('all in use: 5,000 draws land only on the 10 least-shown (chi-square ' + x2.toFixed(2) + ' < 27.88), a level field reopens all 35');
}

// ---------- cards made before covers, and cards that are not Pumpy's ----------
{
  await clear(A);
  const legacy = await card(A, null);
  const shows = (await one('select public.pumpy_cover_fallback($1) as k', [legacy])).k;
  assert(!(await draws(A, 1500)).includes(shows), 'a card with no cover is counted by the drawing it shows');
  await clear(A);
  // A video card with the same id shape counts for nothing.
  await card(A, null, { platform: 'web', id: legacy });
  assert((await draws(A, 1500)).includes(shows), 'a video card does not take a drawing');
  await clear(A);
  for (const k of keys.slice(0, 34)) await card(B, k);
  assert(new Set(await draws(A, 1500)).size >= 34, "another person's covers do not count");
  await clear(B);
  ok("older cards count by their fallback; video cards and another person's cards do not count");
}

// ---------- the confirm path ----------
{
  await clear(A);
  const thread = crypto.randomUUID();
  await db.query('insert into public.pumpy_threads(id, user_id, title) values ($1, $2, $3)', [thread, A, 'Fixture']);
  const block = { title: null, type: 'straight', exercises: [{ name: 'Goblet Squat', reps: '10' }] };
  const proposal = async (method = null) => (await one(`insert into public.pumpy_messages(thread_id, user_id, role, content, meta)
    values ($1, $2, 'assistant', 'x', $3) returning id`, [thread, A, { proposal: { kind: 'create_workout', title: 'Legs', summary: 'Legs', category: 'Legs',
      muscle_groups: ['Quads'], equipment: [], difficulty: null, duration_minutes: 20, blocks: [block] }, status: 'pending', model: 'fixture', method }])).id;
  const confirm = async (mid) => (await one('select public.confirm_pumpy_proposal($1, $2, true, $3) as r', [A, mid, { id: crypto.randomUUID(), model: 'fixture' }])).r;
  const seen = [];
  for (let i = 0; i < 35; i++) {
    const r = await confirm(await proposal(i % 2 ? 'deterministic_combine' : null));
    assert.equal(r.status, 'ok');
    const row = await one('select pumpy_cover, platform from public.workouts where id = $1', [r.workout.id]);
    assert.equal(row.platform, 'pumpy');
    assert.equal(r.workout.pumpy_cover, row.pumpy_cover, 'the answer carries the cover the row holds');
    seen.push(row.pumpy_cover);
  }
  assert.deepEqual(seen.slice().sort(), keys, 'thirty-five confirms, thirty-five different drawings, the model path and the combine path alike');
  // Two confirms side by side: the profile row lock serialises them, and the
  // second picks after the first's card exists. (PGlite is one connection, so
  // this shows the ordering; the lock is what gives it on the real server.)
  await db.query('delete from public.workouts where user_id = $1 and pumpy_cover = any($2)', [A, [seen[0], seen[1]]]);
  const [m1, m2] = [await proposal(), await proposal()];
  const [r1, r2] = await Promise.all([confirm(m1), confirm(m2)]);
  assert.notEqual(r1.workout.pumpy_cover, r2.workout.pumpy_cover);
  assert.deepEqual([r1.workout.pumpy_cover, r2.workout.pumpy_cover].sort(), [seen[0], seen[1]].sort(), 'the two freed drawings, one each');
  // A repeated accept is the stored receipt: no second pick, no second card.
  const replay = await confirm(m1);
  assert.equal(replay.workout.pumpy_cover, r1.workout.pumpy_cover);
  assert.equal((await one('select count(*)::int as n from public.workouts where user_id = $1', [A])).n, 35);
  const src = readFileSync(MIGRATION, 'utf8');
  const fn = src.slice(src.indexOf('create or replace function public.confirm_pumpy_proposal('));
  assert(fn.indexOf('select plan into plan_name from profiles where id=p_user for update;') < fn.indexOf('cover := public.pumpy_cover_pick(p_user);'),
    'the pick happens after the profile row lock');
  ok('confirm: 35 accepts (model and combine) wrote 35 distinct valid covers; two at once took one freed drawing each; a replay picks nothing');
}

// ---------- the migration re-runs cleanly ----------
{
  await db.exec(readFileSync(MIGRATION, 'utf8'));
  await db.exec(readFileSync(MIGRATION, 'utf8'));
  const c = await one(`select count(*)::int as n from pg_constraint where conname = 'workouts_pumpy_cover_known'`);
  assert.equal(c.n, 1);
  assert.equal((await one('select count(*)::int as n from public.workouts where pumpy_cover is not null')).n, 35, 'no row rewritten');
  ok('idempotent: applied twice more, one constraint, no row touched');
}

console.log('PASS ' + passed + ' Pumpy cover database checks');
await db.close();

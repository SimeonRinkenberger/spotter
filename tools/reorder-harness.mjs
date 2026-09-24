// Offline checks for reordering a card: the sheet's drag model, its keyboard
// and VoiceOver alternative, the order it sends, and the server op that applies
// it. Run against the real source.
//
// The client half is lifted out of app.ts the way tools/midadd-harness.mjs lifts
// its own and run in a vm: where a carried tile lands (the slot math), how fast
// the list scrolls under it and where that stops (auto-scroll bounds), what Move
// up / Move down do at every boundary, the order payload, and the one choke point
// every card write now goes through. What draws is not here; the pane and the
// simulator are where the feel is judged.
//
// The server half is lifted out of index.ts through esbuild: applyReorder must
// take an exact permutation and nothing else, move every item whole (fields
// byte-for-byte, key order kept), and the stale guard must refuse a card that
// changed and pass one that did not. Then the two halves are run against each
// other: every order the sheet can produce, the server stores exactly what the
// card showed after Done.
//
//   node tools/reorder-harness.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const src = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const idx = fs.readFileSync('supabase/functions/spotter/index.ts', 'utf8');

function fn(name) {
  const a = src.indexOf('\n  function ' + name + '(');
  assert(a >= 0, 'not found in app.ts: ' + name);
  const line = src.slice(a + 1, src.indexOf('\n', a + 1));
  if (/\}\s*$/.test(line) && (line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  const b = src.indexOf('\n  }\n', a);
  assert(b > a, 'unterminated in app.ts: ' + name);
  return src.slice(a + 1, b + 4);
}
function tsFn(name) {
  let a = idx.indexOf('\nfunction ' + name + '(');
  if (a < 0) a = idx.indexOf('\nexport function ' + name + '(');
  assert(a >= 0, 'not found in index.ts: ' + name);
  const b = idx.indexOf('\n}\n', a);
  return idx.slice(a + 1, b + 3).replace(/^export /, '');
}

let checks = 0;
function ok(what, f) { f(); checks++; console.log('  ok  ' + what); }

// ---------- the client ----------

const LIFTED = ['ordKeys', 'ordKey', 'ordSecs', 'ordFlat', 'ordMove', 'ordStep', 'ordSlot', 'ordEdge',
  'ordPayload', 'ordApply', 'ordCan', 'cardOf', 'cardWrite', 'ordTitle', 'ordLabel',
  'cxScoreOf', 'cxLogged', 'cxScore', 'complexOf', 'cxCap', 'cxDosed', 'isTimed'];
const consts = ['ORD_EDGE', 'ORD_SPEED'].map((k) => {
  const m = new RegExp('var ' + k + ' = (\\d+);').exec(src);
  assert(m, 'constant not found: ' + k);
  return 'var ' + k + ' = ' + m[1] + ';';
}).join('\n');
const STUBS = `
var state = { workouts: [] }, undoFn = null, orderLanding = null, calls = [];
function flushUndo() { var f = undoFn; undoFn = null; if (f) f(); }
function api(path, opts) { calls.push({ path: path, body: JSON.parse(opts.body), landed: !orderLanding }); return Promise.resolve({ status: "ok" }); }
`;
const ctx = vm.createContext({ Promise, JSON, Math, Object, Array, String, Number, console });
vm.runInContext(consts + STUBS + LIFTED.map(fn).join('\n'), ctx);
const run = (code) => {
  const v = vm.runInContext(code, ctx);
  return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
};
const EDGE = run('ORD_EDGE'), SPEED = run('ORD_SPEED');

// A card with the things a reorder must carry: a titled circuit with rounds and
// rest, a superset with a cap, a straight block, evidence, each, cardio minutes,
// catalog ids, a Pumpy citation and a field no code here knows about.
const CARD = [
  { title: 'Warm-up', type: 'straight', rounds: null, rest_seconds: null, exercises: [
    { name: 'Jump Rope', canonical_id: 'jump-rope', sets: 1, reps: null, duration_seconds: 300, rest_seconds: 0,
      evidence: { source: 'caption', quote: '5 min rope', verified: true } },
    { name: 'World’s Greatest Stretch', canonical_id: null, sets: 1, reps: '5 each', duration_seconds: null,
      rest_seconds: null, evidence: null, added_by_user: true } ] },
  { title: 'Strength', type: 'straight', rounds: null, rest_seconds: 120, exercises: [
    { name: 'Goblet Squat', canonical_id: 'goblet-squat', sets: 4, reps: '8', duration_seconds: null, rest_seconds: 90,
      weight: '24 kg', each: false, evidence: { source: 'speech', quote: 'four sets of eight', verified: false, t: 12.5 } },
    { name: 'Dumbbell Row', canonical_id: 'dumbbell-row', sets: 3, reps: '10', duration_seconds: null, rest_seconds: 60,
      each: true, edited_by_user: true, future_field: { x: [1, 2] } },
    { name: 'Push-up', canonical_id: 'push-up', sets: 3, reps: '12', duration_seconds: null, rest_seconds: null,
      source: { workout_id: '0e0e0e0e-0000-4000-8000-000000000001', block_index: 0, exercise_index: 2 } } ] },
  { title: 'Finisher', type: 'superset', rounds: 3, rest_seconds: 60, duration_seconds: 600, exercises: [
    { name: 'Kettlebell Swing', canonical_id: 'kettlebell-swing', sets: 3, reps: '15', duration_seconds: null, rest_seconds: 0 },
    { name: 'Plank', canonical_id: 'plank', sets: 3, reps: null, duration_seconds: 45, rest_seconds: 0 } ] },
];
vm.runInContext('var CARD = ' + JSON.stringify(CARD) + ';', ctx);
const KEYS = run('ordKeys(CARD)');

console.log('the model');

ok('keys name every stored section and exercise once, in the order shown', () => {
  assert.deepEqual(KEYS, ['s0', 'e0.0', 'e0.1', 's1', 'e1.0', 'e1.1', 'e1.2', 's2', 'e2.0', 'e2.1']);
  assert.deepEqual(run('ordFlat(ordSecs(ordKeys(CARD)))'), KEYS);
  assert.deepEqual(run('ordKey("e2.1")'), { b: 2, e: 1 });
  assert.deepEqual(run('ordKey("s1")'), { b: 1, e: null });
});

ok('an untitled block keeps the name the card gave it, however far it moves', () => {
  vm.runInContext('var PLAIN = [{ title: null, exercises: [{ name: "A" }] }, { title: null, exercises: [{ name: "B" }] }];', ctx);
  assert.equal(run('ordTitle(PLAIN, 1)'), 'Block 2');
  assert.equal(run('ordTitle([{ title: null, exercises: [] }], 0)'), 'Exercises');
  assert.equal(run('ordLabel(CARD, "e1.0")'), 'Goblet Squat');
  assert.equal(run('ordLabel(CARD, "s2")'), 'Finisher');
});

ok('Reorder is offered only where there is something to move', () => {
  assert.equal(run('ordCan({ blocks: [{ exercises: [{ name: "A" }] }] })'), false);
  assert.equal(run('ordCan({ blocks: [{ exercises: [{ name: "A" }, { name: "B" }] }] })'), true);
  assert.equal(run('ordCan({ blocks: [{ exercises: [{ name: "A" }] }, { exercises: [{ name: "B" }] }] })'), true);
  assert.equal(run('ordCan({ blocks: [] })'), false);
});

console.log('the slot math');

// Tiles as the sheet lays them out: 6px gap, sections 50px, exercises 58px.
function layout(keys) {
  const tops = [], hs = [], mids = [];
  let y = 0;
  for (const k of keys) { const h = k[0] === 's' ? 50 : 58; tops.push(y); hs.push(h); mids.push(y + h / 2); y += h + 6; }
  return { tops, hs, mids };
}
const slot = (mids, from, y, lo, hi) => run('ordSlot(' + JSON.stringify(mids) + ',' + from + ',' + y + ',' + lo + ',' + hi + ')');

ok('a tile passes a neighbour at the neighbour’s midpoint, not before', () => {
  const { mids } = layout(KEYS);
  const hi = KEYS.length - 1;
  assert.equal(slot(mids, 4, mids[4], 1, hi), 4, 'at rest it stays');
  assert.equal(slot(mids, 4, mids[5], 1, hi), 4, 'exactly on the midpoint is not past it');
  assert.equal(slot(mids, 4, mids[5] + 0.5, 1, hi), 5);
  assert.equal(slot(mids, 4, mids[3] - 0.5, 1, hi), 3, 'up past its own heading: the end of the section above');
  assert.equal(slot(mids, 4, mids[7] + 1, 1, hi), 7, 'down past the next heading: the top of the next section');
});

ok('the ends: an exercise can never go above the first heading, nothing past the last row', () => {
  const { mids } = layout(KEYS);
  const hi = KEYS.length - 1;
  assert.equal(slot(mids, 4, -5000, 1, hi), 1);
  assert.equal(slot(mids, 4, 99999, 1, hi), hi);
  assert.equal(slot(mids, 1, -5000, 1, hi), 1);
  // A section, carried folded: only headings, every slot open.
  const heads = layout(['s0', 's1', 's2']).mids;
  assert.equal(slot(heads, 2, -5000, 0, 2), 0);
  assert.equal(slot(heads, 0, 99999, 0, 2), 2);
  assert.equal(slot(heads, 1, heads[1], 0, 2), 1);
});

ok('every slot a drag can end in is a valid card: a key list that opens on a heading', () => {
  const { mids } = layout(KEYS);
  const hi = KEYS.length - 1;
  for (let from = 1; from <= hi; from++) {
    if (KEYS[from][0] === 's') continue;
    for (let y = -200; y < mids[hi] + 200; y += 7) {
      const to = slot(mids, from, y, 1, hi);
      const keys = run('ordMove(' + JSON.stringify(KEYS) + ',' + from + ',' + to + ')');
      assert.equal(keys[0], 's0');
      assert.equal(keys.length, KEYS.length);
      assert.deepEqual([...keys].sort(), [...KEYS].sort());
    }
  }
});

ok('the tiles making way move by exactly the lifted tile and one gap', () => {
  // Mirrors ordCarry: rows between from and to shift by foot, the rest stay.
  const body = fn('ordCarry');
  assert(body.includes('j > g.from && j <= to ? -g.foot : j < g.from && j >= to ? g.foot : 0'));
  assert(fn('ordLift').includes('g.foot = g.hs[i] + gap;'));
  assert(fn('ordLift').includes('gap = parseFloat(getComputedStyle(list).rowGap) || 6;'));
  // Transform only, while a finger is down.
  assert(!/\.style\.(top|height|marginTop|marginBottom)\s*=/.test(fn('ordCarry')));
});

console.log('auto-scroll');

const edge = (y, st = 100, max = 500) => run('ordEdge(' + y + ', 100, 700, ' + st + ', ' + max + ')');

ok('still in the middle, faster toward an edge, capped at the edge and beyond it', () => {
  assert.equal(edge(400), 0);
  assert.equal(edge(100 + EDGE), 0);
  assert.equal(edge(700 - EDGE), 0);
  assert(edge(100 + EDGE - 1) < 0 && edge(100 + EDGE - 1) > -1);
  assert(edge(120) < edge(140), 'closer to the top scrolls up faster');
  assert.equal(edge(100), -SPEED);
  assert.equal(edge(20), -SPEED, 'beyond the edge is not faster than at it');
  assert(edge(680) > edge(660), 'closer to the bottom scrolls down faster');
  assert.equal(edge(700), SPEED);
  assert.equal(edge(900), SPEED);
});

ok('it never scrolls past either end of the list', () => {
  assert.equal(edge(110, 0), 0, 'at the top, nothing further up');
  assert.equal(edge(690, 500, 500), 0, 'at the bottom, nothing further down');
  assert(edge(690, 0, 500) > 0, 'at the top it can still go down');
  assert(edge(110, 500, 500) < 0, 'at the bottom it can still go up');
  assert.equal(edge(690, 0, 0), 0, 'a list that fits does not scroll');
});

console.log('Move up / Move down');

const step = (keys, k, d) => run('ordStep(' + JSON.stringify(keys) + ', "' + k + '", ' + d + ')');

ok('an exercise steps over its neighbour, and a heading counts as one', () => {
  assert.deepEqual(step(KEYS, 'e1.1', -1), ['s0', 'e0.0', 'e0.1', 's1', 'e1.1', 'e1.0', 'e1.2', 's2', 'e2.0', 'e2.1']);
  assert.deepEqual(step(KEYS, 'e1.0', -1), ['s0', 'e0.0', 'e0.1', 'e1.0', 's1', 'e1.1', 'e1.2', 's2', 'e2.0', 'e2.1'],
    'first in its section, up: last of the section above');
  assert.deepEqual(step(KEYS, 'e1.2', 1), ['s0', 'e0.0', 'e0.1', 's1', 'e1.0', 'e1.1', 's2', 'e1.2', 'e2.0', 'e2.1'],
    'last in its section, down: first of the next — into the superset');
});

ok('the arrows go grey at the ends', () => {
  assert.equal(step(KEYS, 'e0.0', -1), null, 'first exercise of the first section');
  assert.equal(step(KEYS, 'e2.1', 1), null, 'last row');
  assert.equal(step(KEYS, 's0', -1), null, 'first section');
  assert.equal(step(KEYS, 's2', 1), null, 'last section');
  assert.equal(step(KEYS, 'e9.9', 1), null, 'a key that is not there');
});

ok('a section steps over the whole of the next one, its exercises with it', () => {
  assert.deepEqual(step(KEYS, 's2', -1), ['s0', 'e0.0', 'e0.1', 's2', 'e2.0', 'e2.1', 's1', 'e1.0', 'e1.1', 'e1.2']);
  assert.deepEqual(step(KEYS, 's0', 1), ['s1', 'e1.0', 'e1.1', 'e1.2', 's0', 'e0.0', 'e0.1', 's2', 'e2.0', 'e2.1']);
});

ok('arrow keys and Escape work the selection, and Escape puts it down before the sheet closes', () => {
  const wire = src.slice(src.indexOf('sheet.addEventListener("keydown"'), src.indexOf('$("ordersave").onclick'));
  assert(wire.includes('e.key === "Escape"') && wire.includes('e.stopImmediatePropagation()'));
  assert(wire.includes('ordArrow(ord.sel, e.key === "ArrowUp" ? -1 : 1)'));
  // Registered before the shared Escape/Tab loop that closes sheets.
  assert(src.indexOf('sheet.addEventListener("keydown"') < src.indexOf('"restsheet", "sectionsheet", "ordersheet"].forEach(function (id) {'));
  // Every arrow is a labelled button; the drag handle is hidden from assistive tech.
  const row = fn('ordRow');
  assert(row.includes('b.setAttribute("aria-label", "Move " + title + a[2]);'));
  assert(row.includes('grip.setAttribute("aria-hidden", "true");'));
  assert(row.includes('pick.setAttribute("aria-pressed"'));
  assert(fn('ordArrow').includes('ordSay(ordWhere(k));'));
});

console.log('the order sent, and the server that applies it');

const srv = vm.createContext({});
vm.runInContext(transformSync('class BadEdit extends Error {}\n' + ['guardNum', 'blockGuardForm', 'sameBlock'].map(tsFn).join('\n') +
  '\n' + tsFn('applyReorder') + '\n' + tsFn('reorderGuard') +
  '\n' + tsFn('layoutText'), { loader: 'ts' }).code, srv);
vm.runInContext('var CARD = ' + JSON.stringify(CARD) + ';', srv);
const apply = (order, blocks = CARD) => JSON.parse(JSON.stringify(vm.runInContext(
  'applyReorder(' + JSON.stringify(blocks) + ', ' + JSON.stringify(order) + ')', srv)));
const refuse = (order, re) => assert.throws(() => apply(order), (e) => e.constructor.name === 'BadEdit' && re.test(e.message));
const guard = (seen, blocks = CARD) => vm.runInContext('reorderGuard(' + JSON.stringify(blocks) + ', ' + JSON.stringify(seen) + ')', srv);

ok('the identity order is accepted and changes nothing', () => {
  const same = run('ordPayload(ordSecs(ordKeys(CARD)))');
  assert.deepEqual(same, [{ block: 0, exercises: [0, 1] }, { block: 1, exercises: [0, 1, 2] }, { block: 2, exercises: [0, 1] }]);
  assert.equal(JSON.stringify(apply(same)), JSON.stringify(CARD));
});

ok('an exercise from another section travels as [block, index]', () => {
  const keys = step(KEYS, 'e1.2', 1);
  const order = run('ordPayload(ordSecs(' + JSON.stringify(keys) + '))');
  assert.deepEqual(order[2], { block: 2, exercises: [[1, 2], 0, 1] });
  const out = apply(order);
  assert.deepEqual(out[2].exercises.map((x) => x.name), ['Push-up', 'Kettlebell Swing', 'Plank']);
  assert.equal(out[2].type, 'superset', 'it joined the superset, the superset is still one');
});

ok('the server refuses anything that is not an exact permutation, in a sentence', () => {
  const good = [{ block: 0, exercises: [0, 1] }, { block: 1, exercises: [0, 1, 2] }, { block: 2, exercises: [0, 1] }];
  refuse(good.slice(0, 2), /does not list every section/);
  refuse([...good, { block: 0, exercises: [] }], /does not list every section/);
  refuse([good[0], { block: 0, exercises: [0, 1, 2] }, good[2]], /lists a section twice/);
  refuse([good[0], { block: 3, exercises: [0, 1, 2] }, good[2]], /section this workout does not have/);
  refuse([good[0], { block: -1, exercises: [0, 1, 2] }, good[2]], /section this workout does not have/);
  refuse([good[0], { block: '1', exercises: [0, 1, 2] }, good[2]], /section this workout does not have/);
  refuse([good[0], { block: 1, exercises: [0, 1] }, good[2]], /leaves an exercise out/);
  refuse([good[0], { block: 1, exercises: [0, 1, 1] }, good[2]], /lists an exercise twice/);
  refuse([good[0], { block: 1, exercises: [0, 1, 2, [1, 2]] }, good[2]], /lists an exercise twice/);
  refuse([good[0], { block: 1, exercises: [0, 1, 3] }, good[2]], /exercise this workout does not have/);
  refuse([good[0], { block: 1, exercises: [0, 1, [5, 0]] }, good[2]], /exercise this workout does not have/);
  refuse([good[0], { block: 1, exercises: [0, 1, 1.5] }, good[2]], /exercise this workout does not have/);
  refuse([good[0], { block: 1, exercises: [0, 1, [1]] }, good[2]], /exercise this workout does not have/);
  refuse([good[0], { block: 1 }, good[2]], /what is in each section/);
  refuse(null, /does not list every section/);
  refuse('0,1,2', /does not list every section/);
  const big = [{ name: 'x', exercises: Array.from({ length: 61 }, (_, i) => ({ name: 'M' + i })) }];
  assert.throws(() => vm.runInContext('applyReorder(' + JSON.stringify(big) + ', ' +
    JSON.stringify([{ block: 0, exercises: Array.from({ length: 61 }, (_, i) => i) }]) + ')', srv), /at most 60/);
});

ok('the stale guard is the section guard, block by block: what the owner sees, not the bytes', () => {
  assert.equal(guard(CARD), true);
  // What the iOS bridge does to a card on its way to the page: keys in another
  // order, numbers as doubles, a null that arrives absent. None of it is stale.
  const bridged = JSON.parse(JSON.stringify(CARD), (k, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).reverse().filter(([, x]) => x !== null)) : v));
  bridged[1].exercises[0].sets = 4.000000000000001;
  assert.equal(guard(bridged), true, 'key order, float noise, null against absent');
  const extra = JSON.parse(JSON.stringify(CARD));
  extra[0].exercises[0].evidence = { source: 'speech' };
  extra[0].exercises[0].canonical_id = 'something-else';
  assert.equal(guard(extra), true, 'fields nobody sees on the card do not make it stale');
  // Anything the owner would see changed elsewhere refuses the whole order.
  const edits = [
    (c) => { c[1].exercises[1].name = 'Seal Row'; },
    (c) => { c[1].exercises[0].rest_seconds = 30; },
    (c) => { c[1].exercises[0].sets = 5; },
    (c) => { c[2].title = 'Burner'; },
    (c) => { c[2].rounds = 4; },
    (c) => { c[0].exercises.push({ name: 'Arm Circles' }); },
    (c) => { c[1].exercises.reverse(); },
    (c) => { c.pop(); },
    (c) => { c.reverse(); },
  ];
  for (const edit of edits) {
    const c = JSON.parse(JSON.stringify(CARD));
    edit(c);
    assert.equal(guard(c), false, edit.toString());
  }
  assert.equal(guard(undefined), false, 'no guard sent is no write');
  assert.equal(guard({}), false);
  assert.equal(guard([null, null, null]), false);
  assert(idx.includes('stored.every((b, i) => sameBlock(b, seen[i]))'), 'the reorder guard is the shared one');
});

ok('the ledger reads the layout either side as titles and names', () => {
  const t = JSON.parse(vm.runInContext('layoutText(CARD)', srv));
  assert.deepEqual(t[0], { title: 'Warm-up', exercises: ['Jump Rope', 'World’s Greatest Stretch'] });
  assert.equal(t.length, 3);
});

// Every order the sheet can produce, from a seeded walk of drags and arrows.
let seed = 7;
const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };

ok('every order the sheet can make: the server stores exactly what the card showed, every field whole', () => {
  let orders = 0;
  for (let walk = 0; walk < 400; walk++) {
    let keys = KEYS.slice();
    for (let move = 0; move < 1 + rand(6); move++) {
      const k = keys[rand(keys.length)];
      if (rand(2)) {
        const next = step(keys, k, rand(2) ? 1 : -1);
        if (next) keys = next;
      } else if (k[0] === 'e') {
        keys = run('ordMove(' + JSON.stringify(keys) + ',' + keys.indexOf(k) + ',' + (1 + rand(keys.length - 1)) + ')');
      } else {
        const secs = run('ordSecs(' + JSON.stringify(keys) + ')');
        const from = secs.findIndex((s) => 's' + s.b === k), to = rand(secs.length);
        secs.splice(to, 0, secs.splice(from, 1)[0]);
        keys = run('ordFlat(' + JSON.stringify(secs) + ')');
      }
    }
    const secs = 'ordSecs(' + JSON.stringify(keys) + ')';
    const order = run('ordPayload(' + secs + ')');
    const shown = run('ordApply(CARD, ' + secs + ')');
    const stored = apply(order).filter((b) => b.exercises.length);   // handleCorrection's kept filter
    assert.equal(JSON.stringify(stored), JSON.stringify(shown), 'server and card agree to the byte');
    // Nothing lost, nothing doubled, each exercise byte-for-byte what it was.
    const was = CARD.flatMap((b) => b.exercises.map((x) => JSON.stringify(x))).sort();
    const now = stored.flatMap((b) => b.exercises.map((x) => JSON.stringify(x))).sort();
    assert.deepEqual(now, was);
    // Each block keeps its furniture and its key order; only the list changed.
    for (const s of run(secs)) {
      const b = stored.find((x, i) => i < stored.length && JSON.stringify(Object.keys(x)) === JSON.stringify(Object.keys(CARD[s.b])) &&
        x.title === CARD[s.b].title);
      if (!s.ex.length) continue;
      assert(b, 'block ' + s.b + ' kept its furniture');
      const { exercises: _a, ...furn } = b, { exercises: _b, ...orig } = CARD[s.b];
      assert.equal(JSON.stringify(furn), JSON.stringify(orig));
    }
    orders++;
  }
  assert.equal(orders, 400);
});

console.log('the write, and what waits for it');

ok('Done is one reorder op with the order and the layout it came from', () => {
  const commit = fn('ordCommit');
  assert(commit.includes('cardWrite(id, { op: "reorder", order: ordPayload(secs), expect_blocks: before })'));
  assert(commit.includes('orderLanding = p;'));
  const done = fn('ordDone');
  assert(done.includes('if (o.keys.join() === o.start) return;'), 'nothing moved is nothing written');
  assert(done.includes('commit.order = true;'));
  assert(done.includes('offerUndo(one, commit, function () { live.blocks = o.before; ordRepaint(live, null, null); });'));
});

async function okAsync(what, f) { await f(); checks++; console.log('  ok  ' + what); }

await okAsync('a card write made under a reorder’s toast lands the reorder first, and waits for it', async () => {
  vm.runInContext('calls = []; var committed = 0; undoFn = function () { committed++; orderLanding = new Promise(function (r) { setTimeout0 = r; }); }; undoFn.order = true; var setTimeout0 = null;', ctx);
  const p = vm.runInContext('cardWrite("w1", { op: "edit", block: 0, index: 1 })', ctx);
  assert.equal(run('committed'), 1, 'the pending reorder was committed');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(run('calls.length'), 0, 'the edit has not gone out while the reorder is in flight');
  vm.runInContext('orderLanding = null; setTimeout0();', ctx);
  await p;
  assert.equal(run('calls.length'), 1);
  assert.equal(run('calls[0].path'), 'workouts/w1/exercises');
});

ok('a pending delete is not flushed by another write (only a reorder is)', () => {
  vm.runInContext('calls = []; var deleted = 0; orderLanding = null; undoFn = function () { deleted++; };', ctx);
  vm.runInContext('cardWrite("w1", { op: "edit" })', ctx);
  assert.equal(run('deleted'), 0);
  vm.runInContext('undoFn = null;', ctx);
});

ok('every card write goes through cardWrite', () => {
  assert.equal((src.match(/api\("workouts\/" \+ [a-z.]+ \+ "\/exercises"/g) || []).length, 1);
  assert(fn('postCorrection').includes('return cardWrite(w.id, payload)'));
  assert(fn('deleteBlock').includes('cardWrite(w.id, { op: "delete_block", block: bi, expect_block: asStored(expected) })'));
  assert(fn('deleteExEdit').includes('cardWrite(w.id, { op: "delete", block: ctx.block, index: ctx.index, expect_name: ctx.name })'));
});

ok('a paused or running session of this card keeps its order: the sheet does not open', () => {
  const open = fn('openOrder');
  assert(open.includes('(wo && !wo.finished && wo.workout.id === w.id) || (d && d.workoutId === w.id)'));
  assert(open.indexOf('return;') < open.indexOf('openSheet("ordersheet")'));
  // And a delete under its toast lands before the sheet reads the card.
  assert(open.includes('flushUndo();'));
});

console.log('a past session scored against a reordered card');

// A 12-minute AMRAP of three movements, logged, then the card reordered.
vm.runInContext(`
var AMRAP = { title: "AMRAP", type: "amrap", rounds: null, rest_seconds: null, duration_seconds: 720, exercises: [
  { name: "Thruster", canonical_id: "thruster", reps: "10" }, { name: "Pull-up", canonical_id: "pull-up", reps: "8" },
  { name: "Burpee", canonical_id: "burpee", reps: "6" }] };
var STRAIGHT = { title: "Strength", type: "straight", exercises: [{ name: "Deadlift", sets: 3, reps: "5" }, { name: "Row", sets: 3, reps: "8" }] };
function sets(n, reps) { var out = []; for (var i = 0; i < n; i++) out.push({ reps: reps }); return out; }
var LOG = [
  { name: "Deadlift", block: 0, exercise: 0, sets: sets(3, 5) },
  { name: "Thruster", canonical_id: "thruster", block: 1, exercise: 0, sets: sets(4, 10) },
  { name: "Pull-up", canonical_id: "pull-up", block: 1, exercise: 1, sets: sets(4, 8) },
  { name: "Burpee", canonical_id: "burpee", block: 1, exercise: 2, sets: sets(3, 6) } ];
function cxCapStub() {}
`, ctx);
const score = (blocks) => run('(cxScoreOf({ blocks: ' + blocks + ' }, LOG) || {}).text');
const before = score('[STRAIGHT, AMRAP]');

ok('the card as it was on the day scores as it always did', () => {
  assert.equal(before, '3 rounds + 2 movements');
});

ok('sections swapped since: the same score', () => {
  assert.equal(score('[AMRAP, STRAIGHT]'), before);
});

ok('movements reordered inside the complex since: the same score', () => {
  assert.equal(score('[STRAIGHT, { type: "amrap", duration_seconds: 720, exercises: [AMRAP.exercises[2], AMRAP.exercises[0], AMRAP.exercises[1]] }]'), before);
});

ok('a movement renamed since keeps its place', () => {
  assert.equal(score('[STRAIGHT, { type: "amrap", duration_seconds: 720, exercises: [{ name: "DB Thruster", reps: "10" }, AMRAP.exercises[1], AMRAP.exercises[2]] }]'), before);
});

ok('a block nothing in the log can be matched to by name or id reads by position, as before', () => {
  // Every movement renamed with no catalog id to go by: there is no better
  // evidence than the position, so the old reading stands rather than vanishing.
  const renamed = '[STRAIGHT, { type: "amrap", duration_seconds: 720, exercises: [{ name: "A" }, { name: "B" }, { name: "C" }] }]';
  assert.equal(score(renamed), before);
  // With the ids still on them, a full rename is matched by id, in any order.
  assert.equal(score('[{ type: "amrap", duration_seconds: 720, exercises: [{ name: "B", canonical_id: "burpee" }, ' +
    '{ name: "T", canonical_id: "thruster" }, { name: "P", canonical_id: "pull-up" }] }, STRAIGHT]'), before);
});

// ---------- the ledger, as index.ts writes it ----------

console.log('the route');

ok('handleCorrection takes reorder, guards it, and writes one ledger row through the same patch', () => {
  assert(idx.includes('op !== "reorder") {'));
  const at = idx.indexOf('if (op === "reorder") {');
  assert(at > 0);
  const branch = idx.slice(at, idx.indexOf('} else if (op === "delete_block") {', at));
  assert(branch.indexOf('reorderGuard(blocks, (body as any).expect_blocks)') < branch.indexOf('applyReorder(blocks, (body as any).order)'),
    'stale is decided before the order is read');
  assert(branch.includes('status: "stale"') && branch.includes('409'));
  assert(branch.includes('field: "order"'));
  assert(branch.includes('return json({ status: "ok", workout: w, corrections: 0 }, 200, cors)'), 'an unchanged order writes nothing');
  assert(idx.includes('kind: op === "delete_block" ? "delete" : op === "edit_block" || op === "reorder" ? "edit" : op,'));
  assert(idx.includes('block_index: op === "reorder" ? null : bi,'));
  // A reorder changes no exercise, so nothing re-resolves its catalog id: the one
  // a person picked in the bank, or Pumpy carried over, travels as it is.
  assert(idx.includes('if (op !== "reorder") applyCatalog(shim);'));
  // The same dbPatch every correction uses: the override snapshot, the revision fence.
  assert(idx.includes('user_workout_override: { blocks: kept, muscle_groups: shim.muscle_groups,'));
  assert(idx.includes('user_edit_revision=eq.${w.user_edit_revision ?? 0}'));
  const mig = fs.readFileSync('supabase/migrations/20260924150000_corrections_order.sql', 'utf8');
  assert(/check \(field in \([^)]*'order'\)\)/.test(mig));
});

console.log('\n' + checks + ' checks passed.');

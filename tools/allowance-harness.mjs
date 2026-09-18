// The monthly allowances, checked against the real code on both sides of the wire.
//
// Two halves, one run. The client half renders Settings > Plan into a real DOM
// from a stubbed /api/limits body — Basic and Plus, at nothing used, part used
// and exhausted — and asserts the sentence, the reset date and the exhausted
// styling. The server half slices the allowance table and the refusal copy out
// of index.ts and runs them under Deno, so the numbers the app prints and the
// numbers a 429 counts against are proved to be the same numbers.
//
//   npm install --prefix /tmp/spotter-qa linkedom
//   node tools/allowance-harness.mjs            (from the repo root)
//
// SPOTTER_DOM_MODULE overrides where linkedom lives.
// Deliberately west of Greenwich: the reset instant is 00:00 UTC on the 1st, and
// a reader in Chicago renders that as the 30th unless the code asks for UTC.
process.env.TZ = 'America/Chicago';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const { parseHTML } = await import(pathToFileURL(
  process.env.SPOTTER_DOM_MODULE || '/private/tmp/spotter-qa/node_modules/linkedom/esm/index.js'));

const app = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const markup = fs.readFileSync('supabase/functions/spotter/markup.ts', 'utf8');
const server = fs.readFileSync('supabase/functions/spotter/index.ts', 'utf8');

let checks = 0;
function check(name, body) { body(); checks++; console.log('PASS', name); }

// ---------- slicing the real code out of the real files ----------

function fn(src, name, indent) {
  const head = indent + 'function ' + name + '(';
  const start = src.indexOf(head);
  assert(start >= 0, 'not found: function ' + name);
  const end = src.indexOf('\n' + indent + '}', start);
  assert(end > start, 'unterminated: function ' + name);
  return src.slice(start, end + indent.length + 2);
}

function decl(src, keyword, name, indent) {
  const head = indent + keyword + ' ' + name;
  const start = src.indexOf(head);
  assert(start >= 0, 'not found: ' + keyword + ' ' + name);
  const end = src.indexOf('\n' + indent + '};', start);
  if (end > start && end < src.indexOf(';\n', start)) return src.slice(start, end + indent.length + 3);
  return src.slice(start, src.indexOf(';\n', start) + 2);
}

// ---------- half one: Settings > Plan, in a DOM ----------

const { document } = parseHTML('<html><body>' +
  markup.slice(markup.indexOf('export const MARKUP_BODY')) + '</body></html>');
assert(document.getElementById('setplanuse'), 'the markup no longer has #setplanuse');

const context = vm.createContext({
  document, console, Date, JSON, Math, Number, String,
  billing: { prices: null, limits: null },
  $: (id) => document.getElementById(id),
  el: (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  },
});
for (const name of ['num', 'capNum', 'capMany', 'planWord', 'resetDay', 'useRow',
  'paintPlanUse', 'planBenefits', 'pumpyRoom', 'planCtxLine']) {
  vm.runInContext(fn(app, name, '  '), context);
}
for (const [kw, name] of [['var', 'ALLOW_ROWS'], ['var', 'CAP_WORDS'], ['var', 'MULT']]) {
  vm.runInContext(decl(app, kw, name, '  '), context);
}
const run = (s) => vm.runInContext(s, context);

// October is the interesting month: 1 Oct is the reset day for anything read in
// September, and a client west of UTC renders that instant as 30 Sep unless the
// code asks for UTC — which is the bug this assertion exists to catch.
const RESETS = '2026-10-01T00:00:00.000Z';
// The date the reader's own locale would write for that instant, in UTC. Taken
// from Intl rather than hard-coded, because "1 Oct" and "Oct 1" are both right
// and which one a person sees is their device's business, not ours.
const BACK = new Date(RESETS).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

function limits(plan, month, extra) {
  return Object.assign({
    status: 'ok', plan: plan,
    limits: { library: plan === 'free' ? 20 : null, saves: 30, extract: 10, media: 4, uploads: 1, helper: 20 },
    library_count: 7,
    month: Object.assign({
      reads: 0, reads_cap: plan === 'free' ? 4 : 20,
      answers: 0, answers_cap: plan === 'free' ? 100 : 300,
      helpers: 0, helpers_cap: plan === 'free' ? 20 : 100,
      uploads: 0, uploads_cap: plan === 'free' ? 1 : 10,
      previews: 0, previews_cap: plan === 'free' ? 4 : null,
      resets_at: RESETS,
    }, month),
  }, extra);
}

function paint(r) {
  context.billing.limits = r;
  run('paintPlanUse(' + JSON.stringify(r) + ')');
  const n = document.getElementById('setplanuse');
  return {
    node: n,
    hidden: n.classList.contains('hide'),
    lines: Array.from(n.querySelectorAll('.usel')).map((e) => e.textContent),
    out: Array.from(n.querySelectorAll('.usel.out')).map((e) => e.textContent),
  };
}

check('Plus, nothing used: one line per allowance, each naming the UTC reset day', () => {
  const p = paint(limits('plus'));
  assert.equal(p.hidden, false);
  assert.deepEqual(p.lines, [
    'Video reads 0 of 20 this month · resets ' + BACK,
    'Coaching answers 0 of 300 this month · resets ' + BACK,
    'Explanations and swaps 0 of 100 this month · resets ' + BACK,
    'Uploads 0 of 10 this month · resets ' + BACK,
  ]);
  // No shelf line for a plan with no ceiling: there is nothing to count towards.
  assert.equal(p.out.length, 0);
});

check('the reset date is rendered in UTC, not in the reader’s own time zone', () => {
  assert.equal(run('resetDay("' + RESETS + '")'), BACK);
  // In Chicago the same instant is the 30th of September. If that ever comes out
  // of resetDay, every reader west of Greenwich is being told the wrong day.
  assert.notEqual(BACK, new Date(RESETS).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
  assert.equal(run('resetDay(null)'), '');
  assert.equal(run('resetDay("not a date")'), '');
});

check('Plus after three reads says exactly what the brief asks it to say', () => {
  const p = paint(limits('plus', { reads: 3 }));
  assert.equal(p.lines[0], 'Video reads 3 of 20 this month · resets ' + BACK);
});

check('Plus exhausted: the line turns, and only the line that ran out', () => {
  const p = paint(limits('plus', { reads: 20, answers: 12 }));
  assert.deepEqual(p.out, ['Video reads 20 of 20 this month · resets ' + BACK]);
  assert.equal(p.lines[1], 'Coaching answers 12 of 300 this month · resets ' + BACK);
});

check('Basic gets the shelf line and its four reads, from the same fields', () => {
  const p = paint(limits('free', { reads: 2, previews: 2 }));
  assert.deepEqual(p.lines, [
    'Library 7 of 20 saved',
    'Video reads 2 of 4 this month · resets ' + BACK,
    'Coaching answers 0 of 100 this month · resets ' + BACK,
    'Explanations and swaps 0 of 20 this month · resets ' + BACK,
    'Uploads 0 of 1 this month · resets ' + BACK,
  ]);
  // The shelf never says "this month" and never carries a date: it is a stock.
  assert.ok(!p.lines[0].includes('this month'));
});

check('Basic exhausted on previews reads 4 of 4, not 5 of 4', () => {
  const p = paint(limits('free', { reads: 4, previews: 4 }));
  assert.deepEqual(p.out, ['Video reads 4 of 4 this month · resets ' + BACK]);
});

check('the shared budget note appears under the allowances, not instead of them', () => {
  const p = paint(limits('plus', { reads: 5 }, { paid_enabled: false }));
  assert.equal(p.lines.length, 5);
  assert.ok(p.lines[4].startsWith('Spotter’s shared AI budget is spent for today') ||
    p.lines[4].startsWith("Spotter's shared AI budget is spent for today"), p.lines[4]);
  assert.ok(p.lines[4].includes('stays readable'));
});

check('an older server that sends no month object hides the group rather than lying', () => {
  const r = limits('plus');
  delete r.month;
  r.limits.library = null;
  const p = paint(r);
  assert.equal(p.hidden, true);
  assert.deepEqual(p.lines, []);
});

check('an uncapped allowance prints no line at all', () => {
  const p = paint(limits('plus', { reads_cap: null, answers_cap: null, helpers_cap: null, uploads_cap: null }));
  assert.deepEqual(p.lines, []);
  assert.equal(p.hidden, true);
});

// ---------- the copy that surrounds the numbers ----------

check('a monthly refusal speaks in months, and a burst stop still speaks in days', () => {
  const month = run('planCtxLine(' + JSON.stringify({
    kind: 'media', plan: 'free', cap: 4, used: 4, scope: 'month',
    upgrade: true, next_plan: 'plus', next_cap: 20,
  }) + ')');
  assert.equal(month,
    'That is 4 video reads this month, the free plan’s allowance for it. It comes back on the 1st. Plus reads 20 a month.');
  const day = run('planCtxLine(' + JSON.stringify({
    kind: 'saves', plan: 'free', cap: 30, used: 30, upgrade: true, next_plan: 'plus', next_cap: 200,
  }) + ')');
  assert.ok(day.includes('today'), day);
  assert.ok(day.includes('midnight UTC'), day);
  assert.ok(!day.includes('this month'), day);
});

check('Pumpy has one branch now, and it is the monthly one', () => {
  context.billing.prices = { caps: { free: { pumpy_month: 1500 }, plus: { pumpy_month: 5000 } } };
  const line = run('planCtxLine({ kind: "pumpy", plan: "free", next_plan: "plus" })');
  assert.ok(line.startsWith('That is this month’s coaching used up — my credits come back on the 1st.'), line);
  assert.ok(!line.includes('midnight'), line);
});

check('the paywall rows quote the allowances, from the same table the server refuses against', () => {
  const rows = run('planBenefits(' + JSON.stringify({
    free: { library: 20, month_reads: 4, month_answers: 100, month_helpers: 20, month_uploads: 1 },
    plus: { library: null, month_reads: 20, month_answers: 300, month_helpers: 100, month_uploads: 10 },
  }) + ')');
  assert.equal(rows.length, 5);
  assert.ok(rows[1].startsWith('Read 20 videos a month in full'), rows[1]);
  assert.ok(rows[1].includes('Basic reads 4.'), rows[1]);
  assert.ok(rows[2].startsWith('300 coaching answers a month'), rows[2]);
  assert.ok(rows[2].includes('100 explanations and swaps'), rows[2]);
  assert.ok(rows[3].includes('never metered'), rows[3]);
  assert.ok(rows[4].includes('reset on the 1st'), rows[4]);
  for (const row of rows) assert.ok(!/ a day\b/.test(row), 'a daily number survived on the paywall: ' + row);
});

check('an older server that sends no allowances makes no promise it cannot keep', () => {
  const rows = run('planBenefits({ free: { library: 20 }, plus: { library: null } })');
  for (const row of rows) {
    assert.ok(!/\bas many\b/.test(row), 'an absent cap printed as "as many": ' + row);
  }
  assert.ok(rows.some((r) => r.includes('Settings shows what is left')), rows.join(' | '));
});

// ---------- half two: the server's table and its refusal copy, under Deno ----------

const pieces = [
  '// generated by tools/allowance-harness.mjs — do not edit',
  'function models(): void {}',                       // the cache tick, not under test
  decl(server, 'type', 'AllowanceKind', ''),
  decl(server, 'type', 'Allowance', ''),
  decl(server, 'const', 'ALLOWANCE_KINDS', ''),
  decl(server, 'const', 'ALLOWANCE_LOG_KIND', ''),
  decl(server, 'const', 'ALLOWANCE_DEFAULTS', ''),
  decl(server, 'const', 'PREVIEW_CAP', ''),
  decl(server, 'const', 'PLAN_NAMES', ''),
  fn(server, 'limitCap', ''),
  fn(server, 'planName', ''),
  fn(server, 'buildAllowanceCfg', ''),
  'let allowanceCache: Record<string, Allowance> = ALLOWANCE_DEFAULTS;',
  fn(server, 'allowancesConfig', ''),
  fn(server, 'allowanceFor', ''),
  fn(server, 'allowanceMessage', ''),
  fn(server, 'utcMonthStart', ''),
  fn(server, 'utcMonthName', ''),
  fn(server, 'utcResetDay', ''),
  fn(server, 'utcNextMonth', ''),
  'function plusPlan(plan: string): boolean { return ["plus", "pro", "staff"].includes(plan); }',
];

const assertions = `
// A local assert rather than jsr:@std/assert: this has to run with no network.
function assert(ok: unknown, msg: string): void { if (!ok) throw new Error("FAIL " + msg); }
function assertEquals(a: unknown, b: unknown): void {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error("FAIL " + x + " !== " + y);
}

// 1. the compiled table is the table of record in ALLOWANCES.md section 3.
assertEquals(allowanceFor("free"), { reads: 4, answers: 100, helpers: 20, uploads: 1 });
assertEquals(allowanceFor("plus"), { reads: 20, answers: 300, helpers: 100, uploads: 10 });
console.log("PASS the compiled defaults are the published allowances");

// 2. an unknown plan reads as free. A bad string in one column must never mean
//    "no ceiling".
assertEquals(allowanceFor("gold-tier"), allowanceFor("free"));
console.log("PASS an unknown plan falls back to Basic, not to unlimited");

// 3. config can lower what Basic is shown and can never raise it past what
//    reserve_video_preview will actually admit.
allowanceCache = buildAllowanceCfg({ "allowances.monthly": JSON.stringify({
  free: { reads: 99 }, plus: { reads: 12 },
}) });
assertEquals(allowanceFor("free").reads, PREVIEW_CAP);
assertEquals(allowanceFor("plus").reads, 12);
// A row that names only two plans is merged over the defaults, not swapped for them.
assertEquals(allowanceFor("free").answers, 100);
assertEquals(allowanceFor("staff").reads, null);
console.log("PASS config merges over the defaults and cannot oversell Basic's previews");

// 4. a typo is a typo, not an uncapped month.
allowanceCache = buildAllowanceCfg({ "allowances.monthly": "{not json" });
assertEquals(allowanceFor("plus"), { reads: 20, answers: 300, helpers: 100, uploads: 10 });
allowanceCache = buildAllowanceCfg({ "allowances.monthly": JSON.stringify({ plus: { reads: "twenty" } }) });
assertEquals(allowanceFor("plus").reads, 20);
// An explicit null is deliberate and does mean uncapped.
allowanceCache = buildAllowanceCfg({ "allowances.monthly": JSON.stringify({ plus: { reads: null } }) });
assertEquals(allowanceFor("plus").reads, null);
allowanceCache = ALLOWANCE_DEFAULTS;
console.log("PASS an unparseable or mistyped cap falls back; an explicit null is honoured");

// 5. the refusal names the allowance, the month and the day it comes back.
const msg = allowanceMessage("reads", "plus", 20);
assert(msg.startsWith("That is 20 video reads on the Plus plan for "), msg);
assert(msg.includes("your allowance comes back on 1 "), msg);
assert(!msg.includes("today"), msg);
assert(!msg.includes("midnight"), msg);
assertEquals(allowanceMessage("uploads", "free", 1).startsWith("That is 1 upload on the Free plan"), true);
console.log("PASS the refusal copy names the allowance, the month and the reset day");

// 6. the reset day and the month boundary agree with each other, in UTC.
const start = utcMonthStart(), next = utcNextMonth();
assertEquals(start.slice(8), "01T00:00:00Z");
assertEquals(next.slice(8, 10), "01");
assertEquals(utcResetDay().slice(0, 2), "1 ");
assert(new Date(next).getTime() > new Date(start).getTime(), next + " is not after " + start);
console.log("PASS the month window and the reset day are the same UTC instant");

// 7. every allowance is counted from exactly one saves_log kind.
assertEquals(new Set(Object.values(ALLOWANCE_LOG_KIND)).size, ALLOWANCE_KINDS.length);
console.log("PASS each allowance has its own ledger kind");
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotter-allowance-'));
const file = path.join(dir, 'server.ts');
fs.writeFileSync(file, pieces.join('\n\n') + '\n' + assertions);
try {
  const out = execFileSync('deno', ['run', file], { encoding: 'utf8' });
  for (const line of out.trim().split('\n')) { console.log(line); if (line.startsWith('PASS')) checks++; }
} catch (e) {
  console.error(e.stdout || '', e.stderr || '');
  console.error('FAIL the server half. The sliced source is at ' + file);
  process.exit(1);
}
fs.rmSync(dir, { recursive: true, force: true });

console.log('\n' + checks + ' checks passed');

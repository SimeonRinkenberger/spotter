// The web page refuses to be drawn inside another page; the native shell is
// unaffected. Runs the head of the real app script (built page) in a vm with a
// framed and an unframed window. No browser, no network.
//
//   node tools/frame-guard-check.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const APP = readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const start = APP.indexOf('(function () {\n  "use strict";');
const stop = APP.indexOf('  var sb = window.supabase.createClient(');
assert(start > 0 && stop > start, 'the app script opens with its IIFE and builds the client after the head');
// The head of the IIFE, closed right where the Supabase client would be built:
// reaching that line is recorded as "the app started".
const head = APP.slice(start, stop) + '  started.push(true);\n})();';

let checks = 0;
const ok = (cond, label) => { assert.ok(cond, label); checks++; };
function run({ framed, native = null, blocked = false }) {
  const started = [];
  const replaced = [];
  const docEl = { style: {} };
  const win = { SpotterNative: native };
  win.self = win;
  win.top = framed ? { location: { replace: (u) => { if (blocked) throw new Error('SecurityError'); replaced.push(u); } } } : win;
  const ctx = vm.createContext({ window: win, location: { href: 'https://simeonrinkenberger.github.io/spotter/', origin: 'https://simeonrinkenberger.github.io', pathname: '/spotter/' },
    document: { documentElement: docEl }, started });
  vm.runInContext(head, ctx);
  return { started, replaced, hidden: docEl.style.display === 'none' };
}

let r = run({ framed: false });
ok(r.started.length === 1 && !r.hidden && !r.replaced.length, 'R-11: unframed, the web app starts as always');
r = run({ framed: true });
ok(!r.started.length && r.hidden && r.replaced[0] === 'https://simeonrinkenberger.github.io/spotter/',
  'R-11: framed, it asks to be the top window, draws nothing and does not start');
r = run({ framed: true, blocked: true });
ok(!r.started.length && r.hidden, 'R-11: framed where it may not navigate the top (sandbox), it still draws nothing');
r = run({ framed: false, native: {} });
ok(r.started.length === 1 && !r.hidden, 'R-11: the native shell starts as always');
r = run({ framed: true, native: {} });
ok(r.started.length === 1 && !r.hidden && !r.replaced.length, 'R-11: the native shell is never subject to the guard');
const built = readFileSync('docs/index.html', 'utf8');
ok(built.includes('if (!native && window.top !== window.self) {'), 'R-11: the built page carries the guard');
console.log('PASS ' + checks + ' frame-guard checks: the web page refuses to be framed, the native shell is untouched.');

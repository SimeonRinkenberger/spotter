// The web app stays retired. No browser, no network: the real files, read and run.
//
//   node tools/retire-web-check.mjs
//
// 1. docs/ (what GitHub Pages publishes) carries no Supabase client, no app script,
//    no key, no API call and no web manifest, and every page the stores, the server
//    and old native builds send people to is still there.
// 2. docs/sw.js is the kill switch (tools/sw-harness.mjs drives it in detail).
// 3. The landing page's own script, run against a fake shared origin, removes
//    Spotter's session, library cache, every spotter* key, Spotter's caches and
//    Spotter's worker, and leaves another app's keys, caches and worker alone; it
//    answers each kind of old email link, and takes tokens out of the address bar.
// 4. The edge function no longer serves the app, and never lets the Pages origin
//    through CORS, whatever ALLOWED_ORIGINS says; the modules that send people back
//    to the Pages address still do. spotter-purchases no longer allows it either.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

let checks = 0;
const ok = (cond, label) => { assert.ok(cond, label); checks++; };
const read = (p) => readFileSync(p, 'utf8');

// ---------- 1. what Pages publishes ----------
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = dir + '/' + name;
    if (statSync(p).isDirectory()) walk(p); else files.push(p);
  }
})('docs');
const text = files.filter((p) => /\.(html|js|json|webmanifest|css|txt|svg)$/.test(p));
const FORBIDDEN = [
  [/supabase-js|createClient\s*\(|window\.supabase/, 'Supabase client'],
  [/eyJhbGciOi[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, 'JWT (the anon key or any other)'],
  [/\/functions\/v1\/|\/rest\/v1\/|\/auth\/v1\//, 'call into the Supabase project'],
  [/mtzevoxxpsktmrbbuxva\.supabase\.co/, 'Supabase project host'],
  [/serviceWorker\.register\s*\(/, 'service-worker registration'],
  [/rel="manifest"/, 'web-app manifest link'],
  [/<script[^>]+\ssrc\s*=/i, 'script loaded from a file or another host'],
  [/\bfetch\s*\(|XMLHttpRequest|sendBeacon|EventSource|WebSocket/, 'network request from script'],
];
// Comments may name what a page does not do ("no Supabase client"); code may not.
// Only whole comments are dropped (HTML, block, and // on a line of its own), so a
// URL's "//" inside real code is still scanned.
const code = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
for (const p of text) {
  const body = code(read(p));
  for (const [re, what] of FORBIDDEN) ok(!re.test(body), p + ' carries no ' + what);
}
ok(!existsSync('docs/manifest.webmanifest'), 'docs/ has no web-app manifest (the site is not installable)');
const landing = read('docs/index.html');
ok(Buffer.byteLength(landing) < 40_000, 'docs/index.html is the small landing page (' + Buffer.byteLength(landing) + ' bytes), not the app');
ok(!landing.includes('window.SpotterNative') && !landing.includes('var API = '), 'docs/index.html holds none of the app script');
ok(/Spotter is an iPhone and Android app now\./.test(landing), 'the landing page says Spotter is an iPhone and Android app');
ok(/Coming soon to the App&nbsp;Store and Google&nbsp;Play/.test(landing), 'and that it is coming soon to both stores');
ok(!/apps\.apple\.com|play\.google\.com/.test(landing), 'with no store link until the listings are public');
ok(/Your account and workouts are safe\. Sign in with the same email in the app\./.test(landing), 'and tells a web user their account is safe');
for (const href of ['privacy.html', 'terms.html', 'delete-account.html', 'mailto:business@quarterdeckcollective.com']) {
  ok(landing.includes('href="' + href + '"'), 'the landing page links ' + href);
}
// Every Pages address something else sends people to: the store listings
// (privacy, deletion), strava.ts (strava-return.html), billing.ts (billing-return.html),
// native/bridge.js (any <page>.html), design/pumpy.md, and tools/ios/build.mjs (assets, icon).
for (const p of ['index.html', 'sw.js', 'privacy.html', 'terms.html', 'delete-account.html', 'strava-return.html',
  'billing-return.html', 'whats-new.html', 'pumpy.html', 'icon.png', 'strava-connect.svg']) {
  ok(existsSync('docs/' + p), 'docs/' + p + ' is still published');
}
ok(readdirSync('docs/assets/pumpy').some((f) => f.endsWith('.webp')), 'the mascot art is still published (the native bundle copies it from docs/assets)');
const del = read('docs/delete-account.html');
ok(/Settings<\/b>[\s\S]*Delete account[\s\S]*mailto:business@quarterdeckcollective\.com/.test(del),
  'the deletion page says how to delete in the app and by email, without the web app');
ok(!/href="\.\/\?(strava|billing)=/.test(read('docs/strava-return.html') + read('docs/billing-return.html')),
  'the Strava and billing return pages no longer link back into the web app');
ok(!existsSync('supabase/functions/spotter/page.gen.ts') && !existsSync('supabase/functions/spotter/page.ts'),
  'the edge function no longer carries a copy of the app page');
ok(read('.gitignore').split('\n').includes('web-dist/'), "build.mjs's app page (web-dist/) is not committed");

// ---------- 2. the kill switch ----------
{
  const events = {};
  let unregistered = 0;
  const deleted = [];
  vm.runInContext(read('docs/sw.js'), vm.createContext({
    Promise,
    caches: { keys: async () => ['spotter-shell-v7', 'simmer-shell-v1'], delete: async (k) => { deleted.push(k); return true; } },
    self: {
      addEventListener: (k, fn) => { events[k] = fn; }, skipWaiting: () => Promise.resolve(),
      registration: { unregister: async () => { unregistered++; return true; } },
      clients: { matchAll: async () => [] },
    },
  }));
  ok(Object.keys(events).sort().join() === 'activate,install', 'sw.js registers install and activate only: no fetch, no push');
  let wait = Promise.resolve();
  events.activate({ waitUntil: (p) => { wait = p; } });
  await wait;
  ok(unregistered === 1 && deleted.join() === 'spotter-shell-v7', "sw.js unregisters and deletes Spotter's cache, not Simmer's");
}

// ---------- 3. the landing page's script on a shared origin ----------
const script = /<script>([\s\S]*?)<\/script>/.exec(landing)[1];
function store(init) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    keys: () => [...m.keys()].sort(),
  };
}
async function visit(url, { local = {}, session = {}, cacheNames = [], scopes = [] } = {}) {
  const u = new URL(url);
  const els = {};
  const el = (id) => (els[id] ??= { id, hidden: true, textContent: '', runs: [], appendChild(c) { this.runs.push(c); } });
  const replaced = [], deleted = [], unregistered = [];
  const win = { localStorage: store(local), sessionStorage: store(session) };
  vm.runInContext(script, vm.createContext({
    window: win, URL, URLSearchParams, Promise,
    location: { href: u.href, search: u.search, hash: u.hash, pathname: u.pathname },
    history: { replaceState: (_s, _t, to) => replaced.push(to) },
    document: { getElementById: el, createElement: (tag) => ({ tag, textContent: '' }) },
    caches: { keys: async () => cacheNames, delete: async (n) => { deleted.push(n); return true; } },
    navigator: { serviceWorker: { getRegistrations: async () => scopes.map((scope) => ({ scope, unregister: async () => { unregistered.push(scope); return true; } })) } },
  }));
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const note = el('linknote'), code = el('codenote');
  return {
    replaced, deleted, unregistered, local: win.localStorage.keys(), session: win.sessionStorage.keys(),
    note: note.hidden ? null : el('linkhead').textContent,
    noteText: el('linkbody').runs.map((r) => r.textContent).join(''),
    bold: el('linkbody').runs.filter((r) => r.tag === 'b').map((r) => r.textContent),
    code: code.hidden ? null : el('codeword').textContent,
  };
}
const PAGES = 'https://simeonrinkenberger.github.io/spotter/';
{
  const r = await visit(PAGES, {
    local: {
      'sb-mtzevoxxpsktmrbbuxva-auth-token': '{"access_token":"fake"}', 'sb-mtzevoxxpsktmrbbuxva-auth-token-code-verifier': 'fake',
      'spotter-lib-v1': '{}', spotter_sort: 'new', 'spotter.creator.code': 'MARIA|link', 'spotter_pumpy_v1:u': '{}',
      'spotter_embed_h:tiktok:390': '700', spotter_push_token: 'x', spotter_draft: 'x',
      'sb-mfxaogzzegwkscamarre-auth-token': '{"simmer":true}', 'simmer-recipes-v1': '[]', 'supabase.auth.token': 'other', theme: 'dark',
    },
    session: { spotter_share_pending: 'x', spotter_open_pending: 'x', spotter_strava_waiting: '1', simmer_tab: 'home' },
    cacheNames: ['spotter-shell-v6', 'spotter-shell-v7', 'simmer-shell-v1', 'workbox-precache-v2'],
    scopes: [PAGES, 'https://simeonrinkenberger.github.io/simmer/', 'https://simeonrinkenberger.github.io/'],
  });
  ok(r.local.join() === ['sb-mfxaogzzegwkscamarre-auth-token', 'simmer-recipes-v1', 'supabase.auth.token', 'theme'].sort().join(),
    "landing: Spotter's session, library cache and every spotter* key leave localStorage; Simmer's and anyone else's stay (" + r.local.join(', ') + ')');
  ok(r.session.join() === 'simmer_tab', 'landing: the same in sessionStorage');
  ok(r.deleted.sort().join() === 'spotter-shell-v6,spotter-shell-v7', "landing: Spotter's caches are deleted, nobody else's");
  ok(r.unregistered.join() === PAGES, "landing: Spotter's worker (scope /spotter/) is unregistered, Simmer's and a root one are not");
  ok(r.note === null && r.code === null && !r.replaced.length, 'landing: a plain visit shows no notice and leaves the address alone');
}
{
  const r = await visit(PAGES + '#access_token=a.b.c&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery');
  ok(r.note === 'Reset your password in the\u00a0app' && r.bold.join() === 'Forgot your password?' && /six-digit code/.test(r.noteText),
    'landing: a password-reset link says to reset it in the app with a new six-digit code');
  ok(r.replaced.join() === '/spotter/', 'landing: and takes the tokens out of the address bar');
}
{
  const r = await visit(PAGES + '?code=6f1d3a2e-9b7c-4e8f-a1d2-3c4b5a697887');
  ok(r.note === 'Carry on in the Spotter\u00a0app' && r.code === null && r.replaced.join() === '/spotter/',
    'landing: a PKCE ?code= (a UUID) is an email link, never a creator code, and leaves the address');
}
{
  const r = await visit(PAGES + '#access_token=a&refresh_token=r&type=signup');
  ok(r.note === 'Carry on in the Spotter\u00a0app' && /confirming an email address, that is done/.test(r.noteText),
    'landing: a confirmation link says it is done and to carry on in the app');
}
{
  const r = await visit(PAGES + '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  ok(r.note === 'That link has\u00a0expired' && r.replaced.join() === '/spotter/', 'landing: an expired link says so and asks for a new code');
}
{
  const r = await visit(PAGES + '?code=maria');
  ok(r.code === 'MARIA' && r.note === null && !r.replaced.length, "landing: a creator's ?code= is shown, upper-cased, and stays shareable");
  const both = await visit(PAGES + '?code=MARIA#access_token=a&type=magiclink');
  ok(both.code === 'MARIA' && both.note && both.replaced.join() === '/spotter/?code=MARIA', 'landing: a token next to a creator code goes, the code stays');
  const junk = await visit(PAGES + '?code=%3Cimg%20src%3Dx%3E');
  ok(junk.code === null, 'landing: anything that is not a code (3-20 letters and digits) is ignored');
}

// ---------- 4. the edge functions ----------
const index = read('supabase/functions/spotter/index.ts');
ok(!/PAGE_HTML|from "\.\/page(\.gen)?\.ts"/.test(index), 'index.ts imports no app page');
ok(!/manifest\.webmanifest"/.test(index.replace(/\/\/.*$/gm, '')), 'index.ts has no web-app manifest route');
{
  const from = index.indexOf('const RETIRED_WEB_ORIGIN');
  const to = index.indexOf('function json(', from);
  assert(from > 0 && to > from, 'the CORS block is where it was');
  const ts = index.slice(from, to).replace('function corsFor(', 'globalThis.corsFor = function corsFor(');
  const js = transformSync('type Cors = Record<string, string>;\n' + ts, { loader: 'ts' }).code;
  function cors(env, origin) {
    const ctx = vm.createContext({ Deno: { env: { get: (k) => (k === 'ALLOWED_ORIGINS' ? env : undefined) } } });
    vm.runInContext(js + '\nglobalThis.LANDING = LANDING_URL;', ctx);
    return { allow: ctx.corsFor({ headers: { get: () => origin } })['Access-Control-Allow-Origin'], landing: ctx.LANDING };
  }
  const pages = 'https://simeonrinkenberger.github.io';
  ok(cors(undefined, pages).allow !== pages, 'CORS: the Pages origin is refused with the default list');
  ok(cors(pages + ',http://localhost:8000', pages).allow !== pages, 'CORS: and refused even when ALLOWED_ORIGINS still names it');
  ok(cors(pages, pages).allow === 'null', 'CORS: a list of only the Pages origin leaves no origin at all, said as "null"');
  ok(cors(undefined, 'http://localhost:8000').allow === 'http://localhost:8000', 'CORS: the local test origin still works');
  ok(cors(undefined, 'capacitor://localhost').allow === 'http://localhost:8000', 'CORS: a stray origin gets the local one back, never Pages');
  ok(cors(undefined, '').landing === PAGES, 'the function root sends people to the landing page');
}
{
  const router = index.slice(index.indexOf('Deno.serve(async (req: Request) => {'));
  const root = /if \(req\.method === "GET" && \(path === "\/" \|\| path === ""\)\) \{([\s\S]*?)\n    \}/.exec(router);
  ok(root && /status: 302/.test(root[1]) && /location: LANDING_URL/.test(root[1]), 'GET / answers 302 to the landing page');
  ok(/if \(req\.method === "HEAD" && \(path === "\/" \|\| path === "\/icon\.png"\)\) \{\s*return new Response\(null, \{ status: 200/.test(router),
    'HEAD / still answers 200 (a reachability probe)');
}
for (const mod of ['billing', 'strava', 'push', 'ops']) {
  ok(read('supabase/functions/spotter/' + mod + '.ts').includes('"https://simeonrinkenberger.github.io,http://localhost:8000,http://127.0.0.1:8000")'),
    mod + '.ts still sends people back to the Pages address (the landing page) first');
}
const purchases = read('supabase/functions/spotter-purchases/index.ts');
ok(/const origins = new Set\(\['https:\/\/localhost','capacitor:\/\/localhost'\]\);/.test(purchases),
  'spotter-purchases allows the two Capacitor shells and not the Pages origin');

console.log('PASS ' + checks + ' retired-web checks: Pages publishes a landing page with no client, key or app; the kill switch; ' +
  'the landing script clears only Spotter from a shared origin and answers old links; the function serves no app and refuses the Pages origin.');

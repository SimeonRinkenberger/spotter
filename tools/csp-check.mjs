// The web page's Content-Security-Policy and SRI, checked statically against the
// page it governs. No network.
//
//   node tools/csp-check.mjs        (after node build.mjs)
//
// Fails when:
//   - docs/index.html has no CSP <meta>, or it is not in <head> ahead of every
//     tag it has to govern;
//   - script-src allows 'unsafe-inline' / 'unsafe-eval' / a bare CDN host, or an
//     inline <script> in the page is not allowed by its sha256;
//   - the supabase-js tag is not pinned by integrity to the exact bytes of the
//     version package.json installs, with crossorigin, or its preload differs;
//   - any origin the page uses is not allowed by the directive its use needs
//     (script, frame, style, font, img, connect) — or, for an origin that is only
//     ever navigated to, is not on the short navigation list below;
//   - the edge function's copy differs from the web page, or the native shell
//     (native-dist/, when built) still carries the web policy.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const failures = [];
let passed = 0;
function check(ok, what) {
  if (ok) passed++;
  else { failures.push(what); console.error('FAIL ' + what); }
}

const page = readFileSync('docs/index.html', 'utf8');
const head = page.slice(0, page.indexOf('</head>'));
const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(page);
check(meta, 'docs/index.html carries a Content-Security-Policy <meta>');
const policy = {};
if (meta) {
  for (const part of meta[1].split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) policy[name] = values;
  }
  const at = meta.index;
  check(at < head.length, 'the CSP meta is inside <head>');
  const firstGoverned = head.search(/<(link|script|style)\b/i);
  check(firstGoverned < 0 || at < firstGoverned, 'the CSP meta comes before every <link>, <script> and <style>');
}
const directive = (name) => policy[name] ?? policy['default-src'] ?? [];

// ---------- CSP source matching (scheme, host with optional *., path prefix) ----------
function allows(name, url) {
  const u = new URL(url);
  for (const src of directive(name)) {
    if (src === "'self'" || src.startsWith("'")) continue;   // 'self' is the page's own origin, never a third party
    if (/^[a-z]+:$/.test(src)) { if (u.protocol === src) return true; continue; }
    const m = /^(?:([a-z]+):\/\/)?(\*\.)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(src);
    if (!m) continue;
    const [, scheme, wild, host, port, path] = m;
    if (scheme && u.protocol !== scheme + ':') continue;
    if (wild ? !u.hostname.endsWith('.' + host) : u.hostname !== host) continue;
    if (port && u.port !== port) continue;
    if (path) {
      if (path.endsWith('/') ? !u.pathname.startsWith(path) : u.pathname !== path) continue;
    }
    return true;
  }
  return false;
}

// ---------- scripts ----------
{
  const s = directive('script-src');
  check(!s.includes("'unsafe-inline'") && !s.includes("'unsafe-eval'"), "script-src has no 'unsafe-inline' or 'unsafe-eval'");
  check(!s.some((x) => /^https:\/\/cdn\.jsdelivr\.net\/?$/.test(x)), 'cdn.jsdelivr.net is allowed by package path, not as a whole host');
  check(!s.includes('*') && !s.includes('https:'), 'script-src allows no wildcard or bare scheme');
  const inline = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let n = 0;
  for (let m; (m = inline.exec(page));) {
    if (/\ssrc\s*=/.test(m[1] ?? '')) continue;
    n++;
    const h = "'sha256-" + createHash('sha256').update(m[2], 'utf8').digest('base64') + "'";
    check(s.includes(h), 'inline script #' + n + ' (' + m[2].length + ' chars) is allowed by its hash');
  }
  check(n >= 1, 'the app script is inline and was found');
  check(!/\son[a-z]+="/i.test(page.replace(/<script[\s\S]*?<\/script>/gi, '')), 'no inline event-handler attributes (the CSP would block them)');
  check(!/href="javascript:/i.test(page), 'no javascript: links');
}

// ---------- supabase-js: SRI to the installed bytes ----------
{
  const pkg = JSON.parse(readFileSync('node_modules/@supabase/supabase-js/package.json', 'utf8'));
  const pinned = JSON.parse(readFileSync('package.json', 'utf8')).dependencies['@supabase/supabase-js'];
  check(pkg.version === pinned, 'node_modules has the pinned supabase-js (' + pkg.version + ' vs ' + pinned + ')');
  const bytes = readFileSync('node_modules/@supabase/supabase-js/dist/umd/supabase.js');
  const sri = 'sha384-' + createHash('sha384').update(bytes).digest('base64');
  const url = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@' + pinned + '/dist/umd/supabase.js';
  const tag = new RegExp('<script src="' + url.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '"([^>]*)></script>').exec(page);
  check(tag, 'the supabase-js tag loads the pinned version ' + pinned);
  check(tag && tag[1].includes('integrity="' + sri + '"'), 'the supabase-js tag is pinned by integrity to those exact bytes (' + sri + ')');
  check(tag && /crossorigin="anonymous"/.test(tag[1]), 'the supabase-js tag is crossorigin="anonymous" (SRI needs CORS)');
  const preload = /<link rel="preload" as="script" href="([^"]+)"([^>]*)>/.exec(page);
  check(preload && preload[1] === url && preload[2].includes('integrity="' + sri + '"') && /crossorigin="anonymous"/.test(preload[2]),
    'its preload is the same request (same URL, integrity and CORS mode), so it is one download');
  check(/<link rel="preconnect" href="https:\/\/cdn\.jsdelivr\.net" crossorigin>/.test(page), 'and the jsdelivr preconnect is in the same CORS mode');
  check(allows('script-src', url), 'script-src allows the pinned supabase-js');
  check(!allows('script-src', 'https://cdn.jsdelivr.net/npm/some-other-package@1.0.0/x.js'), 'but not another package on the same CDN');
}

// ---------- every origin the page uses ----------
// Specific sinks first: the directive each use needs.
const uses = [];
const add = (dir, url, why) => uses.push({ dir, url, why });
for (const m of page.matchAll(/<script[^>]*\ssrc="(https?:[^"]+)"/g)) add('script-src', m[1], 'script tag');
for (const m of page.matchAll(/<link([^>]*)>/g)) {
  const href = /href="(https?:[^"]+)"/.exec(m[1])?.[1];
  if (!href) continue;
  if (/rel="stylesheet"/.test(m[1])) add('style-src', href, 'stylesheet');
  else if (/rel="preload"/.test(m[1]) && /as="script"/.test(m[1])) add('script-src', href, 'script preload');
}
for (const m of page.matchAll(/(?:var\s+)?[A-Z_]+_SRC\s*=\s*"(https:[^"]+)"/g)) add('script-src', m[1], 'loadScript source');
for (const m of page.matchAll(/(?:frame|fr|f)\.src\s*=\s*"(https:[^"]+)"/g)) add('frame-src', m[1] + 'x', 'embed iframe');
for (const m of page.matchAll(/"(https:\/\/www\.youtube-nocookie\.com\/embed\/)"/g)) add('frame-src', m[1] + 'x', 'demo clip iframe');
for (const m of page.matchAll(/img\.src\s*=\s*"(https:[^"]+)"/g)) add('img-src', m[1] + 'x', 'image');
for (const m of page.matchAll(/SB_URL\s*=\s*"(https:[^"]+)"/g)) {
  add('connect-src', m[1] + '/rest/v1/x', 'PostgREST');
  add('connect-src', m[1] + '/functions/v1/spotter/api/pumpy/chat', 'edge function (Pumpy stream)');
  add('connect-src', m[1] + '/storage/v1/object/uploads/x', 'upload');
  add('connect-src', m[1].replace('https:', 'wss:') + '/realtime/v1/websocket', 'realtime');
  add('img-src', m[1] + '/storage/v1/object/public/thumbs/x.jpg', 'thumbnails');
}
// Third parties' own documented needs (Google Identity Services, Cloudflare
// Turnstile): the frames and fetches their scripts make.
add('frame-src', 'https://accounts.google.com/gsi/iframe/select', 'Google One Tap iframe');
add('connect-src', 'https://accounts.google.com/gsi/status', 'Google One Tap status');
add('style-src', 'https://accounts.google.com/gsi/style', 'Google One Tap style');
add('frame-src', 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/x', 'Turnstile iframe');
add('font-src', 'https://fonts.gstatic.com/s/inter/x.woff2', 'Inter');
add('font-src', 'https://cdn.fontshare.com/wf/x.woff2', 'Cabinet Grotesk');
for (const u of uses) check(allows(u.dir, u.url), u.dir + ' allows ' + new URL(u.url).origin + ' (' + u.why + ')');

// Then the catch-all: any origin anywhere in the page is either allowed by some
// fetch directive or is one the page only ever navigates to.
const NAVIGATION_ONLY = new Map([
  ['https://quarterdeckcollective.com', 'terms / privacy / what’s new links'],
  ['https://github.com', 'the "Something wrong?" link'],
  ['https://www.strava.com', '"View on Strava" link'],
  ['https://play.google.com', 'Android redeem link'],
  ['http://www.w3.org', 'SVG namespace, never fetched'],
]);
const FETCH_DIRECTIVES = ['script-src', 'style-src', 'font-src', 'img-src', 'media-src', 'connect-src', 'frame-src'];
const origins = new Set([...page.matchAll(/\b(https?|wss):\/\/[a-zA-Z0-9.-]+[a-zA-Z]/g)].map((m) => m[0]));
for (const o of origins) {
  if (NAVIGATION_ONLY.has(o)) { check(true, ''); continue; }
  const probe = o + '/';
  const ok = FETCH_DIRECTIVES.some((d) => directive(d).some((src) => src !== "'self'" && !src.startsWith("'") &&
    (src.startsWith(o + '/') || src === o || allows(d, probe))));
  check(ok, 'origin ' + o + ' used by the page is covered by the policy (or is navigation-only)');
}
check(directive('object-src').join() === "'none'", "object-src 'none'");
check(directive('base-uri').join() === "'self'", "base-uri 'self'");

// ---------- the other copies ----------
{
  const gen = readFileSync('supabase/functions/spotter/page.gen.ts', 'utf8');
  check(gen.includes(JSON.stringify(page)), 'the edge function serves the same page, policy included');
  if (existsSync('native-dist/index.html')) {
    const shell = readFileSync('native-dist/index.html', 'utf8');
    check(!shell.includes('Content-Security-Policy'), 'the native shell does not carry the web policy');
    check(!shell.includes('cdn.jsdelivr.net/npm/@supabase'), 'and does not load supabase-js from the CDN');
  }
}

if (failures.length) {
  console.error('\n' + failures.length + ' of ' + (failures.length + passed) + ' CSP / SRI checks FAILED');
  process.exit(1);
}
console.log('PASS ' + passed + ' CSP / SRI checks: hashed inline app, no unsafe script sources, supabase-js pinned by SRI to the installed bytes, every origin the page uses allowed by the directive it needs, edge copy identical, native shell without it.');

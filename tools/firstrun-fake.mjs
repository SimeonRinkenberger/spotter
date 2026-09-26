// A fake Supabase for tools/firstrun-harness.mjs, on 127.0.0.1 only. It answers the
// three things the app's auth and boot path talk to — GoTrue, PostgREST and the
// edge function — the way the real ones answer, so the REAL supabase-js 2.115.0
// (the UMD in node_modules, byte-identical to the CDN copy the page pins by SRI)
// can run against it with nothing leaving the Mac. It also serves the app page
// itself, built by build.mjs, with SB_URL pointed here.
//
// Two origins, one port, as production has two (the page and the project):
//   the page      http://127.0.0.1:<port>/              (localStorage lives here)
//   the project   http://mtzevoxxpsktmrbbuxva.localhost:<port>/
// Chrome is started with a host-resolver rule that maps that one name to
// 127.0.0.1 and every other name to nowhere. The name keeps the project ref as
// its first label because supabase-js derives the session's storage key from it
// (sb-<first label>-auth-token): the key the SDK writes, the key app.ts reads
// before the SDK answers (SESSION_KEY) and the Keychain key native/secure-session.js
// matches all stay byte-for-byte what they are in production.
//
// What a deleted account looks like to the real server (supabase/auth, API
// version 2024-01-01, which every supabase-js request asks for):
//   POST /token?grant_type=refresh_token   400 {code:"refresh_token_not_found"}
//     (the account's sessions and refresh tokens go with it, on delete cascade)
//   GET  /user, POST /logout with its JWT   403 {code:"user_not_found"}
//   PostgREST with its still-unexpired JWT  200 [] — PostgREST checks only the
//     signature and exp, never whether the user exists, so RLS matches nothing
//   PostgREST with any expired JWT          401 {code:"PGRST303","JWT expired"}
//   PostgREST with the anon key             200 [] (anon keeps SELECT; RLS)
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const REF = 'mtzevoxxpsktmrbbuxva';
export const PROD_URL = 'https://' + REF + '.supabase.co';
export const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10emV2b3h4cHNrdG1yYmJ1eHZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMjM5ODgsImV4cCI6MjEwMzc5OTk4OH0._vpNhLJtv2bVGgXXClva9O5cX8Y5eJdTgbgAO81NnmU';
export const SESSION_KEY = 'sb-' + REF + '-auth-token';

const b64u = (s) => Buffer.from(s).toString('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startFake(opt = {}) {
  const tree = opt.tree || process.cwd();
  const secret = crypto.randomBytes(32);
  const t0 = opt.t0 || Date.now();
  const log = [];
  const say = (line) => { const at = Date.now() - t0; log.push([at, 'net', line]); if (opt.verbose) console.log(String(at).padStart(6) + ' net  ' + line); };

  // ---------- the world ----------
  const users = new Map();      // id -> { id, email, password, created_at }
  const sessions = new Map();   // refresh token -> { uid, sid, used }
  const rows = {};              // table -> [row]
  const table = (t) => (rows[t] = rows[t] || []);
  const delays = Object.assign({ auth: 40, rest: 25, fn: 25 }, opt.delays || {});
  const holds = {};             // path prefix -> Promise the answer waits for (see hold())
  const faults = opt.faults || [];

  function jwt(uid, email, sid, expSec) {
    const now = Math.floor(Date.now() / 1000);
    const body = { aud: 'authenticated', exp: expSec, iat: now, iss: 'http://' + REF + '.localhost/auth/v1', sub: uid,
      email, phone: '', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
      role: 'authenticated', aal: 'aal1', amr: [{ method: 'password', timestamp: now }], session_id: sid, is_anonymous: false };
    const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + b64u(JSON.stringify(body));
    return head + '.' + crypto.createHmac('sha256', secret).update(head).digest('base64url');
  }
  function claims(token) {
    if (!token || token === ANON) return { role: 'anon' };
    const p = String(token).split('.');
    if (p.length !== 3) return { bad: 'PGRST301' };
    const sig = crypto.createHmac('sha256', secret).update(p[0] + '.' + p[1]).digest('base64url');
    if (sig !== p[2]) return { bad: 'PGRST301' };
    const c = JSON.parse(Buffer.from(p[1], 'base64url').toString());
    if (c.exp * 1000 <= Date.now()) return { bad: 'PGRST303', c };
    return { role: 'authenticated', uid: c.sub, c };
  }
  function userJson(u) {
    return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.created_at,
      phone: '', confirmed_at: u.created_at, last_sign_in_at: new Date().toISOString(),
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { email: u.email, email_verified: true, phone_verified: false, sub: u.id },
      identities: [{ identity_id: crypto.randomUUID(), id: u.id, user_id: u.id, provider: 'email', email: u.email,
        identity_data: { email: u.email, email_verified: true, phone_verified: false, sub: u.id },
        last_sign_in_at: u.created_at, created_at: u.created_at, updated_at: u.created_at }],
      created_at: u.created_at, updated_at: u.created_at, is_anonymous: false };
  }
  // A session as gotrue hands it out. expSec lets a scenario seed one that has
  // already expired (an app left for over an hour) or one that has not.
  function session(u, expSec) {
    const sid = crypto.randomUUID(), rt = 'rt-' + crypto.randomBytes(9).toString('hex');
    const exp = expSec || Math.floor(Date.now() / 1000) + 3600;
    sessions.set(rt, { uid: u.id, sid, used: false });
    return { access_token: jwt(u.id, u.email, sid, exp), token_type: 'bearer', expires_in: exp - Math.floor(Date.now() / 1000),
      expires_at: exp, refresh_token: rt, user: userJson(u) };
  }
  function addUser(email, password, id) {
    const u = { id: id || crypto.randomUUID(), email, password, created_at: new Date().toISOString() };
    users.set(u.id, u);
    // What the signup trigger (handle_new_user) writes.
    table('profiles').push({ id: u.id, display_name: email.split('@')[0], plan: 'free', settings: {},
      ingest_key: 'ik-' + crypto.randomBytes(6).toString('hex'), created_at: u.created_at });
    return u;
  }
  // Deleting an account as the server does: the user, its sessions and refresh
  // tokens, and every row it owned (on delete cascade). Tokens already handed
  // out stay signed and unexpired: nothing can take a JWT back.
  function deleteUser(id) {
    users.delete(id);
    for (const [rt, s] of sessions) if (s.uid === id) sessions.delete(rt);
    for (const t of Object.keys(rows)) rows[t] = rows[t].filter((r) => r.user_id !== id && !(t === 'profiles' && r.id === id));
  }
  // A path prefix whose answers wait until the returned function is called.
  function hold(prefix) {
    let open; holds[prefix] = new Promise((r) => (open = r));
    return () => { delete holds[prefix]; open(); };
  }

  // ---------- http ----------
  const pageHtml = opt.page;            // (mode) -> html, supplied by the harness
  const files = opt.files || {};        // extra served files: path -> { type, body }

  function send(res, status, body, headers = {}) {
    const h = Object.assign({ 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range, x-supabase-api-version',
      'cache-control': 'no-store' }, headers);
    if (body === undefined || body === null) { res.writeHead(status, h); res.end(); return; }
    const raw = typeof body === 'string' || Buffer.isBuffer(body);
    const text = raw ? body : JSON.stringify(body);
    if (!h['content-type']) h['content-type'] = raw ? 'text/plain' : 'application/json';
    res.writeHead(status, h); res.end(text);
  }
  const authErr = (res, status, code, message) => send(res, status, { code, message }, { 'x-supabase-api-version': '2024-01-01' });
  const bearer = (req) => (String(req.headers.authorization || '').match(/^Bearer (.+)$/) || [])[1] || '';
  function readBody(req) {
    return new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { r(b ? JSON.parse(b) : {}); } catch { r({}); } }); });
  }
  const who = (tok) => { const c = claims(tok); return c.role === 'anon' ? 'anon' : c.bad ? c.bad + (c.c ? '(' + short(c.c.sub) + ')' : '') : short(c.uid); };
  const names = new Map();
  const short = (id) => names.get(id) || String(id).slice(0, 8);

  async function auth(req, res, url) {
    const p = url.pathname.replace(/^\/auth\/v1/, '');
    if (p === '/settings') return send(res, 200, { external: { email: true, google: true, apple: true, phone: false },
      disable_signup: false, mailer_autoconfirm: true, phone_autoconfirm: false, sms_provider: '', saml_enabled: false });
    const body = req.method === 'POST' ? await readBody(req) : {};
    if (p === '/token') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'refresh_token') {
        const s = sessions.get(body.refresh_token);
        if (!s || !users.has(s.uid)) { say('   → 400 refresh_token_not_found'); return authErr(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found'); }
        if (s.used) { say('   → 400 refresh_token_already_used'); return authErr(res, 400, 'refresh_token_already_used', 'Invalid Refresh Token: Already Used'); }
        s.used = true;
        const u = users.get(s.uid), out = session(u);
        say('   → 200 session for ' + short(u.id));
        return send(res, 200, out);
      }
      if (grant === 'password') {
        const u = [...users.values()].find((x) => x.email === String(body.email || '').toLowerCase());
        if (!u || u.password !== body.password) { say('   → 400 invalid_credentials'); return authErr(res, 400, 'invalid_credentials', 'Invalid login credentials'); }
        say('   → 200 session for ' + short(u.id));
        return send(res, 200, session(u));
      }
      return authErr(res, 400, 'validation_failed', 'unsupported grant_type');
    }
    if (p === '/signup') {
      const email = String(body.email || '').toLowerCase();
      if ([...users.values()].some((x) => x.email === email)) return authErr(res, 422, 'user_already_exists', 'User already registered');
      if (String(body.password || '').length < 6) return authErr(res, 422, 'weak_password', 'Password should be at least 6 characters.');
      const u = addUser(email, body.password);
      names.set(u.id, opt.nameOf ? opt.nameOf(email) : email.split('@')[0]);
      say('   → 200 signed up ' + short(u.id) + ' (autoconfirm: a session)');
      return send(res, 200, session(u));
    }
    const c = claims(bearer(req));
    if (p === '/user') {
      if (c.bad) return authErr(res, 403, 'bad_jwt', 'invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired');
      if (!users.has(c.uid)) { say('   → 403 user_not_found'); return authErr(res, 403, 'user_not_found', 'User from sub claim in JWT does not exist'); }
      return send(res, 200, userJson(users.get(c.uid)));
    }
    if (p === '/logout') {
      if (c.bad) return authErr(res, 403, 'bad_jwt', 'invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired');
      if (!users.has(c.uid)) { say('   → 403 user_not_found'); return authErr(res, 403, 'user_not_found', 'User from sub claim in JWT does not exist'); }
      for (const [rt, s] of sessions) if (s.uid === c.uid) sessions.delete(rt);
      return send(res, 204);
    }
    return authErr(res, 404, 'not_found', 'not found');
  }

  // Just enough PostgREST: eq filters, RLS by owner, the object media type.
  async function rest(req, res, url) {
    const t = url.pathname.replace(/^\/rest\/v1\//, '');
    const c = claims(bearer(req));
    if (c.bad === 'PGRST303') return send(res, 401, { code: 'PGRST303', details: null, hint: null, message: 'JWT expired' });
    if (c.bad) return send(res, 401, { code: 'PGRST301', details: null, hint: null, message: 'No suitable key or wrong key type' });
    const mine = (r) => c.role === 'authenticated' && (t === 'profiles' ? r.id === c.uid : r.user_id === c.uid);
    const eqs = [...url.searchParams].filter(([k, v]) => /^eq\./.test(v)).map(([k, v]) => [k, v.slice(3)]);
    const match = (r) => mine(r) && eqs.every(([k, v]) => String(r[k]) === v);
    if (req.method === 'GET' || req.method === 'HEAD') {
      const found = table(t).filter(match);
      if (/vnd\.pgrst\.object/.test(req.headers.accept || '')) {
        if (found.length !== 1) return send(res, 406, { code: 'PGRST116', details: 'The result contains ' + found.length + ' rows', hint: null, message: 'Cannot coerce the result to a single JSON object' });
        return send(res, 200, found[0]);
      }
      return send(res, 200, found, { 'content-range': (found.length ? '0-' + (found.length - 1) : '*') + '/' + found.length });
    }
    const body = await readBody(req);
    if (c.role !== 'authenticated') return send(res, 401, { code: '42501', details: null, hint: null, message: 'permission denied for table ' + t });
    const back = /return=representation/.test(req.headers.prefer || '');
    if (req.method === 'POST') {
      const list = [].concat(body).map((r) => Object.assign({ id: crypto.randomUUID(), created_at: new Date().toISOString() }, r));
      table(t).push(...list);
      return back ? send(res, 201, list) : send(res, 201);
    }
    if (req.method === 'PATCH') {
      const hit = table(t).filter(match);
      hit.forEach((r) => Object.assign(r, body));
      return back ? send(res, 200, hit) : send(res, 204);
    }
    if (req.method === 'DELETE') {
      const hit = table(t).filter(match);
      rows[t] = table(t).filter((r) => !hit.includes(r));
      return back ? send(res, 200, hit) : send(res, 204);
    }
    return send(res, 405, { message: 'method' });
  }

  // The edge function: every route answers a plain ok for a live account.
  async function fn(req, res, url) {
    const c = claims(bearer(req));
    if (c.bad || c.role !== 'authenticated' || !users.has(c.uid)) return send(res, 401, { status: 'error', error: 'unauthorized' });
    if (req.method === 'POST') await readBody(req);
    const route = url.pathname.replace(/^\/functions\/v1\/spotter\/api\//, '');
    if (route === 'limits') return send(res, 200, { status: 'ok', plan: 'free', free_program: { state: 'available', thread_id: null } });
    return send(res, 200, { status: 'ok' });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const host = String(req.headers.host || '');
    if (req.method === 'OPTIONS') {
      return send(res, 204, null, { 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS',
        'access-control-allow-headers': req.headers['access-control-request-headers'] || '*', 'access-control-max-age': '600' });
    }
    const project = host.startsWith(REF + '.localhost');
    if (project) {
      const tok = bearer(req);
      say(req.method + ' ' + url.pathname + (url.search ? url.search.slice(0, 70) : '') + '  as ' + (/^\/auth\//.test(url.pathname) && tok === ANON ? 'anon' : who(tok)));
      const kind = url.pathname.startsWith('/auth/') ? 'auth' : url.pathname.startsWith('/rest/') ? 'rest' : 'fn';
      const wait = typeof delays[kind] === 'function' ? delays[kind]() : delays[kind];
      if (wait) await sleep(wait);
      // Scripted trouble for refreshes, one entry per request, in order: 'net'
      // (the connection drops), '503', 'hang' (no answer at all), or 'ok'.
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token' && faults.length) {
        const f = faults.shift();
        if (f === 'net') { say('   → connection dropped'); req.socket.destroy(); return; }
        if (f === '503') { say('   → 503'); return send(res, 503, { message: 'upstream unavailable' }); }
        if (f === 'hang') { say('   → (no answer)'); return; }
      }
      for (const [prefix, gate] of Object.entries(holds)) if (url.pathname.startsWith(prefix)) await gate;
      try {
        if (kind === 'auth') return await auth(req, res, url);
        if (kind === 'rest') return await rest(req, res, url);
        if (url.pathname.startsWith('/functions/v1/spotter/api/')) return await fn(req, res, url);
      } catch (e) { say('   → 500 ' + e.message); return send(res, 500, { message: String(e.message) }); }
      return send(res, 404, { message: 'no route' });
    }
    // The page's own origin.
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return send(res, 200, pageHtml(url.searchParams.get('mode') || 'web', url), { 'content-type': 'text/html' });
    }
    if (files[url.pathname]) return send(res, 200, files[url.pathname].body, { 'content-type': files[url.pathname].type });
    const root = path.join(tree, 'web-dist');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      const types = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
      return send(res, 200, fs.readFileSync(file), { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    }
    return send(res, 404, 'not found');
  });
  // Realtime's websocket is refused: the client backs off and retries on its own,
  // which is what a phone without a socket does too.
  server.on('upgrade', (req, socket) => { say('WS ' + String(req.url).split('?')[0] + ' refused'); socket.destroy(); });
  await new Promise((r) => server.listen(opt.port || 0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    port, log, say, users, sessions, rows, table, addUser, deleteUser, session, hold, names, delays, faults,
    pageOrigin: 'http://127.0.0.1:' + port, sbOrigin: 'http://' + REF + '.localhost:' + port,
    close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(() => r()); })
  };
}

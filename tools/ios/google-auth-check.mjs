import assert from 'node:assert/strict';
import { signInWithGoogle, GOOGLE_AUTH_RETURN } from '../../native/google-auth.js';
let exchanges = [], starts = [], requested;
const sb = { auth: {
  signInWithOAuth: async options => { requested = options; return { data: { url: 'https://mtzevoxxpsktmrbbuxva.supabase.co/auth/v1/authorize' } }; },
  exchangeCodeForSession: async code => { exchanges.push(code); return { data: { session: { user: { id: 'fixture' } } } }; }
} };
const system = url => ({ start: async input => { starts.push(input); return { url }; } });
await signInWithGoogle(sb, system(GOOGLE_AUTH_RETURN + '?code=one-use'));
assert.equal(requested.provider, 'google');
assert.equal(requested.options.skipBrowserRedirect, true);
assert.equal(requested.options.redirectTo, GOOGLE_AUTH_RETURN);
assert.deepEqual(exchanges, ['one-use']);
for (const url of ['https://evil.example/?code=bad', 'com.spotter.auth://other?code=bad',
  'com.spotter.auth://callback/extra?code=bad', 'com.spotter.auth://user@callback?code=bad',
  GOOGLE_AUTH_RETURN + '?code=a&code=b', GOOGLE_AUTH_RETURN + '#access_token=bad',
  GOOGLE_AUTH_RETURN, GOOGLE_AUTH_RETURN + '?error=server_error']) {
  await assert.rejects(signInWithGoogle(sb, system(url)));
}
assert.deepEqual(exchanges, ['one-use']);
await assert.rejects(signInWithGoogle(sb, system(GOOGLE_AUTH_RETURN + '?error=access_denied')), { code: 'AUTH_CANCELLED' });
await assert.rejects(signInWithGoogle(sb, { start: async () => { throw Object.assign(new Error('cancelled'), { code: 'AUTH_CANCELLED' }); } }), { code: 'AUTH_CANCELLED' });
let finish;
const pending = signInWithGoogle(sb, { start: () => new Promise(resolve => { finish = resolve; }) });
await new Promise(resolve => setImmediate(resolve));
await assert.rejects(signInWithGoogle(sb, system(GOOGLE_AUTH_RETURN + '?code=second')), /already open/);
finish({ url: GOOGLE_AUTH_RETURN + '?code=first' });
await pending;
const old = sb.auth.exchangeCodeForSession;
sb.auth.exchangeCodeForSession = async () => ({ error: new Error('invalid verifier') });
await assert.rejects(signInWithGoogle(sb, system(GOOGLE_AUTH_RETURN + '?code=expired')), /invalid verifier/);
sb.auth.exchangeCodeForSession = old;
await signInWithGoogle(sb, system(GOOGLE_AUTH_RETURN + '?code=retry'));
const startCount = starts.length;
sb.auth.signInWithOAuth = async () => ({ error: new Error('provider disabled') });
await assert.rejects(signInWithGoogle(sb, system(GOOGLE_AUTH_RETURN)), /provider disabled/);
assert.equal(starts.length, startCount);
console.log('PASS native Google: PKCE request, callback validation, exchange errors, cancellation, duplicate taps, retry, disabled provider.');

// Short-operation hangs must reset the busy state and allow a clean retry.
const realTimeout = globalThis.setTimeout;
try {
  globalThis.setTimeout = (fn, ms, ...args) => realTimeout(fn, ms === 20000 ? 1 : ms, ...args);
  await assert.rejects(signInWithGoogle({auth:{signInWithOAuth:()=>new Promise(()=>{})}}, system(GOOGLE_AUTH_RETURN)), /Opening Google sign-in timed out/);
  const ready = async () => ({data:{url:'https://mtzevoxxpsktmrbbuxva.supabase.co/auth/v1/authorize'}});
  await assert.rejects(signInWithGoogle({auth:{signInWithOAuth:ready,exchangeCodeForSession:()=>new Promise(()=>{})}}, system(GOOGLE_AUTH_RETURN+'?code=stuck')), /Finishing Google sign-in timed out/);
  sb.auth.signInWithOAuth=ready;
  await signInWithGoogle(sb,system(GOOGLE_AUTH_RETURN+'?code=after-timeout'));
} finally { globalThis.setTimeout=realTimeout; }
console.log('PASS Google preparation/exchange timeout and retry after both hangs.');

// Exercise the actual shared app's provider visibility and button routing.
const { readFileSync } = await import('node:fs');
const { default: vm } = await import('node:vm');
const source = readFileSync('supabase/functions/spotter/app.ts', 'utf8');
function extract(name) {
  const start = source.indexOf('  function ' + name + '(');
  assert(start >= 0);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}
const nodes = Object.fromEntries(['oauthwrap', 'oagoogle', 'oaapple'].map(id => [id, { hidden: true, classList: { toggle: (_name, hide) => { nodes[id].hidden = hide; } } }]));
let routed = [], busy = false;
const ctx = vm.createContext({
  $: id => nodes[id], authProviders: { google: true, apple: false },
  native: { signInWithGoogle: async () => { routed.push('native'); } },
  oauthBusy: false, oauthWatchdog: null, sb: {}, NO_SHELL: 'no shell', toast: m => routed.push(m),
  setOauthBusy: id => { busy = !!id; }, clearTimeout: () => {},
  oauthFailed: error => { throw error; }
});
vm.runInContext(extract('renderAuthProviders') + extract('nativeGoogleSignIn') + extract('googleSignIn'), ctx);
vm.runInContext('renderAuthProviders(); googleSignIn();', ctx);
await new Promise(resolve => setImmediate(resolve));
assert.equal(nodes.oagoogle.hidden, false);
assert.equal(nodes.oauthwrap.hidden, false);
assert.equal(nodes.oaapple.hidden, true);
assert.equal(busy, false);
// No shell (B.2: the page ships only inside the app): the button says where it
// works rather than starting a web sign-in that no longer exists.
ctx.native = null;
vm.runInContext('googleSignIn()', ctx);
assert.deepEqual(routed, ['native', 'no shell']);
assert.equal(busy, false);
ctx.authProviders.google = false;
vm.runInContext('renderAuthProviders()', ctx);
assert.equal(nodes.oauthwrap.hidden, true);
console.log('PASS shared Google button: enabled/disabled visibility, native routing, no web fallback, busy reset.');

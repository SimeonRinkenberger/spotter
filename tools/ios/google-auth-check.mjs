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
  $: id => nodes[id], authProviders: { google: true, apple: false }, isAppleDevice: () => false,
  native: { signInWithGoogle: async () => { routed.push('native'); } },
  oauthBusy: false, oauthWatchdog: null, sb: {}, PUBLIC_AUTH: { google_client_id: '' },
  setOauthBusy: id => { busy = !!id; }, authError: () => {}, clearTimeout: () => {},
  oauthFailed: error => { throw error; }, oauthRedirect: provider => routed.push(provider)
});
vm.runInContext(extract('renderAuthProviders') + extract('nativeGoogleSignIn') + extract('googleSignIn'), ctx);
vm.runInContext('renderAuthProviders(); googleSignIn();', ctx);
await new Promise(resolve => setImmediate(resolve));
assert.equal(nodes.oagoogle.hidden, false);
assert.equal(nodes.oauthwrap.hidden, false);
assert.equal(nodes.oaapple.hidden, true);
assert.equal(busy, false);
ctx.native = null;
vm.runInContext('googleSignIn()', ctx);
assert.deepEqual(routed, ['native', 'google']);
ctx.authProviders.google = false;
vm.runInContext('renderAuthProviders()', ctx);
assert.equal(nodes.oauthwrap.hidden, true);
console.log('PASS shared Google button: enabled/disabled visibility, native routing, web OAuth fallback, busy reset.');

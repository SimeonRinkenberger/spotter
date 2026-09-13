import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { signInWithApple } from '../../native/apple-auth.js';
let sent = [], opens = 0;
const sb = { auth: { signInWithIdToken: async args => {
  sent.push(args);
  return { data: { user: { id: 'fixture' }, session: { access_token: 'fixture' } } };
} } };
const provider = (credential = { identityToken: 'apple-token', nonce: 'raw-nonce', fullName: 'Alex Example' }) => ({ start: async () => { opens++; return credential; } });
let result = await signInWithApple(sb, provider());
assert.equal(result.fullName, 'Alex Example');
assert.deepEqual(sent, [{ provider: 'apple', token: 'apple-token', nonce: 'raw-nonce' }]);
result = await signInWithApple(sb, provider({ identityToken: 'returning-token', nonce: 'another-nonce' }));
assert.equal(result.fullName, null);
for (const credential of [{}, { identityToken: 'token' }, { nonce: 'nonce' }]) {
  await assert.rejects(signInWithApple(sb, provider(credential)), /complete sign-in credential/);
}
assert.equal(sent.length, 2);
await assert.rejects(signInWithApple(sb, { start: async () => { throw Object.assign(new Error('cancelled'), { code: 'AUTH_CANCELLED' }); } }), { code: 'AUTH_CANCELLED' });
let complete;
const pending = signInWithApple(sb, { start: () => new Promise(resolve => { complete = resolve; }) });
await assert.rejects(signInWithApple(sb, provider()), /already open/);
complete({ identityToken: 'token', nonce: 'nonce' });
await pending;
const good = sb.auth.signInWithIdToken;
sb.auth.signInWithIdToken = async () => ({ error: new Error('nonce mismatch') });
await assert.rejects(signInWithApple(sb, provider()), /nonce mismatch/);
sb.auth.signInWithIdToken = async () => ({ data: { user: { id: 'fixture' } } });
await assert.rejects(signInWithApple(sb, provider()), /did not create a session/);
sb.auth.signInWithIdToken = good;
await signInWithApple(sb, provider());

const source = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const extract = name => {
  const start = source.indexOf('  function ' + name + '(');
  assert(start >= 0);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
};
let names = [], failures = [], busy = false, routes = [];
const ctx = vm.createContext({
  native: { signInWithApple: async () => ({ user: { id: 'fixture' }, fullName: 'Alex Example' }) }, sb: {},
  oauthBusy: false, oauthWatchdog: null, clearTimeout: () => {},
  setOauthBusy: id => { busy = !!id; }, authError: () => {},
  saveProviderName: (user, name) => names.push([user.id, name]), oauthFailed: error => failures.push(error),
  PUBLIC_AUTH: { apple_services_id: '' }, oauthRedirect: provider => routes.push(provider)
});
vm.runInContext(extract('nativeAppleSignIn') + extract('appleSignIn') + '; appleSignIn()', ctx);
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(names, [['fixture', 'Alex Example']]);
assert.equal(busy, false);
ctx.native.signInWithApple = async () => { throw Object.assign(new Error('cancelled'), { code: 'AUTH_CANCELLED' }); };
vm.runInContext('appleSignIn()', ctx);
await new Promise(resolve => setImmediate(resolve));
assert.equal(busy, false);
assert.equal(failures.length, 0);
ctx.native = null;
vm.runInContext('appleSignIn()', ctx);
assert.deepEqual(routes, ['apple']);
console.log('PASS Apple auth: native token/nonce exchange, first/returning name, cancellation, invalid credentials, duplicate requests, retry, shared button and web fallback.');

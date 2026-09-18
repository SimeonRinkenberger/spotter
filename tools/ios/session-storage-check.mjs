import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSecureSession } from '../../native/secure-session.js';

// The adapter supabase-js is handed on a phone, driven against fakes that
// behave like the two plugins: a Keychain/Keystore-backed store and Preferences.
// Everything here is about one question — can a refresh token end up, or stay,
// in a plain preferences file?

const TOKEN = 'sb-mtzevoxxpsktmrbbuxva-auth-token';
const VERIFIER = 'sb-mtzevoxxpsktmrbbuxva-auth-token-code-verifier';

const store = (initial = {}) => {
  const held = new Map(Object.entries(initial));
  return {
    held,
    // Absent resolves without a `value`, which is what both native sides do.
    get: async ({ key }) => (held.has(key) ? { value: held.get(key) } : {}),
    set: async ({ key, value }) => { held.set(key, value); },
    remove: async ({ key }) => { held.delete(key); },
    keys: async () => ({ keys: [...held.keys()] })
  };
};

// --- ordinary use: set / get / remove -------------------------------------
{
  const secure = store(), prefs = store();
  const { storage } = createSecureSession(secure, prefs);
  assert.equal(await storage.getItem(TOKEN), null, 'a fresh install has no session');
  await storage.setItem(TOKEN, '{"refresh_token":"r1"}');
  assert.equal(await storage.getItem(TOKEN), '{"refresh_token":"r1"}');
  assert.equal(prefs.held.size, 0, 'a session write never reaches Preferences');
  await storage.removeItem(TOKEN);
  assert.equal(await storage.getItem(TOKEN), null);
  assert.equal(secure.held.size, 0, 'sign-out empties secure storage');
}

// --- upgrade: a session already sitting in Preferences ---------------------
{
  const secure = store();
  const prefs = store({
    [TOKEN]: '{"refresh_token":"carried"}',
    [VERIFIER]: 'pkce-verifier',
    spotter_draft: '{"sets":3}'
  });
  const { storage, prepare } = createSecureSession(secure, prefs);
  assert.equal(await prepare(), 'migrated');
  assert.equal(await storage.getItem(TOKEN), '{"refresh_token":"carried"}', 'the upgrade stays signed in');
  assert.equal(await storage.getItem(VERIFIER), 'pkce-verifier', 'the PKCE verifier is a secret too');
  assert.equal(prefs.held.has(TOKEN), false, 'the plaintext token is deleted, not copied');
  assert.equal(prefs.held.has(VERIFIER), false);
  assert.equal(prefs.held.get('spotter_draft'), '{"sets":3}', 'the draft is not a credential and does not move');
  // Second launch: the marker is set, so nothing is scanned or moved again.
  const again = createSecureSession(secure, prefs);
  assert.equal(await again.prepare(), 'ready');
  assert.equal(await again.storage.getItem(TOKEN), '{"refresh_token":"carried"}');
}

// --- an interrupted migration finishes on the next launch -----------------
{
  const secure = store({ [TOKEN]: '{"refresh_token":"moved"}' });
  const prefs = store({ [TOKEN]: '{"refresh_token":"moved"}', [VERIFIER]: 'pkce-verifier' });
  const { storage, prepare } = createSecureSession(secure, prefs);
  assert.equal(await prepare(), 'migrated');
  assert.equal(prefs.held.size, 1, 'only the install marker is left behind');
  assert.equal(await storage.getItem(VERIFIER), 'pkce-verifier');
}

// --- sign-out clears both copies -----------------------------------------
{
  const secure = store({ [TOKEN]: '{"refresh_token":"r1"}' });
  const prefs = store({ [TOKEN]: '{"refresh_token":"stale"}', spotter_install: '1' });
  const { storage } = createSecureSession(secure, prefs);
  await storage.removeItem(TOKEN);
  assert.equal(secure.held.has(TOKEN), false);
  assert.equal(prefs.held.has(TOKEN), false, 'sign-out also removes a stale pre-upgrade copy');
  assert.equal(prefs.held.get('spotter_install'), '1', 'the install marker survives sign-out');
}

// --- fresh install over a Keychain item that outlived the app -------------
{
  // iOS keeps Keychain items when an app is deleted; Preferences go with it.
  const secure = store({ [TOKEN]: '{"refresh_token":"previous-owner"}' });
  const prefs = store();
  const { storage, prepare } = createSecureSession(secure, prefs);
  assert.equal(await prepare(), 'fresh');
  assert.equal(await storage.getItem(TOKEN), null, 'a reinstall must not inherit somebody else’s account');
  assert.equal(secure.held.size, 0);
}

// --- a value far larger than any real session -----------------------------
{
  const secure = store(), prefs = store();
  const { storage } = createSecureSession(secure, prefs);
  const fat = JSON.stringify({ refresh_token: 'r', user: { note: 'x'.repeat(64 * 1024) } });
  await storage.setItem(TOKEN, fat);
  assert.equal(await storage.getItem(TOKEN), fat, 'an oversize session survives the round trip unchunked');
}

// --- a plugin that never answers becomes a sentence, not a hang -----------
{
  // Collapse the adapter's ten-second budget so the guard itself is exercised
  // rather than waited out. Restored immediately afterwards.
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => real(fn, ms >= 10000 ? 1 : ms);
  try {
    const stuck = { get: () => new Promise(() => {}), set: async () => {}, remove: async () => {}, keys: async () => ({ keys: [] }) };
    const { storage } = createSecureSession(stuck, store());
    await assert.rejects(storage.getItem(TOKEN), /Secure sign-in storage is not responding/,
      'a wedged Keychain must fail with something the user can act on');
  } finally { globalThis.setTimeout = real; }
}

// --- the shipped bundle actually uses it ----------------------------------
{
  const bridge = fs.readFileSync('native/bridge.js', 'utf8');
  assert(bridge.includes('authStorage: session.storage'), 'supabase-js must be given the secure adapter');
  assert(bridge.includes('await session.prepare()'), 'the migration must run before app.js builds the client');
  assert(!/authStorage[\s\S]{0,200}Preferences\.get/.test(bridge), 'no Preferences path may remain under authStorage');
  assert(bridge.includes("Preferences.set({ key: 'spotter_draft'"), 'the draft stays in Preferences');
  const bundle = fs.readFileSync('native-dist/native.js', 'utf8');
  assert(bundle.includes('SecureSession'), 'the built bundle registers the SecureSession plugin');
  assert(bundle.includes('spotter_install'), 'the built bundle carries the one-time migration');
}

console.log('PASS secure session set/get/remove, upgrade migration out of Preferences, resumed migration, sign-out clears both, reinstall clears a surviving Keychain session, oversize value, unresponsive-plugin message, wired into the shipped bundle.');

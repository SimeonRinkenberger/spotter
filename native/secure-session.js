// Where the signed-in session lives on a phone.
//
// supabase-js keeps the whole session in whatever storage adapter it is handed:
// the access token, the refresh token, and — under PKCE — the code verifier.
// Until now that adapter was @capacitor/preferences, which is UserDefaults on
// iOS and a plain XML file on Android. Both are ordinary app-sandbox files, so
// the refresh token, a bearer credential that outlives every access token minted
// from it, was readable in any unencrypted backup of the device. The production
// readiness review called that out as a P0 before store distribution.
//
// So the two secret-shaped keys move to the Keychain (iOS) and to a value
// encrypted under an Android Keystore key (Android), reached through the
// SecureSession plugin. Everything that is not a credential — the workout draft
// above all — stays in Preferences, because it is not worth a Keychain round
// trip and it is not a secret.
//
// The module takes its two plugins as arguments rather than importing them so
// that tools/ios/session-storage-check.mjs can drive the whole thing, migration
// included, against fakes.

// sb-<project ref>-auth-token and sb-<project ref>-auth-token-code-verifier.
// Both are minted by supabase-js from the project URL, so matching the shape is
// steadier than hard-coding a ref that a future staging project would not share.
const SECRET = /^sb-.+-auth-token/;

// Preferences are erased when the app is, which is exactly what makes this a
// reliable "has this install ever booted?" flag. Keychain items are not erased,
// which is why we need the flag at all.
const INSTALLED = 'spotter_install';

// The same budget bridge.js used to give Preferences. A storage plugin that
// never answers has to become a sentence the user can act on rather than a
// sign-in screen that quietly does nothing.
const BUDGET = 10000;

export function createSecureSession(secure, preferences) {
  const guard = work => {
    let timer;
    return Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Secure sign-in storage is not responding. Restart Spotter and try again.')), BUDGET);
    })]).finally(() => clearTimeout(timer));
  };

  const storage = {
    getItem: async key => {
      const held = await guard(() => secure.get({ key }));
      return held.value === undefined ? null : held.value;
    },
    setItem: (key, value) => guard(() => secure.set({ key, value })),
    // supabase-js calls this on sign-out and on a refresh it had to abandon.
    // Clearing the Preferences copy as well costs one call and closes the only
    // window in which a token could outlive the account: a migration that was
    // interrupted between the secure write and the Preferences delete.
    removeItem: key => guard(async () => {
      await secure.remove({ key });
      await preferences.remove({ key });
    })
  };

  // Runs once per launch, before app.js builds the Supabase client, so the
  // client's first read already sees the session in its new home.
  async function prepare() {
    const marker = await guard(() => preferences.get({ key: INSTALLED }));
    if (marker.value) return 'ready';

    const { keys } = await guard(() => preferences.keys());
    const carried = keys.filter(key => SECRET.test(key));
    if (carried.length) {
      // Upgrade. Move each value, then drop the plaintext one. Done in this
      // order and with the marker written last, so a kill mid-migration leaves
      // a session that still works and a migration that simply finishes next
      // launch. Nothing about the values is logged.
      for (const key of carried) {
        const held = await guard(() => preferences.get({ key }));
        if (held.value !== null && held.value !== undefined) await guard(() => secure.set({ key, value: held.value }));
        await guard(() => preferences.remove({ key }));
      }
    } else {
      // Nothing in Preferences: a fresh install, or an upgrade by someone who
      // was signed out. Either way nothing should be signed in — and on iOS a
      // Keychain item can outlive the app that wrote it, so a session left by a
      // previous install would silently sign the new owner of the phone into
      // somebody else's account. boot() already clears the share credential for
      // this reason; the session gets the same treatment.
      const held = await guard(() => secure.keys());
      for (const key of held.keys) await guard(() => secure.remove({ key }));
    }
    await guard(() => preferences.set({ key: INSTALLED, value: '1' }));
    return carried.length ? 'migrated' : 'fresh';
  }

  return { storage, prepare };
}

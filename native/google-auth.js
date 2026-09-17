export const GOOGLE_AUTH_RETURN = 'com.spotter.auth://callback';
let signingIn = false;

// Storage and token exchange are short operations. The user's system sign-in
// sheet is deliberately not timed out while they enter credentials or consent.
function authStep(work, label, ms = 20000) {
  let timer;
  return Promise.race([
    Promise.resolve().then(work),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' timed out. Check your connection and try again.')), ms); })
  ]).finally(() => clearTimeout(timer));
}

// Called only from the explicit Google button; no web-view navigation or tokens
// in deep links. The Supabase client must use PKCE with persistent native storage.
export async function signInWithGoogle(sb, systemAuth) {
  if (signingIn) throw new Error('Google sign-in is already open.');
  signingIn = true;
  try {
    const { data, error } = await authStep(() => sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: GOOGLE_AUTH_RETURN, skipBrowserRedirect: true }
    }), 'Opening Google sign-in');
    if (error) throw error;
    if (!data?.url) throw new Error('Google sign-in could not start.');
    const result = await systemAuth.start({ url: data.url });
    const callback = new URL(result.url);
    if (callback.protocol !== 'com.spotter.auth:' || callback.hostname !== 'callback' ||
        callback.pathname !== '' || callback.username || callback.password || callback.port || callback.hash) {
      throw new Error('Unexpected sign-in callback.');
    }
    if (callback.searchParams.has('error')) {
      if (callback.searchParams.get('error') === 'access_denied') {
        throw Object.assign(new Error('Sign-in cancelled.'), { code: 'AUTH_CANCELLED' });
      }
      throw new Error('Google sign-in was not completed.');
    }
    const codes = callback.searchParams.getAll('code');
    if (codes.length !== 1 || !codes[0]) throw new Error('Sign-in code is missing.');
    const session = await authStep(() => sb.auth.exchangeCodeForSession(codes[0]), 'Finishing Google sign-in');
    if (session.error) throw session.error;
    if (!session.data?.session) throw new Error('Sign-in did not create a session.');
    return session.data.session;
  } finally {
    signingIn = false;
  }
}

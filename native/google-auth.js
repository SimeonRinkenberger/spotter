export const GOOGLE_AUTH_RETURN = 'com.spotter.auth://callback';
let signingIn = false;

// Called only from the explicit Google button; no web-view navigation or tokens
// in deep links. The Supabase client must use PKCE with persistent native storage.
export async function signInWithGoogle(sb, systemAuth) {
  if (signingIn) throw new Error('Google sign-in is already open.');
  signingIn = true;
  try {
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: GOOGLE_AUTH_RETURN, skipBrowserRedirect: true }
    });
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
    const session = await sb.auth.exchangeCodeForSession(codes[0]);
    if (session.error) throw session.error;
    if (!session.data?.session) throw new Error('Sign-in did not create a session.');
    return session.data.session;
  } finally {
    signingIn = false;
  }
}

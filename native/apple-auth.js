let signingIn = false;

export async function signInWithApple(sb, appleAuth, registerGrant) {
  if (signingIn) throw new Error('Apple sign-in is already open.');
  signingIn = true;
  try {
    const credential = await appleAuth.start();
    if (!credential?.identityToken || !credential?.nonce || !credential?.authorizationCode) {
      throw new Error('Apple did not return a complete sign-in credential.');
    }
    const { data, error } = await sb.auth.signInWithIdToken({
      provider: 'apple', token: credential.identityToken, nonce: credential.nonce
    });
    if (error) throw error;
    if (!data?.session || !data?.user) throw new Error('Apple sign-in did not create a session.');
    let grantError = null;
    try {
      if (typeof registerGrant !== 'function') throw new Error('Apple connection is not configured.');
      await registerGrant(credential.authorizationCode, data.session);
    } catch {
      grantError = 'You are signed in, but the Apple connection could not finish. Sign out and sign in with Apple again before deleting your account.';
    }
    return { user: data.user, fullName: credential.fullName || null, grantError };
  } finally {
    signingIn = false;
  }
}

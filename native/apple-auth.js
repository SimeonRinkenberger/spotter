let signingIn = false;

export async function signInWithApple(sb, appleAuth) {
  if (signingIn) throw new Error('Apple sign-in is already open.');
  signingIn = true;
  try {
    const credential = await appleAuth.start();
    if (!credential?.identityToken || !credential?.nonce) {
      throw new Error('Apple did not return a complete sign-in credential.');
    }
    const { data, error } = await sb.auth.signInWithIdToken({
      provider: 'apple', token: credential.identityToken, nonce: credential.nonce
    });
    if (error) throw error;
    if (!data?.session || !data?.user) throw new Error('Apple sign-in did not create a session.');
    return { user: data.user, fullName: credential.fullName || null };
  } finally {
    signingIn = false;
  }
}

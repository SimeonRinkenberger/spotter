# Continue with Apple

## Status — September 8, 2026

The native implementation is prepared, but Apple Developer Program enrollment is
still pending (confirmed by the owner). The current installed app uses a free
Personal Team. Apple sign-in cannot be activated with that signing setup.

The existing Apple button stays hidden while the Supabase Apple provider is
inactive. No Apple credentials have been created, provider enabled, paid membership
purchased, or app published. The Google-enabled physical iPhone build remains
installed; this inactive Apple integration has not been installed on the phone.

## Implemented

- `AppleAuth.swift` presents Apple's native authorization controller for name and
  email. It generates a cryptographically random nonce, sends its SHA-256 hash to
  Apple, checks response state, and returns the identity token and original nonce
  to the existing Supabase client. Supabase validates the token and nonce.
- The bridge exchanges the token for a session using `signInWithIdToken`. It rejects
  incomplete credentials, duplicate requests, and failed session exchanges.
- The shared Apple button uses the native flow on iPhone and retains the existing
  web flow in a browser. Cancellation restores the button without an error toast.
- Apple's first-authorization name uses the existing profile update that preserves
  names the user already customized. Returning sign-ins can omit the name.
- `tools/ios/apple-auth-check.mjs` covers these JavaScript behaviors and is included
  in `npm run ios:check`.

## Activate after membership approval

1. Use the approved development team and register the intended App ID with
   **Sign in with Apple** enabled. Review the bundle identifier before changing
   teams: a different identifier installs a separate app, and a team change can
   affect signing and Keychain access.
2. The prepared `ios/App/App/AppleSignIn.entitlements` includes Apple sign-in plus
   the existing share Keychain group. Set **only the main App target's**
   `CODE_SIGN_ENTITLEMENTS` to `App/AppleSignIn.entitlements` for the intended
   build configurations. Keep the ShareExtension using `App/Share.entitlements`.
   It is deliberately not selected while the free Personal Team is in use.
3. Regenerate provisioning through Xcode's automatic signing with the approved
   team. Add the native bundle identifier to the Supabase Apple provider's allowed
   client IDs and enable the provider with nonce verification retained.
4. For website support, also create a Services ID linked to the primary App ID,
   configure the existing website and Supabase callback URLs, and generate the
   required client-secret JWT from Apple's signing key. Keep all private signing
   material out of the repository. Set the public Services ID in
   `PUBLIC_AUTH.apple_services_id`. See README's Apple setup section for URLs.
   Native-only token sign-in does not require the web secret rotation; Apple's
   web OAuth secret needs renewal at least every six months.
5. Build, sign and install the updated app. Verify a real Apple login with both
   Share My Email and Hide My Email, cancellation, returning-user login, session
   restoration, and first-login name persistence. A relay email can produce a
   separate account from an existing account with a different email.

References: [Supabase Apple authentication](https://supabase.com/docs/guides/auth/social-login/auth-apple),
[Apple supported capabilities](https://developer.apple.com/help/account/reference/supported-capabilities-ios/).

# Google sign-in and sign-up

The same **Continue with Google** button signs existing users in and creates an
account for new users. Supabase's existing profile trigger populates the user's
name. The button appears on both faces of the authentication card once Supabase
reports that Google is enabled.

## Activate the provider

Configured on September 8, 2026:

- Google Cloud project: `gen-lang-client-0228763801`, owned through
  `quarterdeckcollective@gmail.com`.
- Consent app: **Spotter by Quarterdeck Collective**; External audience.
- Developer contact: `business@quarterdeckcollective.com`. Google currently only
  offers the owner Gmail address in its support-email dropdown.
- Web client: `48831784248-dh1o2fhiem9kqgs6ambnnvaba8vojrf2.apps.googleusercontent.com`.
  Its secret is saved only in Supabase's Google provider configuration.
- Supabase Google provider is enabled, nonce checks remain enabled, and the exact
  `com.spotter.auth://callback` redirect is allowed alongside the existing web URLs.
- Website source includes the public client ID for One Tap. The currently deployed
  website already displays Google sign-in and uses its existing redirect fallback.
- Google OAuth is **In production** with an External audience, verified in the
  console after explicit user approval on September 8, 2026. This removes the
  test-user restriction; it does not deploy the website or publish an App Store
  listing. A completed Google-account round trip remains unverified.

The steps below document the configuration for future maintenance.

1. In Google Cloud Console, configure Google Auth Platform branding and audience
   for Spotter. Create a **Web application** OAuth client, used by both platforms.
   Register this authorized redirect URI:
   `https://mtzevoxxpsktmrbbuxva.supabase.co/auth/v1/callback`.
   For the website's optional One Tap flow, register the JavaScript origin
   `https://simeonrinkenberger.github.io` (and `http://localhost:8000` for local use).
2. In [Supabase Google provider settings](https://supabase.com/dashboard/project/mtzevoxxpsktmrbbuxva/auth/providers?provider=Google),
   enter the client ID and client secret and enable Google. Keep nonce checks on.
   Store the secret only in the provider settings, never in source control.
3. In [Supabase URL Configuration](https://supabase.com/dashboard/project/mtzevoxxpsktmrbbuxva/auth/url-configuration),
   preserve existing entries and allow these exact redirect URLs:
   - `com.spotter.auth://callback`
   - `https://simeonrinkenberger.github.io/spotter/`
   - `http://localhost:8000/` if testing the web app locally.
4. Optional: set `PUBLIC_AUTH.google_client_id` in
   `supabase/functions/spotter/app.ts` to the public web client ID for One Tap.
   Without it, the website uses Supabase's Google redirect flow.
5. Run `npm run ios:sync`, then build/install through Xcode. Publish the generated
   website assets through the usual release process. Test new-account sign-up,
   existing-account sign-in, cancellation, sign-out, and session restoration.
   In Google testing mode, add the testing accounts to the OAuth audience; publish
   the OAuth app before opening sign-in to everyone.

## iPhone flow

`GoogleAuth.swift` opens `ASWebAuthenticationSession` from the visible app window.
The system sheet receives the callback directly; it does not depend on Safari
sharing web-view storage, a URL handler, or a Google SDK dependency. Requests are
restricted to this project's Google authorize endpoint and expected callback.

The Supabase client uses PKCE and its existing persistent native storage. Only
the one-use authorization code returns through the callback. The code is exchanged
inside the app with the original verifier. Unexpected callback URLs and duplicate
attempts are rejected; cancellation returns to the sign-in screen.

## Verification

`node tools/ios/google-auth-check.mjs` covers request options, callback validation,
cancellation, duplicate taps, provider and exchange errors, and retries. It is also
included in `npm run ios:check`. These are simulated auth responses.

The updated simulator build compiled successfully and was installed on the running
iPhone 16e simulator. Manual checks confirmed:

- The live website's Google button opens Google's account chooser with this client.
- The native Google button opens Apple's authentication session and Google's sign-in
  page, without leaving the Spotter app.
- Cancelling the native sheet returns to Spotter and restores the enabled button.

The signed development build was installed successfully over the existing app on
Simeon's physical iPhone 15 via USB on September 8, 2026. Bundle identifier:
`com.simeonrinkenberger.spotter.dev`. The wireless connection was unavailable on
this network; USB installation completed with devicectl exit code 0.

A real account login, code exchange, and session restoration have not yet been
verified manually. Release of the local One Tap client ID remains a separate release step.

## Branding follow-up — September 8, 2026

- Changed the iOS CFBundleName from App to Spotter. Signed device and simulator
  builds passed; the updated branding build still needs installation because the
  physical iPhone is currently unavailable.
- Website ownership meta tag, matching title/footer, and business privacy contact
  shipped through PR #2; required checks and GitHub Pages deployment passed.
- Google Search Console confirmed ownership under quarterdeckcollective@gmail.com.
- Google rejected the short name Spotter; the accepted OAuth name remains
  Spotter by Quarterdeck Collective. Automated re-verification still reported the
  old ownership/name issues, so evidence was submitted for manual review. The
  Verification Center confirms branding is currently under review (estimated
  2–3 business days). No sensitive or restricted scopes require verification.
- The iOS system sheet still shows the real Supabase auth hostname. Replacing
  that hostname in the current flow requires a branded auth domain; no paid
  Supabase domain or plan upgrade has been purchased.

References: [Supabase Google auth](https://supabase.com/docs/guides/auth/social-login/auth-google),
[Apple authentication session](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession/).

# Continue with Apple

## Current status — 20 September 2026

Apple Developer Program enrollment is approved for **Quarterdeck Collective LLC**
(`5L638CAQW2`). Native Apple login is configured for **`app.spotter.dev`** in Apple
Developer and Supabase. Signed **Spotter 1.0 (1)** uploaded on 19 September,
completed Apple processing, and is assigned to the internal TestFlight group.
The uploaded package contains the required Sign in with Apple entitlement.

**A real device Apple sign-in has not yet been verified end to end.** Configured
credentials, passing checks and successful upload are not a login acceptance pass.
The old September 8 instructions saying enrollment/provider activation are pending
are superseded. No public App Store or external Beta App Review submission occurred.

## Implemented and deployed

- `ios/App/App/AppleAuth.swift` uses Apple's native authorization controller,
  requests name/email, creates a secure nonce and verifies request state. It returns
  the identity token, raw nonce, authorization code and first-authorization name.
- `native/apple-auth.js` exchanges the token/nonce with Supabase using
  `signInWithIdToken`, requires a valid session/user, and registers the one-time
  authorization code with the authenticated backend. Duplicate/incomplete requests
  fail; cancelling restores the sign-in UI. Existing customized names are preserved.
- Authenticated `POST /api/auth/apple/grant` takes `{code}`. The backend exchanges
  it with Apple, checks issuer/audience/expiry/subject against the Supabase-verified
  Apple identity, and stores the refresh grant in service-only `apple_auth_tokens`.
- `supabase/functions/spotter/apple-auth.ts` signs five-minute ES256 client-secret
  JWTs server-side. Before account deletion it revokes all retained Apple grants;
  failures are surfaced for retry. A legacy Apple account without a grant must
  sign in with Apple again before deletion. Non-Apple accounts are unaffected.
- If grant registration fails after login, the client explains that sign-in
  succeeded but the Apple connection must be completed before account deletion.
- Migration `20260919120000_apple_auth_tokens.sql` was applied. RLS denies client
  access; grants are accessed with service privileges. Do not log authorization
  codes, tokens, private keys, request bodies or Apple token responses.
- Shipped in PRs 25/26; runtime baseline `3a6163a624700346d6103637b551bd7e9d1bbdb3`.

## Configuration and signing

- Supabase project `mtzevoxxpsktmrbbuxva`: Apple provider enabled, native client ID
  `app.spotter.dev`, nonce verification retained.
- Backend secret names: `APPLE_AUTH_KEY_ID`, `APPLE_AUTH_KEY_P8`, `APPLE_TEAM_ID`,
  `APPLE_CLIENT_IDS`. Dedicated Apple sign-in key exists in the approved backend;
  its private material is never part of the client or repository.
- Release selects `App/Release.entitlements` through
  `ios/App/App/Release.xcconfig`; Share/Widgets use `App/ReleaseShared.entitlements`.
  Do not replace those full Release files with the older Apple-only entitlement
  file: that would lose production push and/or shared-container capabilities.
- The signed Release archive and export were verified for Apple sign-in,
  production APNs, company team, shared app/keychain groups and Watch HealthKit.
  The successful upload used the existing distribution certificate and all four
  manual App Store profiles. See `design/gtm/APPLE-LAUNCH-2026-09-19.md` and the
  current local `HANDOFF.md` for the repeatable upload path.
- **Web Apple OAuth is not configured.** No Services ID or web client secret was
  created; the web Apple button stays hidden. Native ID-token login does not
  require a website Services ID. Any future web setup is separate work.

## Verified evidence

The iOS Apple-auth checks and release checks passed. Live checks confirmed 401 for
an unauthenticated grant request, 403 for a non-Apple user's grant request and 403
for client access to the Apple token table. None of those checks authenticates a
real Apple account on a device.

## Next device acceptance checks

1. Install the internal TestFlight build on a physical iPhone and test first login
   with Share My Email, then relaunch and return through Apple sign-in.
2. Test Hide My Email with a suitable test identity, verify first-login name and
   repeat-login behavior, and check that an unrelated existing email account is
   not incorrectly merged. A relay address may legitimately create another account.
3. Cancel Apple login and confirm the screen stays usable without false success.
4. Verify grant registration succeeds without a connection-incomplete warning.
5. Use a disposable account to test export, approved account deletion, grant
   revocation and fresh authorization afterward. Never delete or repurpose the
   permanent synthetic Apple/Google reviewer.

Record device, OS, build, result and reproduction steps in the beta test plan.
See [Apple beta test plan](design/gtm/APPLE-BETA-TEST-PLAN.md).

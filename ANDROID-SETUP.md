# Spotter Android release — 13 September 2026

**Nothing submitted or published. Final release and listing saved in Publishing overview. Remaining requirements below.**

## Prepared

- Quarterdeck Collective LLC developer 8117140031917944623; app 4973407564383880975.
- Production draft: 1.0 — Spotter for Android; package app.spotter.dev; version 1.0 (2); minimum API 24, target API 36. Final bundle 2 uploaded/processed; superseded bundle 1 removed from release.
- US distribution saved. Release preview has no errors. Only warning: no deobfuscation mapping; minifyEnabled is false, so no R8 mapping is produced.
- Listing text, icon, feature graphic and four real Android screenshots saved: Ready to send for review. Feature graphic and coaching screenshot carry AI asset declarations.
- Ads, adult audience (18+), category/contact, government status, financial features, fitness health declaration, data safety, privacy and reviewer access saved.
- Persistent reviewer account has synthetic workouts and complimentary Plus. Credentials saved in Play and ignored .native-build/play-reviewer.json. Preserve this account.
- Publishing overview explicitly showed Changes not yet submitted for review. Do not submit or roll out without owner instruction.

## Billing

- Google product spotter_plus: monthly USD 6.99; yearly exactly USD 50.00; both active, US only. Eligible annual trial-7-days offer active. Publisher API verification passed. App reads store pricing.
- RevenueCat project proj44846925; Google app appac6e047ae1; Apple app app0a95be48a9; shared plus entitlement and default monthly/annual packages configured. Google products attached.
- Dedicated Google credential uploaded, required APIs enabled and scoped Play access configured.
- Real-time notifications connected through projects/gen-lang-client-0228763801/topics/spotter-revenuecat. Official Google Play notification identity has topic-only Pub/Sub Publisher access. Play notifications enabled for subscriptions/voided purchases. Test sent successfully and RevenueCat confirmed receipt at 2026-09-13 14:14 UTC.
- Authenticated RevenueCat webhook and Supabase purchase verification deployed. Active Stripe Pro/manual access is preserved. Account switching serialized; server verification controls access. Production rejects sandbox purchases by default.

## Session storage

- The signed-in Supabase session — access token, refresh token and PKCE verifier — is encrypted with AES-256-GCM under a key held in the Android Keystore (alias `app.spotter.session`, randomised IV per write, no user-authentication requirement so a background refresh still works). The ciphertext sits in the private SharedPreferences file `spotter_secure_session`; the key never leaves the Keystore, is not in any backup, and goes with the app on uninstall.
- Not EncryptedSharedPreferences: Jetpack Security's crypto library is deprecated at 1.1.0 with no further releases, and Google's guidance is a Keystore key plus storage of your choosing. Every class used is in the platform, so the app gains no Gradle dependency.
- A session left in `@capacitor/preferences` by a build older than 17 September 2026 is moved into the encrypted store on first launch and deleted from the plain preferences file. Sign-out clears both. A value that no longer decrypts — wiped keystore, restore, half-written blob — is dropped and reported as absent, so the user sees the sign-in screen rather than an error.
- The workout draft and the `spotter_install` marker stay in ordinary Preferences; neither is a credential.
- Verified by compilation and the shared adapter harness only. **No Android runtime verification**: `adb` is not on PATH and no emulator was started for this change.

## Remaining requirements

1. Content rating: separate IARC Terms of Use approval requested, not received. Questionnaire open in dedicated Chrome tab. Accept only after owner reply, then complete accurate fitness-app questionnaire and save rating.
2. Google purchase validation: catalogs readable, but RevenueCat purchase validation still reports No application was found for the given package name. Package matches uploaded bundle. RevenueCat documents up to 36 hours credential propagation. Recheck; do not publish to bypass it. Actual purchase/restore untested.
3. Apple connection: SDK/public configuration and simulator build pass, but Apple In-App Purchase Key missing in RevenueCat. Enrollment pending at last successful check. Finish credentials/products when available; production cross-store purchasing not verified.
4. RevenueCat dashboard reports owner email unconfirmed. Owner must complete confirmation link.
5. Mac locked during Apple recheck. Unlock to finish account checks and inspect Play quick-check results. Leave app unsubmitted.
6. Temporary spotter-tw-androidqa@example.com account remains. Automatic approval review rejected deletion as irreversible without specific user approval; approval requested. After approval: python3 tools/throwaway.py delete androidqa. Preserve reviewer and permanent spotter-tw-simeon@example.com.

## Validation and files

Final Android release/debug build, lint, unit-test task and shared native regression checks passed. Latest AAB signature and artifact hashes verified. iOS assets synced after final shared-code fix.

Real Android emulator checks passed: email sign-in, library/detail, set logging, rest timer, workout save, edge Back, background/resume preserving account, live Pumpy streaming and report submission. Report action now appears immediately after streaming. Database tests cover ownership, duplicates and client permissions.

Google sign-in end to end, incoming Android share UI, real Play purchase/restore and physical-device behavior unverified. Automated checks cover callbacks/cancellation, link formats, Unicode streaming and keyboard behavior. No real purchase made.

- releases/android/Spotter-1.0-2.aab: signed upload already saved in Play.
- releases/android/Spotter-1.0-2.apk and SHA256SUMS.txt: signed device build and verified hashes.
- releases/android/store/: listing, graphics and four screenshots.
- .native-build/android-final-build.log, native-regression.log, ios-final-sync.log: validation evidence.

Rebuild: npm run android:sync then npm run android:build -- --no-daemon bundleRelease assembleRelease assembleDebug lintDebug testDebugUnitTest. Increment versionCode before replacing uploaded version 2.

Preserve secure backup of ignored .native-build/android-signing/. Credentials, webhook secrets and reviewer login also ignored under .native-build; never commit/share them.

Operator reviews public.ai_response_reports and sets reviewed_at after triage. Reports are private, deleted with their account; no automatic email configured.

Only privacy-policy PR #5 merged to public website. Other native/shared changes remain local alongside pre-existing edits; do not indiscriminately commit or reset.

# Spotter iOS sharing repair — 20 September 2026

## Cause and behavior

The Share extension was embedded in build 1, but iOS rejected its activation rule. The predicate used an aggregate literal (`IN {"public.url", ...}`) that evaluated successfully in the macOS test harness but was classified as unsafe by iOS `sharingd`. Device logs explicitly named `app.spotter.dev.share` and that literal. A development or TestFlight installation can provide a share extension; distribution mode was not the cause.

Build 2 replaces the literal with individual equality clauses and keeps UTI-conformance checks. URL/text attachments can activate the extension even when the host also supplies a thumbnail or movie. Image-only and movie-only payloads remain excluded. A second Action extension, `app.spotter.dev.action`, uses the same save controller and shared-keychain credential to expose **Save to Spotter** in the lower actions list. The app-row extension remains **Spotter**. iOS and the user control ordering and Favorites; the app cannot force a specific position.

Both entries use the same link validation, multiple-link rejection, account save key and durable-save acknowledgement. The AI-permission error now directs users to Settings → Data & privacy instead of incorrectly suggesting that their sign-in expired. Consent enforcement was not changed.

## Verification

- Full `npm run ios:check` passed; the modified share checks were rerun after the final error-message fix. Both activation rules, mixed attachments, 17 URL formats, invalid/multiple links, deduplication, durable acknowledgement and error responses are covered.
- Final Release simulator build, signed device archive and App Store export succeeded. All five products were checked for build 2, the company team and required capabilities; strict deep signature verification passed.
- iOS 26.2 simulator visibly displayed Spotter in the app row and Save to Spotter in the lower actions list with its dumbbell symbol.
- A real TikTok workout shared through the app-row extension returned “Saved to your library. Spotter is reading the workout.” The authenticated synthetic review account's persisted row reached `ready`, retained the exact TikTok URL and contained the title “Complex Fives” with five exercise entries and five reps each. This verifies persistence and successful extraction, not independent validation of every inferred exercise detail.
- Sharing the same TikTok URL embedded in a caption with a thumbnail through the Action extension returned “Already in your Spotter library.”
- With AI permission off, the server rejected ingestion with `ai_consent_required`. The owner then explicitly approved enabling AI processing for the synthetic reviewer; its permission remains enabled. No personal account setting was changed.
- Owner reported Sign in with Apple working. Physical TikTok/Instagram host-app checks on the newly installed TestFlight build, the complete Apple-auth matrix and the rest of the beta plan remain pending. Simulator host fixtures cannot fully substitute for the current TikTok/Instagram apps.

## Distribution

Xcode confirmed **Spotter 1.0 (2) uploaded**; App Store Connect reports upload processing **Complete**, created 20 September 2026 at 9:51 AM America/Chicago. Build ID `7cc9c157-b89d-4ad8-b498-37b7348742a5`. The upload was explicitly limited to **TestFlight internal testing only**; a future public candidate needs another upload.

Build 2 is assigned to **Spotter Internal QA** with saved testing notes. The group shows **2 Testers / 2 Builds**, and Hailey’s TestFlight status is **Invited**. John’s team acceptance is still pending; his personal account cannot yet be added.

The action target uses the existing distribution certificate and a new manual profile **Spotter Action App Store** (`Q83395LA89`). Its only custom capability is the same keychain access group used to receive the signed-in user's save key.

Package: `releases/apple/Spotter-1.0-2.ipa` (ignored); SHA-256 `a68c282b39d0456f3acca33021df32c46c64fc99b8956db3fab36f98139558fb`. Final archive: `/private/tmp/spotter-testflight/Spotter-1.0-2-Final.xcarchive`; temporary files may be cleaned by the OS. Build 1's runtime does not gain this fix through a website refresh.

## Tester instructions

Update to **1.0 (2)** in TestFlight, then open Spotter and sign in once. From TikTok/Instagram, share a workout and open **More** to reach the iOS share sheet. Select **Spotter** in the app row; if needed, open that row's **More** and add Spotter to Favorites. For the lower option, use **Save to Spotter**; **Edit Actions** can enable/favorite it. Review the saved card and compare exercises, sets and reps to the original before training.

Record the phone/iOS version, source URL, result and screenshot for failures. Verify no duplicate on repeated sharing and clear retry behavior on poor connections. Plus purchase testing remains separately blocked on billing setup.

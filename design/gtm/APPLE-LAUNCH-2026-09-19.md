# Spotter Apple launch readiness

## Share-sheet repair and GTM update — 20 September 2026

This update supersedes the older status below. The owner made direct TikTok/Instagram sharing the first priority, authorized WordPress updates and the Small Business enrollment, and reported Sign in with Apple working on their device. That is an owner-reported pass, not a complete Apple-auth acceptance matrix.

- **Sharing:** iOS rejected the old activation predicate's aggregate literal as unsafe and hid the Share extension. Replaced it with safe equality/conformance clauses. Added a signed Action extension using the same save controller for the lower **Save to Spotter** list. The existing Share extension supplies the app row beside Messages/Mail. This is not a development-app limitation.
- **Build 2:** final signed archive `/private/tmp/spotter-testflight/Spotter-1.0-2-Final.xcarchive`; exported package `releases/apple/Spotter-1.0-2.ipa`, SHA-256 `a68c282b39d0456f3acca33021df32c46c64fc99b8956db3fab36f98139558fb`. Xcode confirmed **Spotter 1.0 (2) uploaded** on 20 September. Upload explicitly limited to internal TestFlight. Apple processing is **Complete** (build ID `7cc9c157-b89d-4ad8-b498-37b7348742a5`, created 9:51 AM America/Chicago); assigned to **Spotter Internal QA**, now **2 Testers / 2 Builds**. Build-specific testing notes saved.
- **Evidence:** iOS 26.2 simulator shows both entries; real TikTok URL shared through the app row was durably saved, reached `ready`, and produced **Complex Fives**, five exercises with five reps each. Caption plus thumbnail through the lower Action extension recognized the same URL and returned **Already in your Spotter library**, avoiding a duplicate. Full iOS checks, final Release simulator/archive/export builds and all five signed-product entitlement checks passed. Physical TikTok/Instagram host-app checks still required after updating TestFlight.
- **Consent:** owner explicitly approved enabling AI processing on the permanent synthetic reviewer for this test. Enabled the current consent version; left it enabled per approval. No personal account settings changed. Corrected the share UI's previous misleading sign-in message for `ai_consent_required` to direct people to Settings → Data & privacy. Do not remove consent gating.
- **Small Business:** owner confirmed no associated accounts and prior-year proceeds below $1 million. Enrollment was submitted; Apple displayed receipt confirmation. Approval and effective 15% commission date are pending. Paid Apps Agreement now shows accepted/effective 20 September, **Pending User Info**; tax/banking remain incomplete.
- **Testers:** Hailey's team acceptance is confirmed and she was added to Spotter Internal QA. Her TestFlight status is **Invited** on 20 September after build 2 assignment. Group has two testers. John’s supplied personal email still shows **Resend Invitation** in Users and Access and is unavailable to add; owner has been asked to complete that acceptance. Do not substitute the Account Holder's company login. Exact roster stays in ignored private storage.
- **WordPress:** homepage, privacy, terms and What's New saved to existing IDs 900001–900004. Anonymous published content matches approved source, comments closed, all four pages pass 375px one-H1/no-overflow checks, privacy `#delete` present. Current internal beta and $49.99/year / $6.99/month described accurately.
- **Source:** local commits `6a1d92b` (sharing repair/build 2 and QA evidence) and `140b821` (published website source record), on `apple-launch-review`. These commits are not pushed; the native fix is delivered through TestFlight and the four WordPress pages are already live. Existing Apple-auth/launch draft edits remain local.
- **Next gates:** testers update to build 2; finish John's acceptance/invite; owner checks actual TikTok/Instagram on iPhone; complete payment credentials/notifications/tax/banking and purchase/restore testing; privacy/content-rights declarations; native screenshots and remaining beta matrix. No external beta review, public App Store submission, wider cohort, AI-budget increase or marketing spend was authorized here.

Updated 20 September 2026; console outcomes last verified 19 September, America/Chicago. **Spotter 1.0 (1) uploaded successfully; internal testing authorized and three team invitations sent. No App Store or external Beta App Review submission. Not ready for public release.** This supersedes the Apple status and price assumptions in the September 17 GTM drafts. Invitation statuses below are the last verified state, not a claim of a fresh acceptance check.

## Current setup

| Area | Verified result |
| --- | --- |
| Apple organization | Quarterdeck Collective LLC; team `5L638CAQW2` |
| App | `6814013016`; `app.spotter.dev`; SKU `spotter-ios-1`; version 1.0; Prepare for Submission |
| Listing | Spotter: Save Workout Videos; subtitle Workout planner & gym tracker; current feature description, promo text and keywords saved |
| Categories | Health & Fitness, Sports; medical device No; age override 13+ consistent with existing minimum account age |
| Distribution | Free app; U.S. only; manual release; Mac and Vision Pro availability disabled pending testing |
| Subscription group | `22398216`, Spotter Plus; annual and monthly at the same level; English localization saved |
| Annual Plus | `spotter_plus_year`; Apple ID `6814021240`; **$49.99/year U.S.**; one-year upfront payment |
| Monthly Plus | `spotter_plus_month`; Apple ID `6814026593`; **$6.99/month U.S.** |
| Offers | No Apple introductory offer, creator offer code, Family Sharing or multi-seat option enabled |
| RevenueCat | Project `44846925`; Apple app `app0a95be48a9`; both Apple products attached to `plus` and the current `default` offering’s annual/monthly packages |
| Review access | Existing synthetic Google Play reviewer saved for Apple App Review and TestFlight with owner approval; four synthetic workouts and complimentary Plus |
| TestFlight | Spotter Internal QA group `7e5bf111-bf51-43c6-a7e1-af139565c1f3`; one accepted team member added, two team invitations pending acceptance; version 1.0 (1) processed and assigned; accepted member’s TestFlight invitation is Invited; beta description, contact, review login and notes saved |
| Privacy | 13 data types, purposes, account linkage and no-ad-tracking answers saved as draft; URLs saved; final accuracy declaration / Publish awaiting owner approval |
| Sign in with Apple | Native capability enabled; dedicated sign-in key; Supabase provider enabled for `app.spotter.dev`; server token storage/revocation implemented and deployed |
| Push / shared data | Dedicated production APNs key scoped to main app; main, Share and Widgets share `group.app.spotter.dev`; Watch HealthKit capability enabled |
| Signing | Distribution certificate and all four downloaded App Store profiles used to create a signed archive and verified Spotter 1.0 (1) package |

The review password and private keys remain in ignored local storage / their approved services, not in this document or Git.

## Work completed in the app

- Release signing settings and entitlements cover the iPhone/iPad app, Share extension, Widgets and Watch companion. Push uses the production environment for TestFlight/App Store.
- Apple’s one-time authorization code is bound to the authenticated Apple identity. Refresh tokens are stored server-side behind service-only database access and revoked during account deletion, with retry handling for failures.
- AI processing requires explicit permission before sending selected content or training context to OpenAI or Google. Settings lets people review or turn it off. Manual planning/logging remains available. Older clients are directed to the latest web app to manage permission.
- The annual price in the web billing setup source and relevant fixtures is $49.99; this does not mean live web checkout is configured.
- Changes merged in [PR 25](https://github.com/SimeonRinkenberger/spotter/pull/25) and [PR 26](https://github.com/SimeonRinkenberger/spotter/pull/26). Current main `3a6163a624700346d6103637b551bd7e9d1bbdb3`; release checks and Pages deployment succeeded. Matching backend deployed; Apple token-storage migration applied.

## Evidence and its limits

- All 27 GTM check groups and iOS configuration checks passed; GitHub verification and native parity checks passed.
- Release simulator build including Watch and a signed Release archive succeeded. The final exported package passes signature and required-capability checks for all four targets. These are packaging checks, not device acceptance tests.
- Live synthetic-account checks passed: unauthenticated Apple grant rejected (401), non-Apple account rejected (403), signed-in clients denied access to the Apple token table (403), unconsented AI request rejected before inference (403).
- The live web app contains the new permission UI. Browser testing verified enable, reopen, revoke and persisted off state using the synthetic account, without sending training content to AI providers.
- Apple sign-in has **not** been verified end to end on a physical device. Hide My Email, cancellation, deletion/re-authorization, APNs delivery, native purchases, Watch/Health behavior and restore remain required checks.
- Signed version 1.0 (1) uploaded successfully using Xcode Organizer with the existing company distribution certificate and all four manual profiles. Xcode displayed “Spotter 1.0 (1) uploaded” and “Uploaded to Apple.” Apple processing completed; build `6db0b996-d923-4cbf-8bf2-0ff050fc56ed` is assigned to Spotter Internal QA. The group shows 1 Tester / 1 Build and the accepted member has status Invited. No App Store or subscription screenshots uploaded. No external beta group/public link can be considered ready.

## What is still needed

| Dependency | Next action | Why it remains |
| --- | --- | --- |
| Internal beta delivery | Add the two remaining users to Spotter Internal QA after they accept their team invitations | Upload and processing completed; one internal tester invited to install 1.0 (1). Team invitations were sent to all three owner-supplied addresses. Two acceptances remain pending; details are stored privately outside Git |
| Apple paid business setup | Owner accepts Paid Apps Agreement and completes tax/banking | Owner explicitly deferred this; needed for paid subscriptions |
| RevenueCat Apple credentials | Approve pending Spotter RevenueCat In-App Purchase key; create/download and save to the existing RevenueCat Apple app; verify credentials | Persistent Apple credential requires confirmation; final Generate is prepared |
| Store notifications | After credential approval, connect Apple’s production and sandbox notifications to the existing RevenueCat Apple endpoint and verify an event | Not yet saved/tested |
| Privacy declaration | Owner approves the completed 13-type accuracy declaration, then Publish privacy answers | Final legal declaration pending; this does not submit the app |
| Third-party content rights | Owner confirms necessary rights/permissions for supported source content before completing Apple’s declaration | Public availability alone cannot establish those rights |
| Current public pages | Sign in to WordPress; review and publish the prepared updates to the four existing page IDs | Live pages are older; drafts are prepared, not published |
| Device QA and media | Complete the linked beta plan; capture actual native screenshots and subscription review images | Signed TestFlight build is available; physical-device acceptance and screenshot capture remain pending |
| External beta review | Owner separately authorizes Beta App Review, then external invitations after approval | Owner chose internal team testing and authorized the three named invitations. This does not authorize external review or public release |

RevenueCat also displays an unconfirmed account email notice. Owner should complete that email verification; no verification email was resent during this task.

## GTM status

Positioning: **Save the workout. Make it happen.** The launch copy follows the journey from saved video to reviewed card, a planned workout, logged sets and visible progress. Pumpy proposes changes for confirmation. Native copy includes the Share extension, Watch, widgets, Live Activities and reminders without claiming they are already available in the App Store.

Store copy uses $49.99/year and $6.99/month and states renewal/cancellation terms. It does not promise unlimited AI, universal trials, founding discounts, creator discounts or immediate App Store availability.

Google Play’s annual base plan still showed $50.00. It was corrected to **$49.99 for new subscribers**, and the console confirmed the save. No existing subscriber price migration was performed; Google keeps legacy subscribers at their existing price until explicitly migrated. The existing Google annual trial remains store-specific; no matching Apple trial was created.

The owned-domain homepage, privacy, terms and What’s New drafts are in `wordpress/drafts/apple-launch-2026-09-19/`. Update existing WordPress IDs `900001`–`900004` in place; do not reimport duplicates. Privacy and terms source changes under `docs/` are also unpublished working copies. Publishing them needs review of the actual text, not a claim of legal certification.

All four unpublished drafts were checked at a 375-pixel viewport: one H1 each, no horizontal overflow, privacy deletion anchor present. The preview is not the live WordPress theme; repeat the visual and anonymous-content check after publication.

Live billing check: `/api/billing/prices` returned `configured:false`. Stripe credentials are absent from backend secret names; web checkout is not ready. RevenueCat backend API and webhook-auth secrets are present (names checked without exposing values).

Live AI capacity check: shared daily budget **$0.50**, shared monthly budget **$10**; the synthetic Plus account reported **$1.50/month** AI allowance. These are existing beta safeguards, not an approved funded public-launch budget. Do not raise them automatically. Before inviting a cohort, the owner should agree a size that fits capacity and review spend/error/support signals daily.

Support and feedback use `business@quarterdeckcollective.com`. Three App Store Connect team invitations were sent with owner authorization; one recipient has accepted and been added to internal TestFlight. No public announcement or support message was sent. Feedback inbox delivery remains to be checked by the owner. No new monitoring automation was created.

See [Apple beta test plan](APPLE-BETA-TEST-PLAN.md) for device, purchase and activation checks, suggested cohort and ready-to-paste build testing notes.

See [Apple screenshot brief](APPLE-SCREENSHOT-BRIEF.md) for the capture order and subscription review images still required.

## Delivering later updates to testers

Spotter packages its UI/client code and assets in `native-dist`; Capacitor has no
`server.url`, and service-worker registration is disabled in native mode. Updating
the website or editing the repository does not replace the installed app. UI/client,
Swift/plugin, Share, widget and Watch changes require a new signed build, a higher
build number across all four targets, upload, Apple processing, and assignment to
**Spotter Internal QA**. The current group uses **Manual for Xcode Builds**; the
repository's release-check workflow does not upload iOS builds.

Deployed backend/API changes and remotely fetched data/configuration can reach an
existing build on its next applicable request or refresh. Keep those changes
compatible with older installed clients; backend deployment cannot supply missing
client code. Local edits alone change neither the live backend nor testers' apps.

Testers can enable **TestFlight → Spotter → App Information → Automatic Updates**
to install newly available beta builds automatically. Otherwise they tap Update.
Delivery is not guaranteed immediately, and each build is available for up to 90
days. This phone setting is separate from assigning a build to the tester group.
See [Apple's TestFlight instructions](https://testflight.apple.com/) and
[internal group distribution](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/).

## Console links

- [App Store version](https://appstoreconnect.apple.com/apps/6814013016/distribution/ios/version/inflight)
- [App Privacy](https://appstoreconnect.apple.com/apps/6814013016/distribution/privacy)
- [Subscriptions](https://appstoreconnect.apple.com/apps/6814013016/distribution/subscriptions)
- [TestFlight](https://appstoreconnect.apple.com/teams/e8d6a5ef-6e91-4854-8870-9284daad587c/apps/6814013016/testflight)
- [RevenueCat Apple app](https://app.revenuecat.com/projects/44846925/apps/app0a95be48a9)

## Signing inventory

| Target | App Store profile | Portal ID |
| --- | --- | --- |
| `app.spotter.dev` | Spotter App Store | `X8N784FFS9` |
| `app.spotter.dev.share` | Spotter Share App Store | `MYLM5892J7` |
| `app.spotter.dev.widgets` | Spotter Widgets App Store | `QS8P9XBJRP` |
| `app.spotter.dev.watchkitapp` | Spotter Watch App Store | `2FHAFCGH9R` |

Certificate: Apple Distribution: Quarterdeck Collective LLC (`5L638CAQW2`), portal `NLZPYBR44V`, expires 19 September 2027. All four profiles downloaded successfully using Xcode’s Download Manual Profiles button.

The first unsigned-archive export produced a valid signature but omitted custom entitlements. It is not suitable for distribution. Release settings now support per-target manual profiles through the ignored `Distribution.local.xcconfig`; defaults remain automatic when no local override is supplied. The final archive was signed during the build, then exported and verified again.

Final package: `releases/apple/Spotter-1.0-1.ipa` (ignored binary). Archive: `/private/tmp/spotter-testflight/Spotter-Signed.xcarchive`. Verified version/build `1.0 (1)`, company team, no debugging entitlement, Apple sign-in, production APNs, correct shared app/keychain groups on the app/Share/Widgets, and HealthKit on Watch. All iOS configuration checks passed after the signing setup change. Native runtime source is the previously deployed build; these changes affect signing configuration.

Upload completed in Xcode Organizer at 10:11 PM America/Chicago on 19 September 2026. Background upload could not use the account, and the recommended automatic-signing flow failed on the Watch HealthKit profile. Custom App Store Connect upload succeeded using the existing distribution certificate and four manual profiles. The upload review showed the expected Apple sign-in, production APNs and shared-group entitlements. Uploading did not submit Beta App Review or publish the app; do not add this build to an external group or click Submit Review without the owner’s separate authorization.

## Primary references

- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple account deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Apple privacy details](https://developer.apple.com/app-store/app-privacy-details/)
- [Apple external beta testing](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/)
- [Supabase native Apple sign-in](https://supabase.com/docs/guides/auth/social-login/auth-apple)
- [RevenueCat Apple privacy guidance](https://www.revenuecat.com/docs/platform-resources/apple-platform-resources/apple-app-privacy)

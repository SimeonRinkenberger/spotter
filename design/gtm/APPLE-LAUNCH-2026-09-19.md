# Spotter Apple launch readiness

As of 19 September 2026, America/Chicago. **Prepared in App Store Connect; not ready for release or external beta invitations. Nothing submitted, released, or sent to testers.** This supersedes the Apple status and price assumptions in the September 17 GTM drafts.

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
| TestFlight | Spotter Internal QA group `7e5bf111-bf51-43c6-a7e1-af139565c1f3`; zero testers and zero builds; beta description, support contact, review login and detailed notes saved |
| Privacy | 13 data types, purposes, account linkage and no-ad-tracking answers saved as draft; URLs saved; final accuracy declaration / Publish awaiting owner approval |
| Sign in with Apple | Native capability enabled; dedicated sign-in key; Supabase provider enabled for `app.spotter.dev`; server token storage/revocation implemented and deployed |
| Push / shared data | Dedicated production APNs key scoped to main app; main, Share and Widgets share `group.app.spotter.dev`; Watch HealthKit capability enabled |
| Signing | Distribution certificate created in this Mac’s keychain; all four App Store profiles active in Apple Developer; local profile download/signing still blocked |

The review password and private keys remain in ignored local storage / their approved services, not in this document or Git.

## Work completed in the app

- Release signing settings and entitlements cover the iPhone/iPad app, Share extension, Widgets and Watch companion. Push uses the production environment for TestFlight/App Store.
- Apple’s one-time authorization code is bound to the authenticated Apple identity. Refresh tokens are stored server-side behind service-only database access and revoked during account deletion, with retry handling for failures.
- AI processing requires explicit permission before sending selected content or training context to OpenAI or Google. Settings lets people review or turn it off. Manual planning/logging remains available. Older clients are directed to the latest web app to manage permission.
- The annual price in the web billing setup source and relevant fixtures is $49.99; this does not mean live web checkout is configured.
- Changes merged in [PR 25](https://github.com/SimeonRinkenberger/spotter/pull/25) and [PR 26](https://github.com/SimeonRinkenberger/spotter/pull/26). Current main `3a6163a624700346d6103637b551bd7e9d1bbdb3`; release checks and Pages deployment succeeded. Matching backend deployed; Apple token-storage migration applied.

## Evidence and its limits

- All 27 GTM check groups and iOS configuration checks passed; GitHub verification and native parity checks passed.
- Release simulator build including Watch and an unsigned Release archive succeeded. These are build checks, not a signed distribution artifact or device acceptance test.
- Live synthetic-account checks passed: unauthenticated Apple grant rejected (401), non-Apple account rejected (403), signed-in clients denied access to the Apple token table (403), unconsented AI request rejected before inference (403).
- The live web app contains the new permission UI. Browser testing verified enable, reopen, revoke and persisted off state using the synthetic account, without sending training content to AI providers.
- Apple sign-in has **not** been verified end to end on a physical device. Hide My Email, cancellation, deletion/re-authorization, APNs delivery, native purchases, Watch/Health behavior and restore remain required checks.
- No signed `.ipa` uploaded. No App Store or subscription screenshots uploaded. No external beta group/public link can be considered ready.

## What is still needed

| Dependency | Next action | Why it remains |
| --- | --- | --- |
| Unlocked Mac | Owner unlocks; download the four manual profiles in Xcode, then sign/archive/export and upload the latest build | Native tools report Mac locked. Browser profile download did not yield a local file. Browser security policy rejected download-history inspection; no bypass attempted |
| Apple paid business setup | Owner accepts Paid Apps Agreement and completes tax/banking | Owner explicitly deferred this; needed for paid subscriptions |
| RevenueCat Apple credentials | Approve pending Spotter RevenueCat In-App Purchase key; create/download and save to the existing RevenueCat Apple app; verify credentials | Persistent Apple credential requires confirmation; final Generate is prepared |
| Store notifications | After credential approval, connect Apple’s production and sandbox notifications to the existing RevenueCat Apple endpoint and verify an event | Not yet saved/tested |
| Privacy declaration | Owner approves the completed 13-type accuracy declaration, then Publish privacy answers | Final legal declaration pending; this does not submit the app |
| Third-party content rights | Owner confirms necessary rights/permissions for supported source content before completing Apple’s declaration | Public availability alone cannot establish those rights |
| Current public pages | Sign in to WordPress; review and publish the prepared updates to the four existing page IDs | Live pages are older; drafts are prepared, not published |
| Device QA and media | Complete the linked beta plan; capture actual native screenshots and subscription review images | Mac/device access and signed build still needed |
| External beta review | Owner separately authorizes Beta App Review, then invitations after approval | Current instruction is do not submit; no invitations authorized |

RevenueCat also displays an unconfirmed account email notice. Owner should complete that email verification; no verification email was resent during this task.

## GTM status

Positioning: **Save the workout. Make it happen.** The launch copy follows the journey from saved video to reviewed card, a planned workout, logged sets and visible progress. Pumpy proposes changes for confirmation. Native copy includes the Share extension, Watch, widgets, Live Activities and reminders without claiming they are already available in the App Store.

Store copy uses $49.99/year and $6.99/month and states renewal/cancellation terms. It does not promise unlimited AI, universal trials, founding discounts, creator discounts or immediate App Store availability.

Google Play’s annual base plan still showed $50.00. It was corrected to **$49.99 for new subscribers**, and the console confirmed the save. No existing subscriber price migration was performed; Google keeps legacy subscribers at their existing price until explicitly migrated. The existing Google annual trial remains store-specific; no matching Apple trial was created.

The owned-domain homepage, privacy, terms and What’s New drafts are in `wordpress/drafts/apple-launch-2026-09-19/`. Update existing WordPress IDs `900001`–`900004` in place; do not reimport duplicates. Privacy and terms source changes under `docs/` are also unpublished working copies. Publishing them needs review of the actual text, not a claim of legal certification.

All four unpublished drafts were checked at a 375-pixel viewport: one H1 each, no horizontal overflow, privacy deletion anchor present. The preview is not the live WordPress theme; repeat the visual and anonymous-content check after publication.

Live billing check: `/api/billing/prices` returned `configured:false`. Stripe credentials are absent from backend secret names; web checkout is not ready. RevenueCat backend API and webhook-auth secrets are present (names checked without exposing values).

Live AI capacity check: shared daily budget **$0.50**, shared monthly budget **$10**; the synthetic Plus account reported **$1.50/month** AI allowance. These are existing beta safeguards, not an approved funded public-launch budget. Do not raise them automatically. Before inviting a cohort, the owner should agree a size that fits capacity and review spend/error/support signals daily.

Support and feedback use `business@quarterdeckcollective.com`; no customer email, invitation, announcement or support message was sent. Delivery into the inbox remains to be checked by the owner. No new monitoring automation was created.

See [Apple beta test plan](APPLE-BETA-TEST-PLAN.md) for device, purchase and activation checks, suggested cohort and ready-to-paste build testing notes.

See [Apple screenshot brief](APPLE-SCREENSHOT-BRIEF.md) for the capture order and subscription review images still required.

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

Certificate: Apple Distribution: Quarterdeck Collective LLC (`5L638CAQW2`), portal `NLZPYBR44V`, expires 19 September 2027. Profiles must be downloaded and installed before manual signing. The existing unsigned archive is not the final deliverable; build again with the latest synchronized assets and correct profiles.

## Primary references

- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple account deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Apple privacy details](https://developer.apple.com/app-store/app-privacy-details/)
- [Apple external beta testing](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/)
- [Supabase native Apple sign-in](https://supabase.com/docs/guides/auth/social-login/auth-apple)
- [RevenueCat Apple privacy guidance](https://www.revenuecat.com/docs/platform-resources/apple-platform-resources/apple-app-privacy)

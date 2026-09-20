# Spotter Apple beta test plan

Prepared 19 September 2026. This is the plan for the first signed TestFlight build, not a record of completed device tests. No invitations have been sent.

## Distribution boundary

The owner requested preparation only. Do not submit the App Store version, submit Beta App Review, enable a public beta link, or invite testers without a new instruction. The internal group **Spotter Internal QA** exists with zero testers and zero builds. External testing cannot be made invite-ready until the first build is uploaded and Apple’s applicable Beta App Review is approved.

## Internal checks before any external beta

Record the build number, device and OS, result, and a short reproduction for every failure. Use synthetic workouts and a disposable test account for destructive checks. Never delete the permanent Apple/Google review account.

| Test | Required result | Status |
| --- | --- | --- |
| Fresh install; email login; relaunch | Stable session, no blank screen, correct account library | Pending signed build |
| Sign in with Apple, Share My Email | New account works; name/email handled; relaunch preserves session | Pending physical device |
| Sign in with Apple, Hide My Email | Relay identity works; repeat sign-in does not duplicate account | Pending physical device |
| Cancel Apple sign-in | Returns to usable sign-in screen without a false success or crash | Pending physical device |
| Apple account deletion | Export first; disposable account only; revoke stored Apple grants, delete account data, require fresh authorization next time | Pending explicit deletion approval at test time |
| AI permission declined | Manual cards, library, plan and set logging work; AI requests stay blocked | Browser and server checks passed; native confirmation pending |
| AI permission allowed, then turned off | Choice survives relaunch; later AI calls blocked; existing workouts retained | Browser and server checks passed; native confirmation pending |
| Share extension | Share an owner-authorized TikTok/Instagram/YouTube link; correct account and no duplicate submission | Pending physical device |
| Workout journey | Save/review a card, manually correct exercises, plan a day, log a complete workout, see recap and progress | Pending native UI |
| Exercise bank and swaps | Manual bank selection works without AI; accepted AI swap changes only the selected exercise | Pending native UI |
| Pumpy proposed actions | Preview before applying; cancel leaves data unchanged; confirmed action survives relaunch | Pending native UI |
| Annual sandbox purchase | U.S. price $49.99/year; Plus granted in app and backend; allowances agree | Pending paid agreement, IAP key and signed build |
| Monthly sandbox purchase | U.S. price $6.99/month; correct duration and Plus access | Pending paid agreement, IAP key and signed build |
| Restore and account switching | Restore after reinstall; no Plus leak into a different Spotter account | Pending sandbox purchase |
| Renewal, cancellation, expiration, refund | RevenueCat/backend access follows sandbox events; cancellation explanation correct | Pending sandbox purchase and server notifications |
| Offline / poor connection | Saved state is not overwritten; retry and errors are understandable | Pending physical device |
| Widgets / Live Activity / Dynamic Island | Correct plan, current set/rest; completion clears active workout; logout removes previous account context | Pending physical device |
| Reminders | Permission denied path works; one production APNs reminder arrives from the TestFlight build | Pending TestFlight build; key is production-only |
| Apple Watch | iPhone starts workout; Watch shows exercise, logs set and controls rest; reconnect avoids duplicates | Pending paired devices |
| Optional Watch Health access | Denial does not block normal app use; allowed live heart rate stays on Watch; no Health workout saved | Pending paired devices |
| iPad | Navigation, sheets, keyboard, workout logging and purchase controls usable in both orientations | Pending native UI |
| Accessibility | VoiceOver labels/order, Dynamic Type, contrast, Reduce Motion and target sizes checked on advertised devices | Pending native UI |
| Permanent review account | Four synthetic workouts and complimentary Plus; no OTP, payment or Apple login required | Live email login passed; native confirmation pending |

## First beta cohort

Suggested starting cohort: 5–10 people who already save workout videos, including at least two Apple Watch users and one iPad user. This is a proposed cohort, not an imported tester list. Use private email invitations after the owner authorizes review and outreach. Do not share the permanent review login with testers; each tester uses their own account.

Start with Basic access unless an individual beta entitlement has actually been granted. Do not promise free Plus, an Apple trial, a creator discount, or a public invitation link before those are configured. TestFlight’s purchase environment is for testing, but the app’s AI service still incurs real costs.

### What to test — ready to paste into a build

Please try a complete workout: save a video you have permission to use, review and correct the exercises, add it to your plan, log sets and rest, finish the session, and check Train.

Try Sign in with Apple, closing and reopening the app, and the Share extension. In Settings, review AI processing, try declining it, and turn it off again after enabling it. Manual logging and planning should remain available.

If you use Apple Watch, start on iPhone, then log sets and control rest on Watch. Try widgets, Live Activities and optional reminders. Health access is optional.

Report bugs through TestFlight with your device, app version, steps, expected result and actual result. Remove private information from screenshots. AI may misread a video or give incorrect advice; review the workout before training.

## Feedback and beta exit

Owner: Simeon Rinkenberger. Feedback: business@quarterdeckcollective.com and TestFlight feedback. Before inviting anyone, verify delivery into the business inbox; no test message was sent during this setup.

For each tester record only the minimum needed: invitation accepted, first usable card, first completed workout, return workout, blocker, device/build and time spent resolving it. Use the existing operational records; no advertising tracker was installed.

Suggested exit gate: every critical flow above passes on the signed build; no unresolved sign-in, billing, deletion or data-loss defect; five testers complete a workout and at least three return for another. The owner approves spending capacity and launch timing separately. These are proposed gates, not achieved results.

Apple reference: [Invite external testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/).

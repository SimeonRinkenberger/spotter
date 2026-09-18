# Native launch readiness — 17 September 2026

Status: local source fixes and checks completed; physical device, sandbox-store, and published-price gates remain open. Nothing was deployed, installed on a device, signed, or submitted to a store during this pass. No paid AI calls were made.

## Changes

- iOS measures video duration from the decoder before considering page metadata. Invalid/out-of-range returned timestamps cannot count toward a completed capture.
- Both platforms require every scheduled sample to decode, while allowing deduplication. An interrupted prefix or a partially uploaded set is discarded and the existing server fallback is used. Oversize JPEGs remaining after the second encode are rejected locally.
- Native frame manifests carry `evidence.version: 3`, `sampling: sparse_uniform`, counts, and `sampling_complete`. Completion means the scheduled sparse samples were decoded, **not** that every frame or exercise was observed.
- iOS reports actual returned frame timestamps; `timing_uncertainty_s: 0` describes the frame PTS only, never an exercise boundary. Android still uses nearest keyframes, reports `timestamp_basis: requested_nearest_keyframe` with unknown (`null`) timing uncertainty, and burns an approximate `~` prefix into labels. Both platforms retain tenths of seconds in labels and full floating-point values in the manifest.
- The native subscription adapter invalidates queued requests immediately on sign-out, rejects stale in-flight offerings/results, clears cached packages between identities, and recovers after cancellation. UI and server synchronization also require account fences; the root implementation handles those separately.

## Completed validation

| Check | Result and limit |
|---|---|
| `npm run ios:check` | Passed: native shell, workout completion/background drafts, keyboard, streaming, share credentials, sheet arithmetic, Google and Apple auth harnesses. Uses existing packaged assets; final release assets must be regenerated after all source changes. |
| `node tools/android/sheet-check.mjs` | Passed: Java arithmetic matches shared spec and Swift, including decimal labels. |
| `node tools/ios/purchases-check.mjs` | Passed with controlled SDK: prices, identity changes, cancellation recovery, restoration, in-flight offering and queued purchase/restore invalidation, subsequent account recovery. Does not prove store configuration. |
| `node tools/ios/sheet-regression.mjs` | Passed against real UIKit/AVFoundation in an already booted iOS simulator using a generated local video: stale duration hint, coverage endpoints, byte cap, expired capture rejection. No network, upload or model. Requires ffmpeg and booted simulator. |
| `node tools/ios/build-simulator.mjs` | Unsigned simulator build succeeded after final Swift change, including Share Extension. |
| `node tools/android/build.mjs --offline assembleDebug lintDebug testDebugUnitTest` | Build/lint/unit task succeeded. Existing Android unit suite includes template tests; no claim of physical decoder coverage. |

Compiler cache and local Gradle socket access required approved sandbox escalation. Build logs are `/private/tmp/spotter-native-gtm-ios-build.log` and `/private/tmp/spotter-native-gtm-android-build.log` and are temporary.

## Required release gates

1. Regenerate native assets and rebuild after all application/backend integration edits; verify `frames.evidence` survives validation and reaches the visual reader. Release backend support before clients begin sending version 3.
2. Test on physical iOS and Android: cold import, interrupted network, short/long clips, rotations, app suspension, share extension memory pressure, failed page uploads and account switch during processing. Record capture success, bytes, latency, peak memory and fallback rate.
3. Complete sandbox purchase/restore tests with store test accounts: new subscription, cancellation, pending/deferred purchase, expired entitlement, offline completion, reinstall/restore, switch Spotter accounts during purchase and restore. Confirm the configured RevenueCat transfer policy intentionally handles the same store purchase across two Spotter accounts.
4. Verify the actual published **$50/year** product and localized prices, storefront availability and monthly alternative in Apple/Google and RevenueCat offerings. Repository price configuration cannot change native store pricing. No live store price or entitlement mutation occurred here.
5. Walk the complete first workout journey on both platforms: import, review source/AI recommendations, correct, save, start, finish, return; verify Basic versus Plus/preview labels and allowance, purchase restoration, subscription management, privacy/support and deletion access.

## Remaining tradeoffs

Rejecting incomplete capture can increase full-video fallbacks and cost, especially with the existing eight-second pipeline budget. Track this before broad exposure; this is a correctness fix, not a demonstrated cost saving. Deduplication and successful sparse sampling still cannot prove exercise completeness. Android exact decoded PTS, global-first sampling, local motion segmentation, cross-page deduplication, byte-bounded remote retrieval and energy profiling require later measured work. No universal timing bound is assigned to Android's nearest-keyframe decoder.

An uploaded prefix rejected by the client may leave unused private sheet objects; verify storage lifecycle cleanup before scaling. Existing fallback/admission must remain budget bounded. A passed simulator compile does not establish battery life, extension survival, storefront approval or customer demand.

Final integration update: regenerated assets were copied locally to both platform public directories, all 17 packaged assets matched, and both unsigned iOS and offline Android assemble/lint/unit builds passed afterward. Logs: `/private/tmp/spotter-final-ios-build.log` and `/private/tmp/spotter-final-android-build.log`. An ignored duplicate `config 2.xml` resource was preserved outside the Android resource tree to remove an invalid filename build blocker.

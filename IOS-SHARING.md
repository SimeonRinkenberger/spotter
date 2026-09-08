# Native incoming sharing

Added September 7, 2026. The app embeds a real UIKit `ShareExtension.appex`, enabled
for web URLs and shared text, including mixed thumbnail/link payloads. Users install the app and sign in normally;
there is no Shortcut setup. Select Spotter in the system share sheet to save. iOS
controls ordering/favorites, and a source app may require choosing More to reach
the system sheet. App Store publication is not required for development testing.

## Implementation

- `ShareExtension/ShareViewController.swift` reads URL, plain-text and attributed-text
  providers. It extracts HTTP(S) links from captions, deduplicates them, and rejects
  ambiguous multiple-post shares instead of silently picking a post. It does not
  accept photos or movie files; use the main app's upload flow for those.
- `Shared/ShareCredential.swift` shares only the per-account ingest key in Keychain,
  accessible while unlocked, restricted to this device. Both targets use
  `$(AppIdentifierPrefix)$(SPOTTER_BUNDLE_ID)`. No credentials in URLs or shared
  preferences. HTTPS is fixed to the Spotter ingest endpoint; redirects are refused.
- `ShareAccess.swift`, `native/share-access.js` and the profile lifecycle synchronize
  the key after profile load/rotation and clear it at sign-out/account change and
  native boot (including a Keychain item surviving uninstall). Writes are serialized.
  Existing auth sessions remain in the app's Preferences storage as before.
- The extension saves directly through `POST /api/ingest`. The backend owns URL
  safety, redirect checks, deduplication, account limits and durable processing.
  Only `saved`, `processing`, or `exists`, a successful HTTP response and a library
  item ID produce success. Offline/timeouts offer retry, with no false completion.
  Closing cancels the request locally; a server save already accepted can persist.
- The parent app's existing foreground refresh updates the library on return.
  The extension has no app-launch hacks, App Group or background entitlement.
- Native Settings replaces the Shortcut disclosure with share-menu instructions.
  The optional advanced Shortcut remains available to browser-only users.

## Sources and limits

TikTok (including short links/photo posts), YouTube (watch/Shorts/youtu.be), and
Instagram use existing dedicated readers. Public Facebook reels/posts/videos and
other public social links use the generic web reader. The extension does not filter
by app/host, so X, Reddit, Pinterest, Threads, Snapchat, Vimeo, Strava and others can
supply links. Their private/login-only/deleted content and complete exercise
extraction are not promised. Actual source-app share payloads need device testing;
fixture coverage is not live verification of every social app.

## Verification

- `npm run ios:sync`: passed.
- `npm run ios:build`: unsigned Debug simulator build passed, app contains the
  extension and Xcode validates the embedded extension.
- `npm run ios:check`: existing keyboard/stream/timer checks and new sharing checks
  pass. Native activation predicates also pass for URL/text plus thumbnail/file
  payloads and reject image/movie-only shares. These conformance checks need access
  to macOS's registered content types (run outside the restricted sandbox).
  New tests exercise 17 URL forms and caption payloads, unsafe URL forms,
  multiple links, deduplication, response interpretation and serialized account
  changes including failure recovery.
- `node tools/test-share-platforms.mjs`: passes 20 backend routing fixtures,
  short-link redirects, Facebook content links, profile rejection and private
  address redirects. Network is mocked; this is not live extraction testing.
- `deno check supabase/functions/spotter/index.ts`: passed after correcting three
  existing type-only issues (nullable Instagram caption, UUID predicate narrowing,
  Node/Deno timer type). Existing normalizer and all 90 confidence checks pass.
- September 8: verified in Safari on the iPhone 17 Pro simulator (iOS 26.2).
  Spotter's name and parent-app icon appear directly in the system share-sheet
  app row, before More, without enabling it or editing favorites. Selecting
  Spotter for `about:blank` launches the native view and shows the expected
  no-video-link message. Cancel returns to Safari. No video was saved in this test.
- Restored the missing Xcode project workspace contents file. After restarting
  the stalled Xcode process, the project and both targets open normally.
- September 8: the owner signed into Xcode and connected the iPhone by cable.
  Apple created the `.share` development provisioning profile. Both command-line
  and Xcode builds then failed while signing the extension: `errSecInternalComponent`.
  Security diagnostics identify `CSSMERR_CSP_OPERATION_AUTH_DENIED` when using
  the existing signing key, including an integrity-check failure. Keychain Access
  confirms the certificate is valid. The owner attempted creating a new
  development certificate through Xcode, but Apple refused; none was created.
  Retried the exact September 7 successful command, connected-phone destination,
  certificate, and `/private/tmp/spotter-iphone-device` build location. It failed
  with the same signing error. Signing a temporary copy of the main app's dylib
  with the same certificate also failed, independently of the extension.
  Logs: `/tmp/spotter-share-yesterday-method.log` and
  `/tmp/spotter-share-install-device.log`. No certificate was revoked, exported,
  or changed; no Keychain access controls or trust settings were changed.
- September 8, 09:14 CDT: restarting the Mac resolved the signing error. The
  existing certificate signed both targets successfully; Xcode validated the
  embedded extension, and `codesign --verify --deep --strict` passed. Build log:
  `/tmp/spotter-share-after-restart.log`. Installed over the existing app on the
  owner's iPhone 15 using devicectl, retaining the same bundle ID and data.
  Opened the updated native process through Mirroring and confirmed the signed-in
  library still has its nine workouts. No replacement certificate was needed.
- September 8, 09:20 CDT: verified on the owner's actual iPhone 15 in TikTok.
  TikTok's own first panel still ends with More and does not include Spotter.
  Opening that More entry presents Apple's system share sheet. After horizontally
  scrolling its app row, Spotter appears directly beside Gemini and Outlook,
  before the system sheet's own More button. No favorites or extension-enable
  settings were edited. Mirroring's automated scroll did not move these rows;
  the owner swiped them and the visible results were inspected through Mirroring.
  The user's requirement to appear in TikTok's initial custom panel is not met.
- Actual server saving and physical-device cross-process Keychain access are
  still unverified. No real video was submitted during this appearance check.

## Source-app placement

The native extension registers Spotter with Apple's share sheet. It does not
register an item in TikTok's separate, custom first panel. The observed row that
contains Gemini is the system share sheet, where Spotter now also appears.
Apple documents that apps cannot set share-sheet app ordering:
https://developer.apple.com/documentation/xcode/defining-a-custom-url-scheme-for-your-app
TikTok's public Share Kit sends media into TikTok; it does not document registering
an outbound destination in TikTok's own first panel:
https://developers.tiktok.com/docs/en/share-kit-ios-quickstart-v2
No supported integration for controlling that panel was found in the public
developer documentation. Do not promise that additional Spotter code, URL schemes,
or publishing to the App Store will guarantee that placement.

## Finish device verification

1. Share a TikTok short link, YouTube watch/Shorts and Instagram Reel using each
   app's system share sheet. Verify Spotter appears, saves once, and the library
   updates. Test warm/cold app states, duplicate share, offline/retry and cancellation.
2. Verify sign-out prevents new shares to the old account, account switching directs
   saves to the new account, and rotating the key updates extension access. Test
   Dynamic Type/VoiceOver and an iPad sheet before distribution.

Backend Facebook routing requires deploying the updated Edge Function. Deployment
was attempted but the CLI has no Supabase management access token (`supabase login`
is required). No backend deployment occurred. Native sharing for the previously
supported providers uses the existing endpoint.

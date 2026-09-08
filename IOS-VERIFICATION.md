# iOS verification — 7 September 2026

## Global keyboard smoothing follow-up

- Kept the web design and system iOS input for every field. Ordinary fields use
  the normal keyboard without the form accessory; number/date fields and
  multiline forms retain Done. Small fields are enlarged on focus to avoid zoom.
- Matched all native backing surfaces, including the window and under-page
  background, to the web app's dynamic light/dark paper colors. Removed the old
  beige native configuration color.
- Added UIKit frame-duration/curve events for internal page/composer/sheet
  clearance, stable tab measurements during typing, fading/inert navigation,
  late-event protection and reduced-motion handling. UIKit still owns resizing.
- Native checks pass, including rapid refocus, timing, all input types, no focus
  scroll reset and Send focus. Pumpy 46/46 and transition 11/11 checks pass.
- Simulator launched with the unchanged Library design. Further interaction
  returned noWindowsAvailable from computer use, including after reconnecting,
  so this revision's motion, dark-mode transitions and cross-screen typing are
  not visually verified. Physical animation and haptics still need phone testing.
- Build logs: /tmp/spotter-keyboard-global-simulator.log and
  /tmp/spotter-keyboard-global-device.log.
- Final signed build and signature verification passed; installed successfully
  over the existing development app on the paired iPhone 15.

## Current revision: web appearance restored

- Per the owner's correction, removed the separate UIKit chat, tabs and set
  editor. Restored the web app's Pumpy artwork/bubbles, bottom navigation,
  transitions, set sheet and Inter/Cabinet typography.
- Kept UIKit keyboard layout, native visibility notifications, Send focus,
  context-sensitive accessory bars, incremental URLSession transport, haptics,
  storage, sharing and lifecycle improvements.
- Simulator iPhone 17 Pro / iOS 26.2: verified original bottom bar and Pumpy
  conversation, multiline unsent typing, composer above the software keyboard,
  no chat form toolbar, keyboard closure restoring navigation, and history
  opening/closing over the intact conversation. Test draft was cleared without
  sending; no account records were changed.
- Native checks passed, Pumpy harness 46/46, transition harness 11/11,
  generated-page parity and diff whitespace checks passed. Simulator and signed
  iPhone builds succeeded; codesign verification passed.
- Build logs: /tmp/spotter-web-style-simulator-build.log and
  /tmp/spotter-web-style-device-build.log. No paid model calls or backend deploy.
- Installed the signed update over the existing app on the paired iPhone 15.
  The first connection dropped; retry succeeded. Physical keyboard feel and
  Taptic Engine output remain for on-phone evaluation.

## Superseded native redesign pass

- Real UIKit tabs, Pumpy conversation/composer, and numeric set-entry sheet are
  implemented. See IOS-REDESIGN.md for architecture, tested interactions and
  remaining web-rendered screens.
- With explicit owner authorization, signed into the permanent fixture account.
  Verified existing history, multiline unsent input, software keyboard clearance,
  native set presentation, replacement typing, stepper behavior and Cancel.
  No set/log or chat message was saved; empty test workouts were exited.
- Local DEBUG preview verified incremental response rendering, Send preserving
  keyboard focus, and interactive keyboard dismissal. No model call was made.
- Native checks passed; existing Pumpy and transition checks passed (46 + 11).
  Updated their isolated web environments to include native-disabled sync.
- Simulator and signed iPhone builds succeeded. Signature verification passed
  using normal system trust-store access. Installed the development update over
  the existing app on the paired iPhone 15. Launch was denied because the phone
  was locked; open Spotter after unlocking. Hardware haptics and physical-device
  animation feel remain unverified. The owner previously confirmed the earlier
  app was running, so initial developer-profile trust is no longer the blocker.
- Logs: /tmp/spotter-native-final-build.log and
  /tmp/spotter-native-device-build.log. No production deployment or paid AI calls.

## Earlier implementation and verification

- Initial git status was clean. The existing three-template build is retained;
  generated web and Edge Function pages remain byte-identical. Backend code,
  configuration, secrets and production deployment were not changed.
- Xcode 26.2 (17C52), iOS 26.2 SDK/runtime, iPhone 17 Pro simulator. First-launch
  check succeeded. User completed administrator-only xcode-select switch; verified
  active developer directory is `/Applications/Xcode.app/Contents/Developer`.
- Capacitor 8.5.1/Swift Package Manager project generated and synced. **Simulator
  Debug build succeeded**, installed and launched. **Generic physical iPhone SDK
  build also succeeded with code signing disabled**; this is not device deployment.
- Opened the actual Spotter project via Xcode's UI and inspected Signing &
  Capabilities: automatic signing is on. After user account sign-in, selected the
  available Personal Team for Debug and verified Xcode resolves it from the ignored
  Local.xcconfig. Release remains separate. Simulator destination is iPhone 17 Pro.
- Simulator UI: light/dark landing and status-bar appearance; password login,
  library and workout detail; save a set, rest countdown, workout summary; Plan,
  Progress/history and Pumpy landing; software-keyboard composer stays visible;
  external What's New opens in native browser and dismisses back to Spotter.
- Backgrounded during a 60-second rest: foreground showed the elapsed remainder,
  not a restarted timer. Force-close and reinstall over existing app preserved
  login and draft; resumed draft retained the set and original start time.
- Finished workout wrote a real fixture log: backend GET confirmed 301 seconds,
  one completed set of 10 reps. Progress reflected that session.
- Native share sheet displayed generated workout PNG (235 KB). Dismissed without
  sending anything externally. Third-party delivery and Save to Photos/Files were
  not exercised. Cancellation mapping and download-to-share fallback implemented.
- Native haptics preference gate, missing-web-hardware fallback, paused/deadline
  timer logic and exactly-once expiry checked with deterministic tests. Added guard
  and regression check preventing background events from resurrecting completed
  workout drafts. Immediate workout clock paint avoids a transient 0:00 on resume.
- Removed native Home Screen install hint found during UI testing. Native reminders
  explain their unavailable status. Native OAuth buttons explain email/password
  fallback; email/billing/share return URLs use the existing HTTPS web destination.
- `npm run build`, `npm run ios:sync`, `npm run ios:check` passed.
  Existing Pumpy harness: **46 checks passed** (includes web/generated-page parity).
  Existing service-worker harness: **7 checks passed**. `git diff --check` passed.
  npm audit after narrow xcode→uuid override: **0 vulnerabilities**.
- Disposable `iosdev260907` account signed out; helper deletion returned 200 and
  cascaded the fixture/log. Owner's permanent test account was not modified.

Compiler/test logs are retained locally under `.native-build/verification/` (ignored).

## Not verified / remaining

- **Personal Team configured and iPhone paired.** Initial provisioning was blocked
  by the missing device. Once connected, Xcode pairing stalled after Trust; retrying
  with Apple devicectl completed pairing. Xcode then copied shared-cache symbols
  from the iPhone 15 running iOS 26.6.1 and created a managed development profile.
  The signed iPhone build succeeded outside Desktop after Finder metadata in
  generated Desktop build output blocked codesign. devicectl installed the app
  successfully. Initial launch was refused by iOS security; developer-profile trust
  on the phone is the remaining step. Hardware haptics are still unverified. Team and development bundle ID live only in ignored Local.xcconfig;
  the shared project contains no machine-specific team ID. Release has no team.
- Phone pairing, provisioning and installation are complete. App signature verified
  with codesign using normal system keychain access. Launch awaits on-device
  developer-profile trust; Taptic Engine output, real-device keyboard/wake behavior
  and background cues remain unverified.
- No AI extraction or paid coach calls made. Coach tab/navigation tested, not a
  streamed model response. Pumpy now uses incremental URLSession transport;
  adapter tests verify early delivery, split Unicode, cancellation, errors and
  JSON refusals. Haptic tests cover throttling, preference and visibility gates.
  Actual model delivery and Taptic Engine feel still need on-device verification.
- UIKit keyboard-layout follow-up: simulator build and ios:check pass. Installed
  and launched on iPhone 17 Pro / iOS 26.2 simulator; exercised software keyboard
  opening, Done dismissal and refocusing the sign-up email field. The focused
  field remains visible and the full-height screen returns after dismissal.
  No unsatisfiable-constraint or app-termination messages appeared in the runtime
  diagnostic check. Contextual chat/number-pad toolbar behavior has regression
  coverage; signed-in chat, interactive dismissal within web overflow scrollers,
  older iOS versions, floating iPad keyboards and physical-device animation feel
  still require device verification. This is a hybrid app, not a UIKit rewrite.
- Email confirmation/password-reset round trips, social login, purchases, Strava
  authorization, media uploads, offline network failures, third-party video embeds,
  real device sharing and account export delivery were not exercised end-to-end.
- Native session storage is UserDefaults, not encrypted Keychain storage. Existing
  offline library cache is not an offline write queue. Cold restart restores regular
  rest deadlines; timed exercise/circuit callback state restarts idle.
- Share-in extension, HealthKit, Live Activities, notifications, native Apple/Google
  sign-in and StoreKit/distribution integration are deferred. They are not placeholders
  presented as working integrations; see IOS-SETUP.md for engineering/entitlement scope.
- Minimum iOS 15, iPad, landscape, large Dynamic Type and reduced-motion native UI
  were not separately exercised. Existing web accessibility/reduced-motion code retained.

Nothing was published, uploaded to App Store Connect, enrolled, or purchased.

## Native Share Extension — September 7, 2026

See [IOS-SHARING.md](IOS-SHARING.md) for implementation and verification. The app
embeds and validates the extension in a passing simulator build; 17 native link
formats, account-key sequencing and 20 backend route fixtures pass. Backend type
checking and existing normalizer/confidence checks pass. On September 8, verified
Spotter directly in Safari's simulator share-sheet app row, without editing
favorites, and exercised native no-link handling and cancellation. After Xcode
sign-in and a Mac restart, the existing certificate signed both targets and
devicectl installed the app plus extension on the iPhone 15. The signed-in library
loaded with its nine workouts. See IOS-SHARING.md for physical share-menu and
cross-process Keychain verification status. Facebook backend deployment remains
blocked by missing Supabase CLI login.

## Pumpy keyboard dismissal — September 7, 2026

Keep the resting bottom navigation clearance frozen through native dismissal,
including the interval where keyboardVisible is already false but the WebView
safe area has not settled. The bridge emits one keyboard-settled event and the
app remeasures after the transition. Rapid refocus cancels stale cleanup.
Keyboard regression checks pass for transient bar heights, refocus, final
safe-area reconciliation and the existing input/accessory behavior. Native assets
were rebuilt. Visual smoothness on the physical iPhone remains unverified until
the signing/install blocker recorded above is resolved.

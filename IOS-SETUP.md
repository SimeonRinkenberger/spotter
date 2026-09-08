# Spotter iOS development

This is a local development app, not an App Store submission. It packages the same
frontend built by `build.mjs`; the web deployment and backend are unchanged.

## Build and run

Requirements: Xcode 26+ (this Mac: 26.2, iOS SDK/simulator 26.2), Node 22+ (this Mac:
26.7), npm. Capacitor core/CLI/iOS are pinned to 8.5.1; official plugins and Supabase
are pinned in package-lock.json. Swift Package Manager resolves native dependencies;
CocoaPods is unnecessary. Minimum iOS is 15; verification is on 26.2 only.

From this directory:

```sh
npm ci
npm run ios:sync     # build web, package assets, sync plugins and native project
npm run ios:check    # haptics/timer/packaging checks
npm run ios:build    # unsigned iPhone simulator Debug build
npm run ios:open     # open ios/App/App.xcodeproj in Xcode
```

Select scheme **App**, an iPhone simulator, then **Product → Run** (⌘R).
The command-line build is `.native-build/Build/Products/Debug-iphonesimulator/App.app`.
`ios:build` uses installed Xcode explicitly if DEVELOPER_DIR is unset. The system
selection should also be `/Applications/Xcode.app/Contents/Developer`.

There is no live server URL, HTTP exception, or live-reload configuration. Web assets,
Supabase SDK, native bridge, icon and Pumpy assets are packaged in `native-dist` and
copied to `ios/App/App/public`. These generated directories are ignored. Do not
point production configuration at GitHub Pages or a development server. A future
live-reload config must be a separate, explicitly opt-in development configuration.

## Personal Team and your iPhone

On this Mac, Apple Account sign-in and Debug Personal Team configuration are complete.
The ignored Local.xcconfig is populated with the selected team and development bundle
ID. The iPhone has now paired and Xcode has created its managed development profile.
The owner confirmed the app runs on the phone. The current direction restores the
web appearance while keeping native keyboard, streaming and haptic support; see
IOS-REDESIGN.md. Unlock and open Spotter after installation. Mac codesign keychain access was
authorized by the user. If a future build reports resource-fork/Finder-metadata
errors, keep Derived Data outside Desktop (Xcode’s default location is suitable). Steps 1–2 are for a fresh checkout/Mac.

1. In Xcode → Settings → Apple Accounts, sign in to your existing Apple Account.
   Select its **Personal Team** for this local build. Do not create another paid account.
2. Copy `ios/App/Local.xcconfig.example` to `ios/App/Local.xcconfig`. Put the Personal
   Team ID from Xcode in DEVELOPMENT_TEAM and a unique development identifier, such
   as `app.spotter.yourname.dev`, in SPOTTER_BUNDLE_ID. This file is ignored and only
   included by Debug. Keep **Automatically manage signing** enabled on target App.
   Xcode may write team IDs directly into project.pbxproj if you select a team in the
   editor: move that local value into Local.xcconfig and remove the inline value before
   committing. No team or certificate is supplied in the shared project.
3. Connect and unlock your iPhone. Accept **Trust This Computer** on the phone (and
   Mac accessory access if prompted). Developer Mode is already enabled.
4. In Xcode select your iPhone as the destination, wait for pairing/device support,
   then press ⌘R. Allow Xcode to register it and create the development profile.
5. If iOS requests it, trust the development app in Settings → General → VPN &
   Device Management, then launch again. Keep the phone unlocked during installation.

Xcode cannot finish device registration/provisioning or validate installation until
it sees a paired device. It also cannot select a Personal Team before account sign-in.
A simulator build needs neither signing nor a paid membership.

Free provisioning expires seven days after issuance. Reconnect the phone, run
`npm run ios:sync`, open Xcode, select the same Personal Team, bundle ID and phone,
and press ⌘R to refresh signing and reinstall. Install over the existing app to retain
its sandbox; uninstalling removes local storage and unsynced workout drafts.

After organization approval, select the organization account/team, choose the final
registered bundle identifier for Release, and configure distribution signing and
capabilities deliberately. Keep Personal Team values confined to Local.xcconfig.
A different bundle identifier is a separate app/sandbox: sign in again; local drafts
do not migrate. Review App Store privacy disclosures, IAP/StoreKit, social sign-in,
associated domains, extensions and entitlements before archive/distribution.
Nothing in this setup uploads, publishes, enrolls, or purchases anything.

## Native behavior and boundaries

| Area | Current behavior |
| --- | --- |
| Authentication | Email/password uses existing Supabase auth. Sessions persist with native Preferences; refresh stops in background and starts on return. This is app-sandbox UserDefaults, **not Keychain encryption**. Consider Keychain-backed storage before distribution. |
| Email links | Confirmation/reset completes at the existing HTTPS web app; return and sign in with the resulting password. Native OAuth, universal links and custom-scheme auth callbacks are deliberately not claimed. Google/Apple buttons explain the development limitation. |
| Networking | This app's HTTPS Edge Function requests use native transport: Pumpy chat uses PumpyStream, other requests use CapacitorHttp. The deployed browser-origin allowlist remains intact. Auth, database, WebSocket Realtime, uploads and media retain browser networking. ATS stays enabled. |
| Streaming | PumpyStream forwards URLSession bytes incrementally into the existing NDJSON reader. Both scene and storyboard entry points register the plugin. Abort/reader cancellation cancels the native task; this does not undo server writes or refund AI work. No backend deployment is required. |
| Persistence | Native session and workout draft use Preferences; existing library cache/UI preferences retain localStorage and account-backed settings. Cache is not an offline database. Offline writes are not queued. No secrets are bundled from .env.local. |
| Haptics | Existing haptic(kind) maps tap/success to impact and PR/done to notification feedback. Pumpy text deltas trigger light impacts at most once every 90ms while the chat is visible with no overlay. Existing Vibration preference controls every call; failures are nonfatal. Simulator cannot verify Taptic Engine output. |
| Lifecycle/timers | Session clock uses startedAt, rest uses absolute deadlines. Foreground reconciles elapsed time, never assumes background ticks. Drafts preserve sets and ordinary rest deadlines, including paused rest. Timed exercise/circuit callbacks restart idle after process death; unseen sets are not automatically logged. No background execution entitlement or lock-screen cue is promised. |
| Links and sharing out | HTTPS links open in a dismissible native browser, including help/billing/Strava handoffs. Existing share/export flows use native Share with temporary cache files (25 MB cap), cleaned after completion. Saving exported files/sharing to third-party apps needs device verification. |
| Layout | SpotterViewController hosts the original web interface above UIKit's keyboardLayoutGuide. Capacitor Keyboard resize is none: do not re-enable its delayed frame writes alongside Auto Layout. The guide handles docked keyboards and rotation; floating iPad keyboards do not collapse the app. iOS 15/16 compensate for the guide's resting safe area, iOS 17+ use usesBottomSafeArea=false. Pumpy hides form-navigation accessories; other forms retain Done/Next. The web app's Inter/Cabinet typography, Pumpy layout, navigation and set sheet are retained. Status text follows color scheme. Home Screen install prompt is suppressed. |
| Service worker | Never registered in native build; normal web service worker remains intact. Native notifications are explicitly unavailable, not a web push setup prompt. |
| Permissions | No camera, microphone, photos, HealthKit, notifications, tracking, background-mode or associated-domain permissions requested. System file/share pickers do not imply broad library access. Required-reason manifest declares app-owned UserDefaults/file timestamps. |

## Native incoming sharing

The project now embeds a UIKit Share Extension. See [IOS-SHARING.md](IOS-SHARING.md).
Both targets need development signing and the same Keychain access group. This
shares only the existing save key; it does not require an App Group. The new
extension needs its own provisioning profile, with bundle ID
`$(SPOTTER_BUNDLE_ID).share`. The signed app and extension were installed over the
existing iPhone app on September 8, 2026. Account sign-in created the extension
profile; restarting the Mac resolved a temporary Keychain signing failure with the
existing certificate. This is developer setup, not end-user setup.

## Planned integrations, not completed features

- **HealthKit:** follow `briefs/R-HEALTH-REPORT.md`: a first-party Swift workout writer,
  explicit authorization, accurate workout data, capability and purpose strings.
  Confirm team capability eligibility; none is enabled in this development app.
- **Live Activities:** ActivityKit/WidgetKit extension, native lifecycle/deadline state,
  lock-screen presentation and device testing. Push updates additionally require APNs.
- **Notifications:** local permission/scheduling/cancellation engineering, or APNs
  entitlement/backend/token lifecycle for remote notifications. Existing web push
  subscriptions do not become native notifications. Organization setup is needed for
  distribution/APNs provisioning; local scheduling is a separate engineering task.
- **Apple/Google sign-in:** native authentication session/token bridge, provider and
  Supabase configuration, nonce/PKCE and cold/warm callbacks. Apple capability and
  distribution setup follow organization approval. Existing Apple JS code is web code.
- **Store distribution:** native purchase/restore/entitlement integration and policy
  review remain separate. Existing web Stripe flows are development-only here.

See IOS-VERIFICATION.md for what was actually exercised, including limitations.

## Sources checked

- [Capacitor environment](https://capacitorjs.com/docs/getting-started/environment-setup):
  Capacitor 8, Node 22+, Xcode 26+, recommended Swift Package Manager.
- [Haptics](https://capacitorjs.com/docs/apis/haptics),
  [App lifecycle](https://capacitorjs.com/docs/apis/app),
  [native HTTP](https://capacitorjs.com/docs/apis/http),
  [Share](https://capacitorjs.com/docs/apis/share),
  [Filesystem](https://capacitorjs.com/docs/apis/filesystem),
  [Preferences and privacy manifest](https://capacitorjs.com/docs/apis/preferences).
- [Apple signing workflow](https://help.apple.com/xcode/mac/current/en.lproj/dev60b6fbbc7.html),
  [device deployment](https://help.apple.com/xcode/mac/current/en.lproj/dev5a825a1ca.html),
  [Personal Team expiry](https://developer.apple.com/help/account/basics/about-your-developer-account).
- [Apple launch guidance](https://developer.apple.com/design/human-interface-guidelines/launching):
  simple launch presentation; no artificial launch delay.

The xcode build tool's uuid dependency is overridden to 11.1.1 to resolve
GHSA-w5hq-g745-h8pq. xcode uses the compatible v4 API; project parse and build are
verified. Reevaluate this narrow override when upgrading Capacitor CLI.

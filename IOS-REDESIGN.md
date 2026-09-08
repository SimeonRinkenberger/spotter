# Web appearance with native iOS support

The owner's revised direction is to keep the installed app looking exactly like
Spotter's web app, while using Apple APIs to improve keyboard and platform
behavior. The separate UIKit visual redesign has been removed.

## Restored

- Original Pumpy artwork, greetings, conversation bubbles, composer, history,
  proposal cards and new-chat transitions.
- Original bottom navigation, icons, selected state and swipe transitions.
- Original set-entry sheet, controls, colors and typography.
- The same Inter and Cabinet Grotesk stylesheets as the web app. The existing
  system-font fallbacks apply if the font hosts are unavailable.

The native chat controller, tab bar, set editor, preview and UI-state bridge are
removed from the Xcode target and source. The shared web markup and styles are
visible again without an alternate native presentation.

## Retained native support

`SpotterViewController` still hosts WKWebView against UIKit's keyboard layout
guide, with Capacitor's delayed resizing disabled. Keyboard notifications control
visibility; the app avoids a second resize and repeated focus-scroll resets.
The web composer retains focus when Send is tapped, follows keyboard/multiline
size changes when the reader is at the bottom, and suppresses the web-form
accessory bar for ordinary text, search, email, URL, password and chat inputs.
Number/date fields and multiline forms retain Done/Next. Small focused text is
raised to 16px to avoid iOS focus zoom; larger input typography is preserved.

Keyboard-frame notifications now supply duration and curve to the internal
composer/form clearance transitions. They also supersede late Capacitor show/hide
callbacks during rapid refocus. The keyboard layout guide remains the only owner
of outer resizing. Native viewports use 100% of that frame, and tab clearance is
held stable while the keyboard is open. Hidden tabs are inert. Reduced-motion
preferences disable the added web transitions. The window, host, WKWebView,
scroll view and under-page backgrounds match the shared light/dark paper colors.

This follows Apple's [keyboard layout guide](https://developer.apple.com/documentation/uikit/uiview/keyboardlayoutguide)
for frame ownership; the internal spacing synchronization is our integration
with the existing web design, not a replacement keyboard or native UI redesign.

Pumpy still receives incremental URLSession bytes through `PumpyStream`, instead
of buffering the entire response. Throttled native haptics remain controlled by
the existing Vibration preference and chat visibility. Native session storage,
drafts, rest deadlines, browser and share support remain in place.

## Verification

`npm run ios:check` covers keyboard lifecycle/focus, native streaming, Unicode,
cancellation, haptic gates, rest deadlines and packaging. Existing Pumpy and
transition harnesses verify the restored shared rendering and transitions.
All checks passed, including 46 Pumpy and 11 transition checks. Simulator testing
confirmed the original Pumpy and bottom bar, multiline typing above the software
keyboard, and history opening/closing over the conversation. The signed update
was installed over the existing app on the paired iPhone 15.

Build logs for this revision: `/tmp/spotter-web-style-simulator-build.log` and
`/tmp/spotter-web-style-device-build.log`. Physical keyboard feel and the Taptic
Engine still require evaluation on the phone; simulator checks cannot establish
those. No backend deployment or paid model call is required for this restoration.

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

`SpotterViewController` hosts WKWebView at full height and never resizes it for
the keyboard (September 2026: resizing it inside UIKit's animation made WebKit
redraw the page at its final size at once, so the page dropped and the set sheet
jumped). The keys slide over a still frame; the shell reports their height,
duration and how far their own spring animation has already run, and the page
lifts the surface that owns the field (native/keyboard.js, the "keyboard over a
still frame" section of app.ts, `html.kb-over` in style.ts). Capacitor's delayed
resizing stays disabled, and its Keyboard plugin detaches WebKit's own keyboard
observers, so the page reveals covered fields itself.
The web composer retains focus when Send is tapped, follows keyboard/multiline
size changes when the reader is at the bottom, and suppresses the web-form
accessory bar for ordinary text, search, email, URL, password and chat inputs.
Number/date fields and multiline forms retain Done/Next. Small focused text is
raised to 16px to avoid iOS focus zoom; larger input typography is preserved.

Curve 7 is UIKit's keyboard spring (critically damped, stiffness 555), run by the
page as the closest cubic-bezier so Core Animation composites it. Sheets rise
whole while they fit under the status bar and otherwise as far as they can, the
rest scrolling; the Pumpy composer rises from the tab bar and the thread moves
with it; other fields get room at the end of their scroller. A paper backdrop
rides under the translucent iOS 26 keys. Every scroller present when the keyboard
rises is given interactive dismissal, and the keyboard layout guide is sampled per
frame so the lift follows a finger dragging the keys down. Late Capacitor
show/hide callbacks are still superseded during rapid refocus. Hidden tabs are
inert. Reduced-motion preferences make every lift instant. The window, host,
WKWebView, scroll view and under-page backgrounds match the shared light/dark
paper colors.

This uses Apple's [keyboard layout guide](https://developer.apple.com/documentation/uikit/uiview/keyboardlayoutguide)
to follow interactive dismissal; the surface lifts are our integration
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

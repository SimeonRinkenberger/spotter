# Pumpy New chat — 6 September 2026

The New chat button previously replaced the log in one frame. It now keeps the
conversation mounted for a 150 ms opacity exit, swaps at zero opacity, and brings
the greeting in over 320 ms with a 9 px upward settle. The existing motion tokens
control timing/easing. The toolbar and composer stay mounted, and the draft stays.
A failed greeting illustration retains its reserved space.

The chat state resets at the tap, using a new owner object so late packets from an
old stream cannot repaint the new conversation. Cold history is also invalidated.
Repeated taps on an empty chat preserve the greeting. Sending, switching chats,
navigation and account teardown cancel pending animation work. Timed cleanup
covers withheld animation events; reduced motion skips both phases.

## Research

Reviewed [Apple's motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion)
and [web.dev's animation guide](https://web.dev/articles/animations-guide).
Used a restrained transition to explain the state change, with only opacity and
transform animated and no layout changes in animation frames. No animation
library or new artwork was introduced.

## Verification

- Build and generated Pages/Edge HTML identity pass; generated-page Deno check passes.
- 88 automated checks pass: 11 new transition/race checks, 49 Pumpy, 21
  performance/freshness, 7 service-worker. The account teardown test also exercises
  cancellation of active chat motion. No backend changes in this release.
- 375×812 Chromium fixture, light and dark: 80-message and short chats settle to
  the greeting without horizontal overflow. In the dark long-chat trace, the
  composer row stayed at y=692 in all 103 sampled frames. History remained at
  scrollTop 7220 through exit; the greeting was swapped at opacity 0 and scrollTop
  0 at 154 ms. Entrance was fully settled by 485 ms; greeting height stayed 555 px.
  The light short-chat trace also held the composer at y=692 throughout.
- Reduced motion: the greeting was present at the first 5 ms sample with opacity
  1, no transform, no exit frames and no pending animation. Rapid taps settled to
  one empty greeting, preserving the draft. No application console errors observed.
- Local fixture uses stubbed data/transport; no real chats, extraction, payments,
  or permanent test-account data were changed. Physical iPhone keyboard and
  VoiceOver behavior remain unverified on device.
- Built page: 546,045 bytes / 146,295 gzip, +2,648 / +709 versus the prior release.

Deployment verification will be recorded after publication.

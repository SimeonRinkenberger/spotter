# Progress and session recaps

Implemented in the shared web/iPhone templates; rebuilt web, edge-page and native assets. Not published.

- Progress includes training totals, workout/exercise search, month grouping and ten-session pages.
- Sessions open a dedicated recap sheet with date, duration, set count, volume, a large share image, Dark/Light/Clear/Photo options, existing export controls, and set-by-set exercise details.
- Existing delete/undo and Strava sharing remain available.
- The 182-day history cutoff was removed. The most recent 400 sessions are loaded; that cap is disclosed when reached.
- Reading history never finishes a workout, clears an active draft or grants awards. Historical records are not reconstructed. Share cards are regenerated from saved logs; past custom photos were not saved and must be selected again.
- Pending image renders/photo decodes cannot populate a different recap. Closing the recap or leaving the account releases share assets.

Design reference: [Apple Fitness](https://apps.apple.com/us/app/apple-fitness/id1208224953), for an overview leading into workout details and sharing. Kept Spotter's existing visual tokens and canvas card designer.

## Verification

- `npm run parity:check`: passed, including generated web/native/edge parity and all native adapter checks.
- `tools/progress-harness.mjs`: offline Chrome tests passed for search, pagination, empty states, a deleted source workout, null sets, timed sets, mixed weight units, actual canvas PNG generation, themes, download, cleanup, delete/undo, active-workout protection and mobile overflow in light/dark mode.
- Screenshots: `recap-light.png`, `recap-dark.png`, visually inspected at 375 × 812. Browser fixtures stub the weekly hero and network services; the recap and share renderer use real source functions.
- Existing performance harness: first 14 checks passed, including history loading, invalidation and account isolation, then stopped because its account teardown fixture lacks the pre-existing `native` global.
- Physical iPhone share sheet, photo-library interaction, video export and live backend integration were not verified in this pass.

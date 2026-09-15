# Workout Mode updates

Implemented in the shared web/iPhone templates; generated assets rebuilt. Not published.

- Rest periods have an 88px countdown, highlighted panel, pause/resume state, and visible extend/skip controls. Timed circuit rest also receives a highlighted panel.
- A persistent Add exercise button opens an in-workout sheet. Suggestions come from saved workouts; custom names, rep-based and timed movements work offline.
- Session additions use a private copy of the exercise blocks, preserving the library workout. Drafts save that copy so added exercises and their set logs survive recovery. Freestyle logs retain their own screen and sets.
- Add set directly opens the next unlogged index, including sets beyond the original prescription. Timed movements have an explicit Log extra hold action.
- Save workout now occupies the full footer width with a 60px minimum height.

## Verification

`tools/workout-edit-harness.mjs` passed offline Chrome checks for rest pause/extend/expiry, additions during rest, unchanged library data, draft recovery, extra sets, timed additions, final session payload, freestyle mapping, invalid input and 375px light/dark controls. Screenshots `rest-light.png` and `rest-dark.png` were visually inspected. The fixture uses the actual changed functions and CSS; auth, persistence to the backend, secondary helpers and summary rendering are stubbed.

`npm run parity:check` passed for the regenerated shared page and native adapters. Physical iPhone keyboard/datalist interaction and live session insertion remain unverified.

Design reference: [Apple's workout controls](https://support.apple.com/en-lamr/guide/watch/apdd16e8761a/watchos), for accessible pause/resume and in-session actions. Reused Spotter's rest engine, visual tokens and sheet navigation.

## Strava cost and readiness, checked September 12, 2026

Spotter already implements OAuth connection and sending saved logs as WeightTraining activities. Configuration checks expect STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET and STRAVA_STATE_SECRET; live configuration and connection were not checked or changed.

- [Developer FAQ](https://communityhub.strava.com/developers-knowledge-base-14/strava-api-faq-12906): Standard tier requires a developer subscription, without an additional API fee. Up to 10 athletes can be enabled without review; more requires review, with Standard supporting up to 9,999 athletes. Extended access requires review.
- [US pricing](https://www.strava.com/pricing): $11.99/month or $79.99/year plus applicable taxes.
- [Public API reference](https://developers.strava.com/docs/reference/): activity creation is available; public photo upload is not exposed. Share images must be attached manually in Strava.

No Strava purchase, account connection or activity publication was performed.

## Yearly savings follow-up

The yearly card now shows the dollar saving, percentage badge and the total of 12 monthly payments. Monthly equivalent, annual billing and introductory-offer renewal price remain explicit. Values are computed from the fetched prices. With the repository price fixture ($6.99 monthly / $39.99 annual), the regular saving is $43.89 (52%); a $29.99 founding year saves $53.89 (64%) in year one.

Reference: [Apple subscription presentation guidance](https://developer.apple.com/app-store/subscriptions/). Kept the full billed amount larger than savings and monthly equivalents. Offline Chrome checked regular/introductory/no-discount cases and 375px light/dark overflow; the light screenshot was visually inspected. `npm run parity:check` passed again.

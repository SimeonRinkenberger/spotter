# Spotter — store listing pack (App Store + Google Play)

Prepared 17 September 2026 for the GTM wave. Nothing here was submitted, published or saved into
any console. This is copy and answers for the owner to paste.

**Read this first.** A Play listing already exists in draft and is *saved, not submitted*. Per
`releases/android/store/research/status-20260914.md`, Play Console already holds the short
description, the 2,215-character full description, the icon, the feature graphic, five 1080x1920
screenshots and the AI-content labels, and the Console showed "Ready to send for review". So the
Play half of this document is mostly a **policy review with a short list of edits**, not a rewrite.
The App Store half is new, because Apple Developer Program access does not exist yet.

## Sources consulted (17 September 2026)

- App Store Review Guidelines — 1.4.1, 3.1.1, 3.1.2(c), 3.1.3(b), 5.1.1(v), 5.1.2:
  https://developer.apple.com/app-store/review/guidelines/
- Offering account deletion in your app (Apple): https://developer.apple.com/support/offering-account-deletion-in-your-app/
- App privacy details on the App Store (nutrition labels, tracking definition):
  https://developer.apple.com/app-store/app-privacy-details/
- Age ratings reference in App Store Connect (the 4+/9+/13+/16+/18+ questionnaire that replaced
  12+/17+): https://developer.apple.com/help/app-store-connect/reference/age-ratings/
- Google Play account deletion requirements: https://support.google.com/googleplay/android-developer/answer/13327111
- Google Play Data safety form: https://support.google.com/googleplay/android-developer/answer/10787469
- Google Play Health Content and Services policy: https://support.google.com/googleplay/android-developer/answer/16679511
- Google Play health app categories / Health apps declaration:
  https://support.google.com/googleplay/android-developer/answer/13996367
- Google Play subscriptions policy: https://support.google.com/googleplay/android-developer/answer/140504
- Google Play preview asset (screenshot) guidance, already cited by the earlier screenshot work:
  https://support.google.com/googleplay/android-developer/answer/9866151
- Competitor listings read directly: Hevy https://apps.apple.com/us/app/hevy-workout-tracker-gym-log/id1458862350 ,
  Fitbod https://apps.apple.com/us/app/fitbod-gym-fitness-planner/id1041517543 ,
  Strong https://apps.apple.com/us/app/strong-workout-tracker/id464254577 .
  Hevy and Fitbod Play listings were reviewed in the earlier pass (`screenshot-strategy.md`).

## What the competition does, and what we take

| | Hevy | Fitbod | Strong |
|---|---|---|---|
| Subtitle | "Weight Lifting Routine Planner" | "AI Personal Trainer & Workouts" | "Strength Training Planner" |
| Age rating | 9+ | 9+ | 4+ |
| Paid tiers | monthly / yearly / lifetime | monthly / yearly | monthly / 6-month / yearly / forever |
| Privacy labels | Contact Info, Purchases, Usage Data, Contacts linked; User ID, Sensitive Info, Diagnostics not linked | Health & Fitness, Contact Info, User Content, Identifiers, Usage Data, Diagnostics all linked; **Usage Data used to track** | Health & Fitness, Purchases, Contact Info, Identifiers, Diagnostics linked |

**Take:** a category-word subtitle (each one names the job, not a benefit); Health & Fitness
category; 9+; a small number of clearly named subscription periods.
**Avoid:** Hevy's "#1" and "+10 million users" superlatives (we have no users and cannot
substantiate a ranking); Fitbod's "Data Used to Track You" — Spotter has no advertising SDK and
must claim no tracking; Strong's four-way price ladder and a lifetime tier — the CEO plan forbids
a second tier or lifetime access before paid demand exists; Fitbod's "AI Personal Trainer", which
reads as a health professional. Pumpy is a coach that proposes changes you confirm.

---

## 1. Identity and shared fields

| Field | Value |
|---|---|
| Developer / seller | Quarterdeck Collective LLC |
| Bundle / application id | `app.spotter.dev` (capacitor.config.json; android/app/build.gradle) |
| Version at launch | 1.0 (Android versionCode 2, versionName 1.0 — `releases/android/Spotter-1.0-2.aab`) |
| Category | Health & Fitness (both stores) |
| Age rating | 9+ (Apple) / Everyone (Play, IARC) — see section 5 |
| Marketing URL | https://quarterdeckcollective.com/spotter |
| Support URL | https://quarterdeckcollective.com/spotter (contact section) |
| Privacy URL | https://quarterdeckcollective.com/spotter/privacy/ |
| Terms of use URL | https://quarterdeckcollective.com/spotter/terms/ |
| Account deletion URL | https://quarterdeckcollective.com/spotter/delete-account/ **once published** — until then https://simeonrinkenberger.github.io/spotter/delete-account.html (this wave adds `docs/delete-account.html`) |
| Support email | `support@quarterdeckcollective.com` (recommended; today only `business@` exists — see OPS-READINESS.md) |

**Change from the saved Play draft.** The draft's Privacy field and Account deletion field both
point at `simeonrinkenberger.github.io`. GTM-SHARED says the web app is decommissioned after store
approval, so every store-facing URL must be on the owned domain before submission, or the listing
will point at a dead host the day the Pages site is retired. The in-app links already point at
`quarterdeckcollective.com` (`markup.ts` settings group and the plan sheet's legal row), so the
store fields are the inconsistent ones.

---

## 2. App Store (iOS)

### Metadata

- **App name (30 max):** `Spotter: Save Workout Videos` — 28 characters.
- **Subtitle (30 max):** `Turn saved clips into workouts` — 30 characters exactly.
  - Alternate, if the first reads as jargon: `Save a video. Train from it.` (28).
- **Keywords (100 max, comma separated, no spaces):**
  `gym,lifting,strength,log,tracker,routine,exercise,reps,sets,plan,fitness,trainer,barbell,dumbbell,pr`
  — 100 characters exactly. "workout", "video" and "save" are deliberately absent: they are already
  in the name and subtitle, which Apple indexes, and repeating them wastes the field.
- **Promotional text (170 max, editable without review):**
  `Save a workout video from TikTok, Instagram or YouTube. Spotter reads out the exercises, sets and reps so you can check them, fix them, and take the workout to the gym.` — 168 characters.
- **Copyright:** `2026 Quarterdeck Collective LLC`
- **Primary category:** Health & Fitness. **Secondary:** Sports.
- **Price:** Free, with In-App Purchases.

### Description

> Save the workout. Make it happen.
>
> You already save workouts you never do. Spotter is where they turn into training.
>
> From your feed to your workout
> Share a link from TikTok, Instagram or YouTube into Spotter, or paste it in. Spotter reads what
> the post actually says and lays out the exercises, sets and reps it found. You review it, fill in
> what is missing, and make it yours.
>
> A library you can find things in
> Saved videos keep their thumbnails, so you recognise a workout by sight. Search by exercise or
> muscle group, favourite what you come back to, and group the rest into collections.
>
> One set at a time
> Workout Mode puts the current exercise in front of you and nothing else. Log reps and weight, add
> a set, start the rest timer. What you lifted last time is right there.
>
> The week you meant to have
> Put workouts on the days you intend to train, and see the week you actually had beside it.
>
> Your work, added up
> Finished sessions, training volume, muscles worked, personal records.
>
> Pumpy, the coach
> Ask about an exercise, a substitution, or how to fit a workout into the time you have. Pumpy can
> propose changes to your library and your plan, and nothing changes until you confirm it.
>
> Spotter Plus
> Spotter is free to use, with a library of 20 workouts and daily limits on the parts that cost
> money to run. Spotter Plus lifts the library limit and raises those daily limits. Four premium
> video reads a month are included on the free plan, so you can see what the paid reading does
> before you pay for it.
>
> Spotter provides general fitness information and workout logging. It does not diagnose, treat or
> prevent any condition. AI reading and AI answers can be wrong — review a workout before you
> train it, choose exercises that are right for you, and get qualified guidance when you need it.

Notes on the draft above:
- No superlatives, no user counts, no "unlimited", no claimed results. 1.4.1 and Play's Health
  Content and Services policy both turn on claims, and there are none here.
- The explicit "AI reading and AI answers can be wrong" line is the same promise the app already
  makes in the product and it is what 1.4.1's "remind users to check" expects of a health-adjacent
  app that is not a medical device.
- Do not name Google Play in the App Store description, or Apple in the Play description.

### What's New for 1.0 (both stores)

> First release. Spotter turns a saved workout video into a workout you can follow.
>
> - Save from TikTok, Instagram and YouTube, or share straight into Spotter from another app.
> - Review and correct the exercises, sets and reps before you train them.
> - Workout Mode with set logging and a rest timer.
> - A weekly plan, your history, volume and personal records.
> - Pumpy, a coach that proposes changes you confirm.
> - Export your data or delete your account from Settings at any time.

### Subscription disclosure paragraph — App Store

Apple 3.1.2(c) requires the title, length, price, and what the subscription provides to be visible
before the purchase, and the Developer Program License Agreement Schedule 2 requires functional
links to the privacy policy and terms of use from the purchase surface. Use this text on the
paywall and in the App Store description's In-App Purchases area:

> **Spotter Plus** — $6.99 per month, or $50.00 per year. Payment is charged to your Apple Account
> at confirmation of purchase. The subscription renews automatically at the same price unless it is
> cancelled at least 24 hours before the end of the current period. Manage or cancel it in your
> Apple Account settings. A free trial, where offered, applies to the annual plan only; any unused
> part of a free trial is forfeited when a subscription is purchased. Spotter Plus removes the
> 20-workout library limit and raises the daily limits on saving, reading and coaching. Terms of
> use: https://quarterdeckcollective.com/spotter/terms/ — Privacy policy:
> https://quarterdeckcollective.com/spotter/privacy/

**Already in the app, verified in source:** `app.ts` builds the native disclosure line as
"Renews automatically at <localized price> per month/per year until cancelled. Manage or cancel in
your store subscription settings. Any eligible offer and its terms appear in the store
confirmation.", and the plan sheet markup (`markup.ts`, `#plansheet`) carries Terms, Privacy and
Restore purchase links. Two gaps against Apple's expectation, both for the owner or a frontend
agent, not for this brief: the phrase **"Spotter Plus"** as the subscription title and the
**length of the period stated in words** are both in the sheet's heading and price cards rather
than in the disclosure line itself, and the disclosure does not name the Apple Account as the
billing party. Verify on a real device before submission.

### App Review notes (paste into App Store Connect > App Review Information > Notes)

> Spotter saves public fitness videos the user chooses and extracts the exercises, sets and reps
> into an editable workout card, then logs the workout.
>
> Sign-in: an account is required because the library, logs and plan sync across devices and are
> the core of the app. Email/password and Continue with Google are supported. A demo account is
> provided below; it is pre-loaded with saved workouts, a plan for this week and two completed
> sessions, and it has a complimentary Plus entitlement so every paid surface can be exercised
> without a purchase.
>
> Account deletion (5.1.1(v)): Settings > Data & privacy > Delete account. The user types DELETE to
> confirm. The server cancels a web subscription, revokes the Strava grant if one exists, deletes
> the library, logs, plan, collections, corrections, coaching threads, uploaded files and the
> sign-in record itself. The sheet tells the user, before they confirm, that an App Store or Google
> Play subscription must be cancelled in the store and is not cancelled by deleting the account.
> Settings > Data & privacy > Export my data writes everything to a JSON file first.
>
> Subscriptions (3.1.1 / 3.1.2): Spotter Plus is one subscription, $6.99 monthly or $50.00 yearly,
> purchased through In-App Purchase on iOS and validated by RevenueCat. Restore purchase is on the
> plan sheet. Spotter also exists as a web app where the same subscription can be bought through
> Stripe; per 3.1.3(b) the app neither links to that purchase flow nor mentions it, and an account
> bought on the web keeps working in the app.
>
> Health claims (1.4.1): Spotter is not a medical app, reads no health sensors, and uses no
> HealthKit data. The coach is prohibited from diagnosing. A server-side filter
> (`DIAGNOSIS_RE` in supabase/functions/spotter/index.ts) drops any sentence that names a condition
> or says "sounds like"/"you probably have", including mid-stream, and every answer about pain
> carries a fixed line: "Not medical advice — if the pain is sharp, keeps coming back or gets worse,
> see a professional."
>
> Third-party content: video playback uses the platforms' own embedded players. Spotter does not
> download, host or re-serve creator video. Creator attribution is preserved on every card.
>
> AI processing (5.1.2): captions, post text and, for supported videos, audio or sampled frames are
> sent to OpenAI and Google to extract the workout. This is disclosed on the privacy page, which is
> linked from the sign-in screen, from Settings > Data & privacy and from the subscription sheet.

### Reviewer demo account — owner action, and it must be new

Create a **fresh** account for App Review and for Play. Do not reuse anything in the repository.
`tools/throwaway.py` is a tracked file in a public GitHub repository and contains the throwaway
password in plain text, and the permanent fixture login `spotter-tw-simeon@example.com` is
documented alongside it in the agent context. Anything derived from that is a published credential
and cannot be a reviewer account.

Requirements for the account the owner creates:
- A real mailbox the owner controls, e.g. `appreview@quarterdeckcollective.com`, not `@example.com`.
  App Review may need to receive a password-reset or confirmation mail.
- A password used nowhere else, created in the owner's password manager.
- A complimentary Plus entitlement set by the owner (the `staff` plan, or a `profiles.limits`
  override), so no purchase is needed to see paid surfaces. Note this in the review notes.
- Seeded with at least: five saved workouts with visible thumbnails across three creators, one of
  them with a full multi-block card; a plan with something on today and something two days out;
  two completed sessions so Progress and Records are not empty; one Pumpy thread.
- Not signed in anywhere else during review, and not deleted until the app is approved.
- The Play equivalent already exists as a "persistent reviewer login" per
  `releases/android/store/content-declarations.md`, with credentials in
  `.native-build/play-reviewer.json` (gitignored). **Verify that account still signs in, still has
  a complimentary entitlement and still has the seeded content before the closed test.** If it was
  ever derived from the throwaway tool, replace it.

---

## 3. Google Play

### Keep as saved in Console

App name, short description ("Save workout videos. Organize your training. Log sets and track your
progress.", 78 characters), the full description in
`releases/android/store/research/listing-revised-draft.txt`, category Health & Fitness, United
States only at first, and the five screenshots. They were written against Play's guidance and the
Console already accepted them.

### Edits required before sending for review

1. **Privacy field** → `https://quarterdeckcollective.com/spotter/privacy/` (from the github.io
   URL). Play requires an active, publicly accessible, non-geofenced URL, and the Pages host is
   scheduled for decommissioning.
2. **Account deletion URL** → `https://quarterdeckcollective.com/spotter/delete-account/` once the
   page is published, replacing `.../privacy.html#delete`. Play's requirement is a web resource
   where the deletion pathway is *prominently featured and readily discoverable* and which
   *references the app and developer name as shown on the store listing*. A fragment anchor
   two-thirds of the way down a privacy policy does not clearly meet "prominently featured", and
   the privacy page does not name Quarterdeck Collective LLC in the deletion section.
   `docs/delete-account.html`, added in this wave, is written to that standard.
3. **Support email** → `support@quarterdeckcollective.com` once the mailbox exists; the same
   address must then appear on the deletion page, the privacy page and the listing.
4. **Last line of the full description** → change
   `Privacy: https://simeonrinkenberger.github.io/spotter/privacy.html` to the owned-domain URL and
   add one line: `Delete your account: https://quarterdeckcollective.com/spotter/delete-account/`.
5. **"eligible new annual subscribers can try a free trial"** — keep only if the Play Console offer
   is actually configured. `tools/stripe-plans.json` sets `trial_days: 7` on the annual price for
   *Stripe*; the Play offer is separate and was not verified here. If there is no Play trial on the
   day of submission, delete the clause. Play's subscription policy requires free-trial terms to be
   accurate.
6. **Price consistency** — the description defers to Play for prices, which is correct and needs no
   change. Verify in Console that `spotter_plus` is $6.99 monthly and $50.00 yearly before sending.

### Subscription disclosure paragraph — Google Play

Play requires the cost, billing period, free-trial terms, auto-renewal and the cancellation method
to be visible in-app and accurate in the listing, and requires an easy in-app route to cancel. Use:

> **Spotter Plus** — $6.99 per month or $50.00 per year, billed through Google Play. The
> subscription renews automatically at the same price at the end of each period until you cancel.
> Cancel any time in the Google Play app under Payments and subscriptions > Subscriptions, or from
> Settings > Plan in Spotter. Cancelling stops the next renewal; access continues to the end of the
> period you paid for. Free-trial terms, if an offer applies to you, are shown by Google Play before
> you confirm. Spotter Plus removes the 20-workout library limit and raises the daily limits on
> saving, reading and coaching.

**Gap to close, owner or frontend agent:** Play asks for "access to an easy-to-use, online method
to cancel the subscription" from inside the app. `#setmanage` ("Manage subscription") exists in
Settings and the plan sheet has Restore purchase, but whether the Android build opens the Play
subscriptions deep link (`https://play.google.com/store/account/subscriptions?sku=…&package=app.spotter.dev`)
was **not verified** in this pass. Check it on the device before the closed test.

---

## 4. Store product configuration to confirm (owner)

| Item | Expected | Status |
|---|---|---|
| Play product id | `spotter_plus` with monthly and annual base plans | Live per GTM-SHARED; prices to re-verify |
| Play prices | $6.99 / month, $50.00 / year | Play already lists $50/yr per GTM-SHARED; unverified here |
| Stripe lookup keys | `spotter_plus_month` 699, `spotter_plus_year` 5000 (`tools/stripe-plans.json`) | Source says 5000; **live Stripe objects still say $39.99** until `tools/stripe-setup.sh` is re-run |
| Founding coupon | disabled for new purchases (`founding.enabled: false`) | Source only — the live Stripe coupon is not disabled by the source setting |
| Apple product | not created; Developer Program access blocked | Blocked |

---

## 5. Content and age rating answers

### Apple — App Store Connect age rating questionnaire (current 4+/9+/13+/16+/18+ form)

| Question | Answer | Why |
|---|---|---|
| Parental Controls | No | none in the app |
| Age Assurance | No | Declared Age Range API not used |
| Unrestricted Web Access | **No** | no general in-app browser. Custom Tabs appear only in `GoogleAuth.java` for the sign-in flow; the YouTube demo clip plays in an embedded no-cookie player and the "search YouTube" link opens the system browser |
| User-Generated Content | **No** | a user's library is private to that account. There is no feed, no profile, no sharing between users |
| Social Media | No | no redistribution or amplification of anyone's content |
| Social Media disabled under 13 | Not applicable | |
| Messaging and Chat | **No** | Pumpy is an AI assistant; there is no user-to-user communication |
| Advertising | No | no ad SDK, no ads |
| Profanity or Crude Humor | **Infrequent** | Spotter displays the creator's own caption from a public post; a saved TikTok caption can contain profanity Spotter did not write |
| Horror/Fear Themes | None | |
| Alcohol, Tobacco, or Drug Use | None | supplements are never recommended; nothing is sold |
| **Medical or Treatment Information** | **None** | Pumpy is prohibited from diagnosing and the server drops any sentence that does. See the evidence paragraph below |
| **Health or Wellness Topics** | **Yes** | exercise guidance is self-care and lifestyle recommendation. This alone sets the rating at 9+ |
| Mature or Suggestive Themes | None | |
| Sexual Content or Nudity | None | |
| Graphic Sexual Content | None | |
| Cartoon/Fantasy Violence, Realistic Violence, Graphic Violence, Guns or Weapons | None | |
| Gambling | No | |
| Simulated Gambling | None | |
| Contests | **None** | personal records and awards are a record of your own training, not a competition for ranking or reward against other people |
| Loot Boxes | No | |

**Resulting rating: 9+.** Same as Hevy and Fitbod.

Evidence for answering "None" to Medical or Treatment Information, and what to do if Apple
disagrees: `supabase/functions/spotter/index.ts` defines `DIAGNOSIS_RE`, which matches condition
names (tendinitis, bursitis, impingement, arthritis, sciatica, hernia, fracture, tear, dislocation)
and the phrasings "you probably/likely/may/might/could have", "sounds like" and "diagnos*". Any
sentence matching it is dropped from an answer, and `makeSayGate` retracts characters already
streamed the moment a sentence turns diagnostic. Every answer about pain carries the fixed
`PAIN_NOTE`. Put that paragraph in the review notes. If a reviewer still reads Pumpy's pain answers
as treatment guidance, the honest fallback answer is **Infrequent**, which raises the rating to
13+. It does not affect distribution in the United States. Do not argue the rating; change it.

### Google Play — IARC questionnaire

Category: **Utility / Productivity / Communication / Other** (Spotter is a tool, not a game).
Answer every content question None/No: no violence, no sexual content or nudity, no profanity
generated by the app, no controlled substances, no gambling or simulated gambling, no horror,
no crude humour. Interactive elements: **digital purchases — yes**; **users interact — no** (no
user-to-user features); **shares location — no**; **personal information shared with third parties
— yes** (AI processors and the payment processors, as declared in Data safety).
Expected outcome: **Everyone**. If IARC's "users interact" question is read as covering the AI
coach, answering yes produces "Everyone 10+", which is acceptable; do not fight it.

### Google Play — Health apps declaration (required of every app on Play)

Category: **Health and Fitness app** — "apps that help users manage their health and fitness …
inform or let users track" (Play's own category description). Answers:
- Medical device / SaMD: **No**. No regulatory clearance is claimed or needed.
- Human subjects research: **No**.
- Telemedicine or provider services: **No**.
- Health Connect: **No** — Spotter reads no Health Connect data and no device sensors.
- Health data collected: activity and fitness data that the **user types in** (sets, reps, weight,
  notes, planned days). No medical records, no symptoms, no biometrics.
- Non-medical disclaimer present: **Yes** — in the full description and in-app. Play's Health
  Content and Services policy requires non-medical health apps to carry a disclaimer that they do
  not diagnose, treat or prevent conditions. The description paragraph in section 2 is that
  disclaimer; confirm the identical sentence exists in the Play description before submitting.
- AI-generated health content: disclose that an AI model extracts workouts from user-chosen videos
  and that a coaching assistant answers training questions, that its output is user-reviewed before
  it changes anything, and that it is filtered against diagnostic statements.

### Google Play — other App content declarations

Confirm the answers already saved on 13 September (`releases/android/store/content-declarations.md`):
account required with reviewer credentials, no ads, Health & Fitness, free with optional
subscriptions, 18+ target audience, not a government app, no financial features, encryption in
transit, no independent security review claimed. **One change:** update the data-deletion URL as in
section 3. Re-check the "18+ target audience" answer against the 9+/Everyone content rating — they
answer different questions (who the app is *for* versus what it *contains*), and 18+ is a
defensible choice for a gym app that keeps it out of Play's Families programme, but the owner
should confirm it is still what he wants.

---

## 6. Screenshot shot list

Five real captures already exist at 1080x1920 in `releases/android/store/screenshots-v2/final`,
reproducible with `tools/android/store-screenshots.py`, and are already uploaded to Play in order.
Play needs nothing further. The list below is the same story, re-cut for the sizes each store asks
for, and names the fixture data each frame must contain.

**Fixture account for all captures:** the reviewer/demo account from section 2, so nothing real
belongs to a person and nothing has to be redacted. Never capture from
`spotter-tw-simeon@example.com` — its login is public.

| # | Screen | Caption (max ~6 words) | Exactly what must be on screen |
|---|---|---|---|
| 1 | The OS share sheet over TikTok with Spotter as a target, then the import landing in Spotter | Found it. Save it. Train it. | A real public TikTok post; Spotter visible in the share row; creator handle legible. Do not fabricate the share sheet |
| 2 | Library / Favorites | Your workouts, all together | Six saved cards with loaded thumbnails across at least three creators. No card showing an empty or failed extraction |
| 3 | Workout detail | A workout you can follow | A multi-block card with real exercises, sets and reps — the 3-round kettlebell circuit fixture is the right shape. Creator attribution visible |
| 4 | Workout Mode mid-set | Log every set | Current exercise large, reps and weight fields filled, rest timer running, previous-session values visible |
| 5 | Train tab — week strip + calendar | The week you meant to have | Workouts on today and two days out, at least two days marked trained, one marked planned-and-missed |
| 6 | Progress / Records | See your work add up | Muscle map populated, volume chart with at least two weeks of sessions, one personal record |
| 7 (iOS only, optional) | Pumpy thread with a proposed change and the confirm control | Ask. Review. Confirm. | A proposal card with an explicit Confirm control visible, so the "nothing changes until you confirm" claim is shown, not asserted. Do **not** show a pain or injury exchange |

Sizes to produce:
- **iPhone 6.9"** — 1320x2868 or 1290x2796. Required; App Store Connect scales this set down for
  smaller iPhones, so 6.7" and 6.5" sets are **optional** and only worth uploading if a frame
  crops badly. Produce 6.9" first, review at phone size, then decide.
- **iPhone 6.5"** — 1284x2778 or 1242x2688. Upload only if the 6.9" downscale loses a caption.
- **iPad 13"** — 2064x2752. Required **only if the app is offered on iPad**. Spotter is a phone
  layout; the simplest correct answer is to ship iPhone-only for 1.0 and avoid the iPad set
  entirely. Decide this before the first submission — adding iPad later is easy, removing it is not.
- **Android phone** — keep the existing 1080x1920 (9:16) portrait set. Play accepts 320–3840px with
  the long side no more than twice the short side; a 16:9 landscape set is not required for a
  portrait-only app and would have to be genuine landscape captures, which Spotter does not have.
  Do not letterbox portrait captures into landscape frames.

Rules taken from Play's preview-asset guidance and applied to both stores: actual app footage,
UI prominent in the first three frames, caption text under roughly 20% of the image, no invented
ratings or awards, no price promotions, no download calls to action, no third-party logos beyond
the genuine share sheet, and no AI redrawing of product UI or of a creator's thumbnail. The five
existing Play screenshots are already labelled as AI-assisted layouts and the feature graphic as
AI-created; carry the same labels to any new frame built the same way.

---

## 7. Things this listing must never say

- "Unlimited" anything. The library limit is removed on Plus; the AI is metered and the funded
  monthly ceiling is small. `tools/stripe-plans.json` currently describes the Plus product to
  Stripe as "An unlimited library, and more of everything that costs money to make: 200 saves, 60
  extractions, 15 video reads, 10 uploads and 60 coaching answers a day." Those daily numbers are
  the per-plan caps seeded in `limits.plans` (migration `20260904200000_billing.sql`), but the
  global AI guard is $0.50/day and $10/calendar month and the per-account allowance is $0.50/month,
  so a customer cannot actually be served 15 video reads a day for a month. **Owner action:**
  rewrite that Stripe product description before the price re-run, and do not repeat those numbers
  in any store listing. Advertise "raises your daily limits", show the real remaining allowance in
  the app, and publish numbers only after the workload/cost table the CEO plan asks for.
- Accuracy or completeness claims about extraction. Several real TikTok imports in the earlier
  screenshot pass returned a thumbnail and a title with no exercise blocks at all.
- Any medical claim, any named condition, any "fix your knee pain" framing.
- "#1", user counts, "the best", awards, or press quotes. None can be substantiated.
- Any mention of the other store's billing, or of the web checkout, inside a store listing or app.

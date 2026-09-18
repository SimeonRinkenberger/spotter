# Spotter — privacy declarations, derived from the code

Prepared 17 September 2026. These answers were written from the source tree and the migrations, not
from the published privacy page. Part 4 is the diff between the two. Nothing here was submitted to
either console and `docs/privacy.html` was not edited — the owner wants an attorney pass first.

Evidence is cited by file and, where useful, line. Branch `gtm-ops`, off `gtm-release-candidate`.

## Sources consulted

- App privacy details on the App Store (data types, the three groupings, the tracking definition,
  the optional-disclosure exceptions): https://developer.apple.com/app-store/app-privacy-details/
- App Store Review Guideline 5.1.2 (Data Use and Sharing), current text, which now says explicitly:
  disclose where personal data will be shared with third parties, **including with third-party AI**,
  and obtain explicit permission before doing so — https://developer.apple.com/app-store/review/guidelines/
- Google Play Data safety form, including the collected/shared definitions and the ephemeral-
  processing, service-provider and user-initiated-transfer exceptions:
  https://support.google.com/googleplay/android-developer/answer/10787469
- Google Play account deletion requirements (what is in scope for deletion):
  https://support.google.com/googleplay/android-developer/answer/13327111

---

## Part 1 — What Spotter actually collects and processes

| # | Data | Where it lives | Required? | Linked to the account? | Retention |
|---|---|---|---|---|---|
| 1 | Email address | `auth.users` (Supabase Auth) | Required to sign in | Yes | Until account deletion |
| 2 | Password, as a salted hash | Supabase Auth | Required for email sign-in | Yes | Until account deletion |
| 3 | Display name | `profiles` | Optional | Yes | Until deletion |
| 4 | Google or Apple identity (provider subject, email, name) | Supabase Auth identities; `20260902160000_oauth_profiles.sql` | Optional alternative to a password | Yes | Until deletion |
| 5 | Spotter account id (UUID) | every user-scoped table | Required | Yes | Until deletion |
| 6 | Personal save key (`profiles.ingest_key`) | `profiles` | Optional, for the iOS Shortcut | Yes | Until deletion or rotation (`/api/rotate-key`) |
| 7 | Saved post: URL, shortcode, platform, creator/author, the public caption or description, thumbnail URL | `workouts`; shared copy in `video_cache` | Optional — only what the user saves | Yes on `workouts`; **no** on `video_cache` | `workouts` until deletion; `video_cache` indefinitely and not account-linked |
| 8 | Extracted workout card (blocks, exercises, sets, reps, equipment, timestamps) and the Video Context Pack | `workouts.blocks`; `video_cache.card`, `video_cache.pack` | Optional | Yes on `workouts`; no on `video_cache` | as above |
| 9 | Corrections the user makes to a card | `corrections` | Optional | Yes | Until deletion |
| 10 | Workout logs — sets, reps, weight, notes, session times | `workout_logs` | Optional | Yes | Until deletion |
| 11 | Weekly plan | `plan` | Optional | Yes | Until deletion |
| 12 | Collections and their items | `collections`, `collection_items` | Optional | Yes | Until deletion |
| 13 | Achievements / personal records | `achievements` | Derived | Yes | Until deletion |
| 14 | Pumpy conversations and the proposals confirmed from them | `pumpy_threads`, `pumpy_messages` | Optional | Yes | Until deletion |
| 15 | A Pumpy response the user reports as unsafe, **copied so the operator can read it** | `ai_response_reports` (service role only; `report_pumpy_response` copies up to 32,000 characters of the assistant message and its proposal) | Optional, user-initiated | Yes | Until deletion (cascades) |
| 16 | Uploaded video or audio the user supplies | private `uploads` bucket, path `uploads/<user id>/…` | Optional | Yes, by path | Deleted as soon as the read returns, success or failure; hourly sweep removes anything older than two hours |
| 17 | Contact sheets — JPEG stills the **native app cuts from the user's own video on the device** and uploads so the model can see the movement | same private `uploads` bucket, permit `kind='sheet'` (`20260915100000_video_context_pack.sql`) | Optional, native only | Yes, by path | Deleted the moment the read returns; same two-hour sweep |
| 18 | Push subscription: the push-service endpoint, the subscriber's p256dh public key and auth secret, the IANA time zone the browser reported, and the two reminder switches | `push_subscriptions` | Optional, off until a switch is tapped | Yes | Until the switch is turned off, the endpoint 404/410s, or deletion |
| 19 | Web subscription state: Stripe customer and subscription ids, plan, status, cancel-at-period-end, period end, last payment failure | `billing_customers`, `subscriptions` | Only if the user subscribes on the web | Yes | Until deletion (the customer record is deleted at Stripe too) |
| 20 | Store subscription state: store (`apple`/`google`), product id, active flag, expiry | `store_entitlements` | Only if the user subscribes in the app | Yes | Until deletion (cascades) |
| 21 | Stripe webhook log — event id, type, processed-at, error | `billing_events` | System | **No user id on the row** | Indefinite; no payment details |
| 22 | Purchase validation at RevenueCat — Spotter account id, purchase history, product and transaction ids, subscription status | RevenueCat, keyed by the Spotter UUID (`supabase/functions/spotter-purchases/index.ts`) | Only if a store purchase happens | Yes, at RevenueCat | **Not deleted by Spotter's account deletion — see Part 4, item D** |
| 23 | Operational counters: saves, extractions, coaching calls, credits, tokens, estimated cost | `saves_log`, `pumpy_usage` | System | Yes | Deleted explicitly on account deletion |
| 24 | AI accounting: admission records, reservations, per-attempt cost | `ai_actions`, `ai_reservations`, `ai_cost_log` | System | `ai_cost_log` and `ai_reservations` are **de-identified** on deletion (user id set to null); `ai_actions` is deleted | `ai_actions` 40 days, `ai_reservations` 90 days, both by scheduled cleanup (`20260908150000_cost_and_abuse_guards.sql`) |
| 25 | Premium preview accounting — month and video shortcode of each of the four monthly previews | `video_previews` | System | Yes | Until deletion (cascades) |
| 26 | Upload permits | `upload_permits` | System | Yes | Deleted explicitly on account deletion |
| 27 | Strava connection: two access keys, athlete number, ids of activities Spotter created | `strava_tokens` | Only if the user connects Strava | Yes, server-side only | Until disconnect or deletion; deletion also tells Strava to forget Spotter |
| 28 | Client IP address and request metadata | **Not written by Spotter's own code** — grep for `x-forwarded-for` / `cf-connecting-ip` in `supabase/functions/spotter/*.ts` finds nothing. Supabase Auth's audit log and the Edge Function request logs record it at the platform level | System | Platform-dependent | **Unverified** — the project's log retention was not queried (the worktree is not `supabase link`ed and linking is an owner action) |

### Processors

| Processor | What it receives | Why |
|---|---|---|
| Supabase (US) | everything in the table above | database, auth, storage, edge functions |
| OpenAI | captions, post text, carousel images, user-supplied text; the workout context Pumpy needs (titles, exercises, equipment, collection names, planned days, a summary of recent sessions) | extraction and coaching. Luna is the text model |
| Google (Gemini) | supported audio and video, contact sheets, private uploads | reading a video that has no usable text. Gemini 3.6 Flash reads contact sheets and raw video |
| Stripe | account id, and the email the user gives Stripe at checkout | web payment; card details never reach Spotter |
| RevenueCat | Spotter account id, purchase and transaction identifiers, subscription status | store purchase validation |
| Strava | workout name, start time, duration, one line per exercise, volume, personal bests, a link back | only when the user taps Send to Strava |
| Google Fonts, Google image host, YouTube (no-cookie player) | the request itself | fonts, demo thumbnails, demo playback |
| TikTok / Instagram / YouTube embeds | the request itself | playback inside the platform's own player |

### Tracking

**None.** There is no advertising SDK, no analytics SDK, no advertising identifier, no data broker,
and no joining of Spotter data with third-party data for advertising. Under Apple's definition,
Spotter does no tracking, so **no data type may be declared under "Data Used to Track You" and the
App Tracking Transparency prompt is not required.** This is the single biggest difference from
Fitbod, which declares Usage Data as used to track.

---

## Part 2 — Apple App Store privacy label answers

Declare these under **Data Linked to You**. Purposes in brackets use Apple's own purpose names.

| Category > Type | Purposes | Note |
|---|---|---|
| Contact Info > Email Address | App Functionality | sign-in identity |
| Contact Info > Name | App Functionality | optional display name, or the name Google/Apple returns |
| Health & Fitness > Fitness | App Functionality, Product Personalization | sets, reps, weight, plan, sessions, records. **Not** Health — no medical or sensor data |
| User Content > Photos or Videos | App Functionality | a video the user uploads, and the contact sheets the native app cuts from it |
| User Content > Audio Data | App Functionality | an audio file the user uploads, and the audio track read from a supported video |
| User Content > Other User Content | App Functionality, Product Personalization | saved links and captions, workout cards, corrections, notes, Pumpy conversations |
| User Content > Customer Support | App Functionality | a Pumpy response the user reports, which the operator reads |
| Identifiers > User ID | App Functionality | the Spotter account UUID, also sent to RevenueCat and Stripe |
| Identifiers > Device ID | App Functionality | the push endpoint, which identifies one browser or device |
| Purchases > Purchase History | App Functionality | subscription state only |
| Usage Data > Product Interaction | App Functionality, Analytics | save/extract/coaching counters and preview accounting, used to enforce plan limits and to run the cost ledger |
| Diagnostics > Other Diagnostic Data | App Functionality | platform request logs. Declare as Linked because Supabase's auth audit log is keyed to the account |

**Data Not Linked to You:** nothing needs to be declared here. The shared extraction cache holds only
information taken from a public post and carries no user identifier, so it is not user data at all.

**Data Used to Track You:** none.

Not declared, with reasons: the password hash (Apple has no credential type and it is never
readable); the personal save key (a credential, not a data type); the IANA time zone (see the Play
note below); location of any kind (no sensor, no permission, no IP-derived location); Contacts;
Browsing or Search History (Spotter has an in-library search, which is Product Interaction, not
web search history); Sensitive Info.

**Additional Apple obligations that fall out of this, both currently unmet:**
1. **5.1.2(i), third-party AI.** Apple's current text requires clear disclosure *and explicit
   permission* before personal data is shared with third parties "including with third-party AI".
   The privacy page names OpenAI and Google, and the sign-in screen, the settings group and the
   plan sheet all link it (`markup.ts` lines 152-153, 720-721, 757-758). But there is **no
   affirmative in-app step** where the user agrees that their caption, uploaded video or contact
   sheets go to OpenAI and Google. A search of `markup.ts` and `app.ts` for a consent surface finds
   none. Before an iOS submission the owner should add a one-time, plainly worded acknowledgement
   on the first read. Not in this brief's scope; listed for the owner.
2. **Sign in with Apple token revocation.** Apple requires an app that offers Sign in with Apple to
   call the REST revoke endpoint when the account is deleted. `handleAccountDelete`
   (`supabase/functions/spotter/index.ts`, lines 7085-7146) cancels Stripe, forgets Strava, deletes
   the ledgers and uploads and then deletes the Supabase auth user — it never contacts
   `appleid.apple.com`. Grep confirms no reference to that host anywhere in the function. Apple
   sign-in is not active yet (`APPLE-AUTH.md`), so this is a blocker only for the iOS submission,
   but it must be built before it.

---

## Part 3 — Google Play Data safety answers

Overall: **data is collected, not shared**. Every third party in the processor table is either a
service provider acting on Spotter's instructions (Supabase, OpenAI, Google, RevenueCat, Stripe)
or a user-initiated transfer (Strava, and the platform embed the user chooses to play). Both are
Play's own exceptions to "shared". **No data is ephemeral-only**, because everything is written to
the database; the uploads bucket is short-lived but is still storage, so it is declared.
Encryption in transit: **yes**. Users can request data deletion: **yes**, in-app and by web URL.

| Category > Type | Collected | Required/optional | Purposes |
|---|---|---|---|
| Personal info > Email address | Yes | Required | App functionality, Account management, Fraud prevention/security/compliance |
| Personal info > Name | Yes | Optional | App functionality, Account management |
| Personal info > User IDs | Yes | Required | App functionality, Account management, Analytics, Fraud prevention/security/compliance |
| Financial info > Purchase history | Yes | Required (for purchasers) | App functionality, Analytics, Fraud prevention/security/compliance |
| Health and fitness > Fitness info | Yes | Optional | App functionality, Personalization |
| Messages > Other in-app messages | Yes | Optional | App functionality, Personalization, Fraud prevention/security/compliance |
| Photos and videos > Photos | Yes | Optional | App functionality |
| Photos and videos > Videos | Yes | Optional | App functionality |
| **Audio files > Other audio files** | Yes | Optional | App functionality |
| App activity > App interactions | Yes | Required | App functionality, Analytics, Fraud prevention/security/compliance |
| App activity > Other user-generated content | Yes | Optional | App functionality, Personalization |
| App info and performance > Diagnostics | Yes | Required | Analytics, Fraud prevention/security/compliance |
| **Device or other IDs > Device or other IDs** | Yes | Optional | App functionality |

Changes from the declaration saved on 13 September
(`releases/android/store/content-declarations.md`):
- **Add `Audio files > Other audio files`.** The app accepts an audio upload and the reader
  transcribes the audio track of a supported video. The `uploads` bucket's own allowlist includes
  `audio/mpeg`, `audio/mp4`, `audio/x-m4a`, `audio/wav`, `audio/webm`
  (`20260902130000_uploads_bucket.sql`). Declaring only Photos and Videos understates this.
- **Add `Device or other IDs`.** A Web Push endpoint identifies one browser or device and is stored
  on a row attached to the account. The old declaration says "No advertising/device IDs"; the
  advertising half stays true, the device half does not.
- **Keep everything else as saved.** Name, Email, User IDs, Purchase history, Fitness information,
  Other in-app messages, Photos, Videos, Diagnostics, App interactions and Other user-generated
  content are all correct.

Deliberate non-declarations, with reasoning to keep on file:
- **Location — not declared.** Spotter requests no location permission and derives nothing from IP.
  The one geographic-ish value stored is the IANA time zone the browser reports
  (`push_subscriptions.tz`), used only to decide whether it is 17:30 where the user is. Play's
  location types are defined by area precision (approximate = an area of 3 or more square
  kilometres); a time zone is not a location fix and is not derived from one. It is declared above
  under Device or other IDs together with the push endpoint, and is disclosed in plain words in the
  proposed privacy edits.
- **Files and docs — not declared.** Uploads are media, and are covered by Photos/Videos/Audio.
- **Calendar, Contacts, Web browsing — not declared.** No API, no permission, nothing stored.
- **Financial info > Other financial info / payment info — not declared.** Card data never reaches
  Spotter; it is entered on Stripe's page or handled by the store.

---

## Part 4 — Diff against `docs/privacy.html`, as proposed edits

`docs/privacy.html` was **not modified**. It is accurate about everything it covers and is unusually
candid for a page of its kind. What follows is what it does not cover, or covers in a way the code
no longer matches. Each item is written as an edit the owner (or the owner's attorney) can apply.

Separately and more urgently: **the live page at quarterdeckcollective.com is three versions behind
this file.** See `design/gtm/WORDPRESS-DRIFT.md`; that gap is larger than every item below.

### A. Push notifications are not mentioned at all — add a section

The page never uses the word "push". `push_subscriptions` stores, per browser or device: the push
service's endpoint URL, the subscriber's p256dh public key, its auth secret, the IANA time zone the
browser reported, the two reminder switches, the chosen reminder minute, and the send-rate marks.
Proposed insert after "What Spotter stores":

> **If you turn on reminders**, Spotter stores what the notification service needs to reach that one
> browser or phone: the address it gave us, the two keys that encrypt a notification to you, and the
> time zone your browser reports, so a 17:30 reminder is 17:30 where you are. One row per device, so
> turning reminders off on your phone does not silence your laptop. Turning a reminder off deletes
> its permission to send; deleting your account deletes the rows. Spotter sends two kinds of
> reminder and no others, both off until you switch them on.

### B. The contact sheets the phone cuts are not described — extend "Files and video reading"

The section covers uploads, but not the native path added in September: the app cuts still frames
from the user's own video **on the device**, uploads up to three JPEG contact sheets into the same
private bucket, and deletes them the moment the read returns
(`20260915100000_video_context_pack.sql`). A reader would not learn from the current page that
images of their video leave the phone. Proposed insert:

> On the iPhone and Android apps, Spotter can cut a handful of still frames out of a video on your
> phone and send just those images — not the video — to be read. They go into the same private,
> temporary storage as an upload, under your own folder, and are deleted as soon as the read
> returns. This is how Spotter can describe what a movement looked like when the caption never says.

### C. Reported Pumpy answers are read by a person — say so

`report_pumpy_response` copies up to 32,000 characters of the reported assistant message and its
proposal into `ai_response_reports`, which only the service role can read, so that the operator can
review it. The page says the library and chats "are private to your account", which is true of
everything except this. Proposed insert in "Your conversations with Pumpy":

> If you report one of Pumpy's answers, a copy of that answer is kept so it can be read and fixed.
> That copy is the one part of a conversation a person at Spotter looks at, and only because you
> asked. It is deleted with your account.

### D. Deleting the account does not delete the RevenueCat subscriber — say so, or fix it

Verified in code: `handleAccountDelete` cancels and deletes the **Stripe** customer and deletes
`store_entitlements` by cascade, but never calls RevenueCat. `spotter-purchases/index.ts`
deliberately holds only RevenueCat's public SDK key, which cannot delete a subscriber. So after a
deletion, RevenueCat still holds a subscriber record keyed by the Spotter account UUID with that
person's purchase history. The page's payments section mentions store retention generally but
implies the Spotter-side identifiers go. Two options, and the owner should pick one before the Play
submission because Play's deletion policy puts everything declared as collected in scope:

1. **Fix it** — have the deletion path call RevenueCat's subscriber-delete endpoint with a secret
   key held only by the server, best-effort like the Strava step. Preferred.
2. **Disclose it** — add: "RevenueCat keeps its record of a store purchase, under an identifier that
   was your Spotter account, for as long as its own retention policy says. Deleting your Spotter
   account does not delete it; email us and we will ask them to."

### E. IP addresses in platform logs are not mentioned

Spotter's own code logs no IP address. Supabase's auth audit log and the Edge Function request logs
do, at the platform level, and they survive an account deletion for whatever the platform's
retention is. Proposed insert into "Deleting your account":

> Spotter's own code does not record your IP address. Supabase, which runs the database and the
> server, keeps ordinary request and sign-in logs that include it, for its own security and for a
> limited period. Those are not Spotter's to delete.

**Owner check before publishing this sentence:** confirm Supabase's actual log retention for this
project rather than repeating "a limited period".

### F. "an identifier for you at your payment provider" is now two providers with different behaviour

The "What Spotter stores" bullet is generic where the Payments section is specific. Minor; align the
bullet with the Payments section so a reader who stops at the list is not surprised.

### G. Achievements, corrections and the preview ledger are not listed

Small, and arguably covered by "what you log", but the deletion list in the page enumerates
categories, and `achievements`, `video_previews` and `upload_permits` are not among them. Add
"records and awards Spotter worked out from your sessions" to the storage list and to the deletion
list.

### H. Link to the new deletion page

`docs/delete-account.html` is added in this wave. **No edit was made to `privacy.html`.** Proposed:
in the "Deleting your account" section, after the first sentence, add
`<a href="delete-account.html">how to request deletion without the app</a>` — and on the WordPress
copy, `https://quarterdeckcollective.com/spotter/delete-account/`. Play's requirement is that the
deletion route be prominently featured and readily discoverable on a web page that names the app
and the developer; a fragment inside a privacy policy is a weaker answer than a dedicated page, and
the privacy page's deletion section does not name Quarterdeck Collective LLC.

### I. The dates

`docs/privacy.html` says "Last updated 13 September 2026". If any of A-H is applied, change it.

---

## Part 5 — What is verified and what is not

**Verified by reading the code in this worktree:** every row of Part 1 except item 28; the absence
of any advertising or analytics SDK; the absence of an Apple token revoke call; the absence of a
RevenueCat delete call; the absence of an in-app AI-processing consent step; the 40-day and 90-day
cleanup intervals; the uploads bucket's MIME allowlist; the contents of `handleAccountDelete`; the
cascade list from `auth.users`.

**Not verified:** the live `app_config` values (not read — agents may not touch `app_config`);
Supabase's platform log retention for this project (the worktree is not linked and linking is an
owner action); whether Play Console's saved Data safety answers still match what is written here;
anything about Apple's console, which does not exist yet.

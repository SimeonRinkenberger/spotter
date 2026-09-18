# Spotter — operational readiness

Prepared 17 September 2026 for the readiness gate "Operational readiness: privacy/account
deletion/support/store declarations reviewed; monitoring and a named release owner". This closes
the documentation half of that gate. It does not certify anything legally or operationally; it says
who owns what, what exists, and what is missing.

---

## 1. Release owner and escalation

| Role | Person | What they decide |
|---|---|---|
| **Release owner** | **Simeon Rinkenberger** | whether a build ships, whether a rollout pauses, every spend increase, every store submission |
| Deputy | none | there is no second person. This is the single largest operational risk in this document and it cannot be fixed by writing a document |
| Provider escalation | Supabase support, OpenAI support, Google AI support, Stripe support, RevenueCat support, Play Console support | each is a ticket queue, not a phone number. None has an SLA on the current plans |

**Escalation ladder during the beta.** There is one on-call person, so the ladder is really a
decision tree for him:

1. **Customers cannot use saved workouts** (app down, database down, auth down) — highest. Roll back
   to the previous compatible server/client pair per the rollback checklist. Post on the Spotter
   page and reply to open support mail within the day.
2. **Money is leaking** (spend anomaly, a provider bill moving faster than expected, a runaway
   retry loop). The global guard is $0.50/day and $10/calendar month, so the blast radius is
   bounded by design; treat a guard trip as an incident to diagnose, not a limit to raise.
3. **Data integrity** (an edit lost, a stale worker overwriting a card, an entitlement leaking
   across accounts). Pause admission rather than continue. These were the P0 class in the CEO plan
   and they are the ones a beta tester will never forgive.
4. **Extraction quality** — a bad card is a support conversation, not an incident.
5. **Everything else** — the weekly review.

**Monitoring that exists today:** `GET /api/limits` returns `spend_today`, `spend_limit`,
`budget` (`ai_budget_status`), `ai_allowance`, `paid_enabled` and `cache_pct_today`; the
`ai_actions`, `ai_reservations` and `ai_cost_log` tables carry per-attempt accounting with
environment attribution after migration `20260917150000`; Supabase gives function logs and database
metrics; Stripe and RevenueCat each have their own dashboards.
**Monitoring that does not exist:** any alert. Nothing pages anybody. Every number above has to be
looked at. Before the closed test the owner should at minimum set a calendar reminder to read
`/api/limits` and the Supabase function error count once a day, and set Supabase's built-in email
alerts if the plan offers them. This is listed as an owner action, not solved here.

---

## 2. Support channel

**Today there is one address, `business@quarterdeckcollective.com`, and it appears in
`docs/privacy.html` twice and in the Play listing draft as the support contact.** That is the
owner's business mailbox. It works, but it mixes customer support with everything else, it cannot
be handed to anyone, and it reads as a company contact rather than a place to report a broken card.

**Recommendation: create `support@quarterdeckcollective.com`** as an alias into the same mailbox to
start with. One address, one label, one place to count support minutes for the weekly scorecard.

Where it must then appear, all four before the closed test:

| Surface | Today | Should be |
|---|---|---|
| Play Console > Store listing > Contact details | `business@` | `support@` |
| App Store Connect > App Review + Support URL page | does not exist | `support@` |
| `docs/privacy.html` (two places) and the live WordPress copy | `business@` | `support@` (owner edit — this wave did not touch privacy.html) |
| `docs/delete-account.html` (this wave) | `business@` | `support@` once the alias exists |
| In the app | there is no support address at all; Settings > About offers "Something wrong? Tell me" linking to the public GitHub issue tracker | add a mail row, or at least name the address on the deletion sheet. Sending a paying customer to GitHub Issues is not a support channel, and the comment in `markup.ts` explains why an address was avoided: a public page gets harvested. An alias behind a form or an alias that can be rotated answers that |

**Note for App Review.** Apple expects a support URL that leads to a way to contact a human. The
Spotter homepage's Contact section does that. Keep it.

---

## 3. Support FAQ — draft

Plain answers, written to be pasted into a page or a canned reply. Every one of them is true of the
code as it stands on `gtm-release-candidate`.

**1. How do I save a workout from TikTok or Instagram?**
On Android and iPhone, open the post, tap Share, and choose Spotter — on iPhone you may have to open
More to find it the first time. Anywhere else, copy the link and tap Save workout in Spotter. On
iPhone there is also a Shortcut you can set up in Settings > Save from your phone, which posts a
shared link straight to your library using a personal key. Spotter then reads whatever the post
makes available and builds a card.

**2. The exercises on a card are wrong. Can I fix them?**
Yes, and your fix sticks. Open the workout and edit any exercise, set count, rep count or piece of
equipment. Spotter keeps your edits if the video is ever read again — a reread will not overwrite
something you changed, delete something you deleted, or refill something you deliberately left
empty. If a whole card is wrong, tell us the link at the support address; bad cards are the thing
we most want to see during the beta.

**3. What does Spotter Plus add?**
The free plan holds 20 workouts and has daily limits on the parts that cost money to run: saving,
extracting, reading video, uploading, and asking the coach. Plus removes the library limit and
raises those daily limits. The exact numbers are shown in the app on the plan screen, and they are
the numbers the server actually enforces. Free accounts also get four premium video reads a month,
so you can see what the paid reading does before paying for it.

**4. How do I cancel, and can I get a refund?**
It depends where you bought it. **Google Play:** open the Play Store, Payments and subscriptions,
Subscriptions, pick Spotter, Cancel. Refunds are Google's — ask in Play within their window.
**Apple:** Settings, your name, Subscriptions, pick Spotter, Cancel. Refunds are Apple's, at
reportaproblem.apple.com. **On the Spotter website:** Settings > Plan > Manage subscription, which
opens the billing portal. In every case, cancelling stops the next renewal and you keep access
until the end of the period you already paid for.

**5. How do I delete my account?**
Settings > Data & privacy > Delete account, then type DELETE. It is immediate and cannot be undone.
If you cannot sign in, email us from your account's address and we will do it — see
https://quarterdeckcollective.com/spotter/delete-account/. **If you subscribed through Google Play
or Apple, cancel that subscription in the store first: deleting your Spotter account does not stop
store billing.**

**6. Can I get my data out?**
Settings > Data & privacy > Export my data writes your workout cards, every logged session, your
plan, your collections, your chats with Pumpy and your settings into one JSON file on your device.
Your personal save key is deliberately left out, because it works without a password and files get
forwarded. Do this before deleting anything you want to keep.

**7. Why could Spotter not read this video?**
Usually because the post never says the workout in a way anything can read: no caption, no
on-screen text, and a voiceover that is not available to us. Spotter can read audio and sample
frames for supported videos, but not every platform or post allows it, a private or removed post
cannot be fetched at all, and long videos can time out. When that happens you get the video and a
place to type the workout yourself, which still gives you Workout Mode, logging and the plan.

**8. What are the four previews?**
Free accounts get four premium video reads per calendar month — the deeper read that looks at the
video rather than only the text. They reset on the first of the month. A read that fails does not
consume one. The app tells you when one is being used and how many are left.

**9. What does Spotter do with my data, and what does the AI see?**
Your library, logs, plan and coaching conversations are private to your account, are not sold, and
carry no ads or trackers. To build a card, the caption or text of a post you saved — and, for a
supported video, its audio or a few still frames cut from it — is sent to OpenAI or Google to be
read. Asking the coach sends what you typed plus the workout context needed to answer: titles,
exercises, equipment, collection names, your planned days and a summary of recent sessions.
Uploaded files and the frames go into private temporary storage and are deleted as soon as the read
returns. The full account is at https://quarterdeckcollective.com/spotter/privacy/.

**10. Is Pumpy giving me medical advice?**
No, and it is built not to. Pumpy is a coach for the workouts in your library. It will not name a
condition or tell you what you have — the server drops any sentence that tries, even mid-answer —
and every answer about pain carries the same line: not medical advice, and see a professional if it
is sharp, recurring or getting worse. Spotter does not diagnose, treat or prevent anything. Choose
exercises that are right for you.

---

## 4. Provider account inventory

Login holder is Simeon in every row; there is no shared credential store and no second holder. That
is itself a risk (section 7).

| Provider | Used for | Plan / key facts | Owner check |
|---|---|---|---|
| **Supabase** | Postgres, Auth, Storage (`uploads` bucket), Edge Functions `spotter` and `spotter-purchases`. Project ref `mtzevoxxpsktmrbbuxva` | live function version 180 from `509bc99`. Migrations `20260917130000/140000/150000` are **not applied**; edge code is **not deployed** | confirm plan tier, backup retention and log retention. Log retention feeds a sentence in the privacy page |
| **OpenAI** | text extraction and coaching (Luna) | API key in function secrets | confirm the org's data-controls setting and that it is a paid account with no training on API data |
| **Google AI (Gemini)** | audio/video reads, contact sheets (Gemini 3.6 Flash) | API key in function secrets | **P0 from the 8 September review, still open: the billing/data-use mode is not verified.** Google's paid and unpaid tiers have different data-use terms, and the privacy page already says so. This must be confirmed before any beta tester uploads a video |
| **Stripe** | web subscriptions, Managed Payments (Stripe as merchant of record) | products and prices by lookup key from `tools/stripe-plans.json`; `spotter_plus_year` is 5000 in source | **live objects still say $39.99** until `tools/stripe-setup.sh` is re-run. The founding coupon is `enabled:false` in source but a **live coupon is not disabled by that setting** — delete it in the Dashboard, honouring anyone already promised it |
| **RevenueCat** | validating Google Play and Apple purchases, syncing entitlement | `spotter-purchases` holds only the public SDK key plus a webhook secret; no privileged key | it cannot delete a subscriber with the key it has — see PRIVACY-DECLARATIONS.md item D |
| **Google Play Console** | Android distribution, `app.spotter.dev`, product `spotter_plus` | listing saved and "Ready to send for review"; content rating awaits IARC terms approval; reviewer login in `.native-build/play-reviewer.json` (gitignored) | complete the IARC questionnaire and the Health apps declaration; correct the two URLs in STORE-LISTING.md section 3 |
| **Apple Developer Program** | iOS distribution, Sign in with Apple, IAP | **enrollment not complete.** Current iOS builds use a free Personal Team. Nothing can be submitted, and Apple sign-in cannot be switched on | this is the hard blocker on the iOS half of the whole wave |
| **GitHub** | `SimeonRinkenberger/spotter` (public repo), GitHub Pages at `simeonrinkenberger.github.io/spotter`, Issues used as the in-app "something wrong" target | `main` protected; Release checks required | the repo being public is why the reviewer account must be fresh |
| **WordPress / quarterdeckcollective.com** | the four public pages (IDs 900001-900004) | published 13 September via the official importer as admin user 1 | **the live privacy page is the 8 September text.** See WORDPRESS-DRIFT.md |
| **Strava** | optional one-way activity export | API application, server-side tokens only | confirm the app's Strava API rate tier before more than a handful of testers connect |
| **Cloudflare** | not used by Spotter as far as this pass could tell | no reference in the repo | if the domain sits behind it, note who holds that login too |

---

## 5. Launch-day checklist

Condensed from `design/GTM-RELEASE-READINESS.md` sections "Release sequence and rollback" and
"Gates still open". Order matters; each line is a stop.

**Before the day**
1. `npm install`, then `npm run gtm:check` — 14 regression groups green. Keep the commit, the
   artifacts and the output.
2. Native parity and `deno check` green; `Release checks` green on the PR.
3. Store fields corrected: privacy URL, account-deletion URL, support address (STORE-LISTING.md §3).
4. `docs/delete-account.html` published, and the WordPress copy published at
   `/spotter/delete-account/`, both returning 200 anonymously.
5. Privacy page brought up to date on WordPress (WORDPRESS-DRIFT.md), and any attorney-approved
   edits from PRIVACY-DECLARATIONS.md Part 4 applied.
6. Google AI billing/data-use mode verified. Stripe prices re-run and the live founding coupon
   dealt with.
7. Fresh reviewer account created and seeded; Play reviewer login re-verified.
8. IARC content rating completed; Health apps declaration completed; Data safety form updated with
   the two added types and the new deletion URL.

**On the day**
9. Quiesce or drain ingestion workers.
10. Apply migrations in order: `20260917130000`, then `20260917140000`, then `20260917150000`.
    Validate permissions and real concurrent connection counts afterwards.
11. Set `AI_USAGE_ENVIRONMENT` explicitly per environment. The safe default is `unclassified`.
12. Deploy the server **before** distributing native manifest-v3 clients.
13. Regenerate `native-dist`, run the Capacitor copy for both platforms, verify the packaged assets
    match the regenerated ones, then rebuild both platforms from the final candidate.
14. Smoke test on a real phone, signed in as the fresh reviewer account: save, read, correct, save,
    start a workout, log a set, finish, check Progress, open Pumpy, confirm a proposal, open the
    plan sheet, tap Restore purchase, open Manage subscription, export data. Do not delete that
    account.
15. Read `/api/limits` and record `spend_today`, `budget` and `ai_allowance` as the launch baseline.
16. Send for review / upload the AAB to the closed track. Nothing else ships that day.

**First 72 hours**
17. Read the function error count and `/api/limits` twice a day.
18. Read every support mail the same day.
19. Watch for the specific failure classes the release doc calls out: a worker claiming a job before
    evidence is attached, a manual plan racing a coach plan, abandoned sheet uploads not cleaned up,
    paid fallbacks rising because incomplete native capture is rejected.

## 6. Rollback checklist

1. **Decide the pair.** Roll back to a compatible tested server/client pair. Do **not** roll back
   only the edge function while preservation triggers and new RPC contracts stay active — that
   combination was called out as a specific hazard.
2. **Pause admission** during an incompatible rollback rather than serve a half-rolled-back stack.
3. **Keep user edits and billing/audit records.** No destructive schema rollback, ever, and
   specifically none that would erase evidence of what happened.
4. **Native versus server.** A provider or config change rolls back immediately. A native change
   needs store review, so the rollback for a native defect is usually a server-side mitigation plus
   a new build, not an undo.
5. **Already-saved workouts must stay usable through the rollback.** If they would not be, the
   rollback is wrong.
6. **Keep ordinary viewing, editing and logging working** during a provider or budget incident. Only
   new AI reading should degrade.
7. **Tell the testers.** One short, factual message to the cohort: what broke, what it affected,
   what they should do. No message goes out without the owner sending it.
8. **Write it down the same day** — what failed, what the acceptance check missed, and what the
   change to the release process is.

---

## 7. `/api/account/delete` — verified by reading the code

**Route:** `POST /api/account/delete`, behind the auth gate, declared at
`supabase/functions/spotter/index.ts:12714` and handled by `handleAccountDelete`
(`index.ts:7085-7146`). The app calls it from the delete sheet (`app.ts:13655`). **It was not run.**

Order of operations, and why the order matters:

1. **Stripe first** — `cancelAndDeleteCustomer(userId)`. If Stripe is unreachable the whole deletion
   **stops** and returns 503 with a message telling the user to retry or cancel from Manage
   subscription first. Deliberately fail-closed: deleting the account while a subscription keeps
   billing would be the worse failure.
2. **Strava next, best effort** — `forgetStravaQuietly(userId)` tells Strava to forget Spotter. A
   Strava outage does not hold up the erasure; a stale grant costs the user nothing and they can
   revoke it themselves.
3. **Ledgers** — deletes `saves_log`, `pumpy_usage`, `ai_actions`, `upload_permits`; **de-identifies**
   `ai_cost_log` (`user_id` set to null) and `ai_reservations` (`user_id` null, `work_key` set to
   `deleted-account`). A failure here returns 500 and stops.
4. **Uploads** — lists and deletes everything under `uploads/<user id>/`, paged up to ten pages of
   100. Best effort; a failure is logged and the deletion continues.
5. **The auth row last** — `DELETE /auth/v1/admin/users/<id>` with the service key. Last because it
   is the one irreversible step and, once gone, no token could ask for any of the above.

**What the auth row's cascade takes with it** (`references auth.users(id) on delete cascade`):
`profiles`, `workouts`, `workout_logs`, `plan`, `ingest_jobs`, `corrections`, `collections`,
`collection_items`, `pumpy_threads`, `pumpy_messages`, `billing_customers`, `subscriptions`,
`strava_tokens`, `achievements`, `push_subscriptions`, `store_entitlements`, `ai_response_reports`,
`video_previews`.

**What survives, correctly:** `video_cache` (shared, keyed by the video's public shortcode, carries
no user identifier, so there is nothing in it to attach to anyone); `billing_events` (Stripe event
log with no user id and no payment details); de-identified rows in `ai_cost_log` and
`ai_reservations`, which the scheduled cleanup clears at 90 days.

**Gaps found, for the owner:**
- **RevenueCat is never told.** The subscriber record keyed by the Spotter UUID stays. See
  PRIVACY-DECLARATIONS.md item D — fix it or disclose it before the Play submission.
- **Sign in with Apple tokens are never revoked.** Required by Apple before an iOS release that
  offers Apple sign-in. Nothing in the function references `appleid.apple.com`.
- **There is no server-side deletion path for someone who cannot sign in.** The email fallback on
  the new deletion page is answered by the owner manually, through the Supabase dashboard. That is
  acceptable at beta scale and is what the page promises (30 days, usually the same week), but it is
  a manual process with no audit trail. Write each one down.

---

## 8. Open risks this document did not close

- One person, no deputy, no alerting. Everything above assumes he is awake.
- No incident log and no status page. The first outage will be reported by a tester.
- The support address is a business mailbox and the in-app "something wrong" link goes to a public
  GitHub issue tracker, which is not somewhere a paying customer should be asked to post.
- The Stripe product description promises daily numbers the funded AI budget cannot serve for a
  month. Flagged in STORE-LISTING.md §7; it is a marketing-copy fix, not a code fix.
- The Play listing's privacy and deletion URLs point at a host scheduled for decommissioning.
- Apple enrollment is not done, so half of this plan cannot start.

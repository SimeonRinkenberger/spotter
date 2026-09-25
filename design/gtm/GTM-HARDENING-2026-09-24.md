# GTM hardening — 24 September 2026

The launch-readiness cycle for Spotter: the save flow from TikTok and Instagram, Spotter Plus, a full security pass
with an independent adversarial review, and speed. Plus the owner's in-cycle asks from his phone (section editing,
Workout Mode dots, the Pumpy new-chat screen, the search X, reordering, tab swipe, a share-first Save sheet).

Integration branch `gtm-hardening`, one PR. Server changes are **deployed** (see Deployment). The iOS app is build **8**.
Detailed audits, build reports, harness output and screenshots are in the git-excluded `briefs/gtm-harden/` of the
owner's checkout; this document is the summary of record. Security detail is described at the level of what was
fixed, not how it could have been abused.

## Ground truth checked at the start (and what was stale)

| Claim (brief, 24 Sept) | Checked | Result |
|---|---|---|
| main `6074e07`, required checks `release-checks` + `native-parity`, build 7 | git, CI | true |
| TestFlight's latest processed build is 1.0 (5) | owner's screenshots of 24 Sept show build-7 features (the rest wheel) on TestFlight | **stale**: testers are on 6 or 7 |
| `billOn()` = `prices.configured`; a failed native product load hides Upgrade | `app.ts:13704`, `13733`, `14616` | true, and worse: every cap refusal also said `upgrade:false` because "sellable" meant "has a Stripe price" |
| sandbox purchases ignored unless `REVENUECAT_ALLOW_SANDBOX` | `spotter-purchases/index.ts:27,52`; secret names | true; the secret is not set |
| RevenueCat erasure has no durable retry | `index.ts:7329` | true, and the DELETE also fails with 401 because the only key set is the public SDK key |
| Instagram reels give no media URL | re-confirmed; carousels, however, were never read slide by slide either (login shell + escaped JSON) | true, plus a second gap |
| deployed `spotter` v196 == main | downloaded and compared (esbuild-normalised) | true |

## 1. The save flow

**Audit (before):** 37 scored matrix cells: 18 pass, 5 partial, 14 fail = **49 %** (62 % counting partials).
Cache-hit save p50 1,329 / p95 1,907 ms; extension tap → "Saved" 2.1–2.8 s; production TikTok uncached to ready p50 31 s
/ p95 135 s (Plus media tier included); production Instagram success 0/1 with any exercise.

**What changed (each is an intended behaviour change):**

| Before | After |
|---|---|
| iOS extension refused an Instagram `?igsh=` link, or any caption with a bio link, as "one post at a time", with only Cancel | links naming the same post collapse; the post link wins over bio links; two different posts → the first is saved and named |
| the save was sent after a prepare call and (Plus) up to 8 s of frame cutting; dismissing lost it | **saved first** (`frames_pending`), frames follow and release the same held job; dismissing keeps the save |
| Instagram carousels: never read slide by slide; one became a junk "each Exercise 3×15" in the shared cache | embed fetched as the crawler/iPhone, slides decoded; dose words are never exercise names; the junk row is served as a miss. Live: 6/6 slides read from Supabase in 15.1 s |
| Instagram reels whose caption has no workout: an empty card promising "Plus reads the video" (Plus cannot) | **Add the video**: download with Instagram's own Download, pick it, it is read into that card (counts one read per file; never cached). The Share extension also accepts a video file |
| every Basic card said Plus reads the video — also on Instagram/YouTube/photo posts | the promise appears only where Plus can deliver (TikTok video, uploads) |
| a deleted TikTok saved as a "ready" card with TikTok's logo; a missing Instagram post spun 6 min then offered a useless retry | one sentence at the first attempt: "This post is private, deleted or unavailable to Spotter." |
| a Basic empty card when a Plus read existed | "The caption lists no exercises. A Plus read of the video found N exercises — use one of your free Plus reads" |
| a second save waited for the next cron minute (66 s) | the next queued job starts when the previous ends |
| duplicates, bad links and cache hits spent the per-minute admission and the busy lease ("limit for now") | admitted only before paid work; the free answers have their own 30/min/route throttle |
| signed out: the link was dropped | parked, saved after sign-in — only into the account that was last signed in on that phone |
| `/share/` Instagram links, `instagr.am`, tiktokv/embed/player links, sound pages, expired short links | resolved or answered with the right sentence |
| the Save workout sheet led with "paste a link" | leads with **Share → More → Spotter** (drawn), "Save to Spotter" in the actions list, the Favorites tip; paste and upload are the fallback; the empty Library teaches the same |

**After (measured):** cache-hit save (same script as the audit, verified set): Basic n=9 **p50 820 / p95 1,168 ms**;
preview n=15 **p50 926 / p95 1,096 ms**. Extension tap → "Saved" on cache hits **1.49 s** p50 (SHARE-IOS, n=6, against the
old server). Accuracy on cache hits unchanged (no reading path changed): basic 3/4 scored pass (the fail is a TikTok whose
caption lists nothing — it now carries the Plus-read hint), preview 3/3, Instagram caption-complete 2/2.
Matrix re-run on the merged build: **see "Final verification" below.**

**Instagram research (2026):** ReciMe (caption → audio → screenshot import as the fallback on the failed item), Deglaze
(save in under a second, process after), Honeydew / Flavorish / Samsung Food (claim reel transcription; Flavorish invents
recipes when the caption is thin — not copied), Pinterest (link + image only), Pocket (shut down July 2025), Gymdex /
RepReel / RepExtract / Fitsaver (claims without method), Instagram's own share-sheet Download. Chosen: Add the video on the
thin card + the extension's video door — inside Instagram's terms, no logged-in scraping, no `video_url` lifting.

## 2. Spotter Plus

**Before:** no path to Plus for testers — Upgrade hidden when products fail to load (always, until the Paid Apps
Agreement is signed); every cap refusal `upgrade:false`; when products did load the sheet had **no benefits**; Settings
told Basic users "Coaching answers 0 of 100" (Pumpy is Plus-only); the Pumpy sheet said "used up" to people who never had
it; Google Play's 7-day yearly trial was undisclosed; "During beta" in the fine print; Manage hidden when products fail.

**After:** one Plus page, four states (store answered / store not answering with Try again and no invented price / web:
"bought in the Spotter app" / already Plus with renewal or end date and Manage), each with a **Basic | Plus table built from
the server's own numbers** and an "Always free" row. Reachable for every Basic user from Settings, the library counter,
every cap-hit sheet, Pumpy and the card links, on iOS, Android and web. Plan changes repaint everything without relaunch.
Trial copy only from the store's eligible offer. 3.1.2: title, length, price per period, auto-renew, Terms, Privacy,
Restore, Manage — all present. Live: a Basic account at the 20-card cap now gets `upgrade:true, next_plan:"plus"`.

Server truth the table reads (enforced): Basic — 20 workouts, 4 video previews/month, no Pumpy, 20 explanations/swaps, 1
upload, $0.40 AI/month; Plus — no library limit, 20 reads, Pumpy, 100 explanations/swaps, 10 uploads, $1.50 AI/month.

**Sandbox:** built as one secret, `REVENUECAT_SANDBOX_POLICY` = `off` (default, today's behaviour) | `qa` | `all`.
Entitlements record their environment; creator commission never counts sandbox. **The policy is the owner's decision**
(recommended `all`, so App Review's sandbox purchase unlocks Plus; exposure: TestFlight testers can hold Plus for free,
bounded by the $1.50/month AI cap per account).

**Paywall research:** RevenueCat State of Subscription Apps 2026 and its paywall guides, Superwall patterns, Adapty 2026,
Hevy, Strong, Fitbod, Strava, Duolingo, Calm (Ladder had no public teardown). Taken: a plain Basic | Plus table with Basic's
numbers named, an "Always free" row, annual first, trial terms only when real, Restore/Manage/Terms/Privacy in the footer,
explorable without buying.

**Not proven yet (owner-blocked):** a real purchase / restore / plan flip in the simulator needs the RevenueCat Test Store
key (or the Paid Apps Agreement for TestFlight sandbox). The server half is proven live: a verified entitlement flips the
plan and raises the caps; expiry flips it back within a minute.

## 3. Security

**Method:** a threat model (assets: accounts, workout data, ingest keys, AI spend, entitlements, the service key, Apple and
RevenueCat keys; attackers: anonymous internet, a signed-in user, a link sharer, hostile creator content), a full audit of
both edge functions route by route, the database (RLS, grants, definer functions, storage), the clients, the AI surface,
supply chain and the account lifecycle; 73 live A-vs-B probes with throwaways; then an **independent adversarial review**
by an agent that wrote none of the fixes, which tried to break each fix and hunted the new surface.

**Findings and outcome:**

| Source | Critical | High | Medium | Low | Fixed |
|---|---|---|---|---|---|
| Audit | 0 | 0 | 1 (+ the brief's DNS-rebinding and erasure items) | 5 | all code items; owner config items listed below |
| Adversarial review | 0 | 0 | 3 | 7 (+1 info) | all but one Medium, which is the owner's (web origin) |

Fixed, each with a negative test that fails before and passes after (deployed 24 Sept): outbound requests from the push
sender now pass the same public-address guard as every other fetch; arbitrary web links are fetched over https only and
refused when DNS cannot vouch for them; plan and session rows may only reference the caller's own card; unused client
write grants revoked across service-only tables and `profiles`; `ops_week` search path pinned; third-party erasure
(RevenueCat, Strava, leftover Stripe) goes through a durable outbox, armed only after the account is gone; a CSP and SRI on
the web page, and no framing; the hourly push tick survives the gateway's top-of-the-hour clock skew (it failed 14 of 24
runs, so reminders were not sending); per-file read accounting for Add the video; honest signed-upload lifetimes with
permits held until the address expires; IPv6 address parsing; Plus headroom in the shared upload ceilings; parked links
stay with their account; account deletion removes contact sheets too.

**Tested and found sound** (coverage, stated honestly): tenant isolation A-vs-B across every table and route tried,
column grants, definer functions, storage path scoping, the ingest path's redirect-by-redirect SSRF guard, the ingest
key's narrow scope, Pumpy tools user-scoped with the confirm gate, no model/creator/user text reaching an HTML sink, Stripe
and RevenueCat webhook verification, and an account-deletion drill with zero residual rows (repeated live after deploy).

**Secret scan:** the full git history (490 commits) with gitleaks plus targeted patterns — **no live secret**; `.p8` and
`*.local.xcconfig` never committed; `npm audit` production 0 vulnerabilities; Swift and Gradle dependencies pinned.

**Advisors after deploy:** security — WARN `pg_net` in `public` (kept: worker cron depends on it; not reachable through
the API), WARN two security-definer functions callable by signed-in users (intentional: both check ownership), one WARN
that is an owner setting (private handoff); INFO 24 service-only tables with RLS and no policy (deny-all by design). Performance — INFO only; the five foreign keys that point at workouts are now indexed.

**Residual risk (not "no flaws"):** the remaining open items are configuration and hosting decisions that belong to
the owner (authentication settings, sign-up abuse controls, the web app's hosting origin, a fixture credential), plus
one compatibility trade-off kept for old Shortcuts. They are listed with their severity and exact remedies in the
owner's private handoff, not here, because this repository is public. This was an engineering review with an internal
adversarial pass, not a penetration test by an outside firm.

## 4. Speed (same scripts before and after, back to back; simulator/Mac numbers, compare columns only)

| Metric | Before (main) | After |
|---|---|---|
| reopen after the token expired: first card painted, from the page's first script | 508 / 731 ms | **163 / 178 ms** |
| same, from launch | 1,545 / 2,167 ms | 1,205 / 1,530 ms |
| `/api/limits` wall time (lab, 60 ms/hop) | 257 / 267 ms | **71 / 76 ms** (18 → 16 PostgREST calls; identical bodies) |
| `/api/limits` per 3 Basic detail opens in a minute | 3 calls | 1 |
| covers bucket | 8.75 MB, `no-cache` | **4.55 MB**, cached 7 days (new covers shrink on save) |
| boot reads of plan + logs | 6 | 4 |
| Library read, decoded bytes (20 cards) | 148,820 | 125,020 (−16 %) |
| native.js → app.js appended | 73–89 ms | 59–63 ms |
| web preflight cache | none | 600 s |
| FK lookups on 2,000 cards / 16,000 logs (PGlite) | seq scans (cost 449) | index scans (cost 31.6) |
| cache-hit save, live (Basic, verified set) | 1,329 / 1,907 ms | **820 / 1,168 ms** |
| detail open / Workout Mode start | 24 / 17 ms | unchanged (already ~1 frame) |
| Pumpy first token (Plus, 5 turns) | 2,424 / 3,398 ms | not changed this cycle |

Output unchanged: `eval:offline` and `eval:test` identical line for line; response bodies diffed identical. Skipped:
bundling fonts (Fontshare's licence forbids the files in a public repository), detail prefetch (nothing to gain at
25 ms), the embed iframe deferral (measured slower before). Page weight grew from 200 to ~217 KB gzip, from the new Plus
page, reorder and the share-first sheet.

## 5. Owner asks during the cycle

| Ask | Root cause | Fix |
|---|---|---|
| "This block changed — reopen the workout" on Edit section | Capacitor's native HTTP reorders JSON keys; the server compared blocks as JSON strings | compares what the owner sees (furniture + each exercise's name and dose); **hotfix deployed mid-cycle (PR #36)**, reaches installed builds |
| Workout Mode dots cut off the card | the dots shared the card's space | their own band, a hairline edge |
| Pumpy: fresh chat after a few minutes; labels; ChatGPT icons; "Edit one of my workouts" | — | new chat after 5 min away (never mid-reply, mid-proposal or from a card), labelled Chats / New chat on the empty screen that fold on the first send, compose and speech-bubble icons |
| Search X does not dismiss the keyboard | the field and the X shared one label; a tap just left of the circle focused the field | the X covers the gap, acts on the lift, clears and dismisses |
| "Ask coach" → "Ask Pumpy" | — | done |
| Reorder sections and exercises | — | a Reorder sheet with handles (Hevy / iOS edit-mode pattern), live reflow, haptics, Undo, Move up/down for VoiceOver; exact-permutation server op with a stale guard |
| Tab swipe stopped working (worked again after relaunch) | not reproducible in the simulator; two real defects found: tall pages' scroll views keeping sideways drags on iOS, and a lost lift leaving the pager refusing swipes | both fixed; the pager lets go of a drag whenever the finger is known to be gone |
| Save sheet should lead with Share | — | Share → More → Spotter first; paste secondary |

## Small fixes found along the way (branch `gtm-cleanup`, deployed)

An exercise's catalog id (an exercise-bank pick, a Pumpy match) now survives edits to anything else on the card, and
Pumpy's "add exercises" keeps the ids the card holds; "Not now" on the AI-permission sheet closes quietly instead of
showing a network error; card art no longer opens the iOS image menu on a long press; sheets taller than the phone (the
Plus page) close on a drag down; the week bar, sheet drags and Workout Mode's swipe let go of a drag whose lift was lost,
like the pager; a tap on a Library card that re-renders mid-press opens it.

## Final verification (merged build `834912f`, iPhone 16e simulator, live server v199)

An agent that built none of it ran the audit's 37-cell matrix again through the real Share and Action extensions from
Safari, in-app paste, and the app, with real videos from the verified sets. Spend: 4 paid cold reads, 2 video reads,
1 Pumpy turn — $0.012.

| | Before (audit, main) | After |
|---|---|---|
| Save matrix, 37 scored cells | 18 pass / 5 partial / 14 fail = **49 %** | **34 pass / 3 partial / 0 fail = 92 %** |
| Extension tap → "Saved", cache hit | 2.09–2.81 s | **p50 1.04 s** (n=9); p95 4.65 s is one fresh server isolate, next worst 1.23 s |
| Extension tap → "Saved", cold | ≈2.0 s | p50 1.04 s, p95 1.09 s (n=3) |
| Cold TikTok → ready card | 9.7 s | 7.6 s |
| Cold Instagram → ready card | 7.0–10.1 s | p50 8.4 s, p95 12.6 s (n=3) |
| Second of two back-to-back saves ready | 65.9 s | 12.6 s |
| Deleted TikTok / missing Instagram | junk "ready" card / 6-minute spinner | final sentence in 1.5 s / 1.2 s |

The three partials: an Instagram carousel whose slides are video covers (read, honestly empty), a real Instagram
`/share/` link (needs a device), and a cancel that could not land because the save had already answered.

**Targets:** confirmation ≤ 2 s at p95 is met on warm isolates (worst 1.23 s) and missed once on a cold isolate (4.65 s);
the edge cache-hit time is p50 1,137 ms live against a modelled 308–456 ms — a cold-isolate cost investigated in the
follow-up. Success on the verified sets: TikTok cache hits 4/5 scored pass (the fail is a caption that lists nothing,
which now says so and offers a Plus read); Instagram caption-complete and slide carousels pass; an Instagram reel whose
caption lacks the workout is **not** readable from its link (the platform exposes no video) — Add the video is the path,
so the ≥ 90 % Instagram target is met only for posts whose workout is in the caption or on the slides, and not claimed
for thin reels. Zero silent failures observed: every failing cell produced a sentence.

**Plus on the phone** (products cannot load: no Paid Apps Agreement): every entry point — Settings › Plan, the library
counter, the library-cap refusal, Pumpy's offer, a card's Plus link — opens the same page with the Basic | Plus table from
the server, "The App Store isn't answering right now… Nothing has been charged" + Try again, no price, and Terms ·
Privacy · Restore · Manage.

**Owner asks:** all pass on the phone build (Edit / Remove section on a Pumpy-shaped card, dots, Pumpy new chat after
5.5 real minutes with labels and icons, search X with the software keyboard, Ask Pumpy, reorder, tab swipe after a sheet
closing / backgrounding / a card landing mid-drag, the share-first Save sheet). **Regression sweep:** sign-in/out,
library, detail, Workout Mode, Train, Pumpy on Plus, Settings, delete account — no regression.

**Found by verification and fixed in the follow-up branch (`gtm-fix2`, deployed):** a Basic account's own shared/uploaded video
was read and then delivered as an empty card (High; the in-app Upload on main had the same flaw); Add the video fell back
to audio-only after one upload that day (Medium; two different daily media numbers); Instagram's logo stored as a cover
for two posts (Medium); an unavailable card's tile still said "Retry"; a slide carousel's "3 sets" was not applied.

## Deployment (24 Sept, all backward-compatible with builds 5–7)

1. Hotfix PR #36 (block guard) → `spotter` v197, after proving v196 identical to main. Live: shuffled-key edit 200, stale 409.
2. 14 migrations `20260924100000`–`150000`, then `spotter` and `spotter-purchases`, from `gtm-hardening`. Smoke-tested live
   with throwaways (limits, prices, cache hit, duplicate, bad link, library-cap upsell, S9 hint, account deletion with zero
   residue and the RevenueCat erasure queued, an Instagram carousel read slide by slide).
3. `20260924110000` (FK indexes) and `spotter` with the speed work. Live: `/api/limits` unchanged shape, CORS max-age 600.
4. `spotter` with the cleanup and the verification follow-up (`gtm-fix2`); no migrations. Live: limits, consent and a
   cache hit 200; an uncached Instagram post stored its real 720×900 JPEG cover (40 KB, cached 7 days), not the logo.
   Then `tools/thumbs-repair.ts --apply --skip-clear`: the two Instagram covers that held the logo replaced with the posts'
   real images, two orphaned TikTok-logo objects deleted; one fixture account's card left for the owner (the tool's CLEAR
   writes a person-owned row).

Not deployed by design: `REVENUECAT_SANDBOX_POLICY` (owner), `REVENUECAT_SECRET_KEY` (owner), the cover backfill of the
34 existing covers (optional; `tools/thumbs-backfill.ts`, dry-run by default).

## Needs the owner

1. Paid Apps Agreement: bank and W-9 in App Store Connect.
2. Sandbox policy decision (recommended `all`): `supabase secrets set REVENUECAT_SANDBOX_POLICY=all`.
3. App Review demo account → Basic, review note "Settings › Plan › Upgrade to Plus".
4. RevenueCat: a v1 secret key (`supabase secrets set REVENUECAT_SECRET_KEY=…`), restore behaviour "Transfer if there are
   no active subscriptions", Test Store prices $6.99 / $49.99 and the Test Store key in `.native-build/revenuecat-test-store.key`.
5. Merge the PR(s), archive and upload build 8, upload the two subscription review screenshots once captured.
6. Play yearly 7-day trial: keep (now disclosed) or delete.
7. Supabase plan and authentication settings, sign-up controls, and the web app's hosting: see the private handoff.
8. Legacy Stripe-era subscription rows: convert or expire. The permanent fixture account: see the private handoff.
9. Optional: shrink the 34 existing full-size covers (`deno run -A tools/thumbs-backfill.ts`, dry run first), and clear
   the one QA-fixture card whose cover is TikTok's logo (`tools/thumbs-repair.ts --apply`).
10. Copy: STORE-LISTING ($49.99, no Apple trial, monthly allowances), "During beta" in Terms, Play "More Pumpy coaching";
    publish the privacy answers and the content-rights declaration.

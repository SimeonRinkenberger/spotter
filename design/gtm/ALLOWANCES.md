# Allowances, unit costs and a funded launch budget

17 September 2026. Analysis only — no price, cap, config or code was changed. Every number below is
either a measured ledger figure (query: `tools/ops/economics.sql`, run against the live database
read-only) or a labelled estimate. Ledger window: 2026-09-01 → 2026-09-17 UTC, 167 reservation rows,
$0.643 total, 14 accounts. **Three of those accounts are `staff` and account for $0.385 of the $0.643**
— this is a development sample with deliberate re-reads, not customer demand. It is the only measured
data that exists.

Provider prices re-checked today against the pages the code cites. `ai-guard.ts` `tokenPrice()` matches
both: Luna $0.20 / $1.20 / $0.02 per M ([OpenAI, 2026-09-17](https://developers.openai.com/api/docs/models/gpt-5.6-luna)),
Gemini 3.6 Flash $0.75 / $3.75 / $0.075 **through 2026-12-31, doubling to $1.50 / $7.50 / $0.15 on
2027-01-01** — the code already switches on that date — and Flash-Lite $0.25 / $1.50 / $0.025
([Google, 2026-09-17](https://ai.google.dev/gemini-api/docs/pricing)). Two rate-card fields are *not*
modelled: Luna's 1.25× cache-**write** multiplier, and its 2×/1.5× tier above 272 K input tokens (the
guard's 200 K input bound makes the second unreachable; the first quietly understates settled charges).

## 1. Workload and cost table

Per-call figures are settled charges from `ai_reservations`. Per-purpose figures come from `ai_cost_log`,
which is a **diagnostic estimate of the same calls** — it is shown because the reservation table cannot
say what a call was *for* until migration `20260917150000` is applied. The two are never added.

| Billable action | AI cost p50 | p95 | n | Non-AI drivers | Gated today by |
|---|---:|---:|---:|---|---|
| Cached save (video already read) | **$0** | $0 | 17 of 56 saves (30.4 % hit rate) | one row, one thumbnail | `saves` daily cap only |
| Text-only extraction (caption → card) | $0.00060 | $0.00364 | 38 units | — | `extract`, `saves`, $/mo guard |
| **Native pack read** (phone sheets → Gemini) | $0.01416 | $0.02078 | 14 | ≤ 3 × 600 KB sheets in the `uploads` bucket, deleted after | `media`, work $0.25/day, $/mo guard |
| Gemini raw-video fallback | $0.00878 | $0.01341 | 13 | up to 40 MB fetched + uploaded (`media.max_bytes`) | `media`, `paidAllowed()`, $/mo guard |
| **One delivered video read, end to end** | **$0.02424** | **$0.05728** | 16 units | Gemini is 94 % of it; median 2 Gemini + 2 Luna calls | `media` + everything above |
| Carousel slide vision (Luna) | $0.00053 | $0.00094 | 18 | — | `extract`, `vision.*` budget |
| Upload transcript (Gemini) | $0.00328 | $0.01139 | 17 (**only 2 succeeded**) | 25 MiB/file, ≤ 4 permits | `uploads`, upload permit |
| Pumpy turn (streamed, attachments) | $0.00065 | $0.00211 | 20 turns | — | credits (`pumpy.plans`), `LIMIT_CHAT` 200/day |
| Explain | $0.00018 | $0.00031 | 27 | — | `helper` |
| Swap | $0.00052 | $0.00093 | 17 | — | `helper` |
| Demo-video lookup | **$0** (no model call) | — | — | YouTube `search.list` = 100 of 10 000 free units/day **and** a 100-calls/day project ceiling since June 2026; hit cached for ever, miss 7 days | `helper` |

Not metered and never will be: logging, Workout Mode, the weekly plan, Progress, the muscle map,
collections, export, editing, viewing, deleting, and re-opening anything already saved.

Three facts that change the plan's arithmetic:

- **A delivered video read costs $0.024 at p50, not $0.008.** The $0.008 figure in circulation is the
  `pack_eval` average (n = 5, p50 $0.00692); a *production* pack read is p50 $0.01416, roughly double,
  and a delivered read is a median of two Gemini calls plus Luna assembly.
- **Admission spends the reserve, not the charge.** Median reserved/charged is 3.85× for Gemini 3.6
  Flash (reserved p50 $0.03386, max $0.04361) and 11.83× for Luna (reserved p50 $0.00576). A dollar
  guard therefore bites at roughly a quarter of the spend it appears to allow.
- **The transcription route fails far more than it works**: 15 of 17 calls this month returned not-ok.
  Failed Gemini calls above HTTP 400 stay reserved as `unknown`, so they are paid-for capacity.

## 2. Cap conflict map — what is advertised vs what is funded

Live values (verified, `economics.sql` section `policy`): `limits.plans` free `{library 20, saves 30,
extract 10, media 2, uploads 1, helper 25}`, plus `{library ∞, saves 200, extract 60, media 15,
uploads 10, helper 60}`; `pumpy.plans` free 150/day 1 500/month credits, plus 400/day 5 000/month;
`ai_guard_policy` daily $0.50, monthly $10, per account free $0.05 / plus $0.50 / pro $1.00 / staff $1.00;
per work key $0.25/day; 3 concurrent calls; 2 jobs.

| Advertised, one Plus day | Dollars at ledger p50 |
|---|---:|
| 15 video reads | $0.364 |
| 60 extractions | $0.036 |
| 10 uploads | $0.033 |
| 60 explain/swap | $0.021 |
| 400 Pumpy credits (≈ $0.00016/credit, derived) | $0.064 |
| **One day of the advertised Plus plan** | **$0.518** |
| **Thirty days of it** | **$15.53** |

- One Plus subscriber exercising one advertised day costs **103 % of the entire project's $0.50 daily
  budget** and **31× their own $0.50 monthly allowance**.
- The $0.50 monthly guard funds **20.7 video reads a month**. The daily cap advertises 450. The hidden
  guard bites at **4.6 %** of the advertised number.
- Free is worse and it breaks a written promise. Walking `ai_reserve` at measured reserves and charges:
  preview 1 admits ($0 + $0.0339 ≤ $0.05), preview 2 admits ($0.0078 + $0.0339), preview 3 admits by
  $0.0005, **preview 4 is refused** ($0.0234 + $0.0339 = $0.0573 > $0.05). At anything above p50 the
  third is refused too. *The four promised free previews cannot be delivered under the current free cap.*
- Free's own Pumpy ladder is 1 500 credits/month ≈ $0.24 — **4.8× the $0.05 the account is allowed**.
- Project-wide: $0.50/day ÷ $0.0339 reserved = **14 premium reads a day for everyone**; $10/month =
  ~413 reads. This month used $0.643 (6.4 % of the cap) across 14 accounts, but the worst single day
  already ran at **39 % of the daily cap with three accounts on it**.

## 3. Proposed customer-visible monthly allowances

**Reset: the 1st of the month, 00:00 UTC.** Not rolling. Every dollar guard already resets on
`date_trunc('month', UTC)`; `video_previews` is already keyed `(user_id, month, shortcode)`; Pumpy's
copy already says "my credits come back on the 1st". A rolling window needs a second counter, a second
sentence in the copy, and makes "what do I have left" unanswerable in one number.

| | Basic (free) | Plus |
|---|---|---|
| Library | 20 workouts held | no ceiling |
| Saves from a caption | not counted — the shelf is the gate | not counted |
| **Video reads** (movements, cues, on-screen text) | **4 previews a month** | **20 a month** |
| Pumpy coaching answers | 100 a month | 300 a month |
| Explanations and swaps | 20 a month | 100 a month |
| Uploads | 1 a month | 10 a month |
| Logging, Workout Mode, plan, Progress, export | free, unmetered | free, unmetered |

"Preview" means one full premium reading of one video — the same reading Plus gets, kept for ever on
that card, re-readable without spending another one. A cache hit never consumes a preview and never
grants access the account is not entitled to.

| Implied cost per account-month | Basic | Plus | Target |
|---|---:|---:|---|
| Whole allowance used, ledger p50 | $0.184 | **$0.783** | — |
| Whole allowance used, ledger p95 | $0.543 | $2.204 | — |
| Heaviest account-month actually observed (9 saves / 14 turns) | $0.227 | $0.227 | — |
| Median account-month actually observed (1 save, 3 credits) | ~$0.001 | ~$0.025 | — |
| **Planning mean** | **≤ $0.03** | **≤ $0.35** | free ≤ $0.03, paid ≤ $0.35 |

Caption saves are unmetered, so "whole allowance" has to assume a volume for them: 20 for Basic (its
shelf) and 60 for Plus (the burst stop), at $0.0006 p50 / $0.0036 p95 each. That is $0.012 of the
Basic p50 figure and $0.036 of the Plus one.

The targets are means, not ceilings, and they hold with these numbers **only under stated conditions**:

- Plus stays under $0.35 unless the average subscriber exceeds **14 video reads a month**. Trigger: if
  the measured mean crosses $0.35, cut the read allowance to 12 or move `pack.sheets_model` to
  Flash-Lite (recorded reader average $0.00264, n = 2 — an estimate, not a result).
- Basic stays under $0.03 only while **≤ 15 % of free accounts use their full allowance** (0.15 × $0.184
  + 0.85 × $0.001 = $0.029). Today 0 of 8 accounts have taken a single preview, so this is untested.
- Free subsidy: at the plan's 5 % paid share that is 19 free accounts per payer × $0.03 = **$0.57 —
  exactly the ceiling, with no slack**. Any drift in free-account behaviour breaks it before anything else.

**The sentence for the paywall and Settings › Plan:**

> Plus reads 20 videos a month — the movements, the spoken cues and the text on screen — with 300
> coaching answers from Pumpy and a library with no ceiling. Saving from a caption, logging, your plan
> and your progress are free and are never metered. Allowances reset on the 1st, 00:00 UTC.

Basic, on the same screen: *"Basic reads four videos a month in full. Everything you have already saved
stays readable for ever."* Settings shows one line per allowance — `Video reads 3 of 20 this month ·
resets 1 Oct` — in the same shape as the existing preview counter.

## 4. Funded launch budget, replacing the $10 global cap

`cap = (A_free × U_free + A_plus × U_plus) × (1 + f) × h + R`

`U_free = $0.03` and `U_plus = $0.25` (the heaviest account-month observed, $0.227, rounded up).
`f = 0.12` failure allowance — measured: 8.5 % of this month's estimated dollars were in not-ok calls,
plus one `unknown` reservation worth $0.037 (5.8 % of the month); 12 % covers both. `h = 2.0` demand
variance — justified by the 39 %-of-daily-cap day inside a 6 %-of-monthly-cap month. `R = $0.50`
in-flight reserve = 3 concurrent calls × $0.0436 worst observed reservation × 2 settlement windows.
Paid share 5 %, per the forecast.

| Active users | Modelled spend | × failure | × variance | Funded monthly cap | Daily cap |
|---:|---:|---:|---:|---:|---:|
| 30 (28.5 free / 1.5 paid) | $1.23 | $1.38 | $2.76 | **$5** | **$0.50** |
| 100 (95 / 5) | $4.10 | $4.59 | $9.18 | **$12** | **$1.20** |
| 300 (285 / 15) | $12.30 | $13.78 | $27.55 | **$35** | **$3.50** |

Daily cap = monthly ÷ 30 × 3, so a normal burst never trips it. At 300 active the $35 ceiling is 56 %
of the $62.50 recognised monthly revenue those 15 payers produce, and the *expected* $13.78 is 22 % —
which is what the forecast's own AI + free-user lines imply, so the model is internally consistent.

**Thresholds and what degrades, in order.** Alert at **60 %** of the monthly cap, or on any UTC day
above 3× the trailing 7-day median; nothing degrades. At **80 %**, premium video reads become Plus-only
and free previews pause with an honest message — and the preview must **not** be consumed. At **95 %**,
Pumpy pauses for free accounts; Plus coaching and text extraction continue. At **100 %**, no new AI work
starts. Never degraded at any threshold: logging, Workout Mode, the plan, Progress, the library,
editing, viewing, export, cached saves, and re-reading anything already saved.

## 5. Exact changes for the senior session — NOT executed

Config alone can move the money. It **cannot** make a count reset monthly: `guard_save_allowance` and
`ai_admit` both bucket on `date_trunc('day')`, `/api/limits` returns `saves_today`/`extracts_today`, the
4-preview number is hard-coded in `reserve_video_preview` and in `video_previews: { cap: 4 }`, and
`LIMIT_CHAT` is a plan-independent 200/day env value. So the interim below sets each **daily** count
equal to the published **monthly** count — the daily cap can then only stop a same-day burst — and makes
the per-account dollar guard, now sized at the published counts, the real monthly ceiling. Publishing a
monthly *count* in the app is a code change and is the senior session's call.

```sql
-- 1. Funded launch budget. Pick the row from §4 for the active-user count you are at.
--    This one is the 100-active-user row. It replaces the beta $10/$0.50.
update public.ai_guard_policy set daily_usd = 1.20, monthly_usd = 12 where singleton;

-- 2. Per-account ceilings sized so a published allowance can never be refused:
--    p95 charge on the video read (so an unlucky video still lands), p50 on the rest,
--    plus one worst-case Gemini reservation ($0.0436) of admission headroom.
--    free  = 4 x 0.0573 + 100 x 0.00065 + 20 x 0.00035 + 1 x 0.00328 + 20 x 0.0006 + 0.0436 = 0.360
--    plus  = 20 x 0.0573 + 300 x 0.00065 + 100 x 0.00035 + 10 x 0.00328 + 60 x 0.0006 + 0.0436 = 1.488
update public.ai_guard_policy
   set user_monthly_usd = '{"free":0.40,"plus":1.50,"pro":3.00,"staff":3.00}'::jsonb
 where singleton;

-- 3. Daily counts become burst stops, never the number anybody is sold.
--    Changed vs live: free media 2->4 (four previews in one sitting must fit),
--    free helper 25->20, plus media 15->20, plus helper 60->100. Pro and staff untouched.
update public.app_config
   set value = '{"free":{"library":20,"saves":30,"extract":10,"media":4,"uploads":1,"helper":20},'
             || '"plus":{"library":null,"saves":200,"extract":60,"media":20,"uploads":10,"helper":100},'
             || '"pro":{"library":null,"saves":500,"extract":150,"media":50,"uploads":25,"helper":600},'
             || '"staff":{"library":null,"saves":null,"extract":null,"media":null,"uploads":null,"helper":null}}',
       updated_at = now()
 where key = 'limits.plans';

-- 4. Pumpy's credit ladder is left exactly as it is. At the measured p95 of 14 credits
--    an answer, free's 1500 buys 107 answers and plus's 5000 buys 357 — both above the
--    100 and 300 published in section 3, so no published answer can be refused.
```

Secrets and env names to check, not to set: `LIMIT_SAVES`, `LIMIT_EXTRACT`, `LIMIT_MEDIA`,
`LIMIT_UPLOADS`, `LIMIT_HELPER` — if any of these is set on the function it silently overrides the
**free** plan's row above and statement 3 will appear not to work; `LIMIT_CHAT` (200/day, every plan);
`AI_USAGE_ENVIRONMENT`. One code constant must move with statement 1: `DAILY_SPEND_USD = 0.50`
(`index.ts:656`) is what `/api/limits` reports as `spend_limit`, and it will keep saying $0.50.

## 6. Fixed costs — what is actually required before 25 paying users

| Cost | Price (verified 2026-09-17) | Required before 25 payers? |
|---|---|---|
| **Supabase Pro** | $25/mo: 100 k MAU, 8 GB disk, 250 GB egress, daily backups kept 7 days. Overage $0.125/GB storage, $0.09/GB egress, $2/M function calls. Free pauses a project after 1 week idle and has no backups. [pricing](https://supabase.com/pricing) | **Yes — before the first payer.** A paused project is an outage for someone who paid, and Free has no backup to restore. |
| **Apple Developer Program** | $99/yr | **Yes** — iOS cannot ship without it, and it is the blocker today. |
| Google Play registration | $25 one-time | Already done — the Play catalog exists at $6.99/mo and $50/yr. |
| OpenAI / Google billing | pay-as-you-go, no tier to buy | No. Budget the Gemini 3.6 Flash doubling on 2027-01-01. |
| RevenueCat | free below $2 500/mo tracked revenue, then 1 %. 25 payers ≈ $104/mo tracked. [pricing](https://www.revenuecat.com/pricing) | No — but annual cash can cross the line before recognised revenue does. |
| Stripe Managed Payments | 3.5 % on top of 2.9 % + 30¢ ≈ **6.4 % + 30¢**, i.e. $3.50 on a $50 sale. [pricing](https://stripe.com/pricing) | Only if the web checkout is kept. The forecast assumes native-only, where store fees replace this. Decide before launch. |
| GitHub / Pages / Actions | free for a public repo | No. |
| Domain + WordPress | marketing surface | No. |
| Transactional email (Resend free 3 000/mo) | $0 | No. |

## 7. Copy audit — every sentence that becomes wrong

| Where | What it says | Why it breaks |
|---|---|---|
| `tools/stripe-plans.json` → `products[plus].description` | "An unlimited library, and more of everything that costs money to make: 200 saves, 60 extractions, 15 video reads, 10 uploads and 60 coaching answers **a day**." | Every number and the unit. This string is pushed to Stripe by `tools/stripe-setup.sh`, so it is live product copy. |
| `app.ts` `CAP_WORDS` (~11310) | "new videos read **today**", "silent clips watched **today**", "uploads **today**", "saves **today**", "explanations and swaps **today**", each with " a day" | The entire 429 vocabulary is daily. |
| `app.ts` `planCtxLine` (~11345) | "That is N …, the free plan's **daily limit**. It resets at **midnight UTC**. Plus allows N **a day**." | Wrong limit, wrong reset, wrong comparison. |
| `app.ts` `planCtxLine` pumpy branch (~11338) | "That is my coaching done **for today** — my credits come back at **midnight UTC**." | The monthly branch directly above it is already right; the daily one goes. |
| `app.ts` `planBenefits` (~11301) | "Video reading and coaching have usage limits; they are not unlimited." | True but evasive once there is a number to print. |
| `app.ts` (~1302) | "You get four Plus video previews **each month**." | **Correct — keep it.** It is the model every other line should copy. |
| `README.md` 808–813 | cap table headed "per day" on five rows | Five rows. |
| `README.md` 674 | "The five **daily** caps below exist to stop abuse" | Still true of the burst stops, but the sold unit is monthly. |
| `README.md` 243 | "Settings shows the day and month counts" | Becomes month only. |
| `index.ts` `/api/limits` (~12765) | `saves_today`, `extracts_today`, `helpers_today`, `limit_*`, `spend_limit` | Field names are daily; new monthly fields are needed before the copy can change. |
| `docs/index.html` | generated from `app.ts` | Fixed by `node build.mjs`, must be committed with the source. |
| `wordpress/terms.html:32` | "A subscription does not include unlimited AI requests." | **Correct — keep it.** |
| `.native-build/google-catalog-verification.json` | "More workout saves and library space", "More Pumpy coaching" | **Survives unchanged** — carries no counts and no "a day". Prices already $6.99/mo, $50/yr. |

## 8. Founding coupon and existing discount commitments

`tools/stripe-plans.json` has `founding.enabled = false`, and its own note says that a source setting
does not disable a coupon that already exists in Stripe. What the database shows (verified):
three `subscriptions` rows — one `manual / active / plus` with no price key (a comp), one
`stripe / active / plus / year` and one `stripe / trialing / plus / year` set to cancel at period end,
both on the single lookup key `spotter_plus_year`. **No row carries a coupon, discount or promotion
field of any kind**, so there is no discount commitment recorded in Spotter.

I cannot confirm from the database that no *real* money moved. `subscriptions.raw` is a trimmed
projection — its only keys are `cancel_at`, `cancel_at_period_end`, `id`, `latest_invoice`,
`lookup_key`, `price`, `status`, `synced_at` — and it carries **no `livemode` flag** (0 true, 0 false,
3 absent). `tools/stripe-setup.sh` documents the intended path as a sandbox `sk_test_…` key, which is
suggestive and is not proof. **Owner step:** open the Stripe dashboard in live mode and confirm zero
payments and zero active `SPOTTER_FOUNDING_YEAR` redemptions before publishing any price.

## Open risks not touched here

- A refused reservation after `reserve_video_preview` has already inserted the row would burn a promised
  preview on work that never happened. Worth a look before previews are marketed.
- `ai_reserve` counts in-flight work at its **reserve**, so a per-account ceiling is really "spent so far
  plus one worst case". Any published count must be sized against the p95 *charge* plus one worst-case
  reserve, which is what §5 does; a narrower guard silently un-sells the allowance.
- `ai_cost_log` still holds 42 token-bearing rows this month estimated at zero (retired Groq and
  `gemini-*-latest` aliases). Reconciling any of it against a provider invoice remains undone.
- 15 of 17 transcription calls failed this month. Whatever the cause, the upload allowance in §3 is
  priced off two successful samples.

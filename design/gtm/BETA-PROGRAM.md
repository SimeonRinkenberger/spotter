# Spotter — beta program pack

Prepared 17 September 2026 for CEO plan **Gate 2 — observed product value**: roughly 20-30 target
users, at least five observed end-to-end sessions, a varied sample of roughly 100 supported imports,
consent collected before any private content is reviewed, and five customer conversations a week.

Nothing here was sent. No outreach, no recruiting, no message. Every piece of text below is a draft
for the owner to send himself, one person at a time. Automated or bulk outreach is explicitly out of
scope for this plan.

**Voice rules applied throughout:** no exclamation marks, no hype, no "unlimited", no accuracy
claims, no medical claims, no promise about what the AI will get right.

---

## 1. Tester invite

Send one at a time, from the owner, to someone he knows saves workout videos. Short on purpose.

> Subject: Would you try the thing I built?
>
> Hi <name> —
>
> I built an app called Spotter. You save a workout video from TikTok, Instagram or YouTube, it
> pulls out the exercises, sets and reps so you can check and fix them, and then walks you through
> the workout and logs what you lifted.
>
> I am looking for about twenty-five people to use it for a few weeks and tell me where it fails.
> You would be one of the first, which means you will hit rough edges — some videos it cannot read
> at all, and the cards it does build sometimes get an exercise or a rep count wrong. That is most
> of what I want to hear about.
>
> What I would ask of you:
>
> - Install it and save the workouts you would have saved anyway.
> - When a card is wrong, fix it in the app and tell me which video it was.
> - Twenty minutes on a call at some point, so I can watch you use it rather than guess.
>
> What you get: the paid features free while you are testing, and someone who actually fixes what
> you report.
>
> No cost and no card. You can stop whenever you want and delete your account from inside the app
> in two taps.
>
> If you are in, reply and I will send the install link and a short consent note about what I would
> be able to see.
>
> — Simeon

**What the invite deliberately does not say:** how accurate extraction is, how many videos it can
read, that the AI is unlimited, or that Plus will stay free after the beta. If a tester asks what
happens at the end, the honest answer is: the complimentary access ends when the beta does, nothing
is charged automatically, and nothing is deleted.

---

## 2. Consent — reviewing a tester's saved videos and cards

The CEO plan requires consent before reviewing private source content, and Gate 2's sample of ~100
imports cannot happen without it. Send this as its own message and keep the reply. **Do not look at
anyone's library before their reply is in hand.**

> **What I would like to look at, and what I would not**
>
> To make the extraction better I need to compare what a video actually shows with the card Spotter
> built from it. That means looking, on my side, at the workouts in your Spotter library: the links
> you saved, the creator and caption that came with the post, the card Spotter produced, and any
> corrections you made to it.
>
> If you say yes, here is exactly what that covers and what it does not.
>
> **I would look at:** the videos you saved and the cards built from them, including the parts you
> fixed. Your corrections are the most useful thing in the whole beta — they tell me what Spotter
> got wrong without you having to write it down.
>
> **I would not look at:** your logged sets, weights, plan or progress; your conversations with
> Pumpy; anything you type in a note. If I ever need one of those to explain a specific bug, I will
> ask you first, for that one thing.
>
> **What I do with it:** read it, write down what went wrong, and fix the reader. I do not share it,
> publish it, sell it, show it in a screenshot, or use it in any marketing. Nothing from your
> library appears in a store listing or a demo. If I want to use something of yours in a screenshot
> I will ask separately.
>
> **How to withdraw:** reply "stop looking" at any time, by email or on a call, and I stop that day.
> You do not have to give a reason and it does not end your access. You can also delete your whole
> account in the app — Settings, Data and privacy, Delete account — which erases everything and
> ends this with it.
>
> **Reply with "yes, you can review my saved videos and cards" if you agree.** If you would rather
> not, that is fine; you can still test everything and tell me about problems in your own words.

Keep each reply in one place with the date. Record consent state per tester in the cohort sheet
(column `consent_review`), and treat "no reply" as "no".

---

## 3. Tester onboarding checklist

Run this once per tester. It should take under fifteen minutes of theirs.

**Before you send anything**
- [ ] Their platform is known: Android, iPhone, or neither.
- [ ] They are in the cohort sheet with an acquisition source.
- [ ] Their consent reply is recorded, or marked as declined.
- [ ] A complimentary Plus entitlement is ready to apply to their account once it exists.

**Android — Play closed testing (the path that works today)**
- [ ] Their Google account email is on the closed-test tester list in Play Console.
- [ ] Send the opt-in link Play generates, and tell them they must accept the invitation on the same
      Google account before the Play listing will appear for them.
- [ ] They install from Play, not from a file.
- [ ] Fallback if Play is slow to propagate: the signed APK `releases/android/Spotter-1.0-2.apk`
      (SHA256 `1ec07519d458016d51b030f214fab6bc4085c64834d0bd8b062c55019b5f8ff8`), sideloaded. Use
      this only if you must — a sideloaded build does not test the Play purchase path, which is the
      thing the closed test exists to test.

**iPhone — TestFlight (not available yet)**
- [ ] Blocked on Apple Developer Program enrollment. Until then, iPhone testers use the web app.
- [ ] When it exists: add them as an external tester, submit the build for TestFlight review, send
      the public link, and tell them the build expires in 90 days.

**Web PWA — the fallback for everyone else**
- [ ] Send https://simeonrinkenberger.github.io/spotter/ and tell them to add it to the home screen.
- [ ] Say plainly that the web app is a stop-gap and will be retired after the native apps ship, and
      that their account and library carry over.

**First run, on a call if possible**
- [ ] They create an account with email or Continue with Google.
- [ ] You apply the complimentary entitlement and they confirm the plan screen shows it.
- [ ] They save their first video **from their own feed**, not one you picked. This is the single
      most informative minute of the whole beta.
- [ ] They open the card, find something wrong, and fix it — so they have done it once before it
      matters.
- [ ] They start a workout and log one set.
- [ ] Show them: Settings > Data & privacy > Export my data, and Delete account. Say the words "you
      can leave with your data at any time."
- [ ] Tell them where to send a broken card: the support address, with the video link.

**After**
- [ ] Note in the sheet: platform, install path, date activated, whether the first save produced a
      usable card, and anything they said in their own words.

---

## 4. Interview script — five customer conversations per week

Twenty minutes, by the founder. The CEO plan's instruction is to focus on **observed problems and
repeated use, not whether people like the idea**, and Gate 2 adds two required questions: what they
previously did with saved videos, and whether Spotter changed their actual training behaviour. Those
are questions 1 and 5 below.

Open with: "I am not going to ask whether you like it. I want to know what you actually did."

1. **Before Spotter, what happened to the workout videos you saved?** Where did they go, and when
   did you last do one of them? *(Gate 2's required question. Listen for the real prior behaviour —
   a saved folder nobody opens, a screenshot, a note, nothing.)*
2. **Walk me through the last workout you saved in Spotter. What did you do next?** *(Do not accept
   a summary. Ask for the specific video and the specific next action. If the next action was
   nothing, that is the finding.)*
3. **Show me a card Spotter got wrong.** *(Screen share. Have them point at it. Then: what did you
   do about it — fix it, ignore it, or drop the workout? Record whether it meets the critical-
   correction definition in section 5.)*
4. **The last time you trained, was Spotter open?** *(If yes: what did you use it for, and what got
   in the way? If no: what did you use instead, and why?)*
5. **Has anything about how you actually train changed since you started using this?** *(Gate 2's
   second required question. Push past "it is handy". Looking for: a workout done that would not
   have been done, a session logged that would not have been logged, or an honest no.)*

Close with: "If I switched it off tomorrow, what would you miss, if anything?" and then stop talking.

**Recording rules.** Ask before recording. Write the notes the same day. Put verbatim quotes in the
notes, not paraphrases — a paraphrase is already an interpretation. One line per conversation in the
cohort sheet, the full notes in the session folder.

---

## 5. Critical correction — the definition, fixed before review

Verbatim from the CEO operating plan, and not to be reinterpreted after seeing results:

> Define critical correction before review: missing/invented exercise, wrong equipment or materially
> different variation, wrong creator dose, or a workout that cannot be used as presented. Minor
> wording changes are separate.

Operationally, when reviewing an import, mark it **critical** if any of these is true:

- an exercise that is in the video is missing from the card, or an exercise that is not in the video
  appears on it;
- the equipment is wrong, or the variation differs materially from what was demonstrated or
  prescribed;
- the creator's prescribed dose — sets, reps, time, rounds — is stated wrongly on the card. A value
  the creator never gave, left blank, is **not** a critical correction; a value invented in place of
  a blank **is**;
- the workout cannot be used as presented.

Mark it **minor** for wording, capitalisation, exercise naming that still identifies the same
movement, ordering that does not change the session, or a missing value the source never supplied.

Two rules that make the measurement honest, both from the plan:
- **Supported-input boundaries are fixed and shown to users before measurement.** Decide in advance
  which platforms and post types count as supported, and do not exclude a failure after seeing it.
- **Counts with denominators, never a bare percentage.** "7 of 94 supported imports needed a
  critical correction" is a finding. "93% accuracy" is not.

---

## 6. Cohort tracking sheet — columns

One row per tester. Keep staff and test accounts out of it entirely.

| Column | Type | Notes |
|---|---|---|
| `tester_id` | short code | use this everywhere else; do not put names in shared notes |
| `first_name` | text | owner's copy only |
| `contact` | email | owner's copy only |
| `acquisition_source` | enum | personal, creator outreach, referral, other. Required by the plan; every tester has one |
| `platform` | enum | android, ios, web |
| `install_path` | enum | play_closed, apk, testflight, pwa |
| `invited_on` / `accepted_on` / `activated_on` | date | activated = account created and first save completed |
| `consent_review` | enum | yes, no, no reply — with the date of the reply |
| `entitlement_granted` | date | complimentary Plus applied |
| `imports_total` | int | all saves |
| `imports_supported` | int | the denominator for every quality number |
| `imports_usable_no_critical` | int | numerator for the ≥90% target |
| `critical_corrections` | int | per the section 5 definition |
| `minor_corrections` | int | kept separate, never merged into the above |
| `first_workout_started_on` | date | for the "half start a workout within seven days" target |
| `reused_saved_workout_week_n` | int | count of later weeks in which a saved workout was used again |
| `sessions_completed` | int | |
| `observed_session_on` | date | one of the five Gate 2 observed sessions |
| `interview_dates` | list | |
| `incidents` | text | entitlement, edit-loss or concurrency incidents, referencing the log |
| `support_contacts` / `support_minutes` | int | feeds the scorecard |
| `withdrew_on` / `withdraw_reason` | date, text | including a consent withdrawal |
| `notes` | text | verbatim quotes, dated |

Derived, not stored: every percentage. Compute them with the denominator beside them each week.

---

## 7. Weekly scorecard — template

One review a week, one sheet, from the plan's "Team process" list. **Counts alongside percentages,
every time. Segment by native platform, acquisition source and model route. Staff and test accounts
excluded.**

**Week of _________ · cohort size __ · reviewed by Simeon**

| Metric | This week | Last week | Denominator / note |
|---|---|---|---|
| Paid accounts, actual | | | excludes staff, trials, manual grants, sandbox |
| Net recognized revenue | | | recognized, not cash collected |
| Activated users | | | account created and first save completed |
| Users who returned to use a workout | | | of __ activated |
| Supported imports reviewed | | | the denominator for the next two rows |
| Usable imports, no critical correction | | | __ of __ — target ≥90%, provisional |
| Critical corrections | | | by category: missing/invented, equipment/variation, dose, unusable |
| Minor corrections | | | reported separately, never merged |
| Testers who started a workout within 7 days of activating | | | __ of __ — target ≥half, provisional |
| Testers who used a saved workout again in a later week | | | __ of __ — target ≥a third, provisional |
| Entitlement / edit-loss / concurrency incidents | | | **any non-zero number here is a stop** |
| Complete-workout cost, mean and p95 | | | from `ai_cost_log`, by model route |
| Complete-workout latency, mean and p95 | | | |
| Total free-user subsidy | | | free service expense ÷ paying subscribers; planning figure is $0.57/payer-month |
| Acquisition spend | | | $0 authorized; record anyway |
| Net new payers | | | |
| Support contacts / support minutes | | | |
| Observed sessions this week | | | running total toward five |
| Customer conversations this week | | | target five |

**Segments to carry on every row that has them:** android / ios / web; acquisition source; model
route. **Kept separate always:** production, experiments, failed calls, retries, unknown charges.
An unknown cost is never recorded as zero.

**Three questions to answer in writing under the table each week:**
1. What did a customer fail to do this week that they were trying to do?
2. Which number moved, and what is the human explanation for it?
3. What are we stopping, because of something in this table?

**Gate 2 is met when:** 20-30 consented testers are active, five end-to-end sessions have been
observed, roughly 100 supported imports have been reviewed against the section 5 definition, and
the three provisional targets have been measured — met or not. Measuring them is the gate;
hitting them is a management judgement afterwards, on counts, not on one percentage.

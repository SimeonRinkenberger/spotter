# pack-eval — the bench log

Every run that changed a decision about how Spotter reads a video. Newest first. Add a
section here whenever `tools/pack-eval/live.ts` is run, with the date, the function version and
the exact command, so the next person can tell a measurement from a memory.

The offline baseline at the top is what `npm run eval:offline` prints today. It costs nothing
and must stay at 3/3; if it ever does not, something in the pure half of the pipeline moved and
the diff that moved it is the one to look at.

---

## 2026-09-16 — offline baseline (no model, no network)

`npm run eval:offline` · main at `b6a2cb6` (wave B's catalog attributes and #12's reader label)
+ branch `vcp-d` · **PASS 3/3, 7 movements matched**

| fixture | eye | movements | missing | extra | stamped | mean \|Δt0\| | equipment | cues within rules | deltas |
|---|---|---|---|---|---|---|---|---|---|
| `tt-7679960172495785246` (WODfather) | sheets | 5 of 5 | 0 | 0 | 5 / 5 | 0.38 s | 5/5 exact | 5/5 length, 5/5 two-sentence, 4/4 quote the creator | 5/5 |
| `tt-7508781312874908974` (silent) | video | 2 of 4 recorded | 0 | 0 | 2 / 2 | 0.00 s | 2/2 exact | 4/4 length and sentences, no creator to quote | 4/4 |
| `ig-dumbbell-finisher` (caption only) | none | — | — | — | 0 / 0 | — | — | no cues in the fixture | 4/4 null |

An offline run labels its pack `sheets:fixture` or `video:fixture`. That is deliberate: since #12
a reader label names the model that actually looked, and nothing looked here — the observation came
out of the fixture. The live runner labels its packs `sheets:<the model it benched>`.

**The first thing it caught, on the day it was written.** Run against main at `5081680` the
fixtures passed 3/3; rebased onto `b6a2cb6` one delta failed — the kettlebell sumo deadlift high
pull lost `load between the feet`. That turned out to be an improvement, not a regression: before
wave B the catalog knew only a family-level standard, so a single bell between the feet read as a
difference from a barbell in front of the thighs, and wave B's per-entry attributes give that
entry its own `load_position: "between the feet"`. Nothing is left to report, so the delta is
correctly null and the fixture was updated to say so. **That is the whole shape of the thing: the
eval does not decide whether a change is good, it makes sure somebody looks.**

Advisory, not failures:

- **Verb-first: 40 % on the WODfather cues.** Three of the five golden cue lines open with an
  adjective or a noun — "Slow and controlled…", "Hip hinge…", "Below 90 degrees…" — because the
  creator's own coaching point does. The prompt asks for verb-first and the scorer measures it;
  it does not enforce it, because enforcing it here would be scoring the fixture rather than the
  pipeline. Watch the number, not the build.
- **Surface overlap 0.20 on the WODfather.** `variantOf` takes `surface` from the first contact
  fact that names a surface, which on the push-up is "feet together on the mat, body in a
  straight line" rather than the fixture's "hands elevated on the bell, feet on the mat". Both
  are true; the assembler's is the less useful one. Worth a look when wave B's catalog
  attributes land.
- **`reps` provenance on the silent fixture is not checked.** `readObservation`'s `numOrNull`
  turns a JSON `null` into 0 (`Number(null) === 0`), so a model that writes `"reps_visible": null`
  gets `reps_seen: 0` and provenance `seen`, and one that omits the key gets `null` and `none`.
  Which Gemini did on 15 Sept was never recorded, so the fixture leaves the expectation out.
  **This is a real bug in `pack.ts` and it is out of wave D's reach** — reported separately.

---

## 2026-09-15 evening — the reader decision: Gemini reads the sheets

`POST /api/worker/eval-sheets`, header `x-pack-eval-key`, purpose `pack_eval`, `sys:` actor with a
null user. Identical pixels to every model: the phone's own three 4×3 sheets of 270×480 cells
(`tools/fixtures/eval/tt-7679960172495785246/sheet-{1,2,3}.jpg`, 398/420/355 KB).

**The question.** On the WODfather push-ups the athlete's hands are stacked on the kettlebell
handle. A person looking at the sheet can see it. Can the reader?

| model | sheets | transcript | what it said about the hands | cost | time |
|---|---|---|---|---|---|
| `gpt-5.6-luna` | phone 270 px | sent | "hands on the mat" — **wrong** | ~$0.003 | 13.6 s |
| `gpt-5.6-luna` | phone 270 px | withheld | "hands on the mat" — **wrong** | ~$0.003 | — |
| `gpt-5.6-luna` | 2× magnified | sent | "hands close together beneath chest; hands and feet on exercise mat" — **wrong** | ~$0.003 | — |
| `gpt-5.6-terra` | phone 270 px | sent | hands on the kettlebell — **right** | $0.020 | — |
| `gemini-3.6-flash` | phone 270 px | sent | "close-grip kettlebell push-up, hands on kettlebell body, toes on mat" — **right** | **$0.007** | **6.7 s** |

**What it settled.**

1. **Resolution is not the lever.** Luna said "hands on the mat" at 200 px cells, at the native
   270×480, and on 2× person-magnified crops where the fingers are unmistakably wrapped around
   the handle. Three sizes, one answer.
2. **Nor is anchoring.** The blind run — no transcript in the prompt, so the words "push ups"
   never reach the model — gave the same wrong answer. It is perception, not suggestion.
3. **So the model is the lever.** Gemini 3.6 Flash got it right on the phone's unmagnified
   sheets at a third of Terra's price and in half the time. Production `pack.sheets_model` became
   `gemini-3.6-flash` (migration `20260915170000`), and `ai-guard.ts` gained a scoped exception
   letting purposes `pack` and `pack_eval` send at most 3 inline JPEGs of at most 600 KB to
   Gemini. No person-crop magnification is needed, which keeps the phone's work at 3.1 s.
4. **Cost per unique video, native path: ≈ $0.008** (Gemini reads the sheets, Luna builds the
   card), paid once per video for everyone who ever saves it.

**`PACK_EVAL_KEY` was unset on the function after this bench**, so the route answers 404 today.
Set it with `supabase secrets set` before benching again, and unset it after: it is the one route
in the file whose whole purpose is to spend money on demand.

The magnified sheets are kept at `tools/fixtures/eval/tt-7679960172495785246/zoom/` (202/214/171 KB)
because they are the evidence for point 1, and `live.ts --zoom` posts them.

---

## 2026-09-15 midday — the two readers, end to end

Not an A/B, but the numbers the design's cost model rests on.

- **Sheets path**, WODfather, simulated phone upload (7×3 sheet of 200 px cells), function v156/v157:
  TikTok's own ASR WebVTT read from the datacenter — 15 timed lines, **free** — Luna read the sheet
  in **13.6 s**, 2,867 in / 1,090 out ≈ **$0.002**, sheet deleted after, pack valid, **5 of 5**
  exercises stamped. Card: `diamond-push-up` ✓, `sumo-deadlift-high-pull` ✓, verbatim cues with
  timestamps ✓, equipment kettlebell ✓. The miss at that size was the hands, which is what the
  evening bench above went after.
- **Gemini video fallback**, the silent TikTok `tt-7508781312874908974`, 34 s:
  `generationConfig.mediaResolution: LOW` confirmed at ~70 tokens a frame, **19.5 s**,
  3,641 in / **2,644 out** ≈ **$0.013**. Output tokens were three quarters of the bill, because
  every field came back as a sentence restating the movement — which is why `OBSERVE_PROMPT` now
  caps every string field at 12 words. Pack valid, 0 re-queries, 4 segments seen, 0 said,
  **2 of 4** card exercises stamped (the camera's compound names share no wording with the
  creator's, and the positional pass cannot run when the counts differ).

Two bugs this run found, both fixed in wave A and both pinned by the fixtures now:

- delta on the renegade row read `load Dumbbell resting on floor pulled to waist level; with
  dumbbell` — the exercise's own definition, reported as a difference from itself.
- delta on the snatch read `with dumbbell` without ever naming what the standard version uses.

---

## How to add to this file

```sh
# offline, free, run it before and after any prompt or model change
npm run eval:offline

# live, spends money, needs the key set on the function
PACK_EVAL_KEY=… PROJECT_REF=… npm run eval:live -- --model gemini-3.6-flash
PACK_EVAL_KEY=… PROJECT_REF=… npm run eval:live -- --model gpt-5.6-luna --blind
PACK_EVAL_KEY=… PROJECT_REF=… npm run eval:live -- --model gemini-3.6-flash --repeat 5   # p50/p95
```

Record the date, the function version, the exact command, the numbers the runner prints
(tokens in/out, cost, p50/p95 ms) and — the part that matters six months from now — **what the
run changed your mind about**. A row of numbers with no decision attached to it is a row nobody
reads twice.

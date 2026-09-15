# TikTok carousel extraction incident — 8 September 2026

Post: https://www.tiktok.com/@greek.bro/photo/7640241369507728661

## Findings

Read the matching production workout, ingest job, video cache and AI cost records, and the Supabase function Logs UI. Times below are America/Chicago.

- 09:22:43: saved. Luna text extraction succeeded at 09:22:50. The caption describes a six-move leg session but contains no exercise list or doses.
- 09:24:10: original job completed with zero exercises. Vision summary: `4 read, 7 timed out, 4 retried, 0 abandoned`. These counters include attempts, not distinct successful slides.
- Original-import logs include Gemini 429 responses at 09:23:44 and 09:23:46, and a 503 UNAVAILABLE/high-demand response at 09:24:10.
- 09:26:19: first reread also completed with zero exercises; `3 read, 7 timed out, 3 retried, 2 abandoned`.
- 09:27:28: later reread produced seven exercise entries from four slide indices (1–4); `4 read, 6 timed out, 3 retried, 2 abandoned`. Slides 5 and 6 were abandoned when the time budget expired. Successful vision provenance includes gemini-flash-lite-latest.
- Repeated 429 rate-limit responses and 503 high-demand responses are visible throughout the retries. Successful Gemini calls disprove a wholly missing/invalid key. Logs do not establish the precise quota dimension or billing status.
- The latest stored card is partial despite `has_full_workout: true`. Alternatives such as barbell squat / hack squat and seated / lying leg curl are stored as separate exercises with “choose one” notes. Seven entries therefore do not mean seven completed workout slots.
- Luna receives the caption/text prompt. The image path calls Gemini only; there is no Luna image fallback. This incident does not test Luna’s ability to interpret the images.
- geminiGenerate returns immediately on 503 rather than proceeding through the model pool. Rate-limit retries and per-slide timeouts consume the overall carousel budget. Failed slides can still lead to a ready/done result. These backend behaviors remain unchanged in this UI-focused fix.

## Fix

Removed the rotation animation from Read it again. The button shows stationary Reading… text and aria-busy while a request is in progress, prevents duplicate requests for the same workout, restores its state after success/failure, and keeps responses attached to the original workout if the user navigates away.

Used Apple’s progress-indicator guidance to keep progress feedback local to the control: https://developer.apple.com/design/human-interface-guidelines/progress-indicators . The existing caption-reader control already uses the same stationary Reading… label.

## Verification and delivery

- `node tools/reread-harness.mjs`: passed busy label, duplicate-click suppression, success/error/rejection cleanup, queued response and navigation cases using mocked requests; no paid AI calls.
- `npm run ios:assets`: passed, rebuilding the web page, generated edge page and native assets.
- `npx cap copy ios`: passed, copying updated assets into the Xcode app.
- `npm run ios:check`: haptics/drafts, keyboard and streaming checks passed. The unchanged share-check.mjs failed in its Swift fixture at main.swift:14; the full suite is not green.
- No backend deploy, production data edits, key/billing changes, or paid re-extraction performed. Updated iPhone binary has not been installed or verified on device.

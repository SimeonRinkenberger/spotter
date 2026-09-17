# Native reader and coaching fixes — September 17, 2026

Production schema and Spotter edge function deployed September 17. Both native debug builds passed and were installed/launched on the available iOS simulator and Android emulator. App Store/TestFlight distribution remains unavailable: this checkout uses a local Personal Team and the physical iPhone is disconnected. See the release evidence below.

## Behavior

- Basic and Plus use separate shared-cache card variants. Basic cannot copy a visual result simply because a subscriber previously saved that URL. Each asynchronous job only updates its own account's workout, and entitlement is checked again before delivery.
- Reading quality and the plan used are recorded. Plus can upgrade a previously Basic result. A Basic write cannot overwrite a completed Plus cache entry.
- Free accounts explicitly request up to four distinct Plus video previews per UTC calendar month. Reservations are serialized in PostgreSQL, repeat taps are idempotent, and unfinished reservations are refunded when reading fails. Completed preview workouts remain in the person's library.
- Basic loading text and workout details explain the difference and show preview usage. Pumpy clearly describes its Plus capabilities; chat and proposal acceptance are also gated on the server.
- Pumpy receives every exercise in the selected attachments. The old 1,200-character cutoff silently dropped movements. Compact exercise lines and the existing AI admission/budget controls remain.
- Workout creation prompts ask one or two missing-context questions. Missing exercise doses are stored as separate, explicitly attributed recommendations rather than creator facts. Session logging can use those suggestions.
- Generated Pumpy workouts use new legs, core, and upper-body artwork packaged in both native apps.
- Workout detail exercise rows and whole blocks support swipe-to-reveal Delete, an accessible button alternative, and Undo. Block deletion checks for stale content. Existing whole-workout deletion remains available in Options.
- Workout Mode shows red/green target completion for regular sets and circuit rounds and permits extras.
- TikTok exercise links display a segment range and send a seek request to TikTok's player after readiness, validating the message origin and source. Actual seeking still depends on the provider allowing playback of the post.
- Compound-name matching avoids adding the same movement again when a reread changes conjunctions or equipment wording. Workout insertion also guards against duplicate realtime/proposal delivery.
- Google sign-in preparation, native credential storage, and token exchange have bounded waits and recoverable errors. The user's actual system sign-in interaction is not given an arbitrary timeout. Web Google fallback handles unavailable One Tap.

## AI spend

Read-only audit of the project's recorded usage estimated about $0.261 in Gemini usage since September 15, including evaluation calls. This is the application's estimated ledger, not a reconciled Google invoice.

Luna remains the text default. Gemini 3.6 Flash remains the visual reader because existing benchmark notes document failures when Luna interpreted exercise frames. This change avoids the initial caption extraction before an eligible full visual pass, reuses valid media packs, and prevents accidental repeated free-preview reads. A bounded live comparison was subsequently run; see the September 17 results below.

Groq adapters, configuration fields, secret-setup instructions, and obsolete streaming tests were removed. The migration retires its model configuration. Historical usage records/migrations remain intact. The obsolete deployed secret is removed during release cleanup.

Gemini Flash-Lite is cheaper, but switching requires exercise-video comparison tests first. Pricing: https://ai.google.dev/gemini-api/docs/pricing

## Validation

- iOS simulator build succeeded with current native assets.
- Android clean debug build, lint, and unit tests succeeded. A prior incremental build contained duplicated generated dex files; the clean build resolved it.
- Native/web parity checks and native Google, Apple, keyboard, stream, share, and frame-sheet checks passed.
- Google regressions include preparation timeout, exchange timeout, and retry after each.
- New actual-server-function checks cover Basic/Plus cache separation, legacy media protection, complete attachments, recommendation provenance, owner/job-scoped completion, and downgrade during a visual job.
- New PostgreSQL/PGlite checks exercise the actual migration: preview limits, repeat requests, account isolation, UTC rollover, RLS, restricted reservation execution, and protection of the premium cache during Basic updates.
- Mobile-shell browser checks at 375px cover light/dark layout, preview count, swipe deletion/Undo, target completion/extras, Pumpy disclosure, and TikTok segment selection. Screenshots are in this directory.
- Existing regressions passed: merge (54), streaming (115), media (60), Pumpy pack (92), source trust (8), ingest coverage (10), plus offline pack evaluation and AI guard/admission checks.
- Server type check and git whitespace validation passed. Access and database regressions are included in release CI.

These tests do not replace real-device Google consent/callback testing, live TikTok embed behavior, or live model evaluation of the new coaching instructions.

## Release sequence

1. Apply `supabase/migrations/20260917120000_reader_quality_previews.sql` before deploying the function; new code requires these columns and RPC.
2. Deploy the Spotter edge function and rebuilt shared app assets together. Remove the obsolete Groq deployed secret after successful deployment. Retain the current Gemini model configuration.
3. Sync/package the native assets and distribute the new native builds. Local debug products are `.native-build/Build/Products/Debug-iphonesimulator/App.app` and `android/app/build/outputs/apk/debug/app-debug.apk`.
4. On staging or a test account, exercise both save orders (Basic then Plus; Plus then Basic), four previews and a rejected fifth, a failed preview, attached-workout coaching, and Google login/cancel/retry on physical iOS and Android devices.
5. Confirm provider usage and response quality after release before changing the visual model.

## Supabase custom Google auth domain

Supabase Pro starts at $25/month and the custom-domain add-on is $10/month: approximately $35/month baseline for one Micro project, plus domain registration and any usage overages. Pro alone does not provide a custom auth domain.

- Upgrade the organization/project to Pro and enable Custom Domains.
- Choose a subdomain you control, for example `auth.yourdomain.com`, and enter Supabase's exact CNAME/TXT records in your DNS provider.
- Add `https://auth.yourdomain.com/auth/v1/callback` to the existing Google OAuth client's authorized redirect URIs. Keep the old Supabase callback during migration.
- Configure the Google consent-screen app name and verified application domain separately; buying the Supabase add-on does not configure Google's branding.
- Activate the verified Supabase domain, update the application's Supabase client URL and native Google URL allowlists, and preserve `com.spotter.auth://callback` in Supabase's allowed redirects. Rebuild both native apps before removing the old callback.
- The native auth allowlists currently intentionally accept the original Supabase host. They must be changed to the actual chosen domain; do not replace host validation with a wildcard.

Official references:
- https://supabase.com/pricing
- https://supabase.com/docs/guides/platform/manage-your-usage/custom-domains
- https://supabase.com/docs/guides/platform/custom-domains
- https://supabase.com/docs/guides/auth/social-login/auth-google


## September 17 release evidence and additional optimization

- Added authenticated native preflight: cached readings and duplicate saves skip downloading, decoding and uploading the video. Both app shells use it; the iOS Share Extension also checks directly with its ingest key. A unavailable preflight falls back to the existing full-quality reader.
- Server ordinary-save processing reuses a verified cache even when older native clients have already sent new frames. Explicit paid rereads retain fresh analysis.
- Cached Plus previews are immediate and issue zero model calls. The database still atomically enforces the four-video monthly quota.
- Identical transcript text is sent to extraction only once when the entire transcript is already represented in the structured pack. Partial or truncated packs keep the separate original transcript. Visual-only packs now reach extraction even without a caption or speech.
- Kept native frame resolution/coverage, original subtitle preference, source attribution, and model quality settings. On-device transcription was not substituted: permission, language and accuracy differences require separate evaluation. Explicit provider cache storage was not added for short one-off clips; Spotter's stored structured reading avoids the entire repeated model call without a provider storage fee.
- Fixed the production-only preview count query to select `shortcode`, because the preview table uses a composite key and has no `id` column. A regression now checks that contract.
- Live checks with disposable accounts passed: Plus-to-Basic cache isolation, duplicate save idempotency, preflight, free Pumpy refusal, immediate cached preview, usage count and four-preview limit, stale-block refusal, whole-block removal with correction recording, Pumpy questions before a proposal, missing-dose recommendations and combining every attached movement. All test accounts and fixture cache rows were removed.
- Missing-dose live testing exposed an ambiguous model schema: recommendation instructions existed but the formal exercise object omitted that key. The formal schema now includes it, and a fresh live test returned labeled recommendations while preserving null source reps/sets.
- Google provider settings are enabled. Automated native tests cover PKCE validation, preparation/exchange timeouts, cancellation and retry. Full Google user-consent completion on a physical device remains unverified.
- UI smoke tests pass at 375 px in light/dark, including whole-block Undo. iOS and Android debug builds, Android lint/unit tests, native parity and existing regressions pass.

### Model comparison (same fixture, two runs per model)

| Model | Average estimated cost/read | Total | Strict fixture result |
| --- | ---: | ---: | --- |
| Gemini 3.1 Flash-Lite | $0.0026 | $0.0053 | 0/2 fully clean |
| Gemini 3.6 Flash | $0.0069 | $0.0138 | 0/2 fully clean |

Flash-Lite was roughly 62% cheaper in this small test. This is not enough evidence of equal quality: it had timing, catalog-identity, movement-detail and provenance differences. The current reader also had strict mismatches, including a push-press/overhead-press naming mismatch in one run. No production model switch was made. These results are a useful limitation, not a claim that either reader is error-free. The four comparison calls cost approximately $0.0191 combined, plus small Luna smoke-test calls.

### Upper-body artwork

Replaced `docs/assets/pumpy/workout-upper.webp` using the built-in image-generation tool, then inspected and resized to the native 640px WebP asset. Final prompt: preserve Pumpy's orange plate, cheerful face, shoes, wings, cream background and vintage ink style; redraw exactly two arms and white-gloved hands in a relaxed standing curl, each with a coherent closed grip around the center handle of one dumbbell, clear thumbs, no fused/extra digits or floating equipment. Both native builds package the replacement.

Sources: Google Gemini pricing, model and context-cache documentation; Apple Human Interface Guidelines on gestures. Cache reuse removes duplicate work rather than reducing the evidence seen by the reader. Swipe actions retain a visible alternative and Undo.

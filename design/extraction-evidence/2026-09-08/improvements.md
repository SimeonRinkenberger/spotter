# Spotter extraction improvements

## Decision and prior conversation

Reviewed the user's ChatGPT conversation **Workout App Model Comparison** (1 September 2026). It explicitly described Luna as accepting text and images but not direct audio/video. Its proposed economical pipeline was text/transcripts/selected frames through Luna, with direct video understanding when needed. That is consistent with the current official [Luna model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna).

The implementation had narrowed Luna to text and sent all carousel images to Gemini. This change removes that unnecessary dependency. Modality support establishes that Luna can receive the inputs; it does not prove extraction accuracy on a particular post.

## Changes implemented locally

- Images: Luna first, with high image detail, reasoning disabled, JSON output and a 4,000-token output cap. One configured Gemini fallback on failed/unreadable/malformed/refused/truncated output; no alias rotation or repeated 429 calls within a slide request.
- Provider requests have abort deadlines, sharing at most 28 seconds and reserving time for fallback inside the existing per-slide ceiling. Successful reads never call a second model. Actual reported usage and failed attempts go to the existing cost ledger. Existing spend gates still apply.
- Explicit empty image results differ from failed image reads. A provider outage, image-download failure or invalid JSON is no longer reported as a successfully read empty slide.
- The job checkpoint retains the assembled card and confirmed slide indices. Automatic job retries retain successful pages and retry missing pages without re-extracting the caption. Retries remain bounded by the existing attempt cap.
- Incomplete attempts use queue backoff. After the attempt cap, a useful partial workout carries an explicit missing-images warning; a completely unreadable post fails and remains retryable. The UI shows the warning on ready partial cards. Slide caps also produce coverage warnings.
- Partial caches cannot bypass extraction. An incomplete reread cannot overwrite a cache known to have full image coverage. Complete cache hits still cost no model calls.
- The image prompt addresses circuits, supersets, AMRAP/EMOM, intervals, choose-one alternatives, unreadable text, and instructions embedded in source images. Alternatives are requested as one OR-labeled slot. This is a prompt rule, not a measured model-quality guarantee.
- A string set range such as `2-3` is preserved in notes with a null numeric sets field instead of silently becoming `2`.
- The stationary reread-button fix remains packaged in the web and native assets.

No production database rows, billing settings, credentials, or account data-sharing settings changed. No backend deployment or phone installation performed.

## Input routing

| Available source | Economical path | Important limit |
| --- | --- | --- |
| Complete caption or web text | Existing text extraction | Preserve quoted evidence; do not pay for unnecessary media |
| Carousel or screenshot images available to the reader | New Luna image reader; one Gemini fallback on failure | Image quality and cross-slide instructions still need real evaluation |
| Spoken workout video | Existing transcription, then text extraction | Missing or contradictory visual information may require the video reader |
| Silent demonstrations, mixed speech/overlays | Existing selective Gemini video escalation | Luna cannot accept raw video/audio; frames alone can miss motion and speech |
| Failed/blocked media retrieval | Retry or show an honest incomplete result | Changing models does not grant access to missing source media |

The supported normalization already covers straight sets, timed exercises, circuits, supersets and other block types. The existing media, merge, confidence and catalog suites passed with these changes. This is not a claim that every social-platform format is reliably downloadable or understood.

## Cost

Current [Luna rates](https://developers.openai.com/api/docs/models/gpt-5.6-luna): $0.20/M uncached input, $0.02/M cached input, $1.20/M output. [Image inputs](https://developers.openai.com/api/docs/guides/images-vision) are metered as tokens; high detail bounds the image representation and preserves more small text than low detail.

Illustrative aggregate usage, not measured imports:

| Usage across an import | Luna cost per import | 1,000 such imports |
| --- | ---: | ---: |
| 5,000 input + 1,000 output tokens | $0.0022 | $2.20 |
| 30,000 input + 7,000 output tokens (carousel example) | $0.0144 | $14.40 |

These examples exclude fallback, retries, transcription/video, retrieval, hosting and storage. The output cap is a ceiling, not expected usage. Aborting a request does not guarantee that a provider bills no work already performed. The existing daily ledger is an estimated spend guard, not a transactional hard reservation across concurrent jobs. A custom OpenAI image-model override needs corresponding pricing configuration; the default remains Luna.

Avoid adding providers or self-hosting solely for a marginal token-price saving until measured errors and volumes justify it. Google's [video documentation](https://ai.google.dev/gemini-api/docs/video-understanding) supports joint video/audio understanding; its [pricing](https://ai.google.dev/gemini-api/docs/pricing) depends on the configured model and tier.

## Validation and remaining live evaluation

Offline tests cover the real provider adapter, job coordinator, carousel assembly, retries, merging, normalization and evidence scoring. They do not contact AI providers. Type checking and web/native asset builds pass.

Still unverified: live Luna image quality/latency and extraction correctness on the user's original post. The local environment has Supabase access, but no directly available OpenAI key for a local model evaluation; deployed secrets were not retrieved. The live backend continues to use the old reader until deployment. The prior full iOS suite also has an unrelated Swift share-activation assertion failure.

Before calling the model choice validated, evaluate a fixed set of manually checked examples: this carousel, the previously successful carousel, a dense table, a choose-one plan, a cross-slide rep table, a handwritten screenshot, a spoken-only video, a silent demonstration and a mixed/conflicting post. Measure missing/extra exercise slots, exact sets/reps/rest, grouping, unsupported numbers, incomplete-result detection, latency and total billed usage. Include Luna output in the evaluation, not only a stronger development model. A successful HTTP response or valid JSON is not a quality score.

A future optimization worth testing is a small multi-image request for interdependent pages, or transcript plus selected video frames. Neither is switched on here: its cost and ability to preserve cross-page relationships should be compared on the labeled examples first.

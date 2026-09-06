# Speed and motion: starting audit

Inspected 6 September 2026 at commit `54c43b1` (Pumpy 0.12). This is a source-level
map and a reproducible build-size baseline for the
[implementation prompt](performance-motion-prompt.md). It is **not** a fresh browser
latency profile or a claim that the possible bottlenecks below have been measured.

## Verified baseline

`node build.mjs` succeeds and regenerates the existing outputs without a diff:

| Generated content | Bytes after build |
| --- | ---: |
| Head | 1,704 |
| CSS | 106,444 |
| Body markup | 34,374 |
| JavaScript | 402,371 |
| Complete page | 544,893 |
| Complete page, build-reported gzip | 142,394 |

These are artifact sizes, not measured HTTP transfer sizes or load times. Fonts,
the external Supabase SDK, pictures and API responses are additional resources.
The build strips comments but intentionally does not minify. Prior handoff timing
claims describe earlier builds and fixtures and must not be reused as this baseline.

## Existing behavior worth preserving

- `boot()` deduplicates startup. Account-checked library cache paints before server
  revalidation. Profile loading runs alongside library loading.
- `warmPages()` schedules Plan, Progress, Pumpy and eligible billing-price work in
  idle time. Already drawn content generally survives tab navigation.
- Workouts use owner-filtered Realtime plus a polling fallback. Plan uses a shape
  signature to avoid an unchanged silent repaint; logs have a memory cache.
- `api()` shares in-flight explain/demo-video/swap calls. Pumpy streams NDJSON into
  a mounted text node and follows the bottom only while the reader is near it.
- Video players use a facade and are created on demand. Demo lookup prefers the
  curated catalog and cache before a metered search.
- Ingest is queued; provider work, caches, checkpoints, budgets and concurrency
  controls already exist. Pumpy snapshots/history are read concurrently.
- Pager motion uses a retargetable spring and localizes frequently updated CSS
  variables. Motion tokens and Reduce Motion rules are already extensive.
- The shell service worker has a 1.5-second network-first fallback to cached HTML;
  first-party Pumpy art is cached on use. It excludes Supabase/CDN responses.
- Pumpy 0.12 fixes continuous visible greeting blinks and explicit workout-context
  attachment. Preserve both, including late-history race protection.

## Network and rendering map

Names below are search anchors in the current source, not permanent line numbers.
Frontend anchors are in `supabase/functions/spotter/app.ts` unless specified.

| Area | Entry points and dependencies to trace |
| --- | --- |
| Shell/auth | `markup.ts` SDK preload, font stylesheets, `loadScript`, `loadAuthProviders`, auth session callbacks, `boot` |
| Shared transport | `api`, `apiStream`, Supabase client reads/writes; cancellation, HTTP/body errors, auth and operation-specific deadlines |
| Library | `paintCache`, `load`, `render`, `renderGrid`, `writeCache`, `watchWorkouts`, `onWorkoutChange`, `watchPending`, foreground listener |
| Detail and edits | `openDetail`, `patchWorkout`, correction/reprocess/media routes, collections and membership writes |
| Saving and uploads | `doAdd`, share capture/consume handlers, `doUpload`, XHR progress, storage upload, ingest API |
| Exercise help/media | `prefetchExplain`, `watchBit`, `demoAPI`, `vidPaint`, explain streaming, swap and catalog lookup |
| Workout session | Prefill query, `renderWorkout`, `saveSet`, completion insert, `renderSummary`, awards, share canvas |
| Plan | `loadToday`, `loadPlan`, `planShape`, optimistic add/remove, copy reads/inserts/rollback |
| Progress | `loadLogs`, `loadAwards`, `renderProgress`, `renderHistory`, derived statistics and cache invalidation |
| Pumpy | `openPumpy`, `loadPumpy`, `openThread`, meter, `sendPumpy`, `liveEvent`, `renderPumpy`, `renderPumpyCtx`, confirmation |
| Integrations/account | Billing prices/subscription/sync/return polling; Strava status/OAuth/activity; push setup; profile, export and deletion |
| Backend | `index.ts`: config, DB helpers, ingest/worker/media/vision, explain/demo/swap, `handlePumpyChat`, `pumpyRun`, router/auth |
| Backend integrations | `billing.ts`, `strava.ts`, `push.ts`; `net.ts` guarded outbound requests; migrations/indexes/RLS |
| Motion | `style.ts` transitions/keyframes; `cardIn`, `viewIn`, sheets/disclosures, `liveEvent`, pager `paint`/`springTo`/`arrive`, guide motion |
| PWA | `docs/sw.js` cache lifetime, timeout fallback, versioning, navigation behavior and lazy art; installed-app update path |

## Prioritized hypotheses to measure

These describe verified code behavior and its possible cost. They do not establish
that the cost dominates real use, or prescribe a rewrite without profiling.

| Priority | Observation | Measurement and possible direction |
| --- | --- | --- |
| 1 | `watchPending()` schedules `load()` every four seconds while processing rows remain, with a bounded poll count. `load()` reads workouts, collections and membership. | Count polling/Realtime/foreground duplicates and background work. Consider targeted pending-row reconciliation, single-flight reads and visibility-aware fallback. Keep recovery when sockets fail. |
| 1 | `load()` waits for all three reads before displaying fresh workouts, despite retaining old collections on collection-query errors. | Delay only the collection reads and measure first usable card. Consider independently applying Library rows while preserving correct filtering and collection UI. |
| 1 | `renderGrid()` clears the grid and recreates visible cards, including on search input. `seenCards` already prevents repeat entrances. | Profile typing and Realtime updates with 200 cards. Reconcile stable nodes if it reduces work without losing sorting, grouping or focus. Do not remove the existing entrance suppression. |
| 1 | Both revalidation and Realtime can call `openDetail(current, true)` for an open workout. | Test long scrolled details, expanded exercises, focus and active embeds during updates. Patch affected sections if full replacement causes disruption. |
| 1 | Shared `api`/`apiStream` wrappers provide no general default deadline or cancellation path. Individual call sites may differ. | Inventory each operation first. Test hangs and late responses; use distinct read/write/stream recovery policies rather than a universal short timeout. |
| 2 | `loadPlan()` writes shared state after its range queries settle. `loadLogs()` caches completed rows but has no in-flight promise at that function. | Delay/reorder week changes, overlap warm/visit loads and switch accounts. Verify freshness guards and deduplication before changing caching. |
| 2 | `liveEvent()` updates text then calls `pumpyFollow()`, which can read layout and set scroll on every event. Final replies call `renderPumpy()`. | Record sustained streaming and final replacement, especially while reading older messages. Consider frame-batched deltas and stable finalization if measured work or jumps warrant it. |
| 2 | Library reads up to 200 full workout rows; logs read up to 400 full rows over 182 days. Cache JSON work is synchronous even when scheduled idle. | Measure response/parse/storage costs with realistic large rows. Split summaries from detail only with explicit handling of every consumer and cache invalidation. |
| 2 | Cold visits invoke some tab data work in `arrive()`, after the spring settles; background warming often hides that delay. | Test immediate navigation before warming. Start necessary reads on navigation intent while preserving the rule that contextual tips require actual arrival. |
| 2 | `handlePumpyChat()` performs config/meter/limit/thread setup before `pumpyRun()`; the latter already parallelizes snapshot/history. | Trace time to first useful answer and distinguish necessary validation from independent reads. Optimize the latter without weakening caps or thread ownership. |
| 3 | A large inline page loads alongside an external SDK and two font services; translucent chrome, list effects and media add rendering work. | Profile cold startup and scrolling. Compare minification, font/asset strategies and layer/paint costs against the current appearance and browser behavior. |
| 3 | The service worker waits up to 1.5 seconds for cached shell fallback; cache-first mascot assets depend on versioned URLs for freshness. | Test poor/offline links and installed upgrades. Evaluate perceived startup and freshness together; changing strategy must not strand users on an old build. |

## Evidence still required

No new latency measurements, dropped-frame recordings, network-throttled runs,
physical-iPhone tests or backend query plans were captured for this document.
The implementation task must collect those before claiming an optimization.
The previous Pumpy release's functional checks remain documented in `HANDOFF.md`
and `design/pumpy.md`; they do not substitute for the new performance test matrix.

The prompt incorporates primary guidance on [Web Vitals](https://web.dev/articles/vitals),
[rendering](https://web.dev/articles/rendering-performance) and
[animation profiling](https://web.dev/articles/animations-guide). Its 100ms feedback
and 1s ordinary-read goals are proposed Spotter product targets, not universal
guarantees or thresholds attributed to Apple.

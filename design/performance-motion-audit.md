# Speed and motion: audit and implementation

The starting inspection below records commit `54c43b1` (Pumpy 0.12) on 6 September
2026. The [implementation results](#implementation-and-measured-results--6-september-2026)
add measured comparisons, changes, regression evidence and remaining acceptance work
for the [implementation prompt](performance-motion-prompt.md). Starting hypotheses
are retained as historical context, not presented as measurements.

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

## Evidence still required at the starting point

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


## Implementation and measured results — 6 September 2026

The local performance pass is implemented on `performance-motion`, starting from
clean `main` at `a4151de` (runtime baseline `54c43b1`). No backend, schema, model,
secret or production configuration was changed. This is a tested local candidate,
not a deployed release. `AGENT-CONTEXT.md` reserves push/merge/deployment for the
senior session. The app version remains 0.12; the changed service worker is v7.

### Conditions and reproducibility

Measurements used the Codex in-app Chromium 152.0.0.0 on an Apple M5 Mac, 10 logical
CPUs, 24 GB RAM, arm64, Darwin 25.5.0. The lab viewport was **375 × 812** throughout
each paired run. No CPU or browser network throttling was enabled. These are desktop
measurements; the ~8.3ms median animation-frame interval does not certify an iPhone
or a physical display refresh rate. Assets/SDK/fonts were already in browser cache.

`tools/performance-server.mjs` serves the generated app on localhost:8000. `/lab`
injects `performance-browser.js` into the app closure, substitutes deterministic
read fixtures and disables persisted lab auth/SW registration. Auth settings and
external resource initialization can still start before injection. `/profile.html`
uses real disposable-account API reads and `startup-browser.js`; both instrumented
routes are local-only and never included in generated pages. Save the baseline
with `git show a4151de:docs/index.html > /private/tmp/spotter-performance/baseline.html`,
then run `node tools/performance-server.mjs /private/tmp/spotter-performance/baseline.html`.
Open `/lab?version=before` and `/lab?version=after` at the same viewport, awaiting
`#lab-results` each time. The server writes sanitized reports to
`/private/tmp/spotter-performance`; committed copies and screenshots are in
[the evidence directory](performance-evidence/2026-09-06/).

Every key synthetic comparison contains five repetitions within one page run,
not five independent cold launches. Fixtures contain 0/20/200 cards, eight exercises
per card except one 40-exercise workout, grouped creators, 80 chat-history messages,
and 400 logs across 167 days. No query limit was raised. The streaming stress case
uses 200 deltas in one synchronous burst; it measures UI overhead, not normal token
cadence or model latency. Progress includes DOM creation, an explicit layout read,
and waiting for the next animation frame. Presentation timings are next-rAF proxies,
not compositor screenshots or field INP measurements.

### Before/after

All values are milliseconds, **median [minimum–maximum]**, n=5 per cell. Source
reports: [before](performance-evidence/2026-09-06/before.json),
[after](performance-evidence/2026-09-06/after.json).

| Scenario | Before | After | Interpretation |
| --- | --- | --- | --- |
| Unchanged empty grid, synchronous work | 0.3 [0.1–0.5] | 0.3 [0.2–0.4] | No measured gain |
| Unchanged 20 cards, synchronous work | 0.4 [0.4–0.7] | 0.1 [0.1–0.1] | Stable nodes |
| Unchanged 200 cards, synchronous work | 3.1 [2.7–5.2] | 0.4 [0.2–0.7] | ~87% less synchronous work |
| Unchanged 200 cards, next-frame proxy | 12.5 [11.4–15.6] | 8.1 [6.6–9.3] | Less rebuilding/layout |
| Alternating search over 200 cards, next-frame proxy | 7.0 [5.8–16.9] | 9.5 [7.6–10.0] | Median regression; under 100ms, no speedup claim |
| Overlapping Library loads, first render | 240.7 [240.2–241.5] | 42.3 [41.2–54.4] | Controlled 40ms workouts/240ms collections; ~198ms dependency removed |
| Same load, all reads settled | 253.7 [248.7–258.6] | 241.8 [241.2–242.5] | Completion still waits for collections |
| Dense stream burst, synchronous work | 25.8 [25.1–38.0] | 0.1 [0.0–0.3] | Append text now; follow-scroll once per frame |
| Dense stream burst, next-frame proxy | 28.7 [26.7–38.5] | 3.9 [1.7–8.0] | No artificial typing delay |
| Progress, 400 logs and next-frame proxy | 61.1 [49.7–92.1] | 44.7 [37.8–64.0] | Reuse two locale formatters instead of constructing 800 |

The overlapping-load fixture makes **8 → 5** database calls: two competing sets of
three Library reads become one set; both versions also make two Today reads.
Concurrent history reads become **2 → 1**. Pending fallback becomes one owner-scoped
workout query for pending IDs instead of the three-query Library load every four
seconds. Polling pauses while hidden, never overlaps and stops after 75 attempts;
foreground resets the recovery budget. This is a bounded fixed interval, not
exponential backoff.

Five actual signed-in navigations per cache mode, with the same 20-card disposable
account and warm HTTP resource cache, measured first Library frame as follows:

| Startup mode | Before | Candidate | Interpretation |
| --- | --- | --- | --- |
| App Library cache cleared | 127.5 [114.0–499.1] | 118.7 [113.6–127.7] | Normal local/live-API connection; not cold DNS/TLS/Edge |
| Account Library cache present | 55.4 [51.1–59.2] | 58.2 [50.8–61.3] | Both under 100ms; candidate median slightly slower |

These 20 reports are named `startup-{before,after}-{cached,uncached}-{0..4}.json`.
They precede the final localized account DOM cleanup, grouped-parent reuse,
Progress formatter and screen-reader status refinements. The synthetic report precedes only a final teardown-only refinement that cancels
old-account undo/close timers; the final generated build received the functional reruns; final cold-start certification is
still outstanding. Typical startup resource counts were 22 uncached/24 app-cached,
including background API work; there is no proven large startup network reduction.
Cross-origin Resource Timing without Timing-Allow-Origin reports transfer sizes as
zero/unavailable. Do not interpret those as zero-byte API responses. Connection,
preflight, provider queueing, server execution and decode were not independently
observable from this tool; no invented subphase timings or backend percentiles.

Final shell: **539,651 bytes raw / 144,530 gzip**, versus **544,893 / 142,394**.
Raw is 5,242 bytes smaller; gzip is 2,136 bytes larger (+1.50%) because the added
freshness/transport/reconciliation code has a real compressed cost. JavaScript
syntax-only optimization saves roughly 22.8KB raw/1.8KB gzip on the same intermediate
source compared with comment-stripping alone. Whitespace and descriptive identifier
names remain; the generated diff is large because esbuild simplifies syntax.

The full lab trace has 307/306 rAF intervals before/after: 15/8 exceed 16.7ms and
4/2 exceed 50ms; maxima 75.0/66.8ms. These are scheduling-gap proxies, **not actual
compositor dropped-frame counts**. Long-task entries fell from 3 (86/60/53ms) to
2 (64/51ms), concentrated in the 400-log Progress case. That case still needs work
before claiming consistently smooth large-history rendering. Recorded layout-shift
sums are approximately 0.2231/0.0329; synthetic programmatic navigation/filtering
has no trusted input exclusion, so these sums are not field CLS or a certified
Web Vitals result. LCP/INP and production 75th percentiles were not collected.

### Network ownership and recovery map

Shared rules: Supabase reads use the SDK session plus RLS, now with a 15-second
GET deadline covering body consumption. The wrapper buffers the body once before
SDK parsing. It does not retry writes. Edge `api` gets the current session before
fetch; explicit GETs use 15 seconds, other calls 90 seconds, streaming 240 seconds.
Account lifetimes scope shared promises and discard obsolete results. Shared
explain/demo/swap keys include account and exact request body. Error bodies still
reach operation-specific UI; 401 gives an expiry message. A browser abort does not
prove server work stopped. SDK auth, direct writes and XHR uploads retain their
existing transport behavior. No payment/chat/upload auto replay was introduced.

| Trigger/caller | Endpoint or table / payload | Dependencies, caching and visible behavior |
| --- | --- | --- |
| Shell/sign-in | jsDelivr Supabase UMD; Google/Fontshare CSS/font files; auth settings/session/OAuth/password routes | SDK precedes auth; provider discovery independent. Public HTTP caching; loading/auth errors stay on landing form. Fully cold signed-out startup not benchmarked. |
| `boot`, cache, refresh | `workouts` full rows (200), `profiles`, `collections`, membership projection | Account-keyed local Library cache paints immediately. Profile and Library start independently. Collections no longer gate cards. Read dedupe by account/revision; one existing 900ms Library retry, then pull-to-refresh toast. Cache work remains idle. |
| Realtime / `pollPending` | owner-filtered workout channel; pending ID list to `workouts` | Socket token before subscription. Identical events skip rendering; revision guards reject older reads. One query/poll, no collections, bounded/hidden-aware fallback. Ready/deleted rows reconcile; error preserves known cards. |
| Open/edit/favourite/collections | local rows; workout UPDATE; collections/member CRUD; workout exercises/media/reprocess Edge routes | Immediate local feedback/optimistic edits with rollback/undo where already present. No thinner list payload: captions, blocks, search and Pumpy refs remain complete. Reprocess is explicit, not speculative. |
| Save URL / shared link | `ingest` JSON URL; share capture/consume | Auth and basic validation precede write. Local pending indication; queued backend extraction remains asynchronous. Acceptance and extraction latency were not measured with paid videos. |
| Upload | signed storage upload/XHR progress then `ingest` with upload metadata | File checks and storage success precede ingest. Existing cancellation/progress/error path preserved. No upload replay or routine paid extraction test. |
| Exercise help / demo / swap | `explain` stream or prefetched JSON; `demo-video`; `swap`; catalog projection | User intent/pointerdown triggers helpers; equivalent active requests shared, session caches cleared on account switch. Catalog failures remain retryable. Video/download only on use; no speculative provider work added. |
| Thumbnails, embeds, mascot | thumbnail URLs, lazy player/embed URLs, versioned first-party WebP | Dimensions/lazy-loading and original platform behavior retained. Same-source detail iframe reused when refreshing changed rows; external playback continuity unverified. Asset URLs v12 unchanged. |
| Workout session | latest 25 log entries; completion INSERT to `workout_logs`; achievements UPSERT | Prefill read account-guarded. Set logging is local immediately; finish writes once, invalidates history, then summary/awards. Canvas/MP4 share stays local until user shares. |
| Today / Plan | day projection + week log times; range `plan` + `workout_logs`; add/delete/copy writes | Parallel range reads, deduped by account/range/revision. Navigation starts reads during spring; help requires arrival. Old week cannot replace new week; error keeps data. Add/remove/copy remain optimistic; changed range protected from old delete rollback. |
| Progress / history / awards | full logs limit400/182days; achievements limit300; catalog projection | Warming/visit share active read; failed reads do not cache an empty result. Completion/refresh invalidates history. PR/chart calculations remain correct; History now reuses date formatters. |
| Pumpy open/history/list | latest joined thread/messages limit80; thread list limit50; selected thread messages; `limits` | Existing ref-revision/open-sequence guard retained. Account teardown retires sequences. Failure preserves known chat; explicit reopen retries. Warm load skips meter request. |
| Pumpy send/confirm | `pumpy/chat` stream with thread ID, text, primary ID and IDs; `pumpy/confirm` | Immediate local message/pending. Backend validates owner, quota, meter and thread; snapshot/history already parallel. Confirmation still required for proposed writes. Stream scroll batched, final bubble reused, partial text kept on failure, composer restored, no automatic retry/charge. |
| Billing | prices, subscriptions, checkout, portal, sync/return polling | Public price cache versus account subscription/meter. Read failure no longer caches missing subscription. Existing checkout/sync sequencing and caps preserved; real payments not exercised. |
| Strava | status/connect/disconnect/push; OAuth return | Session → authorization → explicit share. Existing pending/success/retry button states and idempotency preserved. No real activity posted; fixture harness only. |
| Push/profile/account | config, PushManager permission/subscription, subscription CRUD, profile settings/name, rotate-key, export reads, account/delete | Explicit settings/user intent. Export fans out seven owner-scoped RLS reads. Existing destructive confirmations preserved. No native permission or integration-return browser certification. |
| Service worker | first-party shell and mascot cache only | v7 copies previous valid shell before activation, deletes only Spotter caches, retains late network cache writes with event lifetime, falls back on 503/offline. Private API/CDN traffic bypasses cache. 1.5-second timeout unchanged. |

Backend inspection covered the router, async ingest/provider pipeline, helper/Pumpy
paths, integrations, outbound SSRF guard and query/index definitions. No measured
query plans or provider traces justified changing indexes/models or serial quota
validation. Config/meter/thread setup before Pumpy remains a future profiling target;
existing concurrent snapshot/history reads, caps, worker checkpoints, fallbacks and
RLS/SSRF safeguards were preserved. Backend optimization and production p50/p95 are
not claimed by this frontend-scoped pass.

### Transition inventory

Existing 150/220/320/420ms tokens, spring pager, light/dark theme and reduced-motion
rules remain. No framework, global transition-all, blanket layer promotion or
minimum loading delay was added.

| Surface | Change or preserved behavior | Evidence/status |
| --- | --- | --- |
| Library cards / search / groups | Stable keyed nodes and grouped parents; original one-time card entrance; changed cards use restrained 220ms opacity fade | Five-run browser identity checks pass; search median regression recorded above |
| Pending card | Decorative float only when intersecting/active/visible; ready replacement fades | Live fixture became ready without manual refresh; hidden/poll harness checks |
| Open detail / exercises / media | Identical refresh leaves DOM intact; changed refresh restores scroll, expanded rows and same-source iframe | Identical long-detail identity verified; changed external embed playback/focus not certified |
| Sheets / tabs | Existing interruptible transform spring retained; reads begin at navigation intent | 35-frame sheet geometry trace, actual Plan/Pumpy/Library navigation; physical gesture reversal unverified |
| Plan add/remove/copy | Existing optimistic feedback and arrival tokens retained; range guards added | Actual add, copy next week, remove; deterministic out-of-order/race tests |
| Set logging / completion / Progress | Immediate saved-set state, existing completion/share/ring/count motion | Actual 11 reps × 5lb, finish, 55lb summary, Progress history/PR; 400-log stress trace |
| Chat bubbles / refs / proposals | Append text immediately; one scroll/layout follow per frame; reuse final bubble and history nodes | Dense burst + final identity/composer checks; actual contextual reply; existing ref harness |
| Accessible streaming | Live bubble does not announce every token; separate polite status announces completion/failure once | DOM status present, automated/source check; VoiceOver unverified |
| Errors / toasts | Preserve known content, visible retry guidance and partial answers | 401/429/503, malformed stream, deadlines and stale account tests; no blanket automatic replay |
| Welcome / help / mascot | Three skippable steps, looping eye blink, one wing beat, offscreen/overlay/motion-preference gates retained | 48 existing checks; actual new-account welcome finished; 375×667 light/reduced screenshot |

### Functional proof and limits

Build and generated-page parity pass. **224 automated checks pass**: Pumpy 48,
performance/freshness/client transport 20, service worker 7, backend streaming 111,
Strava 38. Commands and output are in `validation.txt` beside the JSON evidence.
`deno check supabase/functions/spotter/index.ts` still fails at unchanged
`index.ts:1756`, `index.ts:8890`, `net.ts:109`; the three errors are captured in
[deno-check.txt](performance-evidence/2026-09-06/deno-check.txt). This pass does not
claim a clean backend type-check or change those restricted files.

Actual localhost/live-API QA used only tagged disposable accounts: empty welcome,
20 ready/pending fixture workouts, selected-workout detail → Ask Pumpy → correct
exercise/context answer, set adjustment/save/finish, Progress history/PR/award,
Plan add/copy/remove, sign-out and same-page account switch. The browser exposed
old filter counts/toast persisting after sign-out; teardown now clears both along
with cards, chat and panels, and the final browser check confirmed empty DOM on
sign-out and an empty Library for the second account. One real contextual Pumpy
call was made; no videos were extracted, payment executed or Strava activity posted.
Fixture accounts and their rows were removed after QA.

Representative screenshots:
[contextual reply, dark 375×812](performance-evidence/2026-09-06/pumpy-375-dark.png),
[completion, dark 375×667](performance-evidence/2026-09-06/summary-375x667-dark.png),
[greeting, light/reduced 375×667](performance-evidence/2026-09-06/pumpy-375x667-light-reduced.png).
Light/reduced conditions were forced in the local QA wrapper, not via an iOS OS
setting. Screenshots establish layout, not motion performance.

Outstanding acceptance work: physical iPhone/Safari with visible keyboard, touch
reversal, VoiceOver/focus, installed-PWA upgrade and real offline SDK availability;
fully cold signed-out/startup network traces; provider first-status/first-text/total
breakdown; video acceptance versus extraction; integration return browser fixtures;
changed-detail external-player continuity; large-history first-render long tasks;
production field Web Vitals and server query plans. New-account UI signup itself
was not exercised (accounts were provisioned by the fixture tool). Edit/favourite/
collection mutations and disconnected-stream recovery did not all receive a fresh
end-to-end browser run; their relevant unchanged behavior/source or focused harness
coverage is not a substitute. No complete acceptance-matrix or deployment claim.

Applied primary guidance: [web.dev rendering](https://web.dev/articles/rendering-performance)
and [animation profiling](https://web.dev/articles/animations-guide) informed the
removal of repeated layout work and frame-gap inspection; [Web Vitals](https://web.dev/articles/vitals)
informed the lab/field distinction; [esbuild minification options](https://esbuild.github.io/api/#minify)
supported syntax-only optimization while retaining readable names. Apple's
[Motion](https://developer.apple.com/design/human-interface-guidelines/motion) and
[Loading](https://developer.apple.com/design/human-interface-guidelines/loading)
pages were opened, but their current text was not available in the browser extraction;
no new Apple quotation or threshold is asserted.

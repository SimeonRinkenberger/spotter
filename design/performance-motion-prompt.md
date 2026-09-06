# Spotter: speed and motion implementation prompt

Copy the prompt below into a coding task with access to the Spotter repository. The
[companion audit](performance-motion-audit.md) records the inspected starting point.
This is an implementation brief; writing it has not yet optimized the application.

---

Act as Spotter's senior web performance engineer and interaction designer. Bring the
care expected of an excellent Apple app to this mobile PWA. **Speed and smoothness
are product requirements: if Spotter feels slow or rough, people will stop using it.**
Inspect, measure, implement, and test. Finish with working changes and evidence,
not just recommendations. Keep the app's existing visual identity and simple flows.

## Understand the current app

Read the applicable repository instructions, `AGENT-CONTEXT.md`, `README.md`, the
newest sections of `HANDOFF.md`, `design/pumpy.md`, and
`design/performance-motion-audit.md`. Then trace the current source. Older handoffs
contain superseded designs and historical timings; neither is proof of current
behavior. Begin by recording the commit, branch, working-tree changes, and available
test/deployment tools. Respect the scope assigned to your role; a delegated agent
does not inherit the senior session's merge/deploy permissions.

Spotter saves fitness videos into a Library, extracts exercises asynchronously,
supports Workout Mode, Plan and Progress, and offers a contextual coach, Pumpy.
The frontend is authored in `supabase/functions/spotter/{app,style,markup}.ts`.
These are `String.raw` templates. Keep the established `var`/`function` style;
never put an inner backtick or interpolation opener inside a template, even in a
comment. `node build.mjs` generates both `docs/index.html` and
`supabase/functions/spotter/page.gen.ts`; commit generated outputs with source.
Do not introduce a framework or animation dependency as a default solution.

## 1. Establish a measured baseline

Map every user-facing network path: trigger, caller, endpoint/table, critical-path
dependencies, payload, authentication, cache scope, deduplication, cancellation,
retry behavior, and visible loading/error/success states. Include direct Supabase
reads and writes, Realtime, polling, Edge APIs, AI tools and provider fallbacks,
uploads, thumbnails/fonts/scripts, embedded video, billing, Strava, push setup,
account export, and the service worker. Record which calls can run independently
and which must wait for validation or earlier results.

Use browser network and performance recordings plus small, removable development
instrumentation. Break a wait into queueing, connection/preflight, server work,
transfer, parse, DOM work, image decode, and presentation. For Pumpy, distinguish
first status, first useful answer text, and completion. For video saves,
distinguish acknowledgement from extraction completion. Record cache hit/miss,
request count, bytes, main-thread long tasks, layout shifts and dropped frames.
Do not log credentials, private workout content, or chat text.

Compare a signed-out cold launch, signed-in cold launch, warm reload, cached launch
with slow/offline revalidation, and navigation within an already open app. Use
empty, 20-card, and 200-card libraries; include long workouts, collections,
pending cards, 400 logs and a substantial chat history. Large fixtures should
exercise the current limits, not silently raise them. Use disposable fixture
accounts, not the owner's data or paid video extraction for routine tests.

Keep test conditions identical before and after: browser/version, viewport,
hardware, cache state, connection, CPU throttling, fixture sizes, and sample count.
Use at least five repeated lab runs for each key comparison and report median and
range. Report backend p50/p95 only with the sample count and limitations; a handful
of calls is not a reliable production percentile. A desktop mobile viewport is
not an iPhone performance measurement. Mark unavailable physical-device tests.

## 2. Make the critical paths fast

Start with measured impact, using these concrete inspection points:

- **Startup:** trace `boot`, `paintCache`, `loadProfile`, `load`, `warmPages` and
  `arrive`. Show usable cached content immediately. Independent collection,
  profile, billing, or background warming work must not hold the Library hostage.
  Preserve new-account intro eligibility and the rule that background warming
  never triggers a contextual tip. Check first-time visits before warming finishes.
- **Library:** profile the three queries in `load`, the four-second `watchPending`
  fallback, `onWorkoutChange`, `renderGrid`, and `openDetail`. Reduce redundant
  reads and DOM replacement. Reconcile changed items by stable identity where
  worthwhile; preserve focus, scroll, expanded rows and media playback. If list
  reads become thinner, load missing detail fields explicitly and retain correct
  search, filters, Pumpy references and offline/cached behavior.
- **Concurrency and freshness:** share equivalent in-flight reads using keys that
  include account, parameters and relevant version. Use request generations or
  cancellation to prevent an old account, week, search or thread response from
  overwriting the current screen. Clear account-scoped caches on sign-out/change.
  Keep known good content on transient errors. Do not treat a failed read as a
  successful empty result. Mutations invalidate the appropriate derived caches.
- **Polling:** retain a reliable fallback when Realtime fails. Avoid re-fetching
  collections and the entire Library just to check a few pending rows. Prevent
  overlapping polls; suspend unnecessary background work and reconcile once on
  return. Use bounded backoff where appropriate. Test missed events, reconnects,
  foreground races, completion, deletion and user-initiated refresh.
- **Plan and Progress:** inspect `loadPlan`, `loadLogs`, `loadCatalog`, today's
  card, awards and history. Avoid duplicate warming/visit reads, bound queries,
  handle rapidly changing date ranges, and update only the affected visual data.
  Optimize calculations or large lists only when measurements justify it.
- **Pumpy and helpers:** preserve streaming in `apiStream`, `liveEvent`,
  `handlePumpyChat`, and `pumpyRun`. Profile authentication, metering, thread reads,
  snapshot/history reads and tool/provider calls separately. Batch UI stream
  updates at most once per animation frame when useful, without holding the first
  useful text. Keep the existing bubble mounted, preserve the reader's scroll
  position, and prevent a jump when final formatted content replaces streamed text.
  Reuse valid explain/demo/swap requests; do not speculate into paid AI calls on
  casual scrolling or eagerly download videos.
- **Backend:** inspect `index.ts`, related integration modules, and query/index
  definitions. Reduce unnecessary serial work, repeated reads and oversized
  responses. Use query plans or equivalent evidence before changing indexes.
  Preserve the async ingest queue, deduplication, cache quality rules, bounded
  worker concurrency, checkpoints, cost caps and provider fallbacks. Faster
  acknowledgement is not faster extraction: measure both. Do not reduce model or
  extraction quality merely to improve a timing number.
- **Transport and failure:** use operation-appropriate deadlines, bounded retries
  for retryable failures, cancellation where safe, and visible recovery. Never
  automatically replay a payment, chat, upload or other write after an ambiguous
  timeout without established idempotency and reconciliation. A browser abort
  does not prove the server stopped. Preserve partial streamed answers on failure.
- **Assets and caching:** measure shell transfer/parse, SDK/font waterfalls,
  thumbnails and mascot decode. Reserve image dimensions, prioritize genuinely
  visible content, and lazy-load offscreen media. Compare compression/minification
  changes against debuggability. Cache private data only with explicit account
  isolation; keep private API responses out of the public shell cache. Version
  changed art and test installed-PWA updates. Keep a safe still-image fallback.

For each optimization, explain the observed problem, choose the smallest effective
fix, and remeasure. Do not reduce request counts by serving stale or incomplete
information. Do not hide loading failures to make the app appear faster.

## 3. Give every meaningful screen change deliberate motion

Inventory all visible arrivals and state changes, and specify each transition:
Library cards and thumbnails, search/filter results, pending-to-ready replacements,
detail panels, exercise disclosures, sheets, tabs, Plan additions/removals, set
logging, completion, statistics, chat bubbles/reference chips/proposals, errors,
toasts, onboarding and contextual help. Every meaningful newly presented surface
should arrive cleanly; reuse existing good motion. Existing content should remain
stable when refreshed, and text should not restart its entrance on every keystroke
or streamed token.

Use the existing easing and duration tokens: `--e-out`, `--e-in`, `--e-soft`,
`--e-spring`, and 150/220/320/420ms durations. As a starting design rule, use
150–220ms for small feedback, 220–320ms for content arrival, and up to 420ms only
where a larger surface needs it. Tune from observation. Begin feedback immediately;
never wait for an exit animation before starting a request, and never enforce a
minimum loading duration or fake typing to make motion visible.

Prefer transform and opacity for frequent animation. Profile compositing rather
than assuming those properties guarantee smoothness. Separate layout reads from
writes, avoid forced layout per pointer move/token/frame, and use `will-change`
only on the surfaces that need it for as long as they need it. Do not add global
`transition: all`, animate every DOM mutation, or promote every card into a layer.
Avoid large animated blurs/shadows and excessive simultaneous staggered entrances.

For insertion, removal or a disclosure, reserve space or use measured layout
transitions that move neighboring content smoothly. Do not squash text. A narrowly
scoped height animation may be appropriate for a small disclosure if profiling
shows it stays smooth; keep it out of gesture hot paths. Skeletons should match
final geometry, remain quiet, and only appear when useful. No blank flash,
double entrance, end-of-animation snap, stale-content flicker or scroll jump.

Preserve interruptible gestures: quick repeated taps, direction changes and
close/reopen must retarget from the current visual state without jumping back to
the start. Clean up timers, listeners and animation work when surfaces close.
Test scrolling while images load, typing while chat streams, and swiping while
background reads finish. Content arrival must not steal focus or interrupt input.

Keep Pumpy cool, understated, and contextual. Preserve the repeating eye-only
hello blink while visible, the single wing beat, motion preferences and pause
behavior behind overlays, offscreen and in background tabs. Do not add mascot
motion everywhere. Preserve the very short skippable three-step welcome and quiet
contextual tips. **Library → workout → Ask Pumpy must immediately show the selected
workout as context and send its ID; late chat history cannot replace that choice.**

Respect Reduce Motion with immediate updates or restrained fades as appropriate.
Preserve keyboard access, screen-reader announcements, focus restoration, inert
inactive pages, 44px touch targets, contrast, and both color schemes. Streamed
content must not cause a screen reader to announce the entire answer per token.
Test at 375px wide and the small-height phone layout, including a visible keyboard.

## 4. Acceptance targets and proof

Treat these as product targets to validate, not a claim that external networks can
always meet them. Record any miss, its cause, and what remains to improve.

| Experience | Target / acceptance check |
| --- | --- |
| Tap, save-set, expand, open a sheet | Visible feedback within 100ms under the declared reference conditions; no wait for the server before acknowledging the action. |
| Warm tab and cached content | Start presenting already available content within 100ms; no blank placeholder or network-gated transition. |
| Ordinary first-party data reads | Aim for ≤1s end-to-end on the declared normal connection, including UI application; measure warm/cold server and cache cases separately. |
| Save a video | Immediate local acknowledgement; aim for server acceptance within 1s on the normal connection. Extraction remains asynchronous with truthful status and retry/recovery. |
| Pumpy | Immediate sent/pending feedback; minimize and report first useful text and total time by scenario. No fake delay, lost partial answer, duplicate charge or blocked composer after failure. |
| Page health | Where measurable, target LCP ≤2.5s, INP ≤200ms and CLS ≤0.1. Production assessment uses the 75th percentile of real visits, segmented mobile/desktop; lab runs are diagnostic, not field certification. |
| Motion | No visible snap or repeated stall in recorded interactions. Inspect frame times against the display's ~16.7ms at 60Hz or ~8.3ms at 120Hz, leaving browser overhead room. Investigate >50ms main-thread tasks and report dropped frames, device and recording conditions. |
| Payload and background work | Reduce measured waste; report raw/gzip shell and critical-path request/byte totals. No unexplained size growth, duplicate requests, runaway polling, or offscreen decorative animation. |

Run the build, applicable existing harnesses, and focused new regression tests for
changed behavior. Browser-test the actual flows; source inspection and screenshots
alone cannot establish runtime speed or smoothness. Exercise:

1. Sign up → skip/finish welcome → save fixture → pending/ready Library → detail.
2. Search/filter a large Library, edit/favorite, collection changes, refresh, and
   a Realtime update while scrolled inside an open workout.
3. Library → Ask Pumpy with warm and cold chat history → verify chip, outgoing
   reference IDs and answer context; stream, scroll upward, disconnect/retry.
4. Log sets → finish → Progress → share; add/remove/copy Plan entries and change
   weeks rapidly while requests are deliberately delayed.
5. Rapid tabs/sheets, gesture reversal, keyboard, light/dark, Reduce Motion,
   background/foreground, slow network, offline, 401/429/5xx, and sign-out/account
   change while reads are in flight. Confirm there is no cross-account data flash.
6. Installed-PWA cached startup and upgrade; exercise relevant integration returns
   with fixtures/test modes, without executing real payments or posting activities.

Keep authentication, owner scoping/RLS, SSRF protections, quota enforcement,
confirmation before Pumpy writes, billing correctness and user data intact. These
are correctness requirements for optimization, not optional overhead to remove.

Run local live-API browser QA on port 8000, which is in the current CORS allowlist.
Use your own tagged `tools/throwaway.py` account and delete its fixtures afterward.
Never delete `spotter-tw-simeon@example.com`. Use the available approved browser
tools; do not assume tools described in old handoffs still exist.

Provide an updated audit with before/after numbers, test conditions, request
counts, representative traces/recordings and concise remaining limitations.
Include a transition inventory showing what was verified, changed or preserved.
Update the handoff and relevant docs. Within existing authorization, commit/push
the tested change and verify GitHub Pages and any changed Edge deployment; otherwise
hand the tested commit to the senior session. Confirm generated page parity and
installed-PWA asset freshness. Do not claim deployment or physical-iPhone testing
without evidence. Finish with a short report: improvements, proof, live/commit
links, and remaining risks.

## Research to apply

- [Core Web Vitals](https://web.dev/articles/vitals): the thresholds above and the
  distinction between lab diagnostics and real-user percentile assessment.
- [Rendering performance](https://web.dev/articles/rendering-performance): account
  for the whole frame pipeline; layout and paint work consume the time available
  for responsive interactions.
- [High-performance CSS animations](https://web.dev/articles/animations-guide):
  prefer composited properties, inspect actual rendering and dropped frames, and
  use layer promotion sparingly.
- Review Apple's current [Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
  and [Loading](https://developer.apple.com/design/human-interface-guidelines/loading)
  guidance before changing interaction behavior. Adapt the principles to Spotter;
  do not copy unrelated visual decoration or claim native performance from a web mockup.

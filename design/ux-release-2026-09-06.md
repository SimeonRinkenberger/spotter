# Plan, workout and Pumpy follow-up — 6 September 2026

Reviewed the newer edits against deployed performance release `a324632` and
main `9cf9991`. These were additional changes, not duplicate or conflicting copies
of the performance pass. Published runtime commit
`3b70b7efe671b44c8ced9d712672cf91e951170d` to main and deployed Supabase function
`spotter` version **141**. No schema/configuration/secret changes.

## Included changes

- Centered completion content, badge rings and sharing controls; narrow screens
  stack the share preview and controls without horizontal overflow.
- Plan returns to the local current week when revisited, including calendar-boundary tests.
- Reps/weight animate in the direction of the change; activated button icons animate
  between states. Reduced-motion preferences keep values responsive without movement.
- The Plan button's Pumpy artwork is clipped to a circle in dark mode.
- The composer's complete attachment list, including an empty list, is authoritative.
  Each current question explicitly identifies its attachments after prior history.
  Unavailable/unauthorized workout references fail with recovery guidance. Owner
  scoping, caps and confirmation before proposed writes remain intact.

## Verification

Build and generated-page parity pass. **235 regression checks pass**: Pumpy 49,
performance/freshness 21, service worker 7, backend streaming 120, Strava 38.
`deno check` still reports the same three existing errors at index.ts:1756,
index.ts:8890 and net.ts:109; the changed backend code introduces no additional
reported type errors.

A 375×812 Chromium fixture preview verified matching badge/ring geometry, no
horizontal overflow, stacked sharing controls, sound-icon animation, increasing
and decreasing reps, weight changes, local current-week Plan on re-entry, round
Pumpy artwork, light theme and suppressed animation under reduced motion. No
JavaScript errors were captured. Physical iPhone/VoiceOver behavior remains unverified.

The deployed API was tested through a disposable account: a thread started with
one attachment, then a real question selected two workouts. The answer named both
workouts and their exercises, and the persisted message retained both IDs. Clearing
the selection persisted an explicit empty list and cleared the thread's primary
workout; an unavailable reference returned 400 with recovery guidance. The two
trivial chat calls made zero AI calls; only one real contextual answer was requested.
Direct insertion into chat tables was denied by RLS during initial fixture setup,
so the test used the normal chat endpoint. Both fixture-account lifetimes were
cleaned up successfully.

GitHub Pages reports the runtime commit built; the function is ACTIVE at version
141. Both live HTML URLs return HTTP 200 and exactly **543,397 bytes**, SHA-256
`066c37e40c5fc2a02bda6dd3d52cfcbfd9ea02b06bff74a48206e64818e090d3`, matching the
reviewed local build. Gzip is 145,586 bytes. The existing service worker v7 matches
its local file; artwork was unchanged. Live landing-page rendering has no captured
JavaScript errors. This includes the earlier performance work and all eight files
that were awaiting publication from the separate UX task.

Sanitized live verification result:

```json
{
  "initial_single_attachment": {
    "http": 200,
    "ai_calls": 0
  },
  "multiple_attachments": {
    "http": 200,
    "status": "ok",
    "elapsed_seconds": 3.59,
    "persisted_refs_match": true,
    "answer_names_both_workouts": true,
    "answer_names_both_exercises": true
  },
  "cleared_attachments": {
    "http": 200,
    "explicit_empty_refs": true,
    "thread_context_cleared": true,
    "ai_calls": 0
  },
  "unavailable_attachment": {
    "http": 400,
    "recovery_message": true
  },
  "fixture_cleanup_http": 200
}
```

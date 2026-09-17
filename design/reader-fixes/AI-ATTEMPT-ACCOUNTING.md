# Authoritative AI attempt accounting

Implemented locally September 17, 2026; not deployed and no paid calls made.

`ai_reservations` is the authoritative estimated-charge ledger. Its new `attempt_meta` object records purpose, action/job correlation, explicit environment/experiment classification, the applied price version and token rates, provider request/response identifiers when available, returned model, HTTP status, normalized input/output/cached/reasoning tokens, available input modality counts, timing, and success/failure/unknown classification. No prompt, video, transcript, response content, signed URL, or raw exception is stored in this object.

Keep `ai_cost_log` as diagnostic history. **Never add its estimates to reservation charges**: both can describe the same provider call. For conservative admission/exposure reporting use `coalesce(charged_usd,reserved_usd)` once per reservation. Unknown charges are held estimates, not reconciled invoices.

The transport records an attempt after admission and before inference. This adds one small database roundtrip. Failure to record the initial metadata prevents the provider call and keeps the reservation held for reconciliation. Terminal metadata and the existing `ai_settle` function execute in one transaction; failure leaves the original reservation charged. A missing/malformed usage report, transport timeout, or cancelled stream cannot be silently booked as free. Existing HTTP rejection/cooldown accounting rules are unchanged.

Purpose is scoped in a separate asynchronous actor for each call. Reservation IDs and response usage stay in per-call closures, including parallel or streamed requests. Job/action correlation is forwarded through authenticated internal media/vision requests. There is no mutable “last provider request” join.

`AI_USAGE_ENVIRONMENT` is an optional explicit deployment setting: `production`, `staging`, `staff_test`, or `experiment`. Without an explicit classification, regular calls remain `unclassified`; do not label them production in reports. Explicit `pack_eval` purpose is classified as `experiment`. An actor can supply an experiment ID. A production host setting alone does not distinguish ad-hoc staff QA on that host: label the experiment actor explicitly or report that cohort as mixed until reconciled. Existing rows remain unclassified.

## Deployment and verification

Apply `20260917150000_ai_attempt_observability.sql` before the new edge code. The RPC is service-role only and rejects unexpected metadata keys. Old edge code still uses unchanged reservation/settlement functions and produces unclassified metadata; new edge code fails closed if the migration is absent. Rollback can retain the additive column/RPC.

Run:

- `node tools/ai-attempt-db-check.mjs` — shipping migration and original settlement SQL, transactional rollback, unknown charge retention, metadata allowlist, idempotent terminal writes and permissions.
- `deno run --allow-read tools/ai-guard-check.ts` — mocked providers, normalized usage, provider IDs, parallel request association, unknown classification, metadata outage refusal, streams/cancellation and existing budget/modality protections.
- `npm run gtm:check` — includes both groups alongside the application regressions.

Do not treat missing provider request IDs or modality breakdowns as zero usage; those fields depend on provider responses. Token prices remain application estimates and must be reconciled with provider billing. This change does not reconcile invoices or measure end-to-end infrastructure, store, marketing, support or free-user costs. Successful delivery/cache-hit denominators come from job/save events, including deterministic paths with no AI reservation; grouping only AI calls would omit those free deliveries.

# Spotter GTM release decision — September 17, 2026

**Decision: prepare a controlled native beta; do not open broad paid acquisition yet.** Local implementation is substantially hardened. Production deployment, native store configuration, physical-device acceptance, representative AI accuracy and customer willingness to renew remain unverified. This is a release candidate, not a claim that every defect has been found.

## Business direction

Sell one Plus subscription at **$50/year**, with the existing $6.99 monthly alternative. Repository annual pricing is 5000 cents; automatic future founding discounts are disabled in source. Existing purchased or promised discounts must be honored. Store/RevenueCat prices still need separate verification; these source changes do not update them.

Focus development on import → review/correct → save → perform → return. Freeze independent website feature expansion; shared app code remains supported. Preserve four explicit monthly premium previews and entitlement-aware reuse. Do not market unlimited AI or numeric allowances that current cost controls cannot deliver.

The current planning case requires approximately **3,000 annual paying subscribers** to produce **$5,000/month operating profit before personal tax**: $12,500 monthly recognized gross revenue, approximately $7,479 total modeled monthly costs, $5,021 profit (40%). These are scenarios, not observed margins or a demand forecast. They assume 15% store fees, 3% refunds, 1% subscription infrastructure, 35% annual renewal, $8 cash acquisition cost, 5% paid share, $0.55 paid-user monthly AI/infrastructure/support, $0.03 per free user and $500 fixed monthly costs. Replacement acquisition for nonrenewals is included. No separate full-time developer salary is funded; owner labor is compensated by the profit target. Higher staffing, taxes included in price, worse retention or higher acquisition costs change the result materially. See the linked forecast for sensitivities.

At that scale the model implies 57,000 free users. Free usage, support and replacement acquisition can matter more than a fraction-of-a-cent model saving. Annual cash receipts must fund the full year of service; do not treat all upfront receipts as distributable profit.

## Implemented in the local candidate

- Transactional reader completion, generation fences, entitlement checks and preview accounting; preserve explicit edits, deletions, empty values and personal exercise lists across rereads.
- Account fences around reader, purchase, restore and price responses; prevent stale work from updating a new signed-in account.
- Atomic, idempotent Pumpy confirmation; complete attachments and selected history, explicit input limits instead of hidden truncation, deterministic simple combines with no AI call.
- Separate demonstrated repetitions from prescribed repetitions; conservative verified global dose propagation; preserve movement details and fractional timestamps; repair misleading benchmark expectations and negation checks.
- Native sparse-sampling manifest v3, interrupted/partial upload rejection, JPEG limits and honest Android timing uncertainty. Complete sampling still does not mean every frame was observed.
- Account-scoped work budgets; refuse unpriced Lite audio/video instead of billing it as image input. Keep current production model selection until comparative evidence supports a change.
- Content-free per-attempt cost attribution tied to authoritative reservations, with conservative handling of unknown charges and fail-closed behavior if accounting is unavailable. This adds a database round trip before inference; measure its latency in staging.
- A repeatable GTM regression command and CI integration. Production dependency audit reports no known vulnerabilities in the inspected dependency set; this is not a complete security audit.

## Release sequence and rollback

1. Run the full local release checks; retain the commit, artifacts and results. No release commit or deployment was made in this pass.
2. In staging, quiesce/drain existing ingestion workers before coordinated migration and server rollout. Apply reader completion migration `20260917130000`, Pumpy confirmation `20260917140000`, and the attempt-observability migration `20260917150000` in order. Validate permissions and actual concurrent database connections. Set the deployment-owned `AI_USAGE_ENVIRONMENT` explicitly in each environment; the safe default is `unclassified`, not an assumption that all traffic is production. Verify staff/experiment attribution separately. Account-prefixed work keys reset historical per-work aggregation at cutover; user/global budget windows remain authoritative.
3. Deploy server support before distributing native manifest-v3 clients. Regenerate `native-dist`, run local Capacitor copy for both platforms, verify packaged assets match, and rebuild both platforms from the final candidate. Asset generation alone does not update the platform public directories; this pass found and corrected stale packaged JavaScript.
4. Keep pack v2/card v11/native manifest v3 in processing identity. Invalidate stale evidence/results lazily under entitlement and budget rules; do not mass-reread the library. Never overwrite a user's personal override with a new shared result.
5. Roll out to a small internal cohort, then 20–30 consenting beta users. Observe errors, latency, fallbacks, edit retention, attachment coverage, preview use and attributable spend before expanding.
6. Rollback to a compatible tested server/client pair. Do not blindly roll back only edge code while leaving preservation triggers/new RPC contracts active. Pause admission during incompatible rollback; retain user edits and billing/audit records. No destructive schema rollback to erase evidence.

## Gates still open before public GTM

| Gate | Evidence required |
|---|---|
| Staging correctness | Concurrent workers, duplicate confirmations, account switches, plan changes, month boundaries and failed completion all exercised against real separate database connections. Embedded database tests are not concurrency load tests. |
| Native acceptance | Physical iOS and Android import/play/edit/reread/workout completion; short/long clips, app suspension, poor network, share extension memory, battery and capture/fallback measurements. Simulator/compiler success is insufficient. |
| Subscription readiness | Actual $50 annual product and localized price verification; sandbox purchase/restore/deferred/expired flows; account-transfer policy; subscription management and cancellation access. |
| Economics and allowances | Confirm fee-program eligibility and actual invoices; set funded production limits and customer-facing allowances. Current audited global AI $10/month and $0.50/day are tiny beta limits, not a scalable launch budget. No live limits changed here. |
| AI quality | Human-reviewed diverse benchmark with acceptable variants and timestamp uncertainty. Paid screen remains unrun; $5 ordinary cap/$10 absolute contingency remains intact. No model ranking from one five-exercise video. |
| Operational readiness | Privacy/account deletion/support/store declarations reviewed; monitoring and a named release owner; no claims that these were fully legally or operationally certified by code tests. |
| Demand | First 25, then 100 real paying customers; measure repeat workout use, refunds, support minutes, acquisition source and early retention. Annual renewal remains unknown until cohorts mature. |

## Known follow-up risks

- Initial queue insertion and evidence attachment are separate operations; test whether a worker can claim a job before evidence is attached and make enqueue atomic if reproduced.
- Manual planning can race with coach planning; add an appropriate uniqueness/idempotency contract after confirming intended duplicate-plan behavior.
- Android nearest-keyframe timestamps are approximate. Video reread paths that retain old boundaries cannot be assumed to refine timestamps.
- Conservative English universal-dose parsing does not resolve arbitrary languages, cross-sentence exceptions or every circuit scope. Field-level provenance is not yet exhaustive.
- Pumpy includes the selected recent history completely, but does not maintain a durable verified constraint memory across arbitrarily long conversations.
- Rejecting incomplete native capture can increase paid fallbacks under the existing eight-second deadline. Measure before claiming savings; verify cleanup of abandoned private sheet uploads.
- Offline fixture checks do not prove vision accuracy, invoice reconciliation, battery performance or store approval.

## Operating process

Every change should name the customer failure, a measurable acceptance condition, a rollback and its effect on cost per delivered workout. Review a weekly dashboard of activated users, repeat workout completions, paid conversion, refunds, support load, effective acquisition cost and provider cost by purpose. Separate production, experiments, failed calls, retries and unknown charges. Use authoritative reservation/settlement records for budgets; never add diagnostic estimates to those records as extra spend.

Recruit the first beta cohort through owner-led outreach after device/store gates; no outreach was sent in this task. Review at least 100 imports across the benchmark categories and five observed customer sessions before broadening acquisition. Start with small experiments that can identify a concrete failure. Do not add more model stages or providers until measured improvements justify them.

## Supporting files

- [Native evidence and remaining device gates](../native/GTM-READINESS.md)
- [Reader transaction design and rollout cautions](reader-fixes/RELIABILITY-GTM.md)
- [Profit forecast](../../Spotter%20Profitability%20Study%202026-09-17/PROFIT-FORECAST.md)
- [Bounded paid experiment](../../Spotter%20Profitability%20Study%202026-09-17/EXPERIMENT-5-DOLLAR.md)

External experiment spend during this implementation pass: **$0**. No production model, database, live subscription price or store deployment was changed.

## Final local validation

The 14 GTM regression groups pass, including transport/admission accounting, SQL attempt attribution, reader completion, Pumpy confirmation, complete attachment/combine fixtures, purchase/account races and source fidelity. Shared/native parity checks, browser reader checks and server type checking pass. The final iOS simulator build and Android offline assemble/lint/unit tasks pass after local Capacitor asset copy. An untracked byte-identical `config 2.xml` duplicate blocked Android resource merging; it was preserved outside the resource tree and the build rerun successfully. All 17 native packaged assets were verified against regenerated assets. Physical-device, store and representative paid-model gates remain separate.

# Spotter production readiness — 8 September 2026

Decision: improved beta, not yet approved for unrestricted public launch. This is an engineering/security review, not independent penetration testing or certification.

## Deployed and verified

- Migration 20260908150000: project AI reservations enforce $0.50/day and $10/calendar month, per-account allowances, concurrency, admission, upload permits and transactional quotas. These limits cover model charges estimated from configured rates, not hosting, taxes or provider invoice adjustments.
- Migration 20260908170000: active jobs are isolated per account and source. Trusted complete public results still share a cache. Client-supplied HTML/captions and personal fallback text cannot write the shared cache or thumbnails. Old cache versions are not reused by the new extraction path. Caller-provided HTML is not proof of platform origin.
- Direct API execution removed from two database trigger functions. The remaining client-callable security-definer function, has_upload_permit, intentionally checks the caller's own permit for Storage RLS.
- Reread label stays stationary, duplicate clicks are blocked, failed requests recover. Live smoke exposed and fixed a row-versus-array database-helper mismatch missed by the original mocked tests.
- Live Luna read: all seven pages (cover plus six workout slides), eight calls including caption, $0.006595 recorded model cost. All reservations settled. No Gemini fallback needed. This is one sample, not a population cost forecast or accuracy benchmark.
- The live read also exposed an application merge defect: old alternative exercises and fixed set endpoints were restored over the better output. Same-slide OR alternatives now merge as one choice; explicit set ranges do not inherit an old endpoint. Different-slide entries remain protected. The owner's saved card was repaired from the already-paid complete extraction after checking for user edits/concurrent changes.
- Text extraction now distinguishes source data from instructions, preserves alternatives/ranges and stops asking for invented calorie/duration estimates. Exercise explanations may correct unsafe creator cues. These prompts are defense in depth; authorization still belongs in code/SQL.
- Browser Supabase SDK pinned to 2.115.0; native SDK packaging updated to match. Production dependency audit reported no known vulnerabilities at audit time, not proof that dependencies are safe.
- Privacy text corrected for image/video processing, Google routing, fitness information and provider retention. Paid-plan screen discloses beta AI usage pauses.
- Credential-free release workflow added: isolated PostgreSQL guard tests, real helper-contract regression, transport/admission/merge tests, Deno type check, dependency audit and generated web asset consistency. Official actions pinned by commit. Branch protection must make these checks required before they become an enforced gate.

Release evidence: GitHub Pages published `806a571`; the new GitHub Release checks workflow passed on that commit. Supabase backend version 149 is active. The final signed development iOS build succeeded; the paired iPhone remained unavailable, so it was not installed.

## Independent observations

Live metadata audit (`supabase db query --linked --file tools/production-audit.sql`): all 29 public tables have RLS enabled; database approximately 26 MB; no queued/running jobs, stale uploads or unknown recent AI charges at the sampled time. User APIs rejected anonymous access with 401; worker routes rejected it with 404. RLS enablement is necessary but does not prove every ownership policy and foreign-key relationship correct.

The platform JWT setting was already false before release. User routes verify tokens through Supabase Auth inside the function; machine routes check a nonempty secret, Stripe verifies signed request bodies, and the Strava callback has signed state. Deployments preserved this configuration. Do not treat CORS as authorization.

Security advisors still report pg_net's extension location, the intentional upload-permit function, and disabled leaked-password protection. The revoked trigger grants no longer appear. Investigate pg_net relocation compatibility instead of dropping an extension used by worker cron.

## Launch blockers and acceptance evidence

| Priority | Finding / risk | Required completion evidence |
| --- | --- | --- |
| P0 | Account creation is still a weak abuse boundary: live Auth reports signup enabled and email autoconfirm enabled; CAPTCHA/custom SMTP and IP controls were not established. Per-user caps can be multiplied with accounts; the global cap limits model spend but an attacker can exhaust service for everybody. | Configure a verified sender and confirmation flow, integrate CAPTCHA and platform-side signup/login limits; test signup, reset, expired links and native return. Do not enable confirmation without a working sender. |
| P0 | Google billing/data-use mode is not verified. Unpaid and paid API terms differ; old app claims that providers never retain data were incorrect. Audience/region restrictions also need review. | Confirm active billed Google project and intended age/region eligibility before private user content is processed; document provider accounts, retention, DPA and access owners. Do not infer paid status from successful calls or zero ledger entries. |
| P0 | Native distribution is a development build. Session tokens use Preferences/UserDefaults, not Keychain; native social sign-in and distribution billing are unfinished. | Keychain-backed session storage with upgrade/logout tests; organization signing, App Store privacy review and purchase-path review; real-device share, upload, sign-in and account-switch tests. Signed development build is not App Store deployment. |
| P0 | No verified restoration drill, operational alert delivery or incident owner/escalation path. Database size alone says nothing about recovery. | Restore a recent backup into an isolated project, measure data loss/recovery window; configure health, queue age, auth spikes, unknown reservations, provider errors and storage-growth alerts with a tested destination. |
| P1 | Main is unprotected and Pages publishes it directly. New CI is not automatically a deployment gate. | Require passing release checks/review on PRs; stage migrations and runtime compatibility tests in a separate project; record known-good commits and a rollback rehearsal. Keep protected AI paused during a failed rollout rather than restoring unguarded spending. |
| P1 | Outbound URL guard checks redirects/private addresses, but DNS failures currently fail open and DNS validation is separate from fetch resolution. | Exercise DNS failures, IPv6-mapped addresses and rebinding on the actual edge runtime; route arbitrary web fetches through enforced egress filtering or a suitably constrained fetch service. Do not claim SSRF is solved by string checks. |
| P1 | Quality evals remain narrow. One successful carousel does not establish quality for silent video, speech, tables, multilingual captions, supersets or partial uploads. | A versioned, consented golden set covering each format; measure missing/extra exercises, exact dose/alternative fidelity, partial coverage, p95 latency and cost per successful import. Include hostile captions/images and explicit user corrections. |
| P1 | Scale is intentionally beta-sized: two jobs and three model calls globally, four outstanding uploads. More users will queue or receive pauses before the budget overspends. | Staging load test at intended arrival rate, burst tests and failure injection. Measure queue age and success rather than simply increasing concurrency. Confirm Supabase plan/capacity, egress and provider limits before promising thousands of active users. |
| P1 | Payment signatures and current-customer refresh exist; concurrency/retry ordering, refunds and cross-account claims were not exhaustively tested here. | Stripe test-mode scenarios for duplicate/out-of-order events, cancel/refund, trial abuse, customer ownership and event replay. Verify subscription entitlements in SQL, not client state. |
| P1 | Account deletion is multi-system and not atomic; privacy retention must include backups/provider logs. | Synthetic-account export/delete drill with injected provider failures, retry behavior and an audited residual-data inventory. Do not use the owner's permanent account for deletion tests. |
| P1 | AI dollar caps do not cap database writes, Realtime fan-out, thumbnails, egress or logs. | Bound and rate-limit non-AI collection/session/plan writes; test tenant foreign keys and storage reads; set retention and platform billing controls. Review every direct REST table grant, not only Edge routes. |

## Efficient model policy

Keep Luna as the default for text and images. Use Gemini only for the supported raw audio/video path or one bounded fallback. Cache trusted complete reads, resume completed slides, avoid paying again for deterministic repairs and keep normal extraction reasoning disabled. Do not switch models based on one failure before distinguishing fetching, provider, parsing and merge failures.

At the observed $0.006595 per carousel, $0.50 buys roughly 75 similar imports/day and $10 about 1,516/month before coaching/other reads. The configured Plus account allowance of $0.50/month is roughly 75 similar imports/month, not the larger event-rate ceiling advertised by daily quotas. Both constrain usage. These arithmetic examples use one sample; do not market them as included import counts. Raise the global budget only from measured usage and subscription economics. Current regular Plus is $39.99/year, founding first year $29.99; no prices were changed.

The repository is public and documents a permanent development login. Keep that account strictly synthetic; do not use it for real personal data, production administrator privileges or live payment details. Move real owner use to a private credential before public launch.

## Rules for future AI-assisted changes

Every change should state the affected trust boundary, schema/API contracts and observable acceptance criteria. Treat model output and fetched documents as untrusted. Test user A against user B, denied operations, cancellation, retries and partial failure. Exercise real adapters alongside mocks. Preserve failing evidence instead of weakening tests to get green. Review generated migrations and grants explicitly. Verify deployed configuration and artifacts, not just local files. A prompt cannot enforce payment, ownership, spend limits or tool authorization.

## Research used

- [OWASP Secure Coding with AI](https://cheatsheetseries.owasp.org/cheatsheets/Secure_Coding_with_AI_Cheat_Sheet.html): informed independent contract tests, dependency pinning and review of untrusted source inputs and generated changes.
- [OWASP LLM risks](https://genai.owasp.org/llm-top-10/): informed prompt-injection and excessive-agency review; prompts are not a security boundary.
- [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod): informed RLS, Auth, backup and operational launch gates.
- [Google API terms](https://ai.google.dev/gemini-api/terms) and [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data): informed removal of blanket no-retention claims and the need to verify actual provider account settings.

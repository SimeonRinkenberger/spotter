# Simplifying Spotter — 7 September 2026

User authorized implementation and deployment of the focused simplification proposal, preserving four tabs. No backend routes, schema, billing, model configuration, or real user data changed.

## Result
- Four stable tabs: Workouts, Plan, Progress, Pumpy. Labeled Save workout; Refresh lives in Settings.
- Library filters and collections have named entry points. Existing sort, category, favourites and collection paths remain.
- Empty first-use state gives one Save action; automatic three-step feature tour removed. Manual one-screen help remains.
- Workout title, attribution, equipment, compact prescription metadata, uncertainty warning and Start precede supporting sections. Schedule and Ask coach remain visible.
- Original media/caption, muscles, notes/category expand on request. Source players mount only when opened and are removed on collapse. Timestamp access uses a separate sheet.
- Rename, collection management, share, reread and armed deletion live in Options. Review/Edit and Demo are visible per exercise; substitution is under exercise Options. Workout Mode retains logging, timing and demos.
- Demo requests do not automatically invoke AI explanations; explicit explanation button preserves that feature.
- Progress shows weekly summary and five recent session summaries first. Sessions expand to existing details/sharing/deletion; earlier sessions, charts/muscles and achievements remain available.
- Phone setup is offered only after a ready save; advanced iPhone Shortcut details are collapsed inside Settings.

## Evidence and verification
93 deterministic checks passed: simplify-harness 8, pumpy-harness 46, performance-harness 21, pumpy-transition-harness 11, sw-harness 7. The guide harness was updated to the authorized first-use behavior. Generated GitHub Pages and edge-function HTML are byte-identical. git diff --check passed.

Chrome browser passes: 23 main flow checks, 7 edge checks, and empty-state/no-modal/save-action checks. Tested at 375×812 and 1280×900; light, dark and reduced motion; source visibility, timestamps, explicit AI intent, review fields, filtering, scheduling, logging, menu focus/handoff, armed removal, and expanding history/charts. Synthetic records belonged only to spotter-tw-simplify-sep7@example.com. Demo/explanation/media responses were mocked to avoid AI spend; account, workout, history and plan flows used the real backend with disposable fixtures. Scheduling failure was injected. iPhone user-agent checks verify conditional copy, not Safari engine behavior.

Screenshots are in simplification-evidence/2026-09-07. Some walkthrough frames include transient toasts. No physical iPhone/Safari or assistive-technology audit was performed. No claim of improved conversion or reduced overwhelm without observing users.

## Design basis
Research checked 7 September 2026. Hevy: explicit opt-in advanced logging (https://help.hevyapp.com/hc/en-us/articles/35687721776663-How-to-Use-RPE-Rate-of-Perceived-Exertion). Crouton: saved content, planning and execution as recognizable tasks (https://crouton.app/). NN/g: defer secondary controls while preserving visible primary navigation (https://www.nngroup.com/articles/progressive-disclosure/, https://www.nngroup.com/articles/hamburger-menus/). Apple HIG: stable, labeled navigation destinations (https://developer.apple.com/design/human-interface-guidelines/tab-bars).

Deployment verification is recorded after publishing. Rollback is a revert of the implementation commit followed by the normal Pages push and edge function deployment; no migration rollback is involved.

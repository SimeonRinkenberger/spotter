# Spotter pages on the owned domain

Published September 13, 2026 through WordPress's official importer, assigned to
existing admin user 1. No new WordPress user was created. All four pages are public;
comments are closed. WordPress's designated privacy-policy page is now 900002.

| Page | WordPress ID | Public URL |
| --- | --- | --- |
| Spotter homepage | 900001 | https://quarterdeckcollective.com/spotter |
| Privacy policy | 900002 | https://quarterdeckcollective.com/spotter/privacy |
| Terms of use | 900003 | https://quarterdeckcollective.com/spotter/terms |
| What's New | 900004 | https://quarterdeckcollective.com/spotter/whats-new |

`build-import.py` prepares the original page HTML and initial WXR import from
`docs/privacy.html`, `docs/terms.html`, and `docs/whats-new.html`, plus the app homepage.
These local copies are a publication record, not an automatic WordPress sync.
For future edits, update the existing pages in WordPress; do not reimport to update
existing pages, since the importer may skip them. Preserve page IDs and permalinks.

Validation: anonymous HTTP 200 for all four pages; complete rendered text matches
prepared content after normalizing WordPress typography; one visible H1 per page;
privacy page checked at 375 px with no horizontal overflow. Existing legal text
was preserved. This was publishing work, not a legal-compliance certification.

App links updated via PR #4, merged as 4b86cdd0aa9826b52428fa9a320b024375763e48.
The published GitHub Pages response matches that release build. Shared native
source links are updated; already-installed native packages need a new build.
Google Auth Platform branding and verification were not changed by this task.
Use the homepage/privacy/terms URLs above there.

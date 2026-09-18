# WordPress drift check — quarterdeckcollective.com/spotter

Run 17 September 2026. All four pages were fetched anonymously with `curl -L`; all returned
**HTTP 200**. Tags were stripped, WordPress's smart typography normalised back to ASCII, and the
text compared sentence by sentence against the repository copies on branch `gtm-ops`.

Evidence, full sentence-level output:
`/private/tmp/claude-501/-Users-simeon-Desktop-CLAUDE-COWORK/f83e3c45-9ece-4ff1-96cf-c461f42dfdcd/scratchpad/wordpress-drift.txt`
Fetched HTML: same directory, `wp/home.html`, `wp/privacy.html`, `wp/terms.html`, `wp/whats-new.html`.

| Page | ID | Result |
|---|---|---|
| https://quarterdeckcollective.com/spotter | 900001 | **No drift.** Only the theme's own chrome differs |
| https://quarterdeckcollective.com/spotter/privacy | 900002 | **Materially out of date** — see below |
| https://quarterdeckcollective.com/spotter/terms | 900003 | **No drift.** Identical text, "Last updated 4 September 2026" on both |
| https://quarterdeckcollective.com/spotter/whats-new | 900004 | **One release behind** |

---

## 1. Privacy — the one that matters

**The live page is the 8 September 2026 text. `docs/privacy.html` is the 13 September 2026 text.**
Nineteen sentences exist in the repo copy and not on the live page; seven sentences on the live page
have since been replaced in the repo.

This is not cosmetic. The app's own Privacy links — on the sign-in screen, in Settings > Data &
privacy, and on the subscription sheet (`markup.ts` lines 152-153, 720-721, 757-758) — all point at
`https://quarterdeckcollective.com/spotter/privacy/`. So the policy a user reads from inside the
app, and the policy a store reviewer will open, is the older one.

**What the live page is missing entirely**

- The whole native-purchase section. The live page has no mention of **RevenueCat**, of **Google
  Play**, or of purchases handled by a store at all. It says only that Spotter Plus is paid for
  through Stripe. The Android app on Play sells `spotter_plus` through Google Play billing and
  validates it at RevenueCat (`supabase/functions/spotter-purchases/index.ts`).
- The sentence users most need before they delete an account: "Deleting your Spotter account or
  uninstalling the app does not cancel store subscriptions. Cancel in the store first if you want
  billing to stop." The live deletion list says only that the subscription "is cancelled at Stripe
  first".
- "Store providers may retain transaction records required for tax, accounting, fraud prevention,
  and legal obligations."
- The precise wording "No ads or advertising trackers, no web analytics scripts, and no cookies
  beyond the sign-in session your browser needs." The live page says "No ads, no trackers, no
  analytics scripts" — broader, and harder to defend against a reviewer who notices Google Fonts.
- "If you subscribe to Spotter Plus, an identifier for you at **your payment provider**" — the live
  page still says "an identifier for you at **Stripe**".
- The live page opens "Spotter is a small, independent app." The repo copy opens "Spotter is
  operated by Quarterdeck Collective LLC," which is the sentence a store and a regulator want.

**Why it is a submission blocker, not a to-do**

- Google Play's Data safety declaration for this app must state that purchase history goes to a
  third party for validation. A privacy policy that never names that third party contradicts the
  declaration, and Play checks the policy against the form.
- App Store Review Guideline 5.1.2(i) requires clear disclosure of third-party sharing. Apple
  reviewers open the privacy URL.
- Play requires the privacy policy to be on an active, publicly accessible, non-geofenced URL. It is
  — it just says the wrong thing.

**Fix:** update page 900002 in WordPress from the current `docs/privacy.html`, plus whichever of the
proposed edits in `design/gtm/PRIVACY-DECLARATIONS.md` Part 4 survive the attorney pass. Per
`wordpress/README.md`, **edit the existing page in place; do not re-import** — the importer may skip
existing pages, and the page ID and permalink must be preserved.

## 2. What's New — one release behind

The live page ends at the entry before **Version 0.13 · 16 September 2026 ("Train")**, which is in
`docs/whats-new.html`. Eleven sentences describing the merged Plan/Progress tab, the seven-day
strip, the calendar states and the Records view are not published.

Low risk, but it is the page the app's Settings > About links to as "What's new", and it will be the
page a tester checks after an update. Republish from `docs/whats-new.html` at the same time as the
privacy page.

## 3. Terms — clean

Sixty-seven sentences on each side, identical after normalisation. The only difference is the
theme's header and the page title. Nothing to do.

## 4. Homepage — clean

Fourteen sentences on each side, identical. The only difference is the theme's header. Nothing to do.

---

## 5. Also add: the account deletion page

Not drift, but the same publishing job. `docs/delete-account.html` is new in this wave. Its
WordPress-ready body is `design/gtm/delete-account.wordpress.html`, prepared with exactly the
transformation `wordpress/build-import.py` applies to the other pages: the `<main>` inner HTML with
the first `<h1>` removed, relative links rewritten to the owned-domain URLs, wrapped in the same
`spotter-info` div between two copies of the same four-link nav, inside a `wp:html` block.

Publish it as a child of page 900001 with slug `delete-account`, so the URL is
`https://quarterdeckcollective.com/spotter/delete-account/`. That URL then goes in Play Console's
Data safety form as the account-deletion URL and replaces the current
`.../privacy.html#delete`.

Two optional follow-ups, both owner edits to existing pages, neither done here:
- add a fifth link, "Delete account", to the nav on all five pages;
- add the link from the privacy page's "Deleting your account" section
  (`PRIVACY-DECLARATIONS.md` Part 4, item H).

## 6. How to re-run this check

```
for p in "" privacy terms whats-new; do
  curl -sL "https://quarterdeckcollective.com/spotter/$p" -o "wp-${p:-home}.html"
done
```

Then strip tags, normalise curly quotes, dashes, arrows and non-breaking spaces to ASCII, split on
sentence punctuation and set-difference against the `<main>` contents of `docs/privacy.html`,
`docs/terms.html`, `docs/whats-new.html` and against `wordpress/spotter.html`. The script used is in
the scratchpad path above. Worth running before every store submission, because the repo copies and
the published pages have no automatic link — `wordpress/README.md` says so explicitly: "These local
copies are a publication record, not an automatic WordPress sync."

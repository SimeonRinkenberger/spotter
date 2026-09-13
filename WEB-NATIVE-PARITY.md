# Web and iPhone parity

The iPhone package takes its complete application script, markup, and styling from
`docs/index.html`. Both use the same Supabase backend and account entitlements.
Run `npm run parity:check` before publishing either build. CI runs this too.

| Capability | Web testing app | iPhone app |
| --- | --- | --- |
| Link saves, video uploads, extraction and corrections | Shared application | Shared application |
| Library, favorites, collections, editing | Shared application | Shared application |
| Workout mode, sets, weights, rest timer, resume | Shared application; browser storage | Shared application; native draft persistence also |
| Plan, progress, muscle map, records, achievements | Shared application | Shared application |
| Pumpy chat, streaming, workout tools, exercise helpers | Browser streaming | Native streaming adapter |
| Google / Apple sign-in | Web provider flow, subject to provider configuration | System authentication adapters, subject to signing/provider configuration |
| Account, export, deletion, plan access, Strava | Shared application | Shared application; system browser for external flows |
| Incoming social sharing on iPhone | Paste link or optional Shortcut from Settings | Spotter Share Extension |
| Outgoing workout images and exports | Browser share where available; download fallback | System share sheet |
| Haptics and keyboard | Browser capabilities; no vibration on iPhone Safari | Native haptics and keyboard layout |
| Reminders | Web Push in supported installed browsers | Not configured in current development build |
| Updates | Published website; network-first service worker | Rebuild and reinstall / TestFlight update |

Verified September 12, 2026: full generated application and shell parity; native/web
haptics, rest suspension, draft completion, keyboard, streaming, incoming sharing,
Google/Apple adapter checks; seven service-worker update/offline checks. These
checks do not substitute for a completed Google/Apple login or physical-device
exercise session. Platform differences above are intentional and remain visible.

## Paid Gemini key

1. Open https://aistudio.google.com/api-keys and identify the key's Cloud project.
2. In AI Studio Billing, enable billing for that project (or choose the existing
   paid project). A key uses its project's billing: keeping the same project does
   not inherently require a replacement key.
3. If switching projects/keys, update only `GEMINI_API_KEY` in the Spotter project's
   Supabase Dashboard → Edge Functions → Secrets:
   https://supabase.com/dashboard/project/mtzevoxxpsktmrbbuxva/functions/secrets
4. Save. Supabase makes updated secrets available without a function redeploy.
   Keep the secret on the backend, not in the website or native assets.
5. Test one extraction and check AI Studio usage for the chosen project.

This is independent of the Google OAuth client used for sign-in. Spotter also
uses a separate `YOUTUBE_API_KEY` when configured; otherwise its YouTube reader
falls back to `GEMINI_API_KEY`, requiring YouTube Data API v3 on that key's project.

References: https://ai.google.dev/gemini-api/docs/billing,
https://ai.google.dev/gemini-api/docs/api-key,
https://supabase.com/docs/guides/functions/secrets.

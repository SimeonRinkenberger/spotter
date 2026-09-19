# Native push — the two reminders, through APNs

18 September 2026. Branch `native-push`. This is the fourth transport for the same two
reminders and the last one: plan-day at an hour the user picked, and the one that says the
week is still reachable. No third notification, no change to the caps, no new copy beyond a
single sentence about where iOS keeps the off switch.

## What was read first

Apple's own documentation, fetched 18 Sept 2026, and what each page settled:

| Source | What it decided |
| --- | --- |
| [Sending notification requests to APNs](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns) | HTTP/2 + TLS 1.2 to `api.sandbox.push.apple.com` / `api.push.apple.com`; `POST /3/device/<hex token>`; the header set (`authorization`, `apns-topic`, `apns-push-type`, `apns-priority`, `apns-expiration`, `apns-collapse-id`); 4096-byte payload ceiling. `apns-collapse-id` is Web Push's `tag` under another name, so the two senders collapse repeats identically. |
| [Establishing a token-based connection to APNs](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns) | The provider JWT is ES256 over `{alg, kid}` . `{iss, iat}` and **nothing else** — no `aud`, no `exp`, no `sub`. Refresh at least every 60 minutes and at most every 20, or Apple answers `ExpiredProviderToken` (403) at one end and `TooManyProviderTokenUpdates` (429) at the other. Fifty minutes is the cache; it is the middle of that window. |
| [Handling notification responses from APNs](https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns) | The error table, and the explicit do-not-retry list: `BadDeviceToken`, `DeviceTokenNotForTopic`, `Forbidden`, `ExpiredToken`, `Unregistered`, `PayloadTooLarge`. `apnsGone()` is that list minus `PayloadTooLarge` and `Forbidden` — those two are our bug, not their device, and deleting a user's row over our own mistake is unrecoverable. "410 is not considered an error condition" is why a drop is logged at `log` and a 4xx at `error`. |
| [Generating a remote notification](https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification) | `aps.alert.title`/`body`, `sound`, `thread-id`; and the rule that decided the payload shape — **custom keys inside `aps` are ignored**, so the `spotter://` link is a peer of `aps`. One `thread-id` ("reminders") for both kinds: at most one a day does not deserve two stacks in Notification Centre. |
| [Testing remote push on the Simulator](https://developer.apple.com/documentation/xcode/testing-remote-push-notifications-in-simulator) (plus Xcode 14 release notes) | Since Xcode 14, a simulator on an Apple-silicon or T2 Mac can be issued a real sandbox device token. `xcrun simctl push` needs none of that and validates the payload itself, which is what the committed fixtures exercise. |
| HIG, [Notifications](https://developer.apple.com/design/human-interface-guidelines/notifications) | Ask in context, after the value is obvious; never at launch. Already the rule `NotificationsHost` was built to and the reason `register()` is only ever called from the switch's own tap. |

Settings pattern: iOS's own Notifications screen, and Strong and Hevy's reminder rows. All
three do the same two things and Spotter now does them too — the app owns *whether* a
reminder exists and *when* it arrives, and the OS owns whether it may be shown at all. Once
permission is held the app stops re-explaining and just points at Settings. None of them
offers an in-app re-prompt after a refusal, because there is no such thing: a denial is
undone in Settings or not at all.

## The shape

```
app.ts reminders section        push_devices (RLS, one row per install)
  pushable()  = plugin present AND deployment has an APNs key
  register()  -> SpotterPushPlugin -> UNUserNotificationCenter -> APNs
                                                   |
GET /api/push/config { configured, key, apns }      v  token, bundle, env
                                                push.ts runPushTick
  push_subscriptions (web)  ----\
                                 >--- decide() ---> sendPush  | sendApns
  push_devices       (apns) ----/                   (RFC 8291)  (HTTP/2 + ES256 JWT)
```

### Why a second table

`push_devices` is `push_subscriptions` with the Web Push identity (an endpoint URL plus the
subscriber's ECDH keys) swapped for the APNs one (a hex token, a bundle, an environment).
Every other column is deliberately identical, because `runPushTick` walks both arrays
against **one** `decide()`. The alternative — nullable columns on one table — needs a check
constraint saying "exactly one of these five is null", a unique index over a coalesce, and a
sender that asks which kind of row it is holding on every line. The two identities are also
dropped for different reasons (404/410 from the endpoint's own origin; 410 or one of four
400 reasons from Apple), so they were never going to share a delete path anyway.

The type split enforces it: `Reminder` is what `decide()` sees, `Sub = Reminder & {endpoint,
p256dh, auth}`, `Device = Reminder & {token, bundle, env}`. It is not possible to write a
policy rule that applies to one transport and not the other.

### Two devices, two reminders

A user with a browser subscription and the app installed gets the plan-day reminder on both,
because the caps are per row and a row is per grant of permission — the same answer a phone
and a laptop have always had. Folding the caps up to the user would silence whichever device
the tick reached second. A duplicate is a reminder that arrived twice; the alternative is a
reminder that stopped, and only one of those is a bug the user cannot fix from the switches
in front of them.

### Client facts vs deployment facts

`SpotterPushPlugin.status()` deliberately does **not** answer `configured`. The phone knows
what the user allowed, which environment the build talks to, its bundle id and its token;
whether a signing key exists is a secret it cannot see. So `GET /api/push/config` grew one
boolean, `apns`, and the page holds the whole gate:

- no plugin (an older shell) → `permission: "unsupported"` → switches dead, existing copy
- plugin, `apns: false` (today) → switches dead, **the same sentence that shipped**:
  "Native reminders are not configured in this development build."
- plugin, `apns: true`, never asked → switches live, the note explains what arrives
- refused → "Reminders are off in your phone's Settings." Never a second prompt.
- granted → "Reminders arrive as notifications. You can change this in Settings › Notifications."

### Token rotation

iOS reissues a device token (a restore from backup, a long enough gap between launches) and
tells nobody. The enrolment is remembered in `localStorage` under `spotter_push_token`, and a
boot that finds one re-registers, reads the preferences off the old row, writes them to the
new token **before** deleting the old row, and moves on. A failure between the two leaves a
reminder that still arrives rather than one that has quietly stopped. A boot with no
enrolment registers with nothing — asking would put the permission sheet on screen at launch.

### The entitlement switch

A Personal Team is not issued `aps-environment`, and the committed project must keep signing.
So the App target's `CODE_SIGN_ENTITLEMENTS` now reads `$(SPOTTER_ENTITLEMENTS)`, whose
committed default (in `ios/debug.xcconfig` for Debug and in the project's own build settings
for both configurations, since Release has no xcconfig) is `App/Share.entitlements` — exactly
what it was. `App/Push.entitlements` is that file plus `aps-environment = development`, and
is opted into from the gitignored `Local.xcconfig`. `Local.xcconfig.example` documents it.

## Findings on the Simulator (iPhone Air, iOS 26.2)

- The app builds, installs and launches with the default entitlements: `BUILD SUCCEEDED`,
  no Swift warnings. (Two `appintentsmetadataprocessor` warnings are pre-existing on this
  scheme and come from targets this branch does not touch.)
- `xcrun simctl push` **accepts both committed fixtures** and rejects a payload with no `aps`
  key, so "sent" means Apple's own validator read them. The fixtures are generated by
  `npm run push:harness` from the same `apnsPayload()` the sender calls, so a simulator can
  never show something the phone would not get.
- iOS resolves `spotter://tab/plan` to this app, so the link the payload carries is claimed.
- A pushed notification does **not** display, because the app has never been granted
  notification authorization — and by design the only thing that asks is the reminders
  switch. Granting it needs a tap, which this session could not perform (see below).
- **Whether this simulator issues an APNs device token is therefore still unknown.** The
  code path is in place and logged (`Spotter push: APNs issued a %d-character device token`,
  length only — a token is somebody's address and does not belong in a log); Apple documents
  it as working on Apple-silicon Macs since Xcode 14, but it was not observed here.

## What only the owner can do

In this order. Nothing before step 5 changes anything users see.

1. **Join the Apple Developer Program** ($99/yr) — the blocker since 15 Sept. Everything else
   here is waiting on it.
2. **Developer account → Certificates, Identifiers & Profiles → Keys → +**, tick **Apple
   Push Notifications service (APNs)**, choose the Sandbox+Production team-scoped key,
   Continue → Register → **Download** `AuthKey_XXXXXXXXXX.p8`. It downloads once. Note the
   10-character Key ID and the 10-character Team ID.
3. **Enable Push Notifications on the App ID** (Identifiers → the Spotter App ID →
   Capabilities → Push Notifications → Save).
4. **Set the three secrets** (from the repo root):
   ```
   supabase secrets set APNS_KEY_ID=XXXXXXXXXX APNS_TEAM_ID=YYYYYYYYYY \
     APNS_KEY_P8="$(cat ~/Downloads/AuthKey_XXXXXXXXXX.p8)"
   ```
   All three or none: `apnsCfg()` answers null unless every one is set, and the app keeps
   showing the "not configured" line until then.
5. **Apply the migration**: `supabase db push` (it is
   `supabase/migrations/20260918190000_push_devices.sql` — it creates the table and
   **re-schedules `spotter-push-tick` under the same name** so the hourly job also wakes for
   native installs).
6. **Deploy the function** so `/api/push/config` starts answering `apns: true`.
7. **Turn the entitlement on locally**: add `SPOTTER_ENTITLEMENTS = App/Push.entitlements`
   to `ios/App/Local.xcconfig`, then `npm run ios:build`. On a Personal Team this **will
   fail to sign** with "Provisioning profile ... doesn't include the aps-environment
   entitlement" — that is the expected answer until step 1 is done, and the line comes back
   out. With the paid team it signs.
8. **Check it on a device**: sign in, Settings → Reminders → Plan-day on → allow the prompt →
   the row appears (`select token, env, bundle, remind_plan from push_devices` under your own
   account). Then force a tick:
   ```
   curl -X POST "https://mtzevoxxpsktmrbbuxva.supabase.co/functions/v1/spotter/api/push/tick?dry=1" \
     -H "x-worker-secret: <app_config.worker_secret>"
   ```
   `?dry=1` reports the decisions without sending; drop it to send for real.
9. **Distribution builds need the production entitlement**: `aps-environment` becomes
   `production` in the archive, and `SPOTTER_ENTITLEMENTS` has to point at a Push
   entitlements file with that value (or Xcode's automatic signing will do it for an App
   Store profile). The `env` column already records which host each token belongs to, so
   sandbox and production installs can coexist during a TestFlight round.

## Left alone

- No `/api/push/device` route. The page writes its own row through PostgREST under RLS, which
  is exactly what the browser has always done; a route would be a second way to write one
  row and a second thing to keep in step with the grant.
- The cap ledger columns (`last_sent_at`, `sent_week`, `week_key`, `risk_week`) are revoked
  from `authenticated` on the new table, same as the old one. A cap you can erase from a
  debugger is not a cap.
- `docs/sw.js` and the browser path are untouched; `tools/ios/push-check.mjs` asserts that the
  gate and the copy a browser sees are byte-identical to before.

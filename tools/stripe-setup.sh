#!/usr/bin/env bash
# Spotter — set Stripe up, end to end.
#
# Prompts for the Stripe secret key (hidden), runs tools/stripe-setup.mjs against
# it to create the products, prices, portal configuration and webhook endpoint,
# captures the webhook signing secret that run prints, stores both secrets on the
# Supabase function and redeploys it.
#
# Same handling as set-keys.sh: nothing you type is echoed, the values go into a
# temp file with 600 perms rather than onto a command line, and the file is
# deleted on the way out — so neither key reaches your shell history or the
# process list. The signing secret is redacted from what this prints, because a
# terminal scrollback is a file too.
#
#   ./tools/stripe-setup.sh           # a sandbox / test key
#   ./tools/stripe-setup.sh --live    # the live account (asks you to type LIVE)
#
# Run it for the test key first, verify a real checkout end to end, and only then
# run it again with the live key: portal configurations and webhook endpoints are
# per mode, so the live account genuinely needs its own run.
set -euo pipefail
cd "$(dirname "$0")/.."

LIVE=""
for a in "$@"; do
  case "$a" in
    --live) LIVE="--live" ;;
    *) echo "Unknown option: $a  (only --live)"; exit 1 ;;
  esac
done

REF="$(grep '^PROJECT_REF=' .env.local 2>/dev/null | cut -d= -f2 || true)"
[ -n "$REF" ] || { echo "PROJECT_REF missing from .env.local"; exit 1; }
command -v node >/dev/null || { echo "node is not installed (Node 20 or newer)"; exit 1; }
command -v supabase >/dev/null || { echo "the supabase CLI is not installed"; exit 1; }

if [ -n "$LIVE" ]; then
  cat <<'WARN'

*** LIVE MODE ***
This will create products, prices, a portal configuration and a webhook endpoint
in your REAL Stripe account, and point the live function at them. Real cards will
be charged by what you set up here.

WARN
  printf 'Type LIVE to continue: '
  read -r confirm
  [ "$confirm" = "LIVE" ] || { echo "Not confirmed. Nothing was done."; exit 1; }
fi

cat <<'INTRO'

Setting Spotter up in Stripe. Nothing you type is echoed or logged.

The key: https://dashboard.stripe.com/apikeys — start in a sandbox and use the
sk_test_… secret key. What gets created is read from tools/stripe-plans.json;
edit the amounts there first if you want different prices.

INTRO

printf 'Stripe secret key\n  STRIPE_SECRET_KEY: '
read -rs KEY
printf '\n'
[ -n "$KEY" ] || { echo "Nothing entered. No changes made."; exit 0; }

OUT="$(mktemp)"; chmod 600 "$OUT"
TMP="$(mktemp)"; chmod 600 "$TMP"
cleanup() { rm -f "$OUT" "$TMP"; }
trap cleanup EXIT

echo
set +e
STRIPE_SECRET_KEY="$KEY" node tools/stripe-setup.mjs $LIVE >"$OUT" 2>&1
STATUS=$?
set -e

# Everything the script said, with the one line carrying the signing secret held
# back — it is captured below and stored, and it has no business in scrollback.
sed 's/^STRIPE_WEBHOOK_SECRET=.*$/STRIPE_WEBHOOK_SECRET=whsec_… (captured — stored, not shown)/' "$OUT"

if [ "$STATUS" -ne 0 ]; then
  echo "Stripe setup failed. No secrets were stored and the function was not redeployed."
  exit "$STATUS"
fi

WHSEC="$(grep -m1 '^STRIPE_WEBHOOK_SECRET=' "$OUT" | cut -d= -f2- || true)"

if [ -z "$WHSEC" ]; then
  cat <<'NOSECRET'
The webhook endpoint already existed, so Stripe did not return its signing secret
— it only ever shows that once, at creation. If STRIPE_WEBHOOK_SECRET is already
set on the function, leave the next prompt blank and it stays as it is. If it is
not, roll the secret in the Dashboard (Workbench > Webhooks > the Spotter
endpoint > Roll secret) and paste the new one here.

NOSECRET
  printf 'Webhook signing secret (whsec_…, or blank to keep the stored one): '
  read -rs WHSEC
  printf '\n'
fi

printf 'STRIPE_SECRET_KEY=%s\n' "$KEY" >> "$TMP"
# An `[ … ] && printf` one-liner would abort the whole script under `set -e` on
# the run where there is no new secret to store, which is the common re-run.
if [ -n "$WHSEC" ]; then
  printf 'STRIPE_WEBHOOK_SECRET=%s\n' "$WHSEC" >> "$TMP"
fi

echo "Storing secrets…"
supabase secrets set --env-file "$TMP" --project-ref "$REF" >/dev/null
echo "Redeploying the function so it picks them up…"
supabase functions deploy spotter --no-verify-jwt >/dev/null 2>&1

cat <<DONE

Done. The function now has STRIPE_SECRET_KEY${WHSEC:+ and STRIPE_WEBHOOK_SECRET}.

Check it: open the app, Settings > Plan. The paywall should show real prices
instead of "coming soon". Then run one checkout with card 4242 4242 4242 4242
(any future expiry, any CVC) and watch the plan flip to Plus.

DONE

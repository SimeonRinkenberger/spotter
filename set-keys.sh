#!/usr/bin/env bash
# Prompts for the API keys and stores them as Supabase function secrets.
# Input is hidden and written to a temp file with 600 perms rather than passed as
# an argument, so the values never reach your shell history or the process list.
set -euo pipefail
cd "$(dirname "$0")"

REF="$(grep '^PROJECT_REF=' .env.local | cut -d= -f2)"
[ -n "$REF" ] || { echo "PROJECT_REF missing from .env.local"; exit 1; }

TMP="$(mktemp)"
chmod 600 "$TMP"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

ask() {                       # ask VAR_NAME "description"
  local var="$1" desc="$2" val=""
  printf '\n%s\n  %s: ' "$desc" "$var"
  read -rs val
  printf '\n'
  if [ -n "$val" ]; then
    printf '%s=%s\n' "$var" "$val" >> "$TMP"
    echo "  ✓ queued (${#val} chars)"
  else
    echo "  – skipped"
  fi
}

cat <<'INTRO'
Setting Spotter's API keys. Paste each one and press Return; leave blank to skip.
Nothing you type is echoed or logged.

Where to get them:
  OPENAI_API_KEY   https://platform.openai.com/api-keys   (paid — GPT-5.6 Luna; takes
                   precedence over everything below once set. Buy credits first and set
                   a budget cap. A ChatGPT subscription does NOT include API access.)
  GEMINI_API_KEY   https://aistudio.google.com/apikey     (existing keys are viewable)
  GROQ_API_KEY     https://console.groq.com/keys          (create new — Groq shows a key once)
  YOUTUBE_API_KEY  https://console.cloud.google.com/apis/credentials
                   Its own Google Cloud project with YouTube Data API v3 enabled.
                   Restrict the key to that API only — no referrer or IP restriction,
                   since edge functions send no referrer and rotate IPs.
INTRO

ask OPENAI_API_KEY  "OpenAI key — GPT-5.6 Luna, the paid primary extractor"
ask GEMINI_API_KEY  "Google AI Studio key — extraction + vision"
ask GROQ_API_KEY    "Groq key — fallback, 14,400 requests/day free"
ask YOUTUBE_API_KEY "YouTube Data API key — video descriptions (optional)"

if [ ! -s "$TMP" ]; then echo -e "\nNothing entered. No changes made."; exit 0; fi

echo -e "\nStoring secrets…"
supabase secrets set --env-file "$TMP" --project-ref "$REF" >/dev/null
echo "Redeploying the function so it picks them up…"
supabase functions deploy spotter --no-verify-jwt >/dev/null 2>&1
echo -e "\nDone. Secrets now set:"
supabase secrets list --project-ref "$REF" 2>/dev/null \
  | tr ',' '\n' | grep -o '"name":"[A-Z_]*"' | cut -d'"' -f4 \
  | grep -vE '^SUPABASE_' | sed 's/^/  /'

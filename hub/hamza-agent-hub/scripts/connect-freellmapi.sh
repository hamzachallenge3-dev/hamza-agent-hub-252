#!/usr/bin/env bash
# Connect hamza-agent-hub (one plugin) to FreeLLMAPI — open-source free LLM gateway.
# Upstream: https://github.com/tashfeenahmed/freellmapi
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${HAH_ENV_FILE:-$ROOT/.env}"
BASE_URL="${HAH_FREELLMAPI_URL:-http://127.0.0.1:3001/v1}"
MODEL="${HAH_FREELLMAPI_MODEL:-auto}"
KEY="${HAH_FREELLMAPI_KEY:-}"

echo "== Hamza Agent Hub ↔ FreeLLMAPI =="
echo "Plugin: $ROOT"
echo "Gateway: $BASE_URL"
echo "Model:   $MODEL"
echo

write_env() {
  touch "$ENV_FILE"
  # strip previous FreeLLMAPI / model provider lines then append
  tmp="$(mktemp)"
  grep -Ev '^(HAH_MODEL_PROVIDER|HAH_USE_FREELLMAPI|HAH_FREELLMAPI_|HAH_MODEL_URL|HAH_MODEL_NAME|HAH_MODEL_API_KEY)=' "$ENV_FILE" >"$tmp" || true
  cat >>"$tmp" <<EOF
HAH_MODEL_PROVIDER=freellmapi
HAH_USE_FREELLMAPI=1
HAH_FREELLMAPI_URL=$BASE_URL
HAH_FREELLMAPI_MODEL=$MODEL
HAH_MODEL_URL=$BASE_URL
HAH_MODEL_NAME=$MODEL
EOF
  if [[ -n "$KEY" ]]; then
    echo "HAH_FREELLMAPI_KEY=$KEY" >>"$tmp"
    echo "HAH_MODEL_API_KEY=$KEY" >>"$tmp"
  else
    echo "# HAH_FREELLMAPI_KEY=freellmapi-PASTE_FROM_DASHBOARD" >>"$tmp"
  fi
  mv "$tmp" "$ENV_FILE"
  echo "Wrote $ENV_FILE"
}

probe() {
  echo "Probing $BASE_URL/models ..."
  code="$(curl -s -o /tmp/hah-freellmapi-models.json -w '%{http_code}' \
    ${KEY:+-H "Authorization: Bearer $KEY"} \
    --connect-timeout 3 "$BASE_URL/models" || true)"
  echo "HTTP $code"
  if [[ "$code" == "200" ]]; then
    echo "FreeLLMAPI is UP."
    head -c 400 /tmp/hah-freellmapi-models.json || true
    echo
    return 0
  fi
  echo "FreeLLMAPI not reachable yet."
  return 1
}

start_hint() {
  cat <<'EOF'

Start FreeLLMAPI (pick one):

  # Official one-liner (see upstream docs)
  curl -fsSL https://freellmapi.co/install.sh | bash

  # Or Docker Compose from upstream repo
  git clone https://github.com/tashfeenahmed/freellmapi.git /tmp/freellmapi
  cd /tmp/freellmapi && docker compose up -d

Then open http://127.0.0.1:3001 → Keys → add free provider keys → copy unified key:
  export HAH_FREELLMAPI_KEY='freellmapi-…'
  ./scripts/connect-freellmapi.sh

EOF
}

write_env

if probe; then
  echo
  echo "Hub is configured for FreeLLMAPI."
  echo "Restart the MCP server so it reloads env:"
  echo "  cd \"$ROOT\" && ./scripts/start.sh"
else
  start_hint
  echo "Env is prepared; start FreeLLMAPI then re-run this script with HAH_FREELLMAPI_KEY set."
  exit 2
fi

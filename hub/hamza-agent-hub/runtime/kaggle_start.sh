#!/usr/bin/env bash
# Start Hamza Agent Hub origin on Kaggle (or any agentbox host) for the live Worker tunnel.
# Never prints secrets. Requires HAH_AUTH_TOKEN in the environment (Kaggle Secrets).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${HAH_ORIGIN_PORT:-8787}"
SANDBOX_USER="${HUB_SANDBOX_USER:-agentbox}"
WORK_DIR="${HUB_SANDBOX_WORK_DIR:-/home/${SANDBOX_USER}/work}"
DATA_DIR="${HAH_DATA_DIR:-$ROOT/data}"
WS_DIR="${HAH_WORKSPACES_DIR:-$ROOT/workspaces}"
VENV="${HAH_VENV:-$ROOT/.venv}"

if [[ -z "${HAH_AUTH_TOKEN:-}" ]]; then
  echo "ERROR: HAH_AUTH_TOKEN is unset. Load it from Kaggle Secrets (must match Worker ORIGIN_TOKEN)." >&2
  exit 1
fi
if [[ "${#HAH_AUTH_TOKEN}" -lt 24 ]]; then
  echo "ERROR: HAH_AUTH_TOKEN must be at least 24 characters." >&2
  exit 1
fi

command -v node >/dev/null || { echo "ERROR: node not found (need Node 22+)." >&2; exit 1; }
command -v python3 >/dev/null || { echo "ERROR: python3 not found." >&2; exit 1; }
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "ERROR: Node >= 22 required (found $(node -v))." >&2
  exit 1
fi

echo "Installing JS deps and building…"
if [[ ! -d node_modules ]]; then
  npm ci
else
  npm ci --prefer-offline
fi
npm run build

echo "Installing Python deps in venv…"
python3 -m venv "$VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"
pip install -q -r runtime/requirements.txt

mkdir -p "$DATA_DIR" "$WS_DIR" "$WORK_DIR"
# Best-effort ownership for the sandbox work tree (root/Kaggle only).
if id "$SANDBOX_USER" >/dev/null 2>&1; then
  if [[ "$(id -u)" -eq 0 ]]; then
    chown -R "$SANDBOX_USER:$SANDBOX_USER" "$WORK_DIR" 2>/dev/null || true
  fi
else
  echo "WARN: user '$SANDBOX_USER' missing; run_command will fail until it exists." >&2
fi

export HAH_TRANSPORT=http
export HAH_HOST=127.0.0.1
export HAH_PORT=8790
export HAH_DATA_DIR="$DATA_DIR"
export HAH_WORKSPACES_DIR="$WS_DIR"
export HAH_DB_PATH="${HAH_DB_PATH:-$DATA_DIR/hamza-hub.sqlite}"
export HAH_AUTO_FREELLMAPI="${HAH_AUTO_FREELLMAPI:-0}"
export HUB_SANDBOX_USER="$SANDBOX_USER"
export HUB_SANDBOX_WORK_DIR="$WORK_DIR"
# Explicitly enable sandbox tools (also auto-enabled when HTTP + auth).
export HAH_ENABLE_SANDBOX_TOOLS=1

echo "Starting hub.py on 127.0.0.1:${PORT} (Node loopback :8790)…"
echo "Point cloudflared / Worker ORIGIN_URL|HUB_ORIGIN at this host; connect URL remains hub.imdifferent01.com/<HUB_SECRET>/mcp"
cd "$ROOT/runtime"
exec uvicorn hub:app --host 127.0.0.1 --port "$PORT" --no-access-log

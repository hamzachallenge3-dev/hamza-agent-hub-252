#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ -d node_modules ]] || npm ci
[[ -f dist/index.js ]] || npm run build
export HAH_TRANSPORT="${HAH_TRANSPORT:-stdio}"
export HAH_CONCURRENCY="${HAH_CONCURRENCY:-2}"
exec node --experimental-sqlite "$ROOT/dist/index.js"

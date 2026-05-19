#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

npm install
npm run build

if command -v ss >/dev/null 2>&1; then
  existing_pids=$(ss -ltnp 2>/dev/null | awk '/:8877 / { print $0 }' | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u)
  if [ -n "$existing_pids" ]; then
    kill $existing_pids
    while ss -ltnp 2>/dev/null | grep -q ':8877 '; do
      sleep 0.2
    done
  fi
fi

export HOST=0.0.0.0
export PORT=8877
export APP_TOKEN=lingchaojie
export DATABASE_PATH=./webagent.db
export CLAUDE_CONFIG_DIR=/home/alvin/.claude
export CLAUDE_BIN=claude
export SESSION_TTL_MS=1800000

exec npm run dev

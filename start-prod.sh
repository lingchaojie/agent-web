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

log_file="./webagent-prod.log"
pid_file="./webagent-prod.pid"

nohup npm run dev:server >"$log_file" 2>&1 &
server_pid=$!
echo "$server_pid" >"$pid_file"

if command -v ss >/dev/null 2>&1; then
  for _ in {1..50}; do
    if ss -ltnp 2>/dev/null | grep -q ':8877 '; then
      echo "Production server started on port 8877 (pid $server_pid)."
      echo "Logs: $log_file"
      exit 0
    fi
    if ! kill -0 "$server_pid" 2>/dev/null; then
      echo "Production server failed to start. Logs: $log_file" >&2
      exit 1
    fi
    sleep 0.2
  done
fi

echo "Production server starting in background (pid $server_pid)."
echo "Logs: $log_file"

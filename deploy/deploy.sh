#!/usr/bin/env bash
# Build and roll out Curialy AI on the VPS, keeping the previous build for rollback.
#   deploy/deploy.sh            test, build, restart, health-check
#   deploy/deploy.sh --rollback restore the previous build and restart
#   deploy/deploy.sh --bridge   also install deploy/snowflake-proxy/proxy.js and restart the bridge
# The box has ~1 GB RAM: stop any side instance first; the build heap is capped.
set -euo pipefail
cd "$(dirname "$0")/.."

health() {
  for _ in $(seq 1 40); do curl -sf -o /dev/null http://127.0.0.1:3000/ && return 0; sleep 1; done
  return 1
}

if [ "${1:-}" = "--rollback" ]; then
  [ -d dist-prev ] || { echo "no dist-prev to roll back to"; exit 1; }
  rm -rf dist-failed && mv dist dist-failed && mv dist-prev dist
  sudo systemctl restart curialyai && health && echo "rolled back (failed build kept in dist-failed/)"
  exit 0
fi

# Only committed code is deployed: a half-edited tree must never reach production.
if [ "${ALLOW_DIRTY:-}" != "1" ]; then
  dirty=$(git status --porcelain -- . ':!deploy/snowflake-proxy/proxy.js') || { echo "git status failed"; exit 1; }
  if [ -n "$dirty" ]; then
    echo "$dirty"
    echo "working tree has uncommitted or untracked changes; commit them (or ALLOW_DIRTY=1 to override)"; exit 1
  fi
fi
# The unit carries KillMode=mixed / TimeoutStopSec so a restart can record running tasks as interrupted.
if ! cmp -s deploy/systemd/curialyai.service /etc/systemd/system/curialyai.service; then
  echo "note: /etc/systemd/system/curialyai.service differs from deploy/systemd/curialyai.service"
  echo "      install it with: sudo cp deploy/systemd/curialyai.service /etc/systemd/system/ && sudo systemctl daemon-reload"
fi

sudo systemctl stop curialy-test 2>/dev/null || true
NODE_OPTIONS=--max-old-space-size=1700 npx tsc --noEmit
npx vitest run
rm -rf dist-prev && cp -a dist dist-prev
NODE_OPTIONS=--max-old-space-size=900 npm run build
git rev-parse HEAD > dist/BUILD

if [ "${1:-}" = "--bridge" ]; then
  cp ~/snowflake-proxy/proxy.js ~/snowflake-proxy/proxy.js.bak-"$(date +%Y%m%d%H%M)"
  node --check deploy/snowflake-proxy/proxy.js && cp deploy/snowflake-proxy/proxy.js ~/snowflake-proxy/proxy.js
  # Delayed so a session that talks to the bridge (e.g. an operator's coding agent) is not cut mid-request.
  sudo systemd-run --on-active=4 --collect /bin/systemctl restart snowflake-proxy
fi

sudo systemctl restart curialyai
health || { echo "health check failed: run deploy/deploy.sh --rollback"; exit 1; }
curl -s -o /dev/null -w "public %{http_code}\n" https://curialy.tech/

#!/usr/bin/env bash
# Periodic cleanup on a Curialy Dedicated Isolated Compute worker (curialy-worker-cleanup.timer,
# every 10 minutes): stopped containers, dangling images, stale /tmp entries, and workspaces whose
# sandbox is gone. When the root filesystem is still above the limit, the build cache goes too.
set -uo pipefail

LIMIT="${DISK_LIMIT_PERCENT:-85}"
WORKSPACES="${WORKSPACES:-/srv/curialy-workspaces}"
log() { echo "[cleanup] $*"; }

docker container prune -f --filter "until=30m" >/dev/null && log "stopped containers older than 30 min removed"
docker image prune -f >/dev/null && log "dangling images removed"
find /tmp -mindepth 1 -maxdepth 1 -mmin +60 ! -name 'systemd-private-*' ! -name '.X*' -exec rm -rf -- {} + 2>/dev/null
log "/tmp entries older than 1 h removed"

# A workspace without a container (its sandbox was closed, or the worker restarted) is not needed:
# the platform keeps every task's sources.
if [ -d "$WORKSPACES" ]; then
  running=$(docker ps --format '{{.Names}}' | sed -n 's/^curialy-sbx-//p')
  for dir in "$WORKSPACES"/*/; do
    [ -d "$dir" ] || continue
    task=$(basename "$dir")
    if ! grep -qx "$task" <<<"$running" && [ -n "$(find "$dir" -maxdepth 0 -mmin +30)" ]; then
      rm -rf -- "$dir" && log "removed workspace $task (no sandbox)"
    fi
  done
fi

used=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if [ "${used:-0}" -ge "$LIMIT" ]; then
  docker builder prune -af >/dev/null 2>&1
  docker container prune -f >/dev/null
  log "root filesystem at ${used}%: build cache and every stopped container removed"
fi
log "root filesystem at $(df --output=pcent / | tail -1 | tr -d ' ')"

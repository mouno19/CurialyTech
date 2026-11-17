#!/usr/bin/env bash
# Run Node inside a throwaway systemd sandbox for the Astryx snapshot: no network (loopback only),
# a transient user, read-only system, no home, /srv hidden except the staged project (read-only)
# and this folder's driver (read-only). Output only through stdout/stderr.
#   scripts/astryx/jail.sh <staged project dir> <node args...>
set -euo pipefail
project="$(realpath "$1")"; shift
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$project/package.json" ] || { echo "no staged project at $project" >&2; exit 2; }
exec sudo -n systemd-run --quiet --wait --pipe --collect \
  -p DynamicUser=yes -p PrivateNetwork=yes -p PrivateTmp=yes -p PrivateDevices=yes -p PrivateIPC=yes \
  -p ProtectSystem=strict -p ProtectHome=yes -p TemporaryFileSystem=/srv:ro -p TemporaryFileSystem=/opt:ro \
  -p "BindReadOnlyPaths=$project:/srv/stage/project" -p "BindReadOnlyPaths=$here:/srv/stage/driver" \
  -p NoNewPrivileges=yes -p CapabilityBoundingSet= -p AmbientCapabilities= -p RestrictAddressFamilies=AF_UNIX \
  -p RestrictNamespaces=yes -p RestrictSUIDSGID=yes -p LockPersonality=yes -p ProtectKernelTunables=yes \
  -p ProtectKernelModules=yes -p ProtectKernelLogs=yes -p ProtectControlGroups=yes -p ProtectClock=yes \
  -p ProtectHostname=yes -p ProtectProc=invisible -p SystemCallArchitectures=native -p UMask=0077 \
  -p MemoryMax=2G -p TasksMax=64 -p RuntimeMaxSec=1800 \
  -E HOME=/tmp -E CI=1 -E NO_UPDATE_NOTIFIER=1 -E JITI_FS_CACHE=false -E NODE_ENV=production -E NO_COLOR=1 \
  --working-directory=/srv/stage/project /usr/bin/node "$@"

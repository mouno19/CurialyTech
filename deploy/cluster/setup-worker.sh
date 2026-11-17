#!/usr/bin/env bash
# Prepare a Curialy Dedicated Isolated Compute worker (idempotent; run as root from this folder):
#   Docker with user-namespace remapping and capped logs, 2 GB of swap, the sandbox network and its
#   firewall, the curialy-sandbox-runner image, the workspace folder, and the 10-minute cleanup timer.
#   tar -C deploy/cluster -cz . | ssh ubuntu@<worker> 'rm -rf /tmp/curialy-cluster && mkdir /tmp/curialy-cluster && tar -xz -C /tmp/curialy-cluster && sudo bash /tmp/curialy-cluster/setup-worker.sh'
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DEBIAN_FRONTEND=noninteractive

# 1. Docker.
if ! command -v docker >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq docker.io >/dev/null
fi
usermod -aG docker ubuntu
install -d -m 0755 /etc/docker
cat > /etc/docker/daemon.json <<'JSON'
{
  "userns-remap": "default",
  "no-new-privileges": true,
  "icc": false,
  "live-restore": true,
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "2" }
}
JSON
systemctl enable docker >/dev/null 2>&1
systemctl restart docker

# 2. Swap: 2 GB, kept across reboots.
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  [ -f /swapfile ] || fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab

# 3. The sandbox network (no traffic between sandboxes) and its firewall, re-applied whenever Docker starts.
docker network inspect curialy-sbx >/dev/null 2>&1 || docker network create --driver bridge --subnet 172.30.0.0/16 \
  -o com.docker.network.bridge.name=curialy-sbx0 -o com.docker.network.bridge.enable_icc=false curialy-sbx >/dev/null
install -m 0755 "$HERE/sandbox-firewall.sh" /usr/local/sbin/curialy-sandbox-firewall
cat > /etc/systemd/system/curialy-sandbox-firewall.service <<'UNIT'
[Unit]
Description=Curialy Dedicated Isolated Compute sandbox firewall
After=docker.service
PartOf=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/curialy-sandbox-firewall
RemainAfterExit=yes

[Install]
WantedBy=docker.service
UNIT

# 4. Workspaces (one folder per task, mounted into its sandbox) and periodic cleanup.
install -d -m 0711 /srv/curialy-workspaces
install -m 0755 "$HERE/worker-cleanup.sh" /usr/local/sbin/curialy-worker-cleanup
cat > /etc/systemd/system/curialy-worker-cleanup.service <<'UNIT'
[Unit]
Description=Curialy Dedicated Isolated Compute worker cleanup
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/curialy-worker-cleanup
UNIT
cat > /etc/systemd/system/curialy-worker-cleanup.timer <<'UNIT'
[Unit]
Description=Curialy Dedicated Isolated Compute worker cleanup, every 10 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=10min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now curialy-sandbox-firewall.service curialy-worker-cleanup.timer >/dev/null 2>&1
systemctl restart curialy-sandbox-firewall.service

# 5. The platform drives every sandbox over one multiplexed SSH connection per worker: room for many
#    sessions on it (commands, background jobs and file syncs of several sandboxes at once).
cat > /etc/ssh/sshd_config.d/60-curialy-compute.conf <<'CONF'
MaxSessions 100
MaxStartups 50:30:200
ClientAliveInterval 30
ClientAliveCountMax 4
CONF
sshd -t && systemctl reload ssh

# 6. The runner image.
docker build -q -t curialy-sandbox-runner:latest "$HERE" >/dev/null
docker image prune -f >/dev/null

echo "worker ready: $(docker --version | cut -d, -f1); image $(docker image inspect -f '{{.Size}}' curialy-sandbox-runner:latest | awk '{printf "%.0f MB", $1/1048576}'); swap $(swapon --show=SIZE --noheadings | head -1); disk $(df -h --output=avail / | tail -1 | tr -d ' ') free"

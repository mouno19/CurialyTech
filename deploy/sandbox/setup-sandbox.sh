#!/usr/bin/env bash
# Prepare the agent sandbox on a fresh Ubuntu host (idempotent). Run as root.
#
# Agent commands run as the unprivileged user `curialy-agent`, each in its own transient
# systemd scope (512 MB RAM, no swap, 150% CPU, 256 tasks) entered through setpriv; see
# server/agent/sandbox.ts. The app user (APP_USER, default `ubuntu`) needs passwordless sudo
# for exactly these commands:
#   sudo -n systemd-run --scope ... /usr/bin/setpriv --reuid=curialy-agent ...
#   sudo -n systemctl stop curialy-agent-*.scope
#   sudo -n install -d -o curialy-agent -g curialy-agent -m 2775 /srv/curialy-workspaces/<task>
#   sudo -n -u curialy-agent rm -rf -- /srv/curialy-workspaces/<task>
# (On curialy-tech the app user has general sudo from the cloud image; a narrower sudoers
# rule covering only the lines above is the stricter option.)
set -euo pipefail

APP_USER="${APP_USER:-ubuntu}"
SANDBOX_USER="${SANDBOX_USER:-curialy-agent}"
WORKSPACES="${WORKSPACES:-/srv/curialy-workspaces}"

# 1. Sandbox user: system account, no password, no sudo.
if ! id "$SANDBOX_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/var/lib/$SANDBOX_USER" --shell /bin/bash "$SANDBOX_USER"
fi
passwd -l "$SANDBOX_USER" >/dev/null
chmod 750 "/var/lib/$SANDBOX_USER"

# 2. Scratch workspaces: owned by the sandbox user, setgid so the app user (group member) can
#    write files the agent's tools create. Workspaces are snapshotted to the database and
#    removed after AGENT_WORKSPACE_IDLE_MINUTES; nothing durable lives here.
install -d -o "$SANDBOX_USER" -g "$SANDBOX_USER" -m 2770 "$WORKSPACES"
usermod -aG "$SANDBOX_USER" "$APP_USER"

# 3. Keep the sandbox user out of app source, builds and the bridge.
for dir in /srv/curialyai-next "/home/$APP_USER/snowflake-proxy"; do
  [ -d "$dir" ] && chmod 750 "$dir"
done

# 4. Network: the sandbox user may reach the internet (package installs, docs) but not the
#    app (3000), the side instance (3100), the model bridge (8082), SSH, cloud metadata or
#    private networks.
UID_SANDBOX="$(id -u "$SANDBOX_USER")"
iptables -N CURIALY_SANDBOX 2>/dev/null || iptables -F CURIALY_SANDBOX
iptables -C OUTPUT -m owner --uid-owner "$UID_SANDBOX" -j CURIALY_SANDBOX 2>/dev/null \
  || iptables -A OUTPUT -m owner --uid-owner "$UID_SANDBOX" -j CURIALY_SANDBOX
for port in 8082 3000 3100 22; do
  iptables -A CURIALY_SANDBOX -o lo -p tcp --dport "$port" -j REJECT
done
for net in 169.254.0.0/16 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10; do
  iptables -A CURIALY_SANDBOX -d "$net" -j REJECT
done

# 5. Persist the rules across reboots.
if ! command -v netfilter-persistent >/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
fi
netfilter-persistent save

echo "Sandbox ready: user $SANDBOX_USER (uid $UID_SANDBOX), workspaces $WORKSPACES, firewall chain CURIALY_SANDBOX."

#!/usr/bin/env bash
# Network rules for Curialy Dedicated Isolated Compute sandboxes (idempotent; run by
# curialy-sandbox-firewall.service after Docker starts). Sandboxes may reach the public internet
# (package installs, docs) but not: the instance metadata service, private or shared address
# ranges (this worker's network, other workers, the platform), each other, or this worker itself.
set -euo pipefail

SUBNET="${SANDBOX_SUBNET:-172.30.0.0/16}"
BRIDGE="${SANDBOX_BRIDGE:-curialy-sbx0}"

iptables -N CURIALY-SBX 2>/dev/null || iptables -F CURIALY-SBX
iptables -C DOCKER-USER -j CURIALY-SBX 2>/dev/null || iptables -I DOCKER-USER 1 -j CURIALY-SBX
# Replies to connections the worker opened (previews reach a sandbox's dev server this way).
iptables -A CURIALY-SBX -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
for net in 169.254.0.0/16 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 127.0.0.0/8 224.0.0.0/4; do
  iptables -A CURIALY-SBX -s "$SUBNET" -d "$net" -j REJECT --reject-with icmp-port-unreachable
done
iptables -A CURIALY-SBX -j RETURN

# Nothing from a sandbox to the worker's own services (SSH, Docker, anything listening).
iptables -N CURIALY-SBX-IN 2>/dev/null || iptables -F CURIALY-SBX-IN
iptables -C INPUT -i "$BRIDGE" -j CURIALY-SBX-IN 2>/dev/null || iptables -I INPUT 1 -i "$BRIDGE" -j CURIALY-SBX-IN
iptables -A CURIALY-SBX-IN -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
iptables -A CURIALY-SBX-IN -j REJECT --reject-with icmp-port-unreachable

echo "sandbox firewall applied for $SUBNET on $BRIDGE"

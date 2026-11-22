#!/bin/bash
set -euo pipefail
sudo -n mkdir -p /opt/mantel-udm /etc/mantel-udm
sudo -n install -o root -g mantel -m 0644 /tmp/udm_monitor.py /opt/mantel-udm/udm_monitor.py
sudo -n install -o root -g root -m 0644 /tmp/mantel-udm.service /etc/systemd/system/mantel-udm.service
# Key is installed separately to /etc/mantel-udm/unifi.key (0640 root:mantel)
if ! sudo -n test -s /etc/mantel-udm/unifi.key; then
  echo "ERROR: /etc/mantel-udm/unifi.key is missing" >&2
  exit 1
fi
sudo -n systemctl daemon-reload
sudo -n systemctl enable mantel-udm.service
sudo -n systemctl restart mantel-udm.service
sleep 2
systemctl is-active mantel-udm.service
systemctl is-active mantel-kiosk.service
echo "installed"

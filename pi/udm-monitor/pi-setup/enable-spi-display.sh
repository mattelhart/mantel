#!/bin/bash
# Enable the 3.5" SPI GPIO display (PiScreen/LCD35/ILI9486 + XPT2046)
# and pin the HDMI kiosk to the vc4 DRM card so cage does not grab the SPI panel.
set -euo pipefail

CONFIG=/boot/firmware/config.txt
BACKUP=/boot/firmware/config.txt.bak-spi
MARKER="mantel-spi-35"

if [ ! -f "$BACKUP" ]; then
  sudo -n cp -a "$CONFIG" "$BACKUP"
  echo "Backed up $CONFIG to $BACKUP"
else
  echo "Backup already exists: $BACKUP"
fi

if grep -q "$MARKER" "$CONFIG"; then
  echo "SPI display block already present in config.txt"
else
  sudo -n tee -a "$CONFIG" >/dev/null << 'EOF'

# mantel-spi-35: 3.5" GPIO SPI LCD (ILI9486 PiScreen/LCD35 clone) + XPT2046 touch
# Keeps HDMI/vc4 for the wall kiosk. Do not remove dtoverlay=vc4-kms-v3d.
dtparam=spi=on
dtoverlay=piscreen,drm,speed=18000000
EOF
  echo "Added SPI display overlay to config.txt"
fi

echo "----- tail of config.txt -----"
tail -n 20 "$CONFIG"

# Pin cage/kiosk to the HDMI (vc4) DRM card
sudo -n install -m 0755 /tmp/mantel-kiosk-start.sh /usr/local/bin/mantel-kiosk-start.sh

UNIT=/etc/systemd/system/mantel-kiosk.service
if [ ! -f /etc/systemd/system/mantel-kiosk.service.bak-spi ]; then
  sudo -n cp -a "$UNIT" /etc/systemd/system/mantel-kiosk.service.bak-spi
fi

if grep -q 'mantel-kiosk-start.sh' "$UNIT"; then
  echo "Kiosk unit already uses HDMI pin wrapper"
else
  sudo -n python3 - << 'PY'
from pathlib import Path
p = Path("/etc/systemd/system/mantel-kiosk.service")
t = p.read_text()
old = "ExecStart=/usr/bin/cage -s -- /usr/local/bin/mantel-kiosk.sh"
new = "ExecStart=/usr/local/bin/mantel-kiosk-start.sh"
if old not in t:
    raise SystemExit("unexpected kiosk unit ExecStart, aborting")
p.write_text(t.replace(old, new, 1))
print("Updated kiosk unit ExecStart to HDMI pin wrapper")
PY
fi

sudo -n systemctl daemon-reload
systemctl cat mantel-kiosk.service
echo "Ready to reboot"

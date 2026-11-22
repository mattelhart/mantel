#!/bin/bash
# Start cage only on the HDMI (vc4) DRM card so the SPI 3.5" panel stays free.
set -euo pipefail
CARD=""
for conn in /sys/class/drm/card*-HDMI-A-1; do
  [ -e "$conn" ] || continue
  base=$(basename "$conn")
  c=${base%%-*}
  if [ -e "/dev/dri/$c" ]; then
    CARD="/dev/dri/$c"
    break
  fi
done
if [ -n "$CARD" ]; then
  export WLR_DRM_DEVICES="$CARD"
  echo "mantel-kiosk-start: WLR_DRM_DEVICES=$CARD" >&2
else
  echo "mantel-kiosk-start: no HDMI DRM card found, starting cage with defaults" >&2
fi
exec /usr/bin/cage -s -- /usr/local/bin/mantel-kiosk.sh

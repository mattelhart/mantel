#!/bin/bash
set -u
echo "===== UPTIME / KERNEL ====="
uptime
uname -a
echo "===== CONFIG TAIL ====="
tail -n 15 /boot/firmware/config.txt
echo "===== DTOVERLAY ====="
sudo -n dtoverlay -l 2>/dev/null || true
echo "===== FB DEVICES ====="
ls -la /dev/fb* 2>/dev/null || echo "no /dev/fb*"
for fb in /sys/class/graphics/fb*; do
  [ -d "$fb" ] || continue
  echo "-- $fb name=$(cat $fb/name 2>/dev/null) size=$(cat $fb/virtual_size 2>/dev/null) bits=$(cat $fb/bits_per_pixel 2>/dev/null)"
done
echo "===== DRM ====="
ls -l /sys/class/drm/ 2>/dev/null
for c in /sys/class/drm/card*; do
  [ -e "$c/device/uevent" ] || continue
  echo "-- $(basename $c) --"
  grep -E 'DRIVER|OF_NAME|OF_COMPATIBLE' "$c/device/uevent" 2>/dev/null
done
echo "===== SPI ====="
ls -la /dev/spidev* 2>/dev/null || echo "no spidev"
ls /sys/class/spi_master 2>/dev/null || true
echo "===== INPUT ====="
cat /proc/bus/input/devices 2>/dev/null
ls -l /dev/input/ 2>/dev/null
echo "===== MODULES ====="
lsmod | grep -Ei 'ili9486|fbtft|ads7846|mipi_dbi|spi_bcm|spidev|tiny' || true
echo "===== DMESG DISPLAY/SPI/TOUCH ====="
sudo -n dmesg -T | grep -Ei 'ili9486|piscreen|ads7846|xpt2046|mipi-dbi|spi|fbtft|panel|touchscreen|drm_tiny|spi0' | tail -n 80
echo "===== KIOSK ====="
systemctl is-active mantel-kiosk.service
systemctl is-failed mantel-kiosk.service || true
# show whether WLR_DRM_DEVICES was set
journalctl -u mantel-kiosk.service -b --no-pager -n 30
echo "===== HDMI CONNECTOR ====="
for c in /sys/class/drm/card*-HDMI-A-1; do
  echo "$c status=$(cat $c/status 2>/dev/null) enabled=$(cat $c/enabled 2>/dev/null)"
done
echo "DONE"

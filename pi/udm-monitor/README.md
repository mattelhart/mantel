# Mantel UDM Pro monitor (3.5" SPI panel)

Python status display for the generic red-case 480x320 GPIO LCD on mantel-pi.
Source of truth lives here; installed on the Pi at `/opt/mantel-udm/`.

## Display driver (already applied)

`/boot/firmware/config.txt` (backup: `config.txt.bak-spi`):

    dtparam=spi=on
    dtoverlay=piscreen,drm,speed=18000000

This is the TinyDRM ILI9486 path used for Waveshare LCD35 / PiScreen clones
(SPI-to-parallel + XPT2046). After reboot:

- `/dev/fb1` — `ili9486drmfb` 480x320 RGB565
- DRM `card1` driver `ili9486`, compatible `waveshare,rpi-lcd-35`
- Touch: `ADS7846 Touchscreen` on `spi0.1` (`/dev/input/event1`)

The HDMI wall kiosk is pinned to the vc4 card via
`/usr/local/bin/mantel-kiosk-start.sh` (`WLR_DRM_DEVICES` = the card with
HDMI-A-1). Kiosk unit backup: `mantel-kiosk.service.bak-spi`.

## Service

- Unit: `mantel-udm.service` (independent of `mantel-kiosk.service`)
- App: `/opt/mantel-udm/udm_monitor.py`
- Key: `/etc/mantel-udm/unifi.key` (0640 root:mantel) — never log it
- Refresh: 5s from `https://10.0.0.1` Network + Protect Integration APIs
- Pages: Overview, Devices, Cameras. Tap the panel to cycle; also auto-rotates every 20s
- WireGuard: green if `192.168.3.2` (MattPhone) responds to ping

## Preview

`preview.png` is a 3-page contact sheet rendered from a live API dump.
`fb1-live.png` is a capture of the actual SPI framebuffer.

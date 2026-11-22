#!/usr/bin/env python3
"""UDM Pro status display for a 480x320 SPI panel. Never logs the API key."""
from __future__ import annotations

import argparse
import json
import os
import socket
import ssl
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 480, 320
FB_DEFAULT = os.environ.get("UDM_FB", "/dev/fb1")
KEY_DEFAULT = os.environ.get("UDM_KEY_PATH", "/etc/mantel-udm/unifi.key")
BASE = os.environ.get("UDM_BASE", "https://10.0.0.1")
NET_PREFIX = "/proxy/network/integration/v1"
PROTECT_CAMERAS = "/proxy/protect/integration/v1/cameras"
WG_HOST = os.environ.get("UDM_WG_HOST", "192.168.3.2")
WG_NAME = os.environ.get("UDM_WG_NAME", "MattPhone")
SITE_FALLBACK = None
REFRESH_SEC = 5
# Pages change only on a tap. Set UDM_PAGE_SEC to a number of seconds to auto-rotate.
PAGE_SEC = int(os.environ.get("UDM_PAGE_SEC", "0") or 0)
FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")

# Dark, high-contrast palette for a 3.5" panel
BG = (11, 16, 30)
HEADER = (14, 22, 40)
CARD = (22, 32, 52)
CARD2 = (28, 40, 64)
TEXT = (232, 238, 247)
MUTED = (139, 155, 180)
LINE = (40, 54, 80)
ACCENT = (61, 220, 151)
BLUE = (77, 163, 255)
GREEN = (61, 220, 151)
RED = (255, 92, 108)
AMBER = (245, 197, 66)
WHITE = (255, 255, 255)


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    path = FONT_DIR / name
    if not path.is_file():
        # Box and some images use the same family in a slightly different layout
        alt = Path("/usr/share/fonts/truetype/dejavu") / name
        path = alt if alt.is_file() else path
    try:
        return ImageFont.truetype(str(path), size)
    except OSError:
        return ImageFont.load_default()


FONT_TITLE = _font("DejaVuSans-Bold.ttf", 18)
FONT_LABEL = _font("DejaVuSans.ttf", 13)
FONT_SMALL = _font("DejaVuSans.ttf", 12)
FONT_TINY = _font("DejaVuSans.ttf", 11)
FONT_NUM = _font("DejaVuSans-Bold.ttf", 32)
FONT_MED = _font("DejaVuSans-Bold.ttf", 20)
FONT_BIG = _font("DejaVuSans-Bold.ttf", 22)
FONT_CAM = _font("DejaVuSans-Bold.ttf", 15)


def mask_ip(ip: str | None) -> str:
    if not ip:
        return "—"
    parts = ip.split(".")
    if len(parts) == 4 and all(p.isdigit() for p in parts):
        a, b = int(parts[0]), int(parts[1])
        private = a == 10 or (a == 192 and b == 168) or (a == 172 and 16 <= b <= 31)
        if private:
            return ip
        return f"{parts[0]}.{parts[1]}.x.x"
    if ":" in ip:
        head = ip.split(":")[0]
        return f"{head}:x:x:x"
    return "—"


def fmt_bps(bps: float | int | None) -> str:
    if bps is None:
        return "—"
    bps = float(bps)
    if bps < 1000:
        return f"{bps:.0f} bps"
    if bps < 1_000_000:
        return f"{bps / 1000:.0f} Kbps"
    if bps < 1_000_000_000:
        val = bps / 1_000_000
        return f"{val:.1f} Mbps" if val < 10 else f"{val:.0f} Mbps"
    val = bps / 1_000_000_000
    return f"{val:.2f} Gbps"


def fmt_uptime(sec: int | None) -> str:
    if not sec or sec < 0:
        return "—"
    d, rem = divmod(int(sec), 86400)
    h, rem = divmod(rem, 3600)
    m, _ = divmod(rem, 60)
    if d:
        return f"{d}d {h}h"
    if h:
        return f"{h}h {m}m"
    return f"{m}m"


def load_key(path: str) -> str:
    p = Path(path)
    key = p.read_text(encoding="utf-8").strip()
    if not key:
        raise RuntimeError("API key file is empty")
    return key


def http_get(key: str, path: str, timeout: float = 10.0):
    url = BASE + path
    req = urllib.request.Request(
        url,
        headers={"X-API-KEY": key, "Accept": "application/json"},
        method="GET",
    )
    ctx = ssl._create_unverified_context()
    with urllib.request.urlopen(req, context=ctx, timeout=timeout) as resp:
        body = resp.read().decode("utf-8", errors="replace")
        return json.loads(body)


def envelope_items(payload) -> list:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            return data
    return []


def ping_ok(host: str, timeout: float = 1.0) -> bool:
    try:
        r = subprocess.run(
            ["ping", "-c", "1", "-W", str(int(max(1, timeout))), host],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout + 1.5,
            check=False,
        )
        return r.returncode == 0
    except Exception:
        return False


@dataclass
class Device:
    id: str
    name: str
    model: str
    state: str
    ip: str = ""
    cpu: float | None = None
    mem: float | None = None
    uptime: int | None = None
    rx: float | None = None
    tx: float | None = None


@dataclass
class Camera:
    name: str
    typ: str
    connected: bool


@dataclass
class Status:
    ok: bool = False
    error: str = ""
    fetched_at: float = 0.0
    wan_up: bool = False
    wan_ip: str = ""
    wan_down_bps: float | None = None
    wan_up_bps: float | None = None
    cpu: float | None = None
    mem: float | None = None
    uptime: int | None = None
    clients_wired: int = 0
    clients_wifi: int = 0
    clients_vpn: int = 0
    wg_connected: bool | None = None
    devices: list[Device] = field(default_factory=list)
    cameras: list[Camera] = field(default_factory=list)

    @property
    def clients_total(self) -> int:
        return self.clients_wired + self.clients_wifi + self.clients_vpn

    @property
    def devices_online(self) -> int:
        return sum(1 for d in self.devices if (d.state or "").upper() == "ONLINE")

    @property
    def cameras_online(self) -> int:
        return sum(1 for c in self.cameras if c.connected)


def parse_status(raw_devices, raw_clients, raw_cams, stats_by_id, wg: bool | None) -> Status:
    st = Status(ok=True, fetched_at=time.time(), wg_connected=wg)
    devices: list[Device] = []
    udm = None
    for d in envelope_items(raw_devices):
        dev = Device(
            id=str(d.get("id") or ""),
            name=str(d.get("name") or "Device").strip(),
            model=str(d.get("model") or "").strip(),
            state=str(d.get("state") or "UNKNOWN").strip(),
            ip=str(d.get("ipAddress") or ""),
        )
        s = stats_by_id.get(dev.id) or {}
        if isinstance(s, dict):
            dev.cpu = s.get("cpuUtilizationPct")
            dev.mem = s.get("memoryUtilizationPct")
            dev.uptime = s.get("uptimeSec")
            uplink = s.get("uplink") or {}
            if isinstance(uplink, dict):
                dev.rx = uplink.get("rxRateBps")
                dev.tx = uplink.get("txRateBps")
        devices.append(dev)
        if "UDM" in dev.model.upper() or "dream machine" in dev.name.lower():
            udm = dev
    # Keep UDM first, then the rest by name
    devices.sort(key=lambda x: (0 if x is udm else 1, x.name.lower()))
    st.devices = devices
    if udm and (udm.state or "").upper() == "ONLINE":
        st.wan_up = True
        st.wan_ip = mask_ip(udm.ip)
        st.cpu = udm.cpu
        st.mem = udm.mem
        st.uptime = udm.uptime
        st.wan_down_bps = udm.rx
        st.wan_up_bps = udm.tx
    elif udm:
        st.wan_up = False
        st.wan_ip = mask_ip(udm.ip)

    for c in envelope_items(raw_clients):
        typ = str(c.get("type") or "").upper()
        ip = str(c.get("ipAddress") or "")
        name = str(c.get("name") or "")
        if typ in ("VPN", "WIREGUARD", "WG", "TELEPORT") or ip.startswith("192.168.3."):
            st.clients_vpn += 1
            if ip == WG_HOST or WG_NAME.lower() in name.lower():
                st.wg_connected = True
        elif typ == "WIRED":
            st.clients_wired += 1
        else:
            st.clients_wifi += 1

    cams = []
    for cam in envelope_items(raw_cams) if not isinstance(raw_cams, list) else raw_cams:
        if not isinstance(cam, dict):
            continue
        state = str(cam.get("state") or "").upper()
        cams.append(
            Camera(
                name=str(cam.get("name") or "Camera").strip(),
                typ=str(cam.get("type") or cam.get("modelKey") or "").strip(),
                connected=state in ("CONNECTED", "ONLINE"),
            )
        )
    cams.sort(key=lambda c: (0 if c.connected else 1, c.name.lower()))
    st.cameras = cams
    return st


def fetch_status(key: str) -> Status:
    try:
        sites = http_get(key, f"{NET_PREFIX}/sites?limit=50")
        items = envelope_items(sites)
        if not items:
            return Status(ok=False, error="No UniFi sites", fetched_at=time.time())
        site_id = items[0]["id"]
        devices = http_get(key, f"{NET_PREFIX}/sites/{site_id}/devices?limit=200")
        clients = http_get(key, f"{NET_PREFIX}/sites/{site_id}/clients?limit=200")
        try:
            cameras = http_get(key, PROTECT_CAMERAS)
        except Exception:
            cameras = []
        stats_by_id = {}
        for d in envelope_items(devices):
            did = d.get("id")
            if not did:
                continue
            try:
                stats_by_id[did] = http_get(
                    key, f"{NET_PREFIX}/sites/{site_id}/devices/{did}/statistics/latest"
                )
            except Exception:
                stats_by_id[did] = {}
        wg = ping_ok(WG_HOST, timeout=1.0)
        return parse_status(devices, clients, cameras, stats_by_id, wg)
    except urllib.error.HTTPError as e:
        return Status(ok=False, error=f"UDM HTTP {e.code}", fetched_at=time.time())
    except Exception as e:
        # Do not include URL or headers; type and short message only
        msg = type(e).__name__
        return Status(ok=False, error="UDM unreachable", fetched_at=time.time())


def status_from_dump(dump: dict, wg: bool | None = None) -> Status:
    endpoints = dump.get("endpoints") or {}
    devices = None
    clients = None
    cameras = None
    for path, entry in endpoints.items():
        if entry.get("status") != 200:
            continue
        if path.endswith("/cameras") or path.endswith("/cameras"):
            cameras = entry.get("data")
        elif "/devices?" in path or path.endswith("/devices"):
            devices = entry.get("data")
        elif "/clients?" in path or path.endswith("/clients"):
            clients = entry.get("data")
    stats_by_id = {}
    for name, st in (dump.get("device_stats") or {}).items():
        did = st.get("id")
        if did:
            stats_by_id[did] = st.get("data") or {}
    if devices is None:
        return Status(ok=False, error="UDM unreachable", fetched_at=time.time())
    if wg is None:
        # In a recorded dump, infer from clients only
        wg = False
        for c in envelope_items(clients or {}):
            if str(c.get("ipAddress") or "") == WG_HOST:
                wg = True
    return parse_status(devices, clients or {}, cameras or [], stats_by_id, wg)


def text_w(draw: ImageDraw.ImageDraw, text: str, font) -> int:
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0]


def text_h(draw: ImageDraw.ImageDraw, text: str, font) -> int:
    box = draw.textbbox((0, 0), text, font=font)
    return box[3] - box[1]



def fit_text(draw: ImageDraw.ImageDraw, text: str, font, max_w: int) -> str:
    if text_w(draw, text, font) <= max_w:
        return text
    ell = "…"
    t = text
    while t and text_w(draw, t + ell, font) > max_w:
        t = t[:-1]
    return (t + ell) if t else ell


def draw_dot(draw: ImageDraw.ImageDraw, x: int, y: int, r: int, color):
    draw.ellipse((x - r, y - r, x + r, y + r), fill=color)


def header(draw: ImageDraw.ImageDraw, title: str, now: datetime):
    draw.rectangle((0, 0, WIDTH, 34), fill=HEADER)
    draw.rectangle((0, 34, WIDTH, 36), fill=ACCENT)
    draw.text((12, 7), title, font=FONT_TITLE, fill=WHITE)
    clock = now.strftime("%-I:%M %p") if os.name != "nt" else now.strftime("%I:%M %p").lstrip("0")
    w = text_w(draw, clock, FONT_LABEL)
    draw.text((WIDTH - 12 - w, 10), clock, font=FONT_LABEL, fill=MUTED)


def footer(draw: ImageDraw.ImageDraw, page: int, pages: int, hint: str):
    y = HEIGHT - 26
    draw.rectangle((0, y, WIDTH, HEIGHT), fill=HEADER)
    # page dots centered
    gap = 16
    total = (pages - 1) * gap
    x0 = WIDTH // 2 - total // 2
    for i in range(pages):
        color = ACCENT if i == page else LINE
        draw_dot(draw, x0 + i * gap, y + 13, 4 if i == page else 3, color)
    draw.text((10, y + 6), hint, font=FONT_TINY, fill=MUTED)


def render_unreachable(err: str, now: datetime) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(img)
    header(d, "UDM PRO", now)
    d.rounded_rectangle((30, 90, 450, 230), radius=16, fill=CARD)
    draw_dot(d, 70, 155, 14, RED)
    d.text((100, 118), "UDM unreachable", font=FONT_BIG, fill=WHITE)
    d.text((100, 152), err or "Check the console or the network.", font=FONT_LABEL, fill=MUTED)
    d.text((100, 178), "Retrying every 5 seconds", font=FONT_SMALL, fill=MUTED)
    footer(d, 0, 3, "auto retry")
    return img


def render_overview(st: Status, now: datetime) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(img)
    header(d, "UDM PRO", now)

    # Internet row
    d.rounded_rectangle((10, 46, 470, 90), radius=10, fill=CARD)
    draw_dot(d, 32, 68, 8, GREEN if st.wan_up else RED)
    wan_label = "INTERNET UP" if st.wan_up else "INTERNET DOWN"
    d.text((50, 58), wan_label, font=FONT_MED, fill=WHITE)
    ip = st.wan_ip or "—"
    ip = fit_text(d, ip, FONT_LABEL, 150)
    w = text_w(d, ip, FONT_LABEL)
    d.text((458 - w, 60), ip, font=FONT_LABEL, fill=(196, 206, 220))

    # Throughput
    d.rounded_rectangle((10, 100, 237, 176), radius=10, fill=CARD)
    d.rounded_rectangle((243, 100, 470, 176), radius=10, fill=CARD)
    d.text((24, 108), "DOWNLOAD", font=FONT_TINY, fill=BLUE)
    d.text((257, 108), "UPLOAD", font=FONT_TINY, fill=AMBER)
    d.text((24, 126), fmt_bps(st.wan_down_bps), font=FONT_NUM, fill=WHITE)
    d.text((257, 126), fmt_bps(st.wan_up_bps), font=FONT_NUM, fill=WHITE)

    # Metric tiles
    tiles = [
        ("CPU", f"{st.cpu:.0f}%" if st.cpu is not None else "—"),
        ("MEMORY", f"{st.mem:.0f}%" if st.mem is not None else "—"),
        ("UPTIME", fmt_uptime(st.uptime)),
    ]
    tw = 150
    for i, (label, value) in enumerate(tiles):
        x0 = 10 + i * (tw + 5)
        d.rounded_rectangle((x0, 186, x0 + tw, 246), radius=10, fill=CARD)
        d.text((x0 + 10, 192), label, font=FONT_TINY, fill=MUTED)
        d.text((x0 + 10, 208), value, font=FONT_BIG, fill=WHITE)

    # Summary chips
    d.rounded_rectangle((10, 256, 470, 292), radius=10, fill=CARD)
    clients = f"{st.clients_total} clients  {st.clients_wired} wired  {st.clients_wifi} wifi"
    devs = f"{st.devices_online}/{len(st.devices)} devices"
    cams = f"{st.cameras_online}/{len(st.cameras)} cams"
    if st.wg_connected:
        vpn = f"{WG_NAME} VPN"
        vpn_color = GREEN
    else:
        vpn = f"{WG_NAME} off"
        vpn_color = RED
    d.text((20, 266), clients, font=FONT_SMALL, fill=TEXT)
    # right side status
    x = 468
    for label, color in ((vpn, vpn_color), (cams, GREEN if st.cameras_online == len(st.cameras) and st.cameras else (AMBER if st.cameras_online else RED)), (devs, GREEN if st.devices_online == len(st.devices) and st.devices else RED)):
        w = text_w(d, label, FONT_TINY)
        x -= w
        d.text((x, 268), label, font=FONT_TINY, fill=color)
        x -= 14
        draw_dot(d, x + 4, 276, 4, color)
        x -= 8

    footer(d, 0, 3, "tap for devices")
    return img


def render_devices(st: Status, now: datetime) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(img)
    header(d, "DEVICES", now)
    rows = st.devices[:4]
    top = 46
    row_h = 56
    if not rows:
        d.rounded_rectangle((10, 80, 470, 160), radius=10, fill=CARD)
        d.text((24, 110), "No devices returned", font=FONT_LABEL, fill=MUTED)
    for i, dev in enumerate(rows):
        y = top + i * (row_h + 6)
        d.rounded_rectangle((10, y, 470, y + row_h), radius=10, fill=CARD)
        online = (dev.state or "").upper() == "ONLINE"
        draw_dot(d, 32, y + 28, 7, GREEN if online else RED)
        d.text((50, y + 8), dev.name, font=FONT_MED, fill=WHITE)
        meta = dev.model
        d.text((50, y + 32), meta, font=FONT_TINY, fill=MUTED)
        cpu = f"{dev.cpu:.0f}%" if dev.cpu is not None else "—"
        mem = f"{dev.mem:.0f}%" if dev.mem is not None else "—"
        right = f"CPU {cpu}   MEM {mem}"
        w = text_w(d, right, FONT_SMALL)
        d.text((460 - w, y + 20), right, font=FONT_SMALL, fill=TEXT)
    footer(d, 1, 3, "tap for cameras")
    return img


def render_cameras(st: Status, now: datetime) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(img)
    header(d, "CAMERAS", now)
    cams = st.cameras[:6]
    if not cams:
        d.rounded_rectangle((10, 80, 470, 160), radius=10, fill=CARD)
        d.text((24, 110), "No Protect cameras", font=FONT_LABEL, fill=MUTED)
        footer(d, 2, 3, "tap for overview")
        return img
    # 2x2 grid for four cameras, or 2-col list
    cols = 2
    gap = 8
    grid_top = 46
    grid_bot = HEIGHT - 32
    n_rows = max(1, (len(cams) + 1) // 2)
    cell_w = (WIDTH - 20 - gap) // cols
    cell_h = (grid_bot - grid_top - gap * (n_rows - 1)) // n_rows
    for i, cam in enumerate(cams):
        col, row = i % cols, i // cols
        x0 = 10 + col * (cell_w + gap)
        y0 = grid_top + row * (cell_h + gap)
        d.rounded_rectangle((x0, y0, x0 + cell_w, y0 + cell_h), radius=12, fill=CARD)
        color = GREEN if cam.connected else RED
        draw_dot(d, x0 + 22, y0 + cell_h // 2, 9, color)
        name = cam.name
        if name.lower().endswith(" camera"):
            name = name[: -len(" camera")].rstrip()
        name = fit_text(d, name, FONT_CAM, cell_w - 48)
        d.text((x0 + 40, y0 + cell_h // 2 - 16), name, font=FONT_CAM, fill=WHITE)
        state = "Online" if cam.connected else "Disconnected"
        typ = cam.typ
        sub = typ + "  ·  " + state if typ else state
        sub = fit_text(d, sub, FONT_TINY, cell_w - 52)
        d.text((x0 + 40, y0 + cell_h // 2 + 6), sub, font=FONT_TINY, fill=MUTED)
    footer(d, 2, 3, "tap for overview")
    return img


PAGES = ("overview", "devices", "cameras")


def render_page(st: Status, page: int, now: datetime | None = None) -> Image.Image:
    now = now or datetime.now()
    if not st.ok:
        return render_unreachable(st.error, now)
    name = PAGES[page % 3]
    if name == "overview":
        return render_overview(st, now)
    if name == "devices":
        return render_devices(st, now)
    return render_cameras(st, now)


def image_to_rgb565(img: Image.Image, bgr: bool = False) -> bytes:
    img = img.convert("RGB")
    pix = img.tobytes()
    out = bytearray(WIDTH * HEIGHT * 2)
    for i in range(WIDTH * HEIGHT):
        r, g, b = pix[i * 3], pix[i * 3 + 1], pix[i * 3 + 2]
        if bgr:
            r, b = b, r
        val = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
        struct.pack_into("<H", out, i * 2, val)
    return bytes(out)


def blit_fb(img: Image.Image, fb_path: str, bgr: bool = False) -> None:
    data = image_to_rgb565(img, bgr=bgr)
    with open(fb_path, "r+b", buffering=0) as f:
        f.write(data)


def find_touch_device():
    try:
        import evdev
    except ImportError:
        return None
    for path in evdev.list_devices():
        try:
            dev = evdev.InputDevice(path)
        except Exception:
            continue
        name = (dev.name or "").lower()
        if "ads7846" in name or "touchscreen" in name and "cool" not in name:
            return dev
    return None


def touch_loop(dev, last_tap: list) -> bool:
    """Non-blocking: return True if a tap occurred."""
    import evdev
    from evdev import ecodes

    tapped = False
    while True:
        event = dev.read_one()
        if event is None:
            break
        if event.type == ecodes.EV_KEY and event.code in (ecodes.BTN_TOUCH, ecodes.BTN_MOUSE):
            if event.value == 1:
                now = time.monotonic()
                if now - last_tap[0] > 0.3:
                    last_tap[0] = now
                    tapped = True
        # Some ads7846 nodes only report ABS_PRESSURE
        if event.type == ecodes.EV_ABS and event.code == ecodes.ABS_PRESSURE and event.value > 20:
            now = time.monotonic()
            if now - last_tap[0] > 0.35:
                last_tap[0] = now
                tapped = True
    return tapped


def run_preview(dump_path: Path, out_path: Path, page: str | None = None) -> None:
    dump = json.loads(dump_path.read_text(encoding="utf-8"))
    st = status_from_dump(dump, wg=False)
    now = datetime.now()
    if page in PAGES:
        img = render_page(st, PAGES.index(page), now)
        img.save(out_path)
        print("wrote", out_path)
        return
    # Contact sheet of all three pages
    pages = [render_page(st, i, now) for i in range(3)]
    sheet = Image.new("RGB", (WIDTH, HEIGHT * 3 + 16 * 2), (6, 8, 16))
    y = 0
    for im in pages:
        sheet.paste(im, (0, y))
        y += HEIGHT + 16
    sheet.save(out_path)
    print("wrote", out_path, "pages=3", "ok=", st.ok,
          "clients=", st.clients_total, "devices=", f"{st.devices_online}/{len(st.devices)}",
          "cams=", f"{st.cameras_online}/{len(st.cameras)}",
          "wan=", "up" if st.wan_up else "down", "ip=", st.wan_ip,
          "down=", fmt_bps(st.wan_down_bps), "up=", fmt_bps(st.wan_up_bps))


def run_display(key_path: str, fb_path: str, bgr: bool) -> None:
    try:
        key = load_key(key_path)
    except Exception:
        # Don't mention the path contents; do mention that the key is missing
        st = Status(ok=False, error="API key missing", fetched_at=time.time())
        blit_fb(render_unreachable(st.error, datetime.now()), fb_path, bgr=bgr)
        raise SystemExit("API key missing or unreadable")

    page = 0
    last_fetch = 0.0
    last_page = time.monotonic()
    status = Status(ok=False, error="Starting…", fetched_at=0.0)
    touch = find_touch_device()
    last_tap = [0.0]
    print("udm-monitor start fb=", fb_path, "touch=", getattr(touch, "path", None) or "none",
          flush=True)

    while True:
        now_mono = time.monotonic()
        if now_mono - last_fetch >= REFRESH_SEC or status.fetched_at == 0:
            try:
                status = fetch_status(key)
            except Exception:
                status = Status(ok=False, error="UDM unreachable", fetched_at=time.time())
            last_fetch = now_mono
            try:
                blit_fb(render_page(status, page), fb_path, bgr=bgr)
            except Exception as e:
                print("blit failed:", type(e).__name__, file=sys.stderr)

        tapped = False
        if touch is not None:
            try:
                tapped = touch_loop(touch, last_tap)
            except Exception:
                touch = find_touch_device()
        if tapped:
            page = (page + 1) % 3
            last_page = now_mono
            blit_fb(render_page(status, page), fb_path, bgr=bgr)
        elif PAGE_SEC > 0 and now_mono - last_page >= PAGE_SEC:
            page = (page + 1) % 3
            last_page = now_mono
            blit_fb(render_page(status, page), fb_path, bgr=bgr)

        time.sleep(0.05)


def main() -> None:
    parser = argparse.ArgumentParser(description="UDM Pro 3.5\" SPI monitor")
    parser.add_argument("--preview", nargs=2, metavar=("JSON", "PNG"), help="Render a preview from a saved API dump")
    parser.add_argument("--page", choices=PAGES, help="Preview a single page")
    parser.add_argument("--fb", default=FB_DEFAULT)
    parser.add_argument("--key", default=KEY_DEFAULT)
    parser.add_argument("--bgr", action="store_true", help="Swap red/blue if the panel is BGR")
    args = parser.parse_args()
    if args.preview:
        run_preview(Path(args.preview[0]), Path(args.preview[1]), page=args.page)
        return
    run_display(args.key, args.fb, bgr=args.bgr)


if __name__ == "__main__":
    main()

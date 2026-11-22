#!/usr/bin/env python3
"""Capture /dev/fb1 (RGB565 480x320) to a PNG. No secrets."""
import struct, sys
from pathlib import Path
from PIL import Image
FB = "/dev/fb1"
W, H = 480, 320
out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fb1.png"
data = Path(FB).read_bytes()[: W * H * 2]
pixels = []
for i in range(W * H):
    (val,) = struct.unpack_from("<H", data, i * 2)
    r = (val >> 11) & 0x1F
    g = (val >> 5) & 0x3F
    b = val & 0x1F
    pixels.append((r * 255 // 31, g * 255 // 63, b * 255 // 31))
img = Image.new("RGB", (W, H))
img.putdata(pixels)
img.save(out)
print("wrote", out, "bytes", len(data))

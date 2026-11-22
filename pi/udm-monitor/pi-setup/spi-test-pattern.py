#!/usr/bin/env python3
"""Write a labeled color-bar test pattern to the 3.5" SPI framebuffer."""
import struct
import sys

FB = "/dev/fb1"
W, H = 480, 320


def rgb565(r, g, b):
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)


def main():
    buf = bytearray(W * H * 2)
    # Three vertical color bars: red, green, blue
    for y in range(H):
        for x in range(W):
            if x < 160:
                c = rgb565(220, 32, 32)
            elif x < 320:
                c = rgb565(32, 200, 48)
            else:
                c = rgb565(32, 80, 230)
            # Top banner black
            if y < 48:
                c = rgb565(0, 0, 0)
            # Bottom banner dark
            if y >= H - 40:
                c = rgb565(16, 16, 16)
            struct.pack_into("<H", buf, (y * W + x) * 2, c)
    # Simple block letters are hard without a font; draw a white underline
    # and a 8x8 checker in the banner so something is obviously 'on'.
    for x in range(20, 460):
        struct.pack_into("<H", buf, (36 * W + x) * 2, rgb565(255, 255, 255))
    # White rectangles as "SPI OK" stand-in blocks
    def rect(x0, y0, x1, y1, color):
        for y in range(y0, y1):
            for x in range(x0, x1):
                struct.pack_into("<H", buf, (y * W + x) * 2, color)

    # 5 white bars in the header to show it's not a solid color
    for i, x in enumerate((20, 70, 120, 170, 220)):
        rect(x, 10, x + 36, 28, rgb565(255, 255, 255))
    # Small RGB labels as colored squares with white border at the bottom of each bar
    rect(60, 260, 100, 300, rgb565(255, 255, 255))
    rect(66, 266, 94, 294, rgb565(220, 32, 32))
    rect(220, 260, 260, 300, rgb565(255, 255, 255))
    rect(226, 266, 254, 294, rgb565(32, 200, 48))
    rect(380, 260, 420, 300, rgb565(255, 255, 255))
    rect(386, 266, 414, 294, rgb565(32, 80, 230))

    with open(FB, "r+b", buffering=0) as f:
        f.write(buf)
    print(f"wrote {len(buf)} bytes to {FB} (480x320 RGB565 red/green/blue bars)")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("FAIL:", type(e).__name__, e, file=sys.stderr)
        sys.exit(1)

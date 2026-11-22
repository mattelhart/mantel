#!/usr/bin/env python3
import pathlib
t = pathlib.Path("/boot/firmware/overlays/README").read_text()
names = ["piscreen", "piscreen2r", "pitft35-resistive", "tinylcd35", "mipi-dbi-spi", "ads7846", "fbtft"]
for n in names:
    key = "Name:\t" + n + "\n"
    i = t.find(key)
    print("====", n, "====")
    print(t[i:i+1200] if i >= 0 else "NOT FOUND")
    print()

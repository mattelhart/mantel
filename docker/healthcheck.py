"""Docker liveness probe.

One refused connection while the process is accepting sockets is not a dead
server. Try a few times, with a short pause, inside the HEALTHCHECK timeout.
"""

import sys
import time
import urllib.request

URL = "http://127.0.0.1:8080/api/health"
ATTEMPTS = 3
PAUSE_S = 0.4


def main() -> int:
    for attempt in range(ATTEMPTS):
        try:
            if urllib.request.urlopen(URL, timeout=2).status == 200:
                return 0
        except Exception:
            pass
        if attempt + 1 < ATTEMPTS:
            time.sleep(PAUSE_S)
    return 1


if __name__ == "__main__":
    sys.exit(main())

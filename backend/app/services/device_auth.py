"""ASGI gate in front of /api.

Public on purpose, and nothing else:

* `GET /api/health` — Docker's healthcheck, and anything monitoring the box.
* `GET /api/version` — the kiosk polls this to notice a new build. It carries
  no family data.
* `GET /api/ai-guide`, the OpenAPI documents — the contract the phone apps
  are written against. They describe the API; they do not return the calendar.
* `GET /api/accounts/google/callback` — Google redirects the browser here and
  cannot attach a bearer token. The redirect itself only finishes a link that
  was started by someone who could already call the API.
* `GET /api/feeds/*.ics` — already gated by the feed token in the query string.
  Home Assistant and phone calendar subscriptions do not send a device token.
* `POST /api/auth/pair` — the phone has no token yet. The pairing code is the
  credential, and attempts are rate limited.
* `GET /api/auth/status` — tells a client which mode is on, without data.
* everything that is not under `/api` — the wall's HTML and assets. The data
  they ask for is what the gate covers.

A request that presents a bearer token is accepted when the hash matches a
device, from any address. A request with no token (or a token this install
does not know) is accepted when the source address is trusted for the
configured mode. An unrecognised token therefore does not lock the kiosk out
of its own screen: the Pi is still a trusted address.
"""

from __future__ import annotations

import logging

from fastapi import Request
from starlette.responses import JSONResponse

from ..config import get_settings
from .auth import auth_mode, client_host, network_trusted, presented_token, token_is_valid

log = logging.getLogger(__name__)

_PUBLIC_EXACT = {
    ("GET", "/api/health"),
    ("GET", "/api/version"),
    ("GET", "/api/ai-guide"),
    ("GET", "/api/openapi.json"),
    ("GET", "/api/docs"),
    ("GET", "/api/redoc"),
    ("GET", "/api/accounts/google/callback"),
    ("GET", "/api/auth/status"),
    ("POST", "/api/auth/pair"),
}


def is_public(method: str, path: str) -> bool:
    if method == "OPTIONS":
        return True
    path = path.rstrip("/") or "/"
    if not path.startswith("/api"):
        return True
    if path.startswith("/api/docs"):
        return True
    if (method, path) in _PUBLIC_EXACT:
        return True
    # The feed token in the query string is the credential. `/api/feeds/token`,
    # which reveals that secret, is not in this exception.
    return method == "GET" and path.startswith("/api/feeds/") and path.endswith(".ics")


def request_allowed(request: Request) -> bool:
    if is_public(request.method, request.url.path):
        return True
    settings = get_settings()
    if auth_mode(settings) == "off":
        return True
    token = presented_token(request)
    if token:
        try:
            if token_is_valid(token):
                return True
        except Exception:
            # A database problem must not turn into "the door is open".
            log.exception("Could not check a device token")
    return network_trusted(client_host(request, settings), settings)


class DeviceAuthMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        # Headers and the client address only. Reading the body here would
        # consume it before the route saw it.
        request = Request(scope)
        if request_allowed(request):
            await self.app(scope, receive, send)
            return
        response = JSONResponse(
            status_code=401,
            content={
                "error": {
                    "code": "unauthorized",
                    "message": (
                        "This API needs a device token. Pair the phone from "
                        "Settings on the wall display, and send the token as "
                        "Authorization: Bearer."
                    ),
                }
            },
            headers={"WWW-Authenticate": 'Bearer realm="mantel"'},
        )
        await response(scope, receive, send)

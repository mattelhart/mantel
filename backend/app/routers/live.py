"""One stream of "something changed" for every screen in the house.

The wall and the TV apps used to poll. A chore tap then took up to a minute
to show up across the room. This is a Server-Sent Events stream instead:
small, one-way, and an ordinary GET, so the same device-token rules as the
rest of `/api` apply. There is no payload beyond which areas changed — the
client refetches those, and a reconnect sends only the ids it missed.
"""

import asyncio

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from ..services.device_auth import request_allowed
from ..services.live import (
    KEEPALIVE_EVERY,
    KEEPALIVE_TICK_SECONDS,
    TIMEOUT,
    encode_change,
    encode_hello,
    encode_resync,
    hub,
)

router = APIRouter(tags=["live"])


def _last_id(request: Request) -> int | None:
    raw = request.headers.get("last-event-id", "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        # An id we did not mint means the client and the process disagree.
        return -1


@router.get(
    "/live",
    summary="Stream change notices",
    description=(
        "Server-Sent Events. Each `change` event lists the areas that were "
        "committed (`events`, `calendars`, `chores`, `rewards`, `lists`, "
        "`users`, `settings`, `accounts`, `sync`, `widgets`, `photos`) so a "
        "screen can refetch those and leave the rest alone. `hello` is the "
        "current id; send it back as `Last-Event-ID` on reconnect to receive "
        "only what was missed. `resync` means that id is gone (the process "
        "restarted, or too many commits happened while the screen was away) "
        "and the client should refetch.\n\n"
        "The same auth rules as the rest of the API apply: a trusted address "
        "or `Authorization: Bearer`. A comment line (`: keepalive`) arrives "
        "about every 15 seconds so a proxy does not decide the stream is idle. "
        "When the stream is down, clients should keep polling."
    ),
)
async def live(request: Request) -> StreamingResponse:
    sub, missed = hub.open(_last_id(request))

    async def gen():
        try:
            if missed is None:
                yield encode_resync()
            else:
                for item in missed:
                    yield encode_change(item)
            yield encode_hello(hub.latest_id)
            idle = 0
            while True:
                item = await asyncio.to_thread(sub.get, KEEPALIVE_TICK_SECONDS)
                if await request.is_disconnected():
                    break
                if item is TIMEOUT:
                    idle += 1
                    if idle >= KEEPALIVE_EVERY:
                        idle = 0
                        # A token revoked while the stream is open would otherwise
                        # keep receiving notices until the screen happened to reconnect.
                        if not request_allowed(request):
                            break
                        yield ": keepalive\n\n"
                    continue
                idle = 0
                if item == "resync":
                    yield encode_resync()
                    yield encode_hello(hub.latest_id)
                    continue
                yield encode_change(item)
        finally:
            hub.close(sub)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # nginx, if anyone puts it in front, otherwise holds the stream
            # until it has a buffer full and the other screen waits.
            "X-Accel-Buffering": "no",
        },
    )

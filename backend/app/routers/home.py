"""Home control, by way of Home Assistant.

Mantel never gives a browser the Home Assistant token. A screen asks Mantel for the rooms
(`GET /home`), tells Mantel what to do (`POST /home/entities/{id}/action`) and listens
for changes (`GET /home/live`); Mantel makes the matching calls to HA with the token it
keeps in settings. See `services/ha_home.py`.
"""

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import SessionLocal, get_db
from ..services import ha_home
from ..services.device_auth import request_allowed
from ..services.ha_home import HAError

router = APIRouter(prefix="/home", tags=["home"])


async def _load_config() -> ha_home.HAConfig:
    def read() -> ha_home.HAConfig:
        with SessionLocal() as db:
            return ha_home.load_config(db)

    return await asyncio.to_thread(read)


ha_home.stream.set_loader(_load_config)


@router.get(
    "",
    summary="Rooms and everything controllable in them",
    description=(
        "Lights, switches, fans, shades, thermostats, locks and scenes from Home Assistant, "
        "grouped by room. Always answers 200 with a `status`: `ok`, `not_configured`, "
        "`unreachable` or `invalid_token`, and a `message` a person can act on. "
        "`rooms` is `[{area_id, name, entities}]`; `actions` are the scenes and scripts. "
        "Each entity has `state`, `on`, `level` (0-100 for dimmers, fans and shades) and "
        "`adjustable`. Favorites and hidden devices are the `home_favorites` and "
        "`home_hidden` settings."
    ),
)
async def get_home(db: Session = Depends(get_db)) -> dict:
    config = ha_home.load_config(db)
    db.close()
    empty = {"rooms": [], "actions": []}
    try:
        snapshot = await ha_home.fetch_snapshot(config)
    except HAError as exc:
        return {"status": exc.code, "message": exc.message, **empty}
    return {"status": "ok", "message": "", **snapshot}


class Action(BaseModel):
    action: str
    value: Any = None
    confirm: bool = False


@router.post(
    "/entities/{entity_id}/action",
    summary="Do something to one device",
    description=(
        "`action` is one of: `turn_on`, `turn_off`, `toggle`, `set_level` (value 0-100: "
        "brightness, fan speed or shade position), `open`, `close`, `stop` (shades), "
        "`activate` (scenes and scripts), `set_temperature`, `set_hvac_mode`, and `lock` / "
        "`unlock`. Locks are refused unless `confirm` is true, so a client has to have asked "
        "a person first."
    ),
)
async def post_action(entity_id: str, body: Action, db: Session = Depends(get_db)) -> dict:
    config = ha_home.load_config(db)
    db.close()
    try:
        await ha_home.call_action(config, entity_id, body.action, body.value, body.confirm)
    except HAError as exc:
        status = 400 if exc.code in ("refused", "confirmation_required") else 502
        if exc.code == "not_configured":
            status = 409
        raise HTTPException(status, {"code": exc.code, "message": exc.message}) from exc
    return {"ok": True}


@router.post(
    "/test",
    summary="Check the saved Home Assistant address and token",
    description="Says plainly what is wrong: not set up, can't reach it, or token rejected.",
)
async def test_home(db: Session = Depends(get_db)) -> dict:
    config = ha_home.load_config(db)
    db.close()
    ok, code, message = await ha_home.test_connection(config)
    return {"ok": ok, "status": code, "message": message}


def _frame(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


@router.get(
    "/live",
    summary="Stream device changes",
    description=(
        "Server-Sent Events relayed from Home Assistant. `status` carries the connection "
        "state (`ok`, `not_configured`, `unreachable`, `invalid_token`, `error`); `state` is "
        "one device's new `state`/`on`/`level`/`attrs`; `refresh` means rooms or devices changed "
        "and `GET /home` should be fetched again. Same auth as the rest of the API."
    ),
)
async def home_live(request: Request) -> StreamingResponse:
    queue = ha_home.stream.subscribe()

    async def gen():
        try:
            idle = 0
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), 1.0)
                except TimeoutError:
                    if await request.is_disconnected():
                        break
                    idle += 1
                    if idle >= 15:
                        idle = 0
                        if not request_allowed(request):
                            break
                        yield ": keepalive\n\n"
                    continue
                idle = 0
                yield _frame(item["event"], item["data"])
        finally:
            ha_home.stream.unsubscribe(queue)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

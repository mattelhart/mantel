"""A pretend Home Assistant: the REST calls and websocket commands Mantel uses.

Runs as a real server on a free local port (in a thread), because Mantel's client opens
real sockets. `FakeHA.push_state` simulates somebody using a wall switch.
"""

from __future__ import annotations

import asyncio
import json
import socket
import threading
import time

import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect

TOKEN = "fake-long-lived-token"


def light(entity_id, name, on=True, brightness=128, modes=("brightness",)):
    return {
        "entity_id": entity_id,
        "state": "on" if on else "off",
        "attributes": {
            "friendly_name": name,
            "brightness": brightness if on else None,
            "supported_color_modes": list(modes),
            "supported_features": 0,
        },
    }


def default_states() -> list[dict]:
    return [
        light("light.living_room_lamp", "Living Room Lamp"),
        light("light.kitchen_pendant", "Kitchen Pendant", on=False),
        light("light.hall_switch", "Hall Switch", modes=("onoff",)),
        light("light.old_bulb", "Old Bulb"),  # disabled in the registry
        {"entity_id": "switch.porch", "state": "off", "attributes": {"friendly_name": "Porch"}},
        {
            "entity_id": "fan.bedroom_fan",
            "state": "on",
            "attributes": {
                "friendly_name": "Bedroom Fan",
                "percentage": 66,
                "supported_features": 1,
            },
        },
        {
            "entity_id": "cover.den_shade",
            "state": "open",
            "attributes": {
                "friendly_name": "Den Shade",
                "current_position": 80,
                "supported_features": 15,
            },
        },
        {
            "entity_id": "lock.front_door",
            "state": "locked",
            "attributes": {"friendly_name": "Front Door"},
        },
        {
            "entity_id": "climate.upstairs",
            "state": "heat",
            "attributes": {
                "friendly_name": "Upstairs",
                "current_temperature": 68,
                "temperature": 70,
                "min_temp": 50,
                "max_temp": 85,
                "hvac_modes": ["off", "heat", "cool"],
                "target_temp_step": 1,
                "temperature_unit": "°F",
            },
        },
        {
            "entity_id": "scene.movie_night",
            "state": "scening",
            "attributes": {"friendly_name": "Movie Night"},
        },
        {
            "entity_id": "script.goodnight",
            "state": "off",
            "attributes": {"friendly_name": "Goodnight"},
        },
        # Never controls:
        {"entity_id": "sensor.cpu", "state": "3", "attributes": {"friendly_name": "CPU"}},
        {
            "entity_id": "event.pico_button",
            "state": "unknown",
            "attributes": {"friendly_name": "Pico"},
        },
        {
            "entity_id": "light.bridge_identify",
            "state": "off",
            "attributes": {"friendly_name": "Identify"},
        },
    ]


AREAS = [
    {"area_id": "living_room", "name": "Living Room"},
    {"area_id": "kitchen", "name": "Kitchen"},
    {"area_id": "bedroom", "name": "Bedroom"},
]
DEVICES = [{"id": "dev_den", "name": "Den Shade", "area_id": "living_room", "name_by_user": None}]
ENTITIES = [
    {"entity_id": "light.living_room_lamp", "area_id": "living_room", "device_id": None},
    {"entity_id": "light.kitchen_pendant", "area_id": "kitchen", "device_id": None},
    {"entity_id": "light.old_bulb", "area_id": "kitchen", "disabled_by": "user"},
    {"entity_id": "light.bridge_identify", "entity_category": "config"},
    {"entity_id": "fan.bedroom_fan", "area_id": "bedroom"},
    # Area comes from the device, as it does for most Caseta entities.
    {"entity_id": "cover.den_shade", "device_id": "dev_den", "area_id": None},
]


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class FakeHA:
    def __init__(self) -> None:
        self.token = TOKEN
        self.states = {s["entity_id"]: s for s in default_states()}
        self.areas = list(AREAS)
        self.calls: list[tuple[str, str, dict]] = []
        self.reject_services = False
        self.port = _free_port()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._sockets: list[tuple[WebSocket, set[str]]] = []
        self._server: uvicorn.Server | None = None
        self._thread: threading.Thread | None = None
        self.app = Starlette(
            routes=[
                Route("/api/", self._root),
                Route("/api/services/{domain}/{service}", self._service, methods=["POST"]),
                WebSocketRoute("/api/websocket", self._ws),
            ]
        )

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    # ---- lifecycle
    def start(self) -> FakeHA:
        config = uvicorn.Config(
            self.app, host="127.0.0.1", port=self.port, log_level="error", ws="websockets-sansio"
        )
        self._server = uvicorn.Server(config)
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()
        deadline = time.time() + 5
        while not self._server.started and time.time() < deadline:
            time.sleep(0.02)
        return self

    def _serve(self) -> None:
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._server.serve())

    def stop(self) -> None:
        if self._server:
            self._server.should_exit = True
        if self._thread:
            self._thread.join(timeout=5)

    # ---- REST
    def _authed(self, request: Request) -> bool:
        return request.headers.get("authorization") == f"Bearer {self.token}"

    async def _root(self, request: Request):
        if not self._authed(request):
            return JSONResponse({"message": "401: Unauthorized"}, status_code=401)
        return JSONResponse({"message": "API running."})

    async def _service(self, request: Request):
        if not self._authed(request):
            return JSONResponse({"message": "401: Unauthorized"}, status_code=401)
        if self.reject_services:
            return JSONResponse({"message": "boom"}, status_code=400)
        domain, service = request.path_params["domain"], request.path_params["service"]
        data = await request.json()
        self.calls.append((domain, service, data))
        entity_id = data.get("entity_id")
        old = self.states.get(entity_id)
        if old is not None:
            new = json.loads(json.dumps(old))
            if service in ("turn_on", "open_cover"):
                new["state"] = "open" if domain == "cover" else "on"
                if "brightness_pct" in data:
                    new["attributes"]["brightness"] = round(data["brightness_pct"] * 255 / 100)
            elif service in ("turn_off", "close_cover"):
                new["state"] = "closed" if domain == "cover" else "off"
            elif service == "set_percentage":
                new["attributes"]["percentage"] = data["percentage"]
            elif service == "unlock":
                new["state"] = "unlocked"
            await self._set_state(new)
        return JSONResponse([])

    # ---- websocket
    async def _ws(self, ws: WebSocket):
        await ws.accept()
        await ws.send_json({"type": "auth_required", "ha_version": "2026.11.2"})
        auth = await ws.receive_json()
        if auth.get("access_token") != self.token:
            await ws.send_json({"type": "auth_invalid", "message": "Invalid access token"})
            await ws.close()
            return
        await ws.send_json({"type": "auth_ok", "ha_version": "2026.11.2"})
        subscribed: set[str] = set()
        entry = (ws, subscribed)
        self._sockets.append(entry)
        try:
            while True:
                msg = await ws.receive_json()
                kind, mid = msg["type"], msg["id"]
                result: object = None
                if kind == "get_states":
                    result = list(self.states.values())
                elif kind == "config/area_registry/list":
                    result = self.areas
                elif kind == "config/device_registry/list":
                    result = DEVICES
                elif kind == "config/entity_registry/list":
                    result = ENTITIES
                elif kind == "subscribe_events":
                    subscribed.add(msg["event_type"])
                await ws.send_json({"id": mid, "type": "result", "success": True, "result": result})
        except WebSocketDisconnect:
            pass
        finally:
            if entry in self._sockets:
                self._sockets.remove(entry)

    async def _broadcast(self, event_type: str, data: dict):
        for ws, subscribed in list(self._sockets):
            if event_type in subscribed:
                with contextlib_suppress():
                    await ws.send_json(
                        {
                            "id": 1,
                            "type": "event",
                            "event": {"event_type": event_type, "data": data},
                        }
                    )

    async def _set_state(self, new: dict):
        old = self.states.get(new["entity_id"])
        self.states[new["entity_id"]] = new
        await self._broadcast(
            "state_changed", {"entity_id": new["entity_id"], "old_state": old, "new_state": new}
        )

    # ---- helpers for tests (thread-safe)
    def _run(self, coro):
        assert self._loop is not None
        return asyncio.run_coroutine_threadsafe(coro, self._loop).result(5)

    def push_state(self, entity_id: str, state: str, **attributes) -> None:
        new = json.loads(json.dumps(self.states[entity_id]))
        new["state"] = state
        new["attributes"].update(attributes)
        self._run(self._set_state(new))

    def push_registry_change(self) -> None:
        self._run(self._broadcast("entity_registry_updated", {"action": "update"}))

    def subscriber_count(self) -> int:
        return len(self._sockets)

    def drop_sockets(self) -> None:
        async def close():
            for ws, _ in list(self._sockets):
                await ws.close()

        self._run(close())


def contextlib_suppress():
    import contextlib

    return contextlib.suppress(Exception)

"""Home control through Home Assistant.

Home Assistant (HA) is the hub: it already speaks Lutron Caseta, SmartThings, Hue and a few
hundred others, so Mantel does not talk to any of those directly. This module is the one
place Mantel talks to HA for control, and it exists so that **the long-lived access token
never reaches a browser**. Screens call `/api/home/*` on Mantel; Mantel calls HA.

Three pieces:

- `fetch_snapshot` -- one short websocket session: states plus the area, device and entity
  registries, folded into rooms of controllable things.
- `call_action` -- a whitelisted set of verbs turned into HA service calls over REST.
- `HomeStream` -- one long-lived websocket to HA, started when a screen is watching, that
  relays `state_changed` events so a wall switch moves the tile on the wall.

Everything here raises `HAError` with a stable `code`; routers turn that into an answer a
person can act on ("token rejected", "can't reach Home Assistant").
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session
from websockets.asyncio.client import connect as ws_connect
from websockets.exceptions import ConnectionClosed, InvalidHandshake, InvalidURI

from ..models import AppSetting
from .crypto import decrypt, encrypt

log = logging.getLogger(__name__)

TIMEOUT_SECONDS = 8.0

# --------------------------------------------------------------------------- token at rest

_SEALED = "enc:v1:"


def seal_token(token: str) -> str:
    """Encrypted with the same key as the OAuth tokens. Settings never hand it back."""
    return f"{_SEALED}{encrypt(token)}" if token else ""


def open_token(stored: object) -> str:
    """Reads a stored token. A value saved before encryption existed is plain text and
    still works; it is sealed the next time somebody saves."""
    raw = str(stored or "")
    if not raw.startswith(_SEALED):
        return raw
    return decrypt(raw[len(_SEALED) :]) or ""


@dataclass(frozen=True)
class HAConfig:
    url: str
    token: str

    @property
    def configured(self) -> bool:
        return bool(self.url and self.token)


def load_config(db: Session) -> HAConfig:
    rows = {
        r.key: r.value.get("value")
        for r in db.scalars(
            select(AppSetting).where(AppSetting.key.in_(["ha_base_url", "ha_token"]))
        )
    }
    return HAConfig(
        url=str(rows.get("ha_base_url") or "").strip().rstrip("/"),
        token=open_token(rows.get("ha_token")),
    )


def normalize_url(raw: str) -> str:
    """`homeassistant.local:8123` is what people type; give it the scheme it needs."""
    value = (raw or "").strip().rstrip("/")
    if not value:
        return ""
    if "://" not in value:
        value = f"http://{value}"
    return value


# --------------------------------------------------------------------------- errors


class HAError(Exception):
    """`code`: not_configured, unreachable, invalid_token, error, refused, confirmation_required."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _unreachable(exc: BaseException) -> HAError:
    return HAError("unreachable", f"Can't reach Home Assistant ({exc.__class__.__name__}).")


def _require(config: HAConfig) -> None:
    if not config.configured:
        raise HAError("not_configured", "Home Assistant isn't set up yet.")


# --------------------------------------------------------------------------- what is controllable

# Order is also the order tiles appear in a room.
DOMAINS = (
    "light",
    "fan",
    "cover",
    "switch",
    "climate",
    "media_player",
    "lock",
    "input_boolean",
    "script",
    "scene",
)
# Shown as buttons in the row at the top rather than tiles in a room.
ACTION_DOMAINS = ("scene", "script")

# Bits of `supported_features` that matter here (HA's entity feature enums).
_FAN_SET_SPEED = 1
_COVER_SET_POSITION = 4
_LIGHT_ONOFF_ONLY = {"onoff"}
# media_player (HA's MediaPlayerEntityFeature). A TV only offers what its integration says.
_MP_VOLUME_SET = 4
_MP_VOLUME_MUTE = 8
_MP_TURN_ON = 128
_MP_TURN_OFF = 256
_MP_VOLUME_STEP = 1024
_MP_SELECT_SOURCE = 2048
_MAX_SOURCES = 40

_ENTITY_ID = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")

_HVAC_MODES = {"off", "heat", "cool", "heat_cool", "auto", "dry", "fan_only"}


def _num(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def dynamic_fields(state: dict) -> dict:
    """What changes while the house is used: the part a live update replaces."""
    entity_id = state["entity_id"]
    domain = entity_id.split(".", 1)[0]
    raw = str(state.get("state", "unknown"))
    attrs = state.get("attributes") or {}
    available = raw not in ("unavailable", "unknown")
    out: dict[str, Any] = {
        "entity_id": entity_id,
        "state": raw,
        "available": available,
        "on": None,
        "level": None,
        "attrs": {},
    }
    if domain in ("light", "fan", "switch", "input_boolean"):
        out["on"] = raw == "on"
    elif domain == "cover":
        out["on"] = raw in ("open", "opening")
    elif domain == "lock":
        out["on"] = raw == "unlocked"
    elif domain == "climate":
        out["on"] = raw not in ("off", "unavailable", "unknown")
    elif domain == "media_player":
        # "standby" is a TV that is asleep: from the couch that is off.
        out["on"] = raw not in ("off", "standby", "unavailable", "unknown")

    if domain == "light":
        brightness = _num(attrs.get("brightness"))
        if brightness is not None:
            out["level"] = round(brightness / 255 * 100)
        elif raw == "off":
            out["level"] = 0
    elif domain == "fan":
        pct = _num(attrs.get("percentage"))
        out["level"] = round(pct) if pct is not None else (0 if raw == "off" else None)
    elif domain == "cover":
        pos = _num(attrs.get("current_position"))
        out["level"] = round(pos) if pos is not None else None
    elif domain == "media_player":
        out["attrs"] = _media_attrs(attrs)
        volume = _num(attrs.get("volume_level"))
        if volume is not None:
            out["level"] = round(min(1.0, max(0.0, volume)) * 100)
    elif domain == "climate":
        out["attrs"] = {
            "current_temperature": _num(attrs.get("current_temperature")),
            "temperature": _num(attrs.get("temperature")),
            "hvac_mode": raw,
            "hvac_action": attrs.get("hvac_action"),
        }
    return out


def _media_attrs(attrs: dict) -> dict:
    """What a TV tile and its sheet need. Keys HA left out stay out, so a live update from a
    TV that just went to sleep does not wipe the source list the sheet is showing."""
    features = int(_num(attrs.get("supported_features")) or 0)
    out: dict[str, Any] = {
        "can_power": bool(features & (_MP_TURN_ON | _MP_TURN_OFF)),
        "can_volume_step": bool(features & _MP_VOLUME_STEP),
        "can_mute": bool(features & _MP_VOLUME_MUTE),
        "can_source": bool(features & _MP_SELECT_SOURCE),
    }
    if isinstance(attrs.get("is_volume_muted"), bool):
        out["muted"] = attrs["is_volume_muted"]
    if isinstance(attrs.get("source"), str) and attrs["source"]:
        out["source"] = attrs["source"][:80]
    sources = attrs.get("source_list")
    if isinstance(sources, list) and sources:
        out["sources"] = [str(x)[:80] for x in sources if isinstance(x, str)][:_MAX_SOURCES]
    return out


def _adjustable(domain: str, attrs: dict) -> bool:
    features = int(_num(attrs.get("supported_features")) or 0)
    if domain == "media_player":
        return bool(features & _MP_VOLUME_SET)
    if domain == "light":
        modes = set(attrs.get("supported_color_modes") or [])
        return bool(modes - _LIGHT_ONOFF_ONLY)
    if domain == "fan":
        return bool(features & _FAN_SET_SPEED)
    if domain == "cover":
        return bool(features & _COVER_SET_POSITION)
    return domain == "climate"


def _tidy_name(name: str, area: str | None) -> str:
    """ "Living Room Floor Lamp" inside the Living Room card is just "Floor Lamp"."""
    if area and name.lower().startswith(area.lower() + " "):
        rest = name[len(area) + 1 :].strip()
        if rest:
            return rest[0].upper() + rest[1:]
    return name


def build_snapshot(
    states: list[dict], areas: list[dict], devices: list[dict], entities: list[dict]
) -> dict:
    """Fold HA's four lists into rooms. Pure, so it is tested without a server."""
    area_names = {a["area_id"]: a.get("name") or a["area_id"] for a in areas}
    device_area = {d["id"]: d.get("area_id") for d in devices}
    device_names = {d["id"]: d.get("name_by_user") or d.get("name") for d in devices}
    registry = {e["entity_id"]: e for e in entities}

    rooms: dict[str | None, list[dict]] = {}
    actions: list[dict] = []

    for state in states:
        entity_id = state.get("entity_id", "")
        domain = entity_id.split(".", 1)[0]
        if domain not in DOMAINS:
            continue
        reg = registry.get(entity_id)
        if reg and (reg.get("disabled_by") or reg.get("hidden_by")):
            continue
        # Config and diagnostic entities (a bridge's "identify" button) are not controls.
        if reg and reg.get("entity_category"):
            continue

        area_id = None
        if reg:
            area_id = reg.get("area_id") or device_area.get(reg.get("device_id"))
        area_id = area_id if area_id in area_names else None
        attrs = state.get("attributes") or {}
        name = (
            attrs.get("friendly_name")
            or (reg or {}).get("name")
            or (reg or {}).get("original_name")
            or device_names.get((reg or {}).get("device_id"))
            or entity_id
        )
        item = {
            **dynamic_fields(state),
            "domain": domain,
            "name": _tidy_name(str(name), area_names.get(area_id)),
            "area_id": area_id,
            "adjustable": _adjustable(domain, attrs),
        }
        if domain == "climate":
            item["attrs"].update(
                min_temp=_num(attrs.get("min_temp")),
                max_temp=_num(attrs.get("max_temp")),
                step=_num(attrs.get("target_temp_step")) or 1,
                hvac_modes=[m for m in (attrs.get("hvac_modes") or []) if m in _HVAC_MODES],
                unit=attrs.get("temperature_unit"),
            )
        if domain in ACTION_DOMAINS:
            actions.append(item)
        else:
            rooms.setdefault(area_id, []).append(item)

    order = {d: i for i, d in enumerate(DOMAINS)}

    def tile_key(item: dict):
        return (order[item["domain"]], item["name"].lower())

    out_rooms = [
        {
            "area_id": area_id,
            "name": area_names[area_id] if area_id else "Other",
            "entities": sorted(items, key=tile_key),
        }
        for area_id, items in rooms.items()
    ]
    # Named rooms alphabetically, the catch-all last.
    out_rooms.sort(key=lambda r: (r["area_id"] is None, r["name"].lower()))
    actions.sort(key=lambda a: a["name"].lower())
    return {"rooms": out_rooms, "actions": actions}


# --------------------------------------------------------------------------- websocket plumbing


def _ws_url(base: str) -> str:
    scheme = "wss" if base.startswith("https://") else "ws"
    return f"{scheme}://{base.split('://', 1)[-1]}/api/websocket"


class _Session:
    """One authenticated HA websocket with a request/response helper."""

    def __init__(self, ws) -> None:
        self.ws = ws
        self._next = 0

    async def send(self, type_: str, **fields) -> int:
        self._next += 1
        await self.ws.send(json.dumps({"id": self._next, "type": type_, **fields}))
        return self._next

    async def call(self, type_: str, **fields) -> Any:
        msg_id = await self.send(type_, **fields)
        while True:
            message = json.loads(await self.ws.recv())
            if message.get("id") != msg_id or message.get("type") != "result":
                continue
            if not message.get("success"):
                err = message.get("error") or {}
                raise HAError("error", f"Home Assistant refused {type_}: {err.get('message', '?')}")
            return message.get("result")


@contextlib.asynccontextmanager
async def _open(config: HAConfig) -> AsyncIterator[_Session]:
    _require(config)
    try:
        async with ws_connect(
            _ws_url(config.url), open_timeout=TIMEOUT_SECONDS, max_size=32 * 1024 * 1024
        ) as ws:
            hello = json.loads(await asyncio.wait_for(ws.recv(), TIMEOUT_SECONDS))
            if hello.get("type") != "auth_required":
                raise HAError("error", "That address answered, but not like Home Assistant.")
            await ws.send(json.dumps({"type": "auth", "access_token": config.token}))
            reply = json.loads(await asyncio.wait_for(ws.recv(), TIMEOUT_SECONDS))
            if reply.get("type") == "auth_invalid":
                raise HAError("invalid_token", "Home Assistant rejected the access token.")
            if reply.get("type") != "auth_ok":
                raise HAError("error", "Home Assistant did not accept the connection.")
            yield _Session(ws)
    except HAError:
        raise
    except (OSError, TimeoutError, InvalidURI, InvalidHandshake, ConnectionClosed) as exc:
        raise _unreachable(exc) from exc
    except (ValueError, KeyError) as exc:
        raise HAError("error", "Home Assistant sent something unexpected.") from exc


async def fetch_snapshot(config: HAConfig) -> dict:
    async with _open(config) as session:
        states = await session.call("get_states")
        areas = await session.call("config/area_registry/list")
        devices = await session.call("config/device_registry/list")
        entities = await session.call("config/entity_registry/list")
    return build_snapshot(states, areas, devices, entities)


async def test_connection(config: HAConfig) -> tuple[bool, str, str]:
    """(ok, code, message). REST first because it is the cheapest honest question."""
    if not config.configured:
        return False, "not_configured", "Enter the Home Assistant address and an access token."
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            response = await client.get(
                f"{config.url}/api/", headers={"Authorization": f"Bearer {config.token}"}
            )
    except httpx.InvalidURL:
        return False, "error", "That doesn't look like a web address."
    except httpx.HTTPError as exc:
        return (
            False,
            "unreachable",
            f"Can't reach Home Assistant at {config.url} ({exc.__class__.__name__}).",
        )
    if response.status_code in (401, 403):
        return False, "invalid_token", "Home Assistant rejected the access token. Create a new one."
    if response.status_code >= 400:
        return False, "error", f"Home Assistant answered {response.status_code}."
    try:
        snapshot = await fetch_snapshot(config)
    except HAError as exc:
        return False, exc.code, exc.message
    count = sum(len(r["entities"]) for r in snapshot["rooms"]) + len(snapshot["actions"])
    return True, "ok", f"Connected. {count} controls in {len(snapshot['rooms'])} rooms."


# --------------------------------------------------------------------------- actions


def plan_action(entity_id: str, action: str, value: Any, confirm: bool) -> tuple[str, str, dict]:
    """(domain, service, data) for a verb, or HAError('error') for a refused one."""
    if not _ENTITY_ID.match(entity_id or ""):
        raise HAError("refused", "That isn't a device id.")
    domain = entity_id.split(".", 1)[0]
    if domain not in DOMAINS:
        raise HAError("refused", f"Mantel doesn't control {domain} devices.")
    data: dict[str, Any] = {"entity_id": entity_id}

    def level() -> int:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 100:
            raise HAError("refused", "Level must be a number from 0 to 100.")
        return round(value)

    if action in ("turn_on", "turn_off", "toggle") and domain in (
        "light",
        "switch",
        "fan",
        "input_boolean",
        "cover",
        "media_player",
    ):
        if domain == "cover":
            return (
                domain,
                {"turn_on": "open_cover", "turn_off": "close_cover", "toggle": "toggle"}[action],
                data,
            )
        return domain, action, data
    if action == "set_level":
        pct = level()
        if domain == "light":
            if pct == 0:
                return domain, "turn_off", data
            return domain, "turn_on", {**data, "brightness_pct": pct}
        if domain == "fan":
            return domain, "set_percentage", {**data, "percentage": pct}
        if domain == "cover":
            return domain, "set_cover_position", {**data, "position": pct}
        if domain == "media_player":
            return domain, "volume_set", {**data, "volume_level": pct / 100}
    if domain == "media_player":
        if action in ("volume_up", "volume_down"):
            return domain, action, data
        if action in ("mute", "unmute"):
            return domain, "volume_mute", {**data, "is_volume_muted": action == "mute"}
        if action == "select_source":
            if not isinstance(value, str) or not value.strip() or len(value) > 80:
                raise HAError("refused", "Pick one of the TV's inputs.")
            return domain, "select_source", {**data, "source": value}
    if action in ("open", "close", "stop") and domain == "cover":
        return domain, f"{action}_cover", data
    if action == "activate" and domain in ACTION_DOMAINS:
        return domain, "turn_on", data
    if action == "set_temperature" and domain == "climate":
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 < value < 130:
            raise HAError("refused", "That isn't a temperature.")
        return domain, "set_temperature", {**data, "temperature": value}
    if action == "set_hvac_mode" and domain == "climate":
        if value not in _HVAC_MODES:
            raise HAError("refused", "Unknown heating/cooling mode.")
        return domain, "set_hvac_mode", {**data, "hvac_mode": value}
    if action in ("lock", "unlock") and domain == "lock":
        # A lock is the one thing here that can let somebody into the house. The wall asks
        # first; the API refuses to act unless it was told that somebody said yes.
        if not confirm:
            raise HAError("confirmation_required", f"Confirm before you {action} this.")
        return domain, action, data
    raise HAError("refused", f"{action} doesn't work on a {domain}.")


async def call_action(
    config: HAConfig, entity_id: str, action: str, value: Any, confirm: bool
) -> None:
    _require(config)
    domain, service, data = plan_action(entity_id, action, value, confirm)
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{config.url}/api/services/{domain}/{service}",
                headers={"Authorization": f"Bearer {config.token}"},
                json=data,
            )
    except httpx.HTTPError as exc:
        raise _unreachable(exc) from exc
    if response.status_code in (401, 403):
        raise HAError("invalid_token", "Home Assistant rejected the access token.")
    if response.status_code >= 400:
        raise HAError("error", f"Home Assistant answered {response.status_code}.")


# --------------------------------------------------------------------------- live relay

_REGISTRY_EVENTS = ("entity_registry_updated", "device_registry_updated", "area_registry_updated")
_BACKOFF = (1, 2, 4, 8, 15, 30)
# How long the HA socket stays open after the last screen leaves the Home page.
IDLE_CLOSE_SECONDS = 20.0


class HomeStream:
    """Relays HA's event bus to every open Home screen over one websocket.

    Started by the first subscriber and closed shortly after the last leaves, so a house
    that never opens the Home page costs HA nothing. Each message is a dict:
    `{"event": "status"|"state"|"refresh", "data": {...}}`.
    """

    def __init__(self, load: Any = None) -> None:
        self._load = load
        self._subs: set[asyncio.Queue] = set()
        self._task: asyncio.Task | None = None
        self._kick: asyncio.Event | None = None
        self.status: dict = {"status": "connecting", "message": ""}

    def set_loader(self, load) -> None:
        self._load = load

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=256)
        self._subs.add(queue)
        queue.put_nowait({"event": "status", "data": self.status})
        if self._task is None or self._task.done():
            self._kick = asyncio.Event()
            self._task = asyncio.get_running_loop().create_task(self._run(), name="ha-home-stream")
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subs.discard(queue)

    def reconnect(self) -> None:
        """Settings changed: drop the socket and read the new URL and token."""
        if self._kick is not None:
            self._kick.set()

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        self._subs.clear()
        self.status = {"status": "connecting", "message": ""}

    def _publish(self, event: str, data: dict) -> None:
        if event == "status":
            self.status = data
        for queue in list(self._subs):
            try:
                queue.put_nowait({"event": event, "data": data})
            except asyncio.QueueFull:
                # A screen that fell behind refetches the whole snapshot instead.
                with contextlib.suppress(asyncio.QueueEmpty):
                    while True:
                        queue.get_nowait()
                queue.put_nowait({"event": "refresh", "data": {}})

    async def _run(self) -> None:
        attempt = 0
        while self._subs:
            try:
                config = await self._load() if self._load else HAConfig("", "")
                if not config.configured:
                    self._publish("status", {"status": "not_configured", "message": ""})
                    await self._sleep(5.0)
                    continue
                await self._connected(config)
                attempt = 0
            except asyncio.CancelledError:
                raise
            except HAError as exc:
                self._publish("status", {"status": exc.code, "message": exc.message})
            except Exception as exc:  # noqa: BLE001 -- the loop must outlive any one failure
                log.warning("Home stream error: %s", exc)
                self._publish("status", {"status": "error", "message": "Lost the connection."})
            if not self._subs:
                return
            await self._sleep(_BACKOFF[min(attempt, len(_BACKOFF) - 1)])
            attempt += 1

    async def _sleep(self, seconds: float) -> None:
        assert self._kick is not None
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._kick.wait(), seconds)
        self._kick.clear()

    async def _connected(self, config: HAConfig) -> None:
        assert self._kick is not None
        async with _open(config) as session:
            await session.send("subscribe_events", event_type="state_changed")
            for kind in _REGISTRY_EVENTS:
                await session.send("subscribe_events", event_type=kind)
            self._publish("status", {"status": "ok", "message": ""})
            # Anything that changed while we were away.
            self._publish("refresh", {})
            idle_since: float | None = None
            loop = asyncio.get_running_loop()
            while True:
                if self._kick.is_set():
                    self._kick.clear()
                    return
                if self._subs:
                    idle_since = None
                else:
                    idle_since = idle_since or loop.time()
                    if loop.time() - idle_since >= IDLE_CLOSE_SECONDS:
                        return
                try:
                    raw = await asyncio.wait_for(session.ws.recv(), 1.0)
                except TimeoutError:
                    continue
                self._on_message(json.loads(raw))

    def _on_message(self, message: dict) -> None:
        if message.get("type") != "event":
            return
        event = message.get("event") or {}
        kind = event.get("event_type")
        if kind in _REGISTRY_EVENTS:
            self._publish("refresh", {})
            return
        if kind != "state_changed":
            return
        new = (event.get("data") or {}).get("new_state")
        old_id = (event.get("data") or {}).get("entity_id", "")
        if new is None:
            # Removed from HA: the room list is out of date.
            if old_id.split(".", 1)[0] in DOMAINS:
                self._publish("refresh", {})
            return
        if new["entity_id"].split(".", 1)[0] in DOMAINS:
            self._publish("state", dynamic_fields(new))


stream = HomeStream()

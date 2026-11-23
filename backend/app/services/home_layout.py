"""How the family arranged the Home page: the `home_layout` setting.

One household-wide value, so the wall, the phones and the web all show the same
arrangement. It only records *choices*. Rooms and devices that are not listed (a new
light added in Home Assistant, a new room) are not an error: the page puts them after
everything that was arranged, in the usual order.

Rooms are keyed by Home Assistant's area id, or `other` for the catch-all card. Hidden
devices and scenes are not stored here: they are the existing `home_hidden` setting, which
Settings -> Home edits too.
"""

from typing import Any

LIST_KEYS = ("rooms", "hidden_rooms", "wide_rooms", "scenes")
MAX_ITEMS = 1000
MAX_ROOMS = 200

DEFAULT_LAYOUT: dict[str, Any] = {
    "rooms": [],  # room keys, in the order shown
    "hidden_rooms": [],  # room keys left off the page
    "wide_rooms": [],  # room keys shown double width
    "devices": {},  # room key -> device ids, in the order shown inside that room
    "scenes": [],  # scene/script ids, in the order shown in the chip row
}


class LayoutError(ValueError):
    pass


def _ids(value: Any, what: str, limit: int = MAX_ITEMS) -> list[str]:
    if (
        not isinstance(value, list)
        or len(value) > limit
        or not all(isinstance(i, str) and 0 < len(i) < 120 for i in value)
    ):
        raise LayoutError(f"home_layout.{what} must be a list of ids")
    return list(dict.fromkeys(value))  # de-duplicated, order kept


def clean_layout(value: Any) -> dict[str, Any]:
    """Validate what a client sent and fill in anything it left out."""
    if not isinstance(value, dict):
        raise LayoutError("home_layout must be an object")
    unknown = set(value) - set(DEFAULT_LAYOUT)
    if unknown:
        raise LayoutError(f"Unknown home_layout keys: {', '.join(sorted(map(str, unknown)))}")
    out: dict[str, Any] = {key: _ids(value.get(key, []), key) for key in LIST_KEYS}
    devices = value.get("devices", {})
    if not isinstance(devices, dict) or len(devices) > MAX_ROOMS:
        raise LayoutError("home_layout.devices must map a room to its device ids")
    out["devices"] = {
        str(room): _ids(ids, f"devices.{room}")
        for room, ids in devices.items()
        if isinstance(room, str) and 0 < len(room) < 120
    }
    return out

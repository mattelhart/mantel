"""UniFi Protect Integration API client.

The API key is read from a file whose path comes from UNIFI_PROTECT_KEY_FILE.
The key is never logged, never included in an exception message, and never
returned to a caller. Snapshots are cached for a couple of seconds so a wall
of tiles refreshing every three seconds does not hammer the console.
"""

from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

import httpx

DEFAULT_PROTECT_URL = "https://10.0.0.1/proxy/protect/integration"
SNAPSHOT_TTL_SECONDS = 2.0
REQUEST_TIMEOUT = 10.0


def _now() -> float:
    return time.monotonic()


class NotConfigured(Exception):
    """No key file is set, or the file is missing or empty."""


class UpstreamError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class Camera:
    id: str
    name: str
    state: str


@dataclass(frozen=True)
class Snapshot:
    body: bytes
    content_type: str


_cache_lock = threading.Lock()
_snapshots: dict[str, tuple[float, Snapshot]] = {}


def reset_cache() -> None:
    with _cache_lock:
        _snapshots.clear()


def key_file_path() -> str:
    return os.environ.get("UNIFI_PROTECT_KEY_FILE", "").strip()


def base_url() -> str:
    raw = os.environ.get("UNIFI_PROTECT_URL", "").strip() or DEFAULT_PROTECT_URL
    return raw.rstrip("/")


def configured() -> bool:
    path = key_file_path()
    if not path:
        return False
    try:
        return bool(_read_key(path))
    except OSError:
        return False


def _read_key(path: str) -> str:
    # The key is only returned to the request builder. Do not log it.
    return Path(path).read_text(encoding="utf-8").strip()


def _api_key() -> str:
    path = key_file_path()
    if not path:
        raise NotConfigured("not configured")
    try:
        key = _read_key(path)
    except OSError as exc:
        raise NotConfigured("not configured") from exc
    if not key:
        raise NotConfigured("not configured")
    return key


def build_client() -> httpx.Client:
    """HTTP client used only for the Protect host.

    Certificate verification is off because UniFi consoles typically present a
    self-signed certificate. The flag stays on this client, not on a process-wide
    SSL context.
    """
    return httpx.Client(verify=False, timeout=REQUEST_TIMEOUT, follow_redirects=True)


def _request(method: str, path: str, *, accept: str) -> httpx.Response:
    key = _api_key()
    url = f"{base_url()}{path}"
    headers = {"X-API-KEY": key, "Accept": accept}
    try:
        with build_client() as client:
            return client.request(method, url, headers=headers)
    except httpx.HTTPError as exc:
        # str(exc) can include the URL, never the key (it is a header).
        raise UpstreamError("Could not reach UniFi Protect.") from exc


def list_cameras() -> list[Camera]:
    response = _request("GET", "/v1/cameras", accept="application/json")
    if response.status_code != 200:
        raise UpstreamError("UniFi Protect did not return the camera list.", response.status_code)
    try:
        payload = response.json()
    except ValueError as exc:
        raise UpstreamError("UniFi Protect returned an invalid camera list.") from exc
    if not isinstance(payload, list):
        raise UpstreamError("UniFi Protect returned an invalid camera list.")
    return [_map_camera(item) for item in payload if isinstance(item, dict) and item.get("id")]


def _map_camera(item: dict) -> Camera:
    camera_id = str(item["id"])
    name = str(item.get("name") or item.get("displayName") or "Camera")
    state = item.get("state")
    if not state:
        connected = item.get("isConnected")
        state = "CONNECTED" if connected else "DISCONNECTED"
    return Camera(id=camera_id, name=name, state=str(state))


def snapshot(camera_id: str) -> Snapshot:
    now = _now()
    with _cache_lock:
        hit = _snapshots.get(camera_id)
        if hit and hit[0] > now:
            return hit[1]

    image = _fetch_snapshot(camera_id)
    with _cache_lock:
        _snapshots[camera_id] = (_now() + SNAPSHOT_TTL_SECONDS, image)
    return image


def _fetch_snapshot(camera_id: str) -> Snapshot:
    path = f"/v1/cameras/{quote(camera_id, safe='')}/snapshot"
    response = _request("GET", path, accept="image/jpeg")
    if response.status_code == 404:
        raise UpstreamError("Camera not found.", 404)
    if response.status_code != 200:
        raise UpstreamError("UniFi Protect did not return a snapshot.", response.status_code)
    content_type = response.headers.get("content-type", "image/jpeg").split(";")[0].strip()
    if not content_type:
        content_type = "image/jpeg"
    body = response.content
    if not body:
        raise UpstreamError("UniFi Protect returned an empty snapshot.")
    return Snapshot(body=body, content_type=content_type)

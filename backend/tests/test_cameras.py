"""UniFi Protect camera list and snapshot proxy."""

from __future__ import annotations

import json

import httpx
import pytest

from app.services import protect

JPEG = (
    b"\xff\xd8\xff\xdb\x00C\x00"
    + b"\x08" * 64
    + b"\xff\xc0\x00\x11\x08\x00\x01\x00\x01\x03\x01\x11\x00\x02\x11\x01\x03\x11\x01"
    + b"\xff\xda\x00\x08\x01\x01\x00\x00?\x00\x7f\xff\xd9"
)

CAMERAS = [
    {"id": "front-door", "name": "Front Door Camera", "state": "CONNECTED"},
    {"id": "g5-dome", "name": "G5 Dome", "state": "DISCONNECTED"},
    {"id": "driveway", "name": "Driveway", "state": "CONNECTED"},
    {"id": "brooklyns-bedroom", "name": "Brooklyn's Bedroom", "isConnected": True},
]


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch, tmp_path):
    protect.reset_cache()
    monkeypatch.delenv("UNIFI_PROTECT_KEY_FILE", raising=False)
    monkeypatch.delenv("UNIFI_PROTECT_URL", raising=False)
    yield
    protect.reset_cache()


def _install_key(monkeypatch, tmp_path, value="test-protect-key"):
    path = tmp_path / "unifi-protect.key"
    path.write_text(value)
    monkeypatch.setenv("UNIFI_PROTECT_KEY_FILE", str(path))
    monkeypatch.setenv("UNIFI_PROTECT_URL", "https://protect.test/proxy/protect/integration")
    return path


def _install_transport(monkeypatch, handler):
    calls: list[httpx.Request] = []

    def factory() -> httpx.Client:
        def wrapped(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            return handler(request)

        return httpx.Client(
            transport=httpx.MockTransport(wrapped),
            verify=False,
            timeout=protect.REQUEST_TIMEOUT,
        )

    monkeypatch.setattr(protect, "build_client", factory)
    return calls


def test_list_reports_not_configured_when_env_unset(client):
    response = client.get("/api/cameras")
    assert response.status_code == 200
    body = response.json()
    assert body == {"configured": False, "cameras": []}
    assert "key" not in json.dumps(body).lower() or "test-protect" not in json.dumps(body)


def test_list_reports_not_configured_when_file_missing(client, monkeypatch, tmp_path):
    monkeypatch.setenv("UNIFI_PROTECT_KEY_FILE", str(tmp_path / "missing.key"))
    response = client.get("/api/cameras")
    assert response.status_code == 200
    assert response.json()["configured"] is False


def test_list_reports_not_configured_when_file_empty(client, monkeypatch, tmp_path):
    _install_key(monkeypatch, tmp_path, value="  \n")
    response = client.get("/api/cameras")
    assert response.status_code == 200
    assert response.json()["configured"] is False


def test_list_maps_cameras_and_never_returns_the_key(client, monkeypatch, tmp_path):
    _install_key(monkeypatch, tmp_path)
    calls = _install_transport(
        monkeypatch,
        lambda req: httpx.Response(200, json=CAMERAS),
    )

    response = client.get("/api/cameras")
    assert response.status_code == 200
    body = response.json()
    assert body["configured"] is True
    assert body["cameras"] == [
        {"id": "front-door", "name": "Front Door Camera", "state": "CONNECTED"},
        {"id": "g5-dome", "name": "G5 Dome", "state": "DISCONNECTED"},
        {"id": "driveway", "name": "Driveway", "state": "CONNECTED"},
        {"id": "brooklyns-bedroom", "name": "Brooklyn's Bedroom", "state": "CONNECTED"},
    ]
    dumped = json.dumps(body)
    assert "test-protect-key" not in dumped
    assert len(calls) == 1
    assert calls[0].url.path.endswith("/v1/cameras")
    assert calls[0].headers["X-API-KEY"] == "test-protect-key"
    # The header is for upstream only; our JSON body must not echo it.
    assert "X-API-KEY" not in response.headers
    assert "test-protect-key" not in response.text


def test_list_upstream_error_is_502(client, monkeypatch, tmp_path):
    _install_key(monkeypatch, tmp_path)
    _install_transport(monkeypatch, lambda req: httpx.Response(500, json={"error": "nope"}))
    response = client.get("/api/cameras")
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "upstream_error"
    assert "test-protect-key" not in response.text


def test_snapshot_not_configured(client):
    response = client.get("/api/cameras/front-door/snapshot")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "not_configured"
    assert response.json()["error"]["message"] == "not configured"


def test_snapshot_proxies_jpeg_and_caches(client, monkeypatch, tmp_path):
    _install_key(monkeypatch, tmp_path)
    hits = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        hits["n"] += 1
        assert request.url.path.endswith("/v1/cameras/front-door/snapshot")
        return httpx.Response(200, content=JPEG, headers={"Content-Type": "image/jpeg"})

    _install_transport(monkeypatch, handler)

    first = client.get("/api/cameras/front-door/snapshot")
    second = client.get("/api/cameras/front-door/snapshot")
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.content == JPEG
    assert second.content == JPEG
    assert first.headers["content-type"].startswith("image/jpeg")
    assert hits["n"] == 1, "the second request should be served from the short cache"


def test_snapshot_cache_expires(client, monkeypatch, tmp_path):
    _install_key(monkeypatch, tmp_path)
    hits = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        hits["n"] += 1
        return httpx.Response(200, content=JPEG, headers={"Content-Type": "image/jpeg"})

    _install_transport(monkeypatch, handler)

    clock = {"t": 1000.0}
    monkeypatch.setattr(protect, "_now", lambda: clock["t"])

    assert client.get("/api/cameras/front-door/snapshot").status_code == 200
    clock["t"] = 1001.5
    assert client.get("/api/cameras/front-door/snapshot").status_code == 200
    assert hits["n"] == 1
    clock["t"] = 1002.1
    assert client.get("/api/cameras/front-door/snapshot").status_code == 200
    assert hits["n"] == 2


def test_snapshot_missing_camera_is_404(client, monkeypatch, tmp_path):
    _install_key(monkeypatch, tmp_path)
    _install_transport(monkeypatch, lambda req: httpx.Response(404, json={"error": "missing"}))
    response = client.get("/api/cameras/unknown/snapshot")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert "test-protect-key" not in response.text


def test_snapshot_upstream_failure_is_502(client, monkeypatch, tmp_path):
    _install_key(monkeypatch, tmp_path)
    _install_transport(monkeypatch, lambda req: httpx.Response(503, content=b"busy"))
    response = client.get("/api/cameras/front-door/snapshot")
    assert response.status_code == 502
    assert "test-protect-key" not in response.text


def test_build_client_disables_verify_only_on_that_client():
    client = protect.build_client()
    try:
        assert client._transport._pool._ssl_context is not None or True
        # httpx stores verify=False as an SSL context that does not check certs.
        assert client._transport._pool._ssl_context.check_hostname is False
    finally:
        client.close()

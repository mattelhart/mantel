"""Family messaging through the Signal CLI REST API. HTTP is mocked."""

from __future__ import annotations

import base64
import json
from io import BytesIO

import httpx
import pytest
from PIL import Image
from sqlalchemy import select

from app.models import FamilyMessage
from app.services import signal_messages, twilio_messages as sms

FROM = "+15550001111"
AUSTIN = "+15555550123"
STRANGER = "+15555550999"
API = "http://signal-api:8080"


def _png_bytes(color=(30, 80, 160)) -> bytes:
    buf = BytesIO()
    Image.new("RGB", (24, 16), color).save(buf, format="PNG")
    return buf.getvalue()


PNG = _png_bytes()
PNG_B64 = base64.b64encode(PNG).decode()
QR_PNG = b"\x89PNG\r\n\x1a\n" + b"qr-code-bytes"


@pytest.fixture(autouse=True)
def _reset(tmp_path, monkeypatch):
    sms.reset_rate_limiter()
    monkeypatch.setattr(sms, "data_dir", lambda: tmp_path)
    yield
    sms.reset_rate_limiter()


def _configure(client, *, url=API, number=FROM, provider="signal"):
    r = client.patch(
        "/api/settings",
        json={
            "message_provider": provider,
            "signal_api_url": url,
            "signal_account_number": number,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def _person(client, name="Austin", phone=AUSTIN):
    r = client.post("/api/users", json={"name": name, "phone": phone, "color": "#3b82f6"})
    assert r.status_code == 201, r.text
    return r.json()


def _install(monkeypatch, handler):
    calls: list[httpx.Request] = []

    def factory(timeout: float = signal_messages.REQUEST_TIMEOUT) -> httpx.Client:
        def wrapped(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            return handler(request)

        return httpx.Client(
            transport=httpx.MockTransport(wrapped), timeout=timeout
        )

    monkeypatch.setattr(signal_messages, "build_client", factory)
    return calls


def _json(request, body, status=200):
    return httpx.Response(status, json=body, request=request)


def _png(request, body=QR_PNG, status=200):
    return httpx.Response(status, content=body, headers={"Content-Type": "image/png"}, request=request)


def test_settings_store_signal_fields_and_report_flags(client):
    body = _configure(client)
    assert body["message_provider"] == "signal"
    assert body["signal_api_url"] == API
    assert body["signal_account_number"] == FROM
    assert body["server"]["signal_configured"] is True
    assert body["server"]["messages_configured"] is True
    assert body["server"]["messages_provider"] == "signal"
    # Twilio flags stay independent.
    assert body["server"]["twilio_configured"] is False


def test_signal_url_and_number_are_validated(client):
    bad = client.patch("/api/settings", json={"signal_api_url": "ftp://example.com"})
    assert bad.status_code == 400
    bad = client.patch("/api/settings", json={"signal_api_url": "http://user:pass@host:8080"})
    assert bad.status_code == 400
    bad = client.patch("/api/settings", json={"signal_account_number": "abc"})
    assert bad.status_code == 400
    ok = client.patch("/api/settings", json={"signal_account_number": "5555550123"})
    assert ok.status_code == 200
    assert ok.json()["signal_account_number"] == "+15555550123"


def test_send_rejected_when_unconfigured(client):
    person = _person(client)
    # Provider is still Twilio by default, also unconfigured.
    r = client.post("/api/messages", json={"user_id": person["id"], "body": "Hi"})
    assert r.status_code == 400
    _configure(client, number="")  # switch to Signal without a number
    r = client.post("/api/messages", json={"user_id": person["id"], "body": "Hi"})
    assert r.status_code == 400
    assert "Signal" in r.json()["error"]["message"]


def test_send_text_and_doodle_use_v2_send_with_base64(client, monkeypatch):
    person = _person(client)
    _configure(client)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v2/send":
            return _json(request, [{"timestamp": "1700000000001"}], 201)
        return _json(request, {"error": "unexpected " + request.url.path}, 400)

    calls = _install(monkeypatch, handler)
    r = client.post(
        "/api/messages",
        json={"user_id": person["id"], "body": "For you", "media_base64": PNG_B64},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["direction"] == "out"
    assert body["status"] == "sent"
    assert body["body"] == "For you"
    assert body["media_url"]
    assert len(calls) == 1
    payload = json.loads(calls[0].content)
    assert calls[0].url.path == "/v2/send"
    assert payload["number"] == FROM
    assert payload["recipients"] == [AUSTIN]
    assert payload["message"] == "For you"
    assert "base64_attachments" in payload
    assert payload["base64_attachments"]
    # Must not involve Twilio's media host.
    assert b"twilio" not in calls[0].content.lower()
    assert b"twiliocdn" not in calls[0].content.lower()


def test_send_only_to_saved_family_and_caps_body(client, monkeypatch):
    person = _person(client)
    _configure(client)
    _install(monkeypatch, lambda request: _json(request, [{"timestamp": "1"}], 201))
    missing = client.post("/api/messages", json={"user_id": 9999, "body": "Hi"})
    assert missing.status_code == 404
    too_long = client.post("/api/messages", json={"user_id": person["id"], "body": "x" * 1001})
    assert too_long.status_code == 400
    nobody = client.post("/api/users", json={"name": "Sam", "color": "#f97316"})
    assert nobody.status_code == 201
    r = client.post("/api/messages", json={"user_id": nobody.json()["id"], "body": "Hi"})
    assert r.status_code == 400
    assert "phone number" in r.json()["error"]["message"]


def test_doodle_falls_back_to_text_when_attachment_rejected(client, monkeypatch):
    person = _person(client)
    _configure(client)
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v2/send":
            payload = json.loads(request.content)
            seen.append(payload)
            if payload.get("base64_attachments"):
                return _json(request, {"error": "attachment too large"}, 400)
            return _json(request, [{"timestamp": "9"}], 201)
        return _json(request, {"error": "unexpected"}, 400)

    _install(monkeypatch, handler)
    r = client.post(
        "/api/messages",
        json={"user_id": person["id"], "body": "Hi", "media_base64": PNG_B64},
    )
    assert r.status_code == 201, r.text
    assert len(seen) == 2
    assert "base64_attachments" in seen[0]
    assert "base64_attachments" not in seen[1]
    assert "couldn't be sent as a picture" in r.json()["error_message"]


def test_rate_limit(client, monkeypatch):
    person = _person(client)
    _configure(client)
    n = {"i": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        n["i"] += 1
        return _json(request, [{"timestamp": str(n["i"])}], 201)

    _install(monkeypatch, handler)
    for _ in range(sms.MAX_SENDS_PER_MINUTE):
        r = client.post("/api/messages", json={"user_id": person["id"], "body": "Hi"})
        assert r.status_code == 201, r.text
    r = client.post("/api/messages", json={"user_id": person["id"], "body": "Hi"})
    assert r.status_code == 429


def test_poll_inbound_stores_unknown_and_known_and_never_auto_replies(client, monkeypatch, db):
    person = _person(client)
    _configure(client)
    photo = _png_bytes((10, 20, 30))
    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/v2/send":
            sent.append(request)
            return _json(request, {"error": "should not send"}, 400)
        if path.startswith("/v1/receive/"):
            return _json(
                request,
                [
                    {
                        "envelope": {
                            "sourceNumber": AUSTIN,
                            "timestamp": 1700000001000,
                            "dataMessage": {
                                "timestamp": 1700000001000,
                                "message": "On my way",
                            },
                        }
                    },
                    {
                        "envelope": {
                            "sourceNumber": STRANGER,
                            "timestamp": 1700000002000,
                            "dataMessage": {
                                "timestamp": 1700000002000,
                                "message": "Who is this?",
                                "attachments": [
                                    {"id": "att-1", "contentType": "image/png"}
                                ],
                            },
                        }
                    },
                    {
                        "envelope": {
                            "sourceNumber": STRANGER,
                            "timestamp": 1700000003000,
                            "typingMessage": {"action": "STARTED"},
                        }
                    },
                ],
            )
        if path == "/v1/attachments/att-1" and request.method == "GET":
            return httpx.Response(
                200,
                content=photo,
                headers={"Content-Type": "image/png"},
                request=request,
            )
        if path == "/v1/attachments/att-1" and request.method == "DELETE":
            return _json(request, {}, 200)
        return _json(request, {"error": path}, 400)

    _install(monkeypatch, handler)
    added = signal_messages.poll_once(db)
    assert added == 2
    assert sent == []
    rows = list(db.scalars(select(FamilyMessage).order_by(FamilyMessage.id)))
    assert [row.phone for row in rows] == [AUSTIN, STRANGER]
    assert rows[0].user_id == person["id"]
    assert rows[0].body == "On my way"
    assert rows[0].direction == "in"
    assert rows[1].user_id is None
    assert rows[1].body == "Who is this?"
    assert rows[1].media_path
    listing = client.get("/api/messages/conversations").json()
    assert listing["configured"] is True
    names = {c["name"]: c for c in listing["conversations"]}
    assert "Austin" in names
    assert "Unknown" not in names


def test_receipt_poll_marks_message_read(client, monkeypatch, db):
    person = _person(client)
    _configure(client)

    def send_handler(request: httpx.Request) -> httpx.Response:
        return _json(request, [{"timestamp": "1700000099"}], 201)

    _install(monkeypatch, send_handler)
    r = client.post("/api/messages", json={"user_id": person["id"], "body": "Hi"})
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "sent"

    def receive_handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.startswith("/v1/receive/"):
            return _json(
                request,
                [
                    {
                        "envelope": {
                            "sourceNumber": AUSTIN,
                            "receiptMessage": {
                                "when": 1700000100,
                                "isDelivery": True,
                                "isRead": True,
                                "isViewed": False,
                                "timestamps": [1700000099],
                            },
                        }
                    }
                ],
            )
        return _json(request, {"error": request.url.path}, 400)

    _install(monkeypatch, receive_handler)
    signal_messages.poll_once(db)
    row = db.scalars(select(FamilyMessage)).first()
    assert row is not None
    db.refresh(row)
    assert row.status == "read"


def test_qr_and_status_proxy_the_container(client, monkeypatch):
    _configure(client)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/qrcodelink":
            assert request.url.params.get("device_name") == "Mantel"
            return _png(request)
        if request.url.path == "/v1/about":
            return _json(request, {"mode": "normal", "version": "test", "versions": ["v1", "v2"], "build": 1, "capabilities": {}})
        if request.url.path == "/v1/accounts":
            return _json(request, [{"number": FROM, "aci": "aaaa"}])
        return _json(request, {"error": request.url.path}, 400)

    _install(monkeypatch, handler)
    qr = client.get("/api/messages/signal/qr")
    assert qr.status_code == 200
    assert qr.headers["content-type"].startswith("image/png")
    assert qr.content == QR_PNG
    status = client.get("/api/messages/signal/status")
    assert status.status_code == 200
    body = status.json()
    assert body["reachable"] is True
    assert body["linked"] is True
    assert body["mode"] == "normal"
    assert body["account_number"] == FROM


def test_status_remembers_linked_number(client, monkeypatch):
    _configure(client, number="")
    # configured is false without a number, but status + QR still work with the URL.

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/about":
            return _json(request, {"mode": "normal", "version": "t", "versions": ["v1"], "build": 1, "capabilities": {}})
        if request.url.path == "/v1/accounts":
            return _json(request, [{"number": FROM, "aci": "bbbb"}])
        return _json(request, {"error": request.url.path}, 400)

    _install(monkeypatch, handler)
    body = client.get("/api/messages/signal/status").json()
    assert body["linked"] is True
    assert body["account_number"] == FROM
    saved = client.get("/api/settings").json()
    assert saved["signal_account_number"] == FROM
    assert saved["server"]["signal_configured"] is True


def test_test_send_uses_first_member_with_a_phone(client, monkeypatch):
    _person(client, name="Sam", phone=None)
    austin = _person(client)
    _configure(client)
    calls = _install(monkeypatch, lambda request: _json(request, [{"timestamp": "3"}], 201))
    r = client.post("/api/messages/test")
    assert r.status_code == 201, r.text
    payload = json.loads(calls[0].content)
    assert payload["recipients"] == [austin["phone"]]
    assert payload["message"] == "This is a test message from Mantel."


def test_blank_send_rejected(client):
    person = _person(client)
    _configure(client)
    r = client.post("/api/messages", json={"user_id": person["id"], "body": "  "})
    assert r.status_code == 400

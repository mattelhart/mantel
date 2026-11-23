"""Family messaging through Twilio. HTTP is mocked; nothing leaves this process."""

from __future__ import annotations

import base64
import json
from io import BytesIO

import httpx
import pytest
from PIL import Image
from sqlalchemy import select

from app.models import AppSetting, FamilyMessage
from app.services import twilio_messages as sms
from app.services.ha_home import open_token

ACCOUNT = "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1"
TOKEN = "twilio-auth-token-SUPER-SECRET"
FROM = "+18005550100"
AUSTIN = "+15555550123"
STRANGER = "+15555550999"
MEDIA_URL = "https://media.twiliocdn.com/temporary/doodle.png"


def _png_bytes(color=(30, 80, 160)) -> bytes:
    buf = BytesIO()
    Image.new("RGB", (24, 16), color).save(buf, format="PNG")
    return buf.getvalue()


PNG = _png_bytes()
PNG_B64 = base64.b64encode(PNG).decode()


@pytest.fixture(autouse=True)
def _reset(tmp_path, monkeypatch):
    sms.reset_rate_limiter()
    # Keep stored pictures inside the test temp dir even if the DB path is reused.
    monkeypatch.setattr(sms, "data_dir", lambda: tmp_path)
    yield
    sms.reset_rate_limiter()


def _configure(client, *, sid=ACCOUNT, token=TOKEN, frm=FROM):
    r = client.patch(
        "/api/settings",
        json={
            "twilio_account_sid": sid,
            "twilio_auth_token": token,
            "twilio_from_number": frm,
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

    def factory() -> httpx.Client:
        def wrapped(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            return handler(request)

        return httpx.Client(transport=httpx.MockTransport(wrapped), timeout=sms.REQUEST_TIMEOUT)

    monkeypatch.setattr(sms, "build_client", factory)
    return calls


def _json(request, body, status=200):
    return httpx.Response(status, json=body, request=request)


def test_settings_hide_twilio_secrets_and_report_flags(client, db):
    body = client.get("/api/settings").json()
    assert body["twilio_account_sid"] == ""
    assert body["twilio_auth_token"] == ""
    assert body["twilio_from_number"] == ""
    assert body["server"]["twilio_account_sid_set"] is False
    assert body["server"]["twilio_auth_token_set"] is False
    assert body["server"]["twilio_configured"] is False
    dumped = json.dumps(body)
    assert TOKEN not in dumped
    assert ACCOUNT not in dumped

    saved = _configure(client)
    dumped = json.dumps(saved)
    assert TOKEN not in dumped
    assert ACCOUNT not in dumped
    assert saved["twilio_account_sid"] == ""
    assert saved["twilio_auth_token"] == ""
    assert saved["twilio_from_number"] == FROM
    assert saved["server"]["twilio_account_sid_set"] is True
    assert saved["server"]["twilio_auth_token_set"] is True
    assert saved["server"]["twilio_configured"] is True

    stored_sid = db.scalar(select(AppSetting).where(AppSetting.key == "twilio_account_sid")).value[
        "value"
    ]
    stored_token = db.scalar(
        select(AppSetting).where(AppSetting.key == "twilio_auth_token")
    ).value["value"]
    assert stored_sid != ACCOUNT
    assert stored_token != TOKEN
    assert open_token(stored_sid) == ACCOUNT
    assert open_token(stored_token) == TOKEN

    # Empty string leaves the secret alone, same as the Home Assistant token.
    left = client.patch("/api/settings", json={"twilio_auth_token": ""}).json()
    assert left["server"]["twilio_auth_token_set"] is True
    assert open_token(
        db.scalar(select(AppSetting).where(AppSetting.key == "twilio_auth_token")).value["value"]
    ) == TOKEN

    cleared = client.patch("/api/settings", json={"twilio_auth_token": None}).json()
    assert cleared["server"]["twilio_auth_token_set"] is False
    assert cleared["server"]["twilio_configured"] is False


def test_from_number_is_normalized_and_validated(client):
    r = client.patch("/api/settings", json={"twilio_from_number": "800-555-0100"})
    assert r.status_code == 200
    assert r.json()["twilio_from_number"] == "+18005550100"

    bad = client.patch("/api/settings", json={"twilio_from_number": "abc"})
    assert bad.status_code == 400


def test_user_phone_round_trip_and_uniqueness(client):
    austin = _person(client)
    assert austin["phone"] == AUSTIN

    other = client.post("/api/users", json={"name": "Brooklyn", "phone": "555-555-0123"})
    assert other.status_code == 400

    brooklyn = client.post("/api/users", json={"name": "Brooklyn", "phone": "5555550111"}).json()
    assert brooklyn["phone"] == "+15555550111"

    cleared = client.patch(f"/api/users/{austin['id']}", json={"phone": ""}).json()
    assert cleared["phone"] is None


def test_send_rejected_when_unconfigured(client):
    person = _person(client)
    listing = client.get("/api/messages/conversations").json()
    assert listing["configured"] is False
    assert listing["conversations"][0]["name"] == "Austin"

    r = client.post("/api/messages", json={"user_id": person["id"], "body": "Hi"})
    assert r.status_code == 400
    assert "Twilio" in r.json()["error"]["message"]


def test_conversations_list_includes_family_without_a_phone(client):
    _person(client, name="Austin", phone=AUSTIN)
    _person(client, name="Sam", phone=None)
    listing = client.get("/api/messages/conversations").json()
    names = {c["name"]: c for c in listing["conversations"]}
    assert set(names) == {"Austin", "Sam"}
    assert names["Austin"]["phone"] == AUSTIN
    assert names["Austin"]["can_send"] is False
    assert names["Sam"]["phone"] is None
    assert names["Sam"]["can_send"] is False
    assert not any(c["unknown"] for c in listing["conversations"])

    _configure(client)
    listing = client.get("/api/messages/conversations").json()
    names = {c["name"]: c for c in listing["conversations"]}
    assert names["Austin"]["can_send"] is True
    assert names["Sam"]["can_send"] is False


def test_send_sms_is_mocked_and_stores_a_message(client, monkeypatch):
    _configure(client)
    person = _person(client)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "api.twilio.com"
        assert request.method == "POST"
        # Basic auth must be present, but the secret must not appear in our JSON later.
        assert request.headers.get("authorization")
        form = dict(httpx.QueryParams(request.content.decode()))
        assert form["To"] == AUSTIN
        assert form["From"] == FROM
        assert form["Body"] == "Dinner's ready"
        assert "MediaUrl" not in form
        return _json(
            request,
            {"sid": "SMout1", "status": "queued", "to": AUSTIN, "from": FROM, "body": form["Body"]},
            201,
        )

    _install(monkeypatch, handler)
    r = client.post("/api/messages", json={"user_id": person["id"], "body": "Dinner's ready"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["direction"] == "out"
    assert body["body"] == "Dinner's ready"
    assert body["status"] == "queued"
    assert body["phone"] == AUSTIN
    dumped = json.dumps(body)
    assert TOKEN not in dumped
    assert ACCOUNT not in dumped


def test_send_only_to_saved_family_and_caps_body(client, monkeypatch):
    _configure(client)
    person = _person(client)

    missing = client.post("/api/messages", json={"user_id": 9999, "body": "Hi"})
    assert missing.status_code == 404

    too_long = client.post("/api/messages", json={"user_id": person["id"], "body": "x" * 1001})
    assert too_long.status_code == 400

    # A number that is not saved on a person cannot be the destination of this API,
    # because the route takes a user_id, not a raw number.
    bare = _person(client, name="Sam", phone=None) if False else client.post(
        "/api/users", json={"name": "Sam"}
    ).json()
    r = client.post("/api/messages", json={"user_id": bare["id"], "body": "Hi"})
    assert r.status_code == 400


def test_send_mms_uploads_to_twilio_then_uses_that_url(client, monkeypatch, tmp_path):
    _configure(client)
    person = _person(client)
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        seen.append(f"{request.method} {url}")
        if request.url.host == "conversations.twilio.com" and request.method == "GET":
            return _json(request, {"services": []})
        if request.url.host == "conversations.twilio.com" and request.method == "POST":
            return _json(request, {"sid": "ISmediaservice", "friendly_name": "Mantel media"}, 201)
        if request.url.host == "mcs.us1.twilio.com":
            assert request.headers.get("content-type") == "image/png"
            assert request.content.startswith(b"\x89PNG")
            return _json(
                request,
                {
                    "sid": "MEdoodle",
                    "links": {"content_direct_temporary": MEDIA_URL},
                },
                201,
            )
        if request.url.path.endswith("/Messages.json") and request.method == "POST":
            form = dict(httpx.QueryParams(request.content.decode()))
            assert form["MediaUrl"] == MEDIA_URL
            assert sms.media_url_host_is_twilio(form["MediaUrl"])
            assert "10.0." not in form["MediaUrl"]
            assert "localhost" not in form["MediaUrl"]
            return _json(request, {"sid": "SMmms1", "status": "sending"}, 201)
        return _json(request, {"message": "unexpected " + url}, 500)

    _install(monkeypatch, handler)
    r = client.post(
        "/api/messages",
        json={"user_id": person["id"], "body": "For you", "media_base64": PNG_B64},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["media_url"] == f"/api/messages/{body['id']}/media"
    assert body["status"] == "sending"
    picture = client.get(body["media_url"])
    assert picture.status_code == 200
    assert picture.content.startswith(b"\x89PNG")
    assert any("mcs.us1.twilio.com" in item for item in seen)


def test_mms_falls_back_to_text_when_upload_fails(client, monkeypatch):
    _configure(client)
    person = _person(client)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "conversations.twilio.com":
            return _json(request, {"message": "Conversations is not available"}, 403)
        if request.url.path.endswith("/Messages.json") and request.method == "POST":
            form = dict(httpx.QueryParams(request.content.decode()))
            assert "MediaUrl" not in form
            assert "couldn't be sent as a picture" in form["Body"]
            return _json(request, {"sid": "SMtextonly", "status": "queued"}, 201)
        return _json(request, {"message": "nope"}, 500)

    _install(monkeypatch, handler)
    r = client.post(
        "/api/messages",
        json={"user_id": person["id"], "body": "Hi", "media_base64": PNG_B64},
    )
    assert r.status_code == 201, r.text
    # The wall still keeps the doodle locally so the thread can show it.
    assert r.json()["media_url"]
    dumped = json.dumps(client.get("/api/settings").json())
    assert TOKEN not in dumped
    assert ACCOUNT not in dumped
    assert "twilio_conversations_service_sid" not in dumped


def test_rate_limit(client, monkeypatch):
    _configure(client)
    person = _person(client)

    n = {"i": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        n["i"] += 1
        return _json(request, {"sid": f"SMx{n['i']}", "status": "queued"}, 201)

    _install(monkeypatch, handler)
    for i in range(20):
        r = client.post("/api/messages", json={"user_id": person["id"], "body": f"n{i}"})
        assert r.status_code == 201, r.text
    blocked = client.post("/api/messages", json={"user_id": person["id"], "body": "one more"})
    assert blocked.status_code == 429


def test_poll_inbound_stores_unknown_and_known_and_never_auto_replies(client, monkeypatch, db):
    _configure(client)
    person = _person(client)
    posts: list[str] = []
    inbound_png = _png_bytes((200, 40, 40))

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if request.method == "POST":
            posts.append(url)
        if request.url.path.endswith("/Messages.json") and request.method == "GET":
            return _json(
                request,
                {
                    "messages": [
                        {
                            "sid": "SMin-austin",
                            "direction": "inbound",
                            "from": AUSTIN,
                            "to": FROM,
                            "body": "On my way",
                            "status": "received",
                            "num_media": "0",
                            "date_sent": "Sun, 22 Nov 2026 18:01:00 +0000",
                        },
                        {
                            "sid": "SMin-stranger",
                            "direction": "inbound",
                            "from": STRANGER,
                            "to": FROM,
                            "body": "",
                            "status": "received",
                            "num_media": "1",
                            "date_sent": "Sun, 22 Nov 2026 18:02:00 +0000",
                        },
                    ]
                },
            )
        if "/Media.json" in request.url.path:
            return _json(
                request,
                {"media_list": [{"sid": "MEin1", "content_type": "image/png"}]},
            )
        if request.url.path.endswith("/Media/MEin1"):
            return httpx.Response(
                200, content=inbound_png, headers={"content-type": "image/png"}, request=request
            )
        if request.url.path.endswith(".json") and "/Messages/SM" in request.url.path:
            return _json(request, {"sid": "SMout", "status": "delivered"})
        return _json(request, {"messages": []})

    _install(monkeypatch, handler)
    added = sms.poll_once(db)
    assert added >= 2

    listing = client.get("/api/messages/conversations").json()
    names = [c["name"] for c in listing["conversations"]]
    assert "Austin" in names
    # Strangers are stored but hidden from the list and from direct lookup.
    assert "Unknown" not in names
    assert not any(c["unknown"] for c in listing["conversations"])
    digits = "".join(ch for ch in STRANGER if ch.isdigit())
    assert client.get(f"/api/messages/conversations/phone-{digits}").status_code == 404

    austin_thread = client.get(f"/api/messages/conversations/user-{person['id']}").json()
    assert austin_thread["messages"][0]["body"] == "On my way"
    assert austin_thread["can_send"] is True

    stranger_rows = list(db.scalars(select(FamilyMessage).where(FamilyMessage.phone == STRANGER)))
    assert stranger_rows and stranger_rows[0].media_path
    assert client.get(f"/api/messages/{stranger_rows[0].id}/media").status_code == 404

    # Polling again must not duplicate, and must never POST a reply.
    again = sms.poll_once(db)
    assert again == 0
    assert posts == []
    assert len(list(db.scalars(select(FamilyMessage)))) == 2
    dumped = json.dumps(listing)
    assert TOKEN not in dumped
    assert ACCOUNT not in dumped


def test_status_poll_updates_delivery(client, monkeypatch, db):
    _configure(client)
    person = _person(client)

    def send_handler(request: httpx.Request) -> httpx.Response:
        return _json(request, {"sid": "SMpending", "status": "queued"}, 201)

    _install(monkeypatch, send_handler)
    sent = client.post("/api/messages", json={"user_id": person["id"], "body": "Hi"}).json()
    assert sent["status"] == "queued"

    def status_handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/SMpending.json"):
            return _json(request, {"sid": "SMpending", "status": "delivered"})
        return _json(request, {"messages": []})

    _install(monkeypatch, status_handler)
    sms.poll_once(db)
    thread = client.get(f"/api/messages/conversations/user-{person['id']}").json()
    assert thread["messages"][-1]["status"] == "delivered"


def test_test_send_uses_first_member_with_a_phone(client, monkeypatch):
    _configure(client)
    client.post("/api/users", json={"name": "NoPhone"})
    person = _person(client)

    def handler(request: httpx.Request) -> httpx.Response:
        form = dict(httpx.QueryParams(request.content.decode()))
        assert form["To"] == AUSTIN
        assert "test message" in form["Body"].lower()
        return _json(request, {"sid": "SMtest", "status": "queued"}, 201)

    _install(monkeypatch, handler)
    r = client.post("/api/messages/test", json={})
    assert r.status_code == 201, r.text
    assert r.json()["user_id"] == person["id"]


def test_blank_send_rejected(client):
    _configure(client)
    person = _person(client)
    r = client.post("/api/messages", json={"user_id": person["id"], "body": "   "})
    assert r.status_code == 400

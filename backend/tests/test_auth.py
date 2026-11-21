"""Device-token auth.

The rest of the suite runs with AUTH_MODE=off so a test client, which has no
real address, can keep calling the API. These cases turn the gate back on and
speak from chosen addresses.
"""

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import SessionLocal
from app.main import app
from app.models import Device
from app.services.auth import clear_failures, hash_token


@pytest.fixture
def locked(monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "lan")
    monkeypatch.setenv("AUTH_TRUSTED_CIDRS", "")
    monkeypatch.setenv("AUTH_TRUST_PROXY", "false")
    get_settings.cache_clear()
    clear_failures()
    yield
    clear_failures()
    get_settings.cache_clear()


def call(host: str, method: str, path: str, **kwargs):
    # Not a context manager: entering one runs the app lifespan again, and a
    # second scheduler would steal the loops the fixture's client already started.
    # The transport sends the request either way. `client` is the source address.
    tester = TestClient(app, client=(host, 50000))
    try:
        return tester.request(method, path, **kwargs)
    finally:
        tester.close()


def test_health_and_version_stay_public(client, locked):
    for path in ("/api/health", "/api/version"):
        response = call("1.2.3.4", "GET", path)
        assert response.status_code == 200, path


def test_google_callback_is_not_blocked_by_the_gate(client, locked):
    """Google's redirect cannot carry a bearer token. A missing code is a 400
    from the handler, which is how we know the gate let it through."""
    response = call("1.2.3.4", "GET", "/api/accounts/google/callback")
    assert response.status_code != 401


def test_the_open_internet_is_rejected(client, locked):
    response = call("1.2.3.4", "GET", "/api/users")
    assert response.status_code == 401
    body = response.json()
    assert body["error"]["code"] == "unauthorized"
    assert response.headers["www-authenticate"].startswith("Bearer")


def test_the_home_lan_and_loopback_need_no_token(client, locked):
    # 192.168.1.20 is a phone on the wifi. 172.17.0.1 is what the Pi's browser
    # looks like from inside the container, via Docker's bridge. Both are the
    # kiosk case: nobody should have to log in.
    for host in ("192.168.1.20", "172.17.0.1", "127.0.0.1", "::1"):
        response = call(host, "GET", "/api/users")
        assert response.status_code == 200, host


def test_local_mode_trusts_only_loopback(client, monkeypatch, locked):
    monkeypatch.setenv("AUTH_MODE", "local")
    get_settings.cache_clear()
    assert call("127.0.0.1", "GET", "/api/users").status_code == 200
    assert call("192.168.1.20", "GET", "/api/users").status_code == 401
    assert call("172.17.0.1", "GET", "/api/users").status_code == 401


def test_an_extra_cidr_is_trusted(client, monkeypatch, locked):
    monkeypatch.setenv("AUTH_MODE", "token")
    monkeypatch.setenv("AUTH_TRUSTED_CIDRS", "100.64.0.0/10")
    get_settings.cache_clear()
    assert call("100.64.1.5", "GET", "/api/users").status_code == 200
    assert call("192.168.1.20", "GET", "/api/users").status_code == 401


def test_forwarded_for_is_ignored_unless_asked(client, monkeypatch, locked):
    headers = {"X-Forwarded-For": "192.168.1.20"}
    assert call("1.2.3.4", "GET", "/api/users", headers=headers).status_code == 401
    monkeypatch.setenv("AUTH_TRUST_PROXY", "true")
    get_settings.cache_clear()
    assert call("1.2.3.4", "GET", "/api/users", headers=headers).status_code == 200


def test_pairing_a_phone_and_revoking_it(client, locked):
    minted = call(
        "192.168.1.20",
        "POST",
        "/api/auth/pairing-codes",
        params={"base_url": "http://192.168.1.20:8080"},
    )
    assert minted.status_code == 200, minted.text
    body = minted.json()
    assert len(body["code"].replace("-", "")) == 8
    assert body["qr_payload"].startswith("mantel://pair?v=1&base=")
    assert body["qr_svg"].startswith("<svg")
    assert "192.168.1.20" in body["qr_payload"]

    # The internet cannot mint codes, and cannot read the calendar yet.
    assert call("1.2.3.4", "POST", "/api/auth/pairing-codes").status_code == 401

    paired = call(
        "1.2.3.4",
        "POST",
        "/api/auth/pair",
        json={"code": body["code"].replace("-", ""), "name": "Matt's iPhone"},
    )
    assert paired.status_code == 201, paired.text
    token = paired.json()["token"]
    assert token.startswith("mantel_")
    device_id = paired.json()["device"]["id"]

    # The plaintext is not what the database holds.
    with SessionLocal() as db:
        stored = db.get(Device, device_id)
        assert stored.token_hash == hash_token(token)
        assert stored.token_hash != token
        assert token.startswith(stored.token_prefix)

    alone = call("1.2.3.4", "GET", "/api/users")
    assert alone.status_code == 401
    authed = call(
        "1.2.3.4",
        "GET",
        "/api/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert authed.status_code == 200

    # <img> cannot set a header. The query form is how screensaver photos load
    # for a paired browser. Same token, same door.
    via_query = call("1.2.3.4", "GET", "/api/users", params={"access_token": token})
    assert via_query.status_code == 200

    # The code does not work twice.
    again = call(
        "1.2.3.4",
        "POST",
        "/api/auth/pair",
        json={"code": body["code"], "name": "Second"},
    )
    assert again.status_code == 401

    listed = call("192.168.1.20", "GET", "/api/auth/devices").json()
    assert listed[0]["name"] == "Matt's iPhone"
    assert "token" not in listed[0]
    assert listed[0]["token_prefix"] == token[:12]

    revoked = call("192.168.1.20", "DELETE", f"/api/auth/devices/{device_id}")
    assert revoked.status_code == 204
    after = call(
        "1.2.3.4",
        "GET",
        "/api/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert after.status_code == 401


def test_a_stale_token_does_not_lock_the_kiosk_out(client, locked):
    response = call(
        "192.168.1.20",
        "GET",
        "/api/users",
        headers={"Authorization": "Bearer mantel_not-a-real-token"},
    )
    assert response.status_code == 200


def test_feed_urls_keep_working_without_a_device_token(client, locked):
    from app.services.crypto import feed_token

    missing = call("1.2.3.4", "GET", "/api/feeds/all.ics")
    assert missing.status_code == 422  # the feed token is required; the gate is not
    ok = call("1.2.3.4", "GET", "/api/feeds/all.ics", params={"token": feed_token()})
    assert ok.status_code == 200
    secret = call("1.2.3.4", "GET", "/api/feeds/token")
    assert secret.status_code == 401


def test_openapi_documents_the_scheme(client, locked):
    schema = call("1.2.3.4", "GET", "/api/openapi.json").json()
    assert "DeviceToken" in schema["components"]["securitySchemes"]
    assert schema["paths"]["/api/health"]["get"]["security"] == []
    assert schema["paths"]["/api/auth/pair"]["post"]["security"] == []
    assert schema["paths"]["/api/users"]["get"]["security"] == [{"DeviceToken": []}]
    assert schema["paths"]["/api/feeds/all.ics"]["get"]["security"] == []


def test_status_tells_a_phone_whether_it_needs_to_pair(client, locked):
    home = call("192.168.1.20", "GET", "/api/auth/status").json()
    assert home["network_trusted"] is True
    assert home["authorization_required"] is False
    away = call("1.2.3.4", "GET", "/api/auth/status").json()
    assert away["auth_mode"] == "lan"
    assert away["authorization_required"] is True


def test_wrong_codes_are_rate_limited(client, locked):
    for _ in range(8):
        response = call("1.2.3.8", "POST", "/api/auth/pair", json={"code": "AAAA-AAAA"})
        assert response.status_code == 401
    blocked = call("1.2.3.8", "POST", "/api/auth/pair", json={"code": "AAAA-AAAA"})
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "rate_limited"
    # A different address is not caught in the same net.
    other = call("1.2.3.9", "POST", "/api/auth/pair", json={"code": "AAAA-AAAA"})
    assert other.status_code == 401


def test_an_expired_pairing_code_is_refused_even_with_a_stale_token(client, locked):
    """A code past its ten minutes is not a credential. A revoked bearer must
    not turn the public pair route into the generic "needs a device token"
    401 — the phone is here because it has no working token."""
    from datetime import timedelta

    from app.models import PairingCode, utcnow
    from app.services.auth import hash_code, normalize_code

    code = "K7NQ4RMP"
    with SessionLocal() as db:
        db.add(
            PairingCode(
                code_hash=hash_code(normalize_code(code)),
                expires_at=utcnow() - timedelta(minutes=1),
            )
        )
        db.commit()
    refused = call(
        "1.2.3.4",
        "POST",
        "/api/auth/pair",
        json={"code": "K7NQ-4RMP", "name": "Phone"},
        headers={"Authorization": "Bearer mantel_not-a-real-token"},
    )
    assert refused.status_code == 401, refused.text
    message = refused.json()["error"]["message"].lower()
    assert "expired" in message
    assert "device token" not in message


def test_a_paired_phone_can_pair_a_tv_without_going_to_the_wall(client, locked):
    """The phone app's "Pair a TV": a phone away from home, holding only its own token,
    shows a code that a TV elsewhere exchanges for a token of its own."""
    first = call("192.168.1.20", "POST", "/api/auth/pairing-codes").json()
    phone = call(
        "1.2.3.4", "POST", "/api/auth/pair", json={"code": first["code"], "name": "Matt's phone"}
    ).json()["token"]
    headers = {"Authorization": f"Bearer {phone}"}

    minted = call(
        "1.2.3.4",
        "POST",
        "/api/auth/pairing-codes",
        params={"base_url": "http://10.0.15.178:8080"},
        headers=headers,
    )
    assert minted.status_code == 200, minted.text
    # No token, no code.
    assert call("1.2.3.4", "POST", "/api/auth/pairing-codes").status_code == 401

    tv = call(
        "5.6.7.8",
        "POST",
        "/api/auth/pair",
        json={"code": minted.json()["code"], "name": "Living room TV"},
    )
    assert tv.status_code == 201, tv.text
    tv_token = tv.json()["token"]
    assert tv_token != phone
    tv_headers = {"Authorization": f"Bearer {tv_token}"}
    assert call("5.6.7.8", "GET", "/api/users", headers=tv_headers).status_code == 200

    # The phone can also set up Home control, and never gets the token back.
    saved = call(
        "1.2.3.4",
        "PATCH",
        "/api/settings",
        json={"ha_base_url": "http://ha:8123", "ha_token": "secret-ha-token"},
        headers=headers,
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["server"]["ha_token_set"] is True
    assert "secret-ha-token" not in saved.text
    assert "secret-ha-token" not in call("1.2.3.4", "GET", "/api/settings", headers=headers).text

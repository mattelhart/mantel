"""The change stream.

Screens used to wait on a poll. These pin the two properties that make the
stream safe to leave open: an address that cannot call the API cannot listen,
and a commit shows up as a notice for just the area that changed.
"""

import json

from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.models import Event
from app.services.auth import clear_failures
from app.services.live import hub


def _read_until(response, predicate, limit=40) -> str:
    body = []
    for line in response.iter_lines():
        body.append(line)
        if predicate("\n".join(body)):
            break
        if len(body) >= limit:
            break
    return "\n".join(body)


def _event(client, calendar_id, title="Dentist"):
    created = client.post(
        "/api/events",
        json={
            "calendar_id": calendar_id,
            "title": title,
            "start_at": "2026-11-16T15:00:00Z",
            "end_at": "2026-11-16T16:00:00Z",
        },
    )
    assert created.status_code == 201, created.text
    hub.flush()
    return created.json()


def test_creating_an_event_is_delivered_on_the_stream(client, local_calendar):
    hub.flush()
    before = hub.latest_id
    _event(client, local_calendar["id"])
    with client.stream(
        "GET",
        "/api/live",
        headers={"Last-Event-ID": str(before)},
        timeout=5,
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        body = _read_until(response, lambda text: '"topics"' in text)
    assert "event: change" in body
    data_line = next(line for line in body.splitlines() if line.startswith("data:"))
    payload = json.loads(data_line.removeprefix("data:"))
    assert "events" in payload["topics"]


def test_checking_a_chore_notifies_chores_and_not_the_calendar(client):
    person = client.post("/api/users", json={"name": "Sam"}).json()
    chore = client.post(
        "/api/chores",
        json={"title": "Make bed", "assignee_ids": [person["id"]], "points": 2},
    ).json()
    hub.flush()
    before = hub.latest_id
    done = client.post(
        f"/api/chores/{chore['id']}/complete",
        json={"user_id": person["id"], "on": "2026-11-15", "done": True, "request_id": "live-1"},
    )
    assert done.status_code == 200, done.text
    hub.flush()
    with client.stream(
        "GET", "/api/live", headers={"Last-Event-ID": str(before)}, timeout=5
    ) as response:
        body = _read_until(response, lambda text: '"chores"' in text)
    assert '"chores"' in body
    assert "events" not in body.split("event: hello")[0]


def test_a_missed_id_from_another_process_asks_for_a_resync(client):
    with client.stream(
        "GET", "/api/live", headers={"Last-Event-ID": "999999"}, timeout=5
    ) as response:
        body = _read_until(response, lambda text: "event: resync" in text or "event: hello" in text)
    assert "event: resync" in body


def test_clearing_checked_items_is_announced_even_though_it_is_a_bulk_delete(client):
    """The shop-is-done button deletes rows in one statement, not through the
    identity map. A listener that only watched session.deleted would miss it
    and the other screen would keep the ticked milk."""
    created = client.post("/api/lists", json={"name": "Groceries"}).json()
    item = client.post(f"/api/lists/{created['id']}/items", json={"text": "Milk"}).json()
    client.patch(f"/api/lists/{created['id']}/items/{item['id']}", json={"checked": True})
    hub.flush()
    before = hub.latest_id
    cleared = client.post(f"/api/lists/{created['id']}/clear-checked")
    assert cleared.status_code == 200, cleared.text
    hub.flush()
    with client.stream(
        "GET", "/api/live", headers={"Last-Event-ID": str(before)}, timeout=5
    ) as response:
        body = _read_until(response, lambda text: "lists" in text)
    assert "lists" in body


def test_a_rolled_back_write_is_not_announced(client, db, local_calendar):
    from datetime import datetime

    hub.flush()
    before = hub.latest_id
    db.add(
        Event(
            calendar_id=local_calendar["id"],
            title="Nope",
            start_at=datetime(2026, 11, 16, 15, 0),
            end_at=datetime(2026, 11, 16, 16, 0),
            origin="local",
        )
    )
    db.flush()
    db.rollback()
    hub.flush()
    assert hub.latest_id == before


def test_the_open_internet_cannot_listen(client, monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "lan")
    monkeypatch.setenv("AUTH_TRUSTED_CIDRS", "")
    monkeypatch.setenv("AUTH_TRUST_PROXY", "false")
    get_settings.cache_clear()
    clear_failures()
    try:
        outsider = TestClient(app, client=("1.2.3.4", 50000))
        denied = outsider.get("/api/live")
        assert denied.status_code == 401
        assert denied.json()["error"]["code"] == "unauthorized"
        outsider.close()

        home = TestClient(app, client=("192.168.1.20", 50000))
        with home.stream("GET", "/api/live", timeout=5) as response:
            assert response.status_code == 200
            body = _read_until(response, lambda text: "event: hello" in text)
        assert "event: hello" in body
        home.close()
    finally:
        clear_failures()
        get_settings.cache_clear()


def test_a_device_token_can_listen_from_outside_the_lan(client, monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "lan")
    monkeypatch.setenv("AUTH_TRUSTED_CIDRS", "")
    monkeypatch.setenv("AUTH_TRUST_PROXY", "false")
    get_settings.cache_clear()
    clear_failures()
    try:
        wall = TestClient(app, client=("192.168.1.20", 50000))
        minted = wall.post("/api/auth/pairing-codes")
        assert minted.status_code == 200, minted.text
        paired = TestClient(app, client=("1.2.3.4", 50000)).post(
            "/api/auth/pair",
            json={"code": minted.json()["code"], "name": "Living room TV"},
        )
        assert paired.status_code == 201, paired.text
        token = paired.json()["token"]

        phone = TestClient(app, client=("1.2.3.4", 50000))
        alone = phone.get("/api/live")
        assert alone.status_code == 401
        with phone.stream(
            "GET",
            "/api/live",
            headers={"Authorization": f"Bearer {token}"},
            timeout=5,
        ) as response:
            assert response.status_code == 200
            body = _read_until(response, lambda text: "event: hello" in text)
        assert "event: hello" in body
        # A client that cannot set a header (nothing on the TV does this today)
        # is still the same credential the photo URLs already accept.
        with phone.stream(
            "GET", "/api/live", params={"access_token": token}, timeout=5
        ) as response:
            assert response.status_code == 200
        phone.close()
        wall.close()
    finally:
        clear_failures()
        get_settings.cache_clear()

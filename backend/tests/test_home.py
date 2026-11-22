"""Home control through Home Assistant, against a pretend HA (tests/fake_ha.py).

What matters: the token never leaves the server, a bad URL or token says so plainly,
only controllable things appear, locks cannot be driven without a yes, and a change at a
wall switch reaches the stream.
"""

import json
import time

import pytest
from sqlalchemy import select

from app.models import AppSetting
from app.services import ha_home
from tests.fake_ha import AREAS, DEVICES, ENTITIES, TOKEN, FakeHA, default_states


@pytest.fixture
def ha():
    fake = FakeHA().start()
    yield fake
    fake.stop()


@pytest.fixture(autouse=True)
def _fresh_stream():
    yield
    import asyncio

    # The stream belongs to whichever event loop started it; each test gets its own.
    ha_home.stream._subs.clear()
    ha_home.stream._task = None
    ha_home.stream.status = {"status": "connecting", "message": ""}
    del asyncio


def connect(client, ha, token=TOKEN):
    r = client.patch("/api/settings", json={"ha_base_url": ha.url, "ha_token": token})
    assert r.status_code == 200, r.text
    return r.json()


def entity(home, entity_id):
    for room in home["rooms"]:
        for e in room["entities"]:
            if e["entity_id"] == entity_id:
                return e
    for a in home["actions"]:
        if a["entity_id"] == entity_id:
            return a
    raise AssertionError(f"{entity_id} not in snapshot")


# ------------------------------------------------------------------ snapshot shaping (pure)


def snapshot():
    return ha_home.build_snapshot(default_states(), AREAS, DEVICES, ENTITIES)


def test_rooms_are_named_areas_alphabetical_with_other_last():
    names = [r["name"] for r in snapshot()["rooms"]]
    assert names == ["Bedroom", "Kitchen", "Living Room", "Other"]


def test_only_controllable_things_appear():
    snap = snapshot()
    ids = {e["entity_id"] for r in snap["rooms"] for e in r["entities"]} | {
        a["entity_id"] for a in snap["actions"]
    }
    assert "sensor.cpu" not in ids and "event.pico_button" not in ids
    assert "light.old_bulb" not in ids  # disabled in the registry
    assert "light.bridge_identify" not in ids  # config entity
    assert {
        "light.living_room_lamp",
        "fan.bedroom_fan",
        "cover.den_shade",
        "lock.front_door",
        "media_player.living_room_tv",
    } <= ids


def test_area_comes_from_the_device_when_the_entity_has_none():
    living = next(r for r in snapshot()["rooms"] if r["name"] == "Living Room")
    assert "cover.den_shade" in {e["entity_id"] for e in living["entities"]}


def test_scenes_and_scripts_are_the_action_row_not_tiles():
    snap = snapshot()
    assert [a["name"] for a in snap["actions"]] == ["Goodnight", "Movie Night"]
    tiles = {e["entity_id"] for r in snap["rooms"] for e in r["entities"]}
    assert "scene.movie_night" not in tiles


def test_room_name_is_dropped_from_a_tile_inside_that_room():
    living = next(r for r in snapshot()["rooms"] if r["name"] == "Living Room")
    assert "Lamp" in {e["name"] for e in living["entities"]}


def test_levels_and_adjustability():
    snap = {e["entity_id"]: e for r in snapshot()["rooms"] for e in r["entities"]}
    assert (
        snap["light.living_room_lamp"]["level"] == 50
        and snap["light.living_room_lamp"]["adjustable"]
    )
    assert (
        snap["light.kitchen_pendant"]["on"] is False and snap["light.kitchen_pendant"]["level"] == 0
    )
    assert snap["light.hall_switch"]["adjustable"] is False  # on/off only
    assert snap["fan.bedroom_fan"]["level"] == 66 and snap["fan.bedroom_fan"]["adjustable"]
    assert snap["cover.den_shade"]["level"] == 80
    assert snap["lock.front_door"]["on"] is False  # locked
    assert snap["climate.upstairs"]["attrs"]["temperature"] == 70


def test_unavailable_devices_are_marked():
    states = [
        {"entity_id": "light.x", "state": "unavailable", "attributes": {"friendly_name": "X"}}
    ]
    out = ha_home.build_snapshot(states, [], [], [])
    assert out["rooms"][0]["entities"][0]["available"] is False


def test_a_tv_is_a_tile_with_its_volume_source_and_what_it_can_do():
    tv = next(
        e for r in snapshot()["rooms"] for e in r["entities"] if e["domain"] == "media_player"
    )
    assert tv["name"] == "TV" and tv["on"] is True and tv["available"] is True
    assert tv["level"] == 25 and tv["adjustable"] is True
    assert tv["attrs"] == {
        "can_power": True,
        "can_volume_step": True,
        "can_mute": True,
        "can_source": True,
        "muted": False,
        "source": "HDMI1",
        "sources": ["HDMI1", "HDMI2", "Netflix"],
    }


@pytest.mark.parametrize(
    ("state", "on"),
    [("on", True), ("playing", True), ("paused", True), ("idle", True)]
    + [("off", False), ("standby", False), ("unavailable", False)],
)
def test_a_tv_that_is_asleep_reads_as_off(state, on):
    out = ha_home.dynamic_fields(
        {"entity_id": "media_player.tv", "state": state, "attributes": {"supported_features": 384}}
    )
    assert out["on"] is on and out["available"] is (state != "unavailable")


def test_a_tv_with_no_volume_or_source_controls_does_not_offer_them():
    states = [
        {
            "entity_id": "media_player.bare",
            "state": "off",
            "attributes": {"friendly_name": "Bare", "supported_features": 0},
        }
    ]
    tv = ha_home.build_snapshot(states, [], [], [])["rooms"][0]["entities"][0]
    assert tv["adjustable"] is False and tv["level"] is None
    assert tv["attrs"] == {
        "can_power": False,
        "can_volume_step": False,
        "can_mute": False,
        "can_source": False,
    }


def test_a_live_update_from_a_sleeping_tv_does_not_blank_its_inputs():
    asleep = ha_home.dynamic_fields(
        {
            "entity_id": "media_player.tv",
            "state": "off",
            "attributes": {"supported_features": 2048 | 256},
        }
    )
    assert "sources" not in asleep["attrs"] and "source" not in asleep["attrs"]


def test_tiles_in_a_room_run_lights_then_fans_then_tvs_then_locks():
    living = next(r for r in snapshot()["rooms"] if r["name"] == "Living Room")
    order = [e["domain"] for e in living["entities"]]
    assert order.index("light") < order.index("cover") < order.index("media_player")


# ------------------------------------------------------------------ GET /api/home


def test_not_configured_says_so(client):
    body = client.get("/api/home").json()
    assert body["status"] == "not_configured"
    assert body["rooms"] == [] and body["message"]


def test_lists_rooms_from_home_assistant(client, ha):
    connect(client, ha)
    body = client.get("/api/home").json()
    assert body["status"] == "ok"
    assert [r["name"] for r in body["rooms"]] == ["Bedroom", "Kitchen", "Living Room", "Other"]
    assert entity(body, "light.living_room_lamp")["on"] is True
    assert entity(body, "scene.movie_night")["domain"] == "scene"


def test_rejected_token_is_reported(client, ha):
    connect(client, ha, token="not-the-token")
    body = client.get("/api/home").json()
    assert body["status"] == "invalid_token"
    assert "token" in body["message"].lower()


def test_unreachable_home_assistant_is_reported(client):
    client.patch("/api/settings", json={"ha_base_url": "http://127.0.0.1:9", "ha_token": "t"})
    body = client.get("/api/home").json()
    assert body["status"] == "unreachable"
    assert "reach" in body["message"].lower()


# ------------------------------------------------------------------ the token stays on the server


def test_token_is_never_returned_and_is_encrypted_at_rest(client, ha, db):
    settings = connect(client, ha)
    assert settings["ha_token"] == ""
    assert settings["server"]["ha_token_set"] is True
    stored = db.scalar(select(AppSetting).where(AppSetting.key == "ha_token")).value["value"]
    assert stored.startswith("enc:v1:") and TOKEN not in stored
    everything = json.dumps(
        [client.get(p).json() for p in ("/api/settings", "/api/home")]
        + [client.post("/api/home/test").json()]
    )
    assert TOKEN not in everything


def test_blank_token_leaves_the_saved_one_and_null_clears_it(client, ha):
    connect(client, ha)
    client.patch("/api/settings", json={"ha_token": ""})
    assert client.get("/api/home").json()["status"] == "ok"
    out = client.patch("/api/settings", json={"ha_token": None}).json()
    assert out["server"]["ha_token_set"] is False
    assert client.get("/api/home").json()["status"] == "not_configured"


def test_a_token_saved_before_encryption_still_works(client, ha, db):
    client.patch("/api/settings", json={"ha_base_url": ha.url})
    row = db.get(AppSetting, "ha_token")
    row.value = {"value": TOKEN}  # how older Mantel stored it
    db.commit()
    assert client.get("/api/home").json()["status"] == "ok"


def test_address_gets_a_scheme_and_junk_is_refused(client):
    out = client.patch("/api/settings", json={"ha_base_url": "homeassistant.local:8123/"}).json()
    assert out["ha_base_url"] == "http://homeassistant.local:8123"
    bad = client.patch("/api/settings", json={"ha_base_url": "ftp://nope"})
    assert bad.status_code == 400


def test_favorites_and_hidden_are_lists_of_device_ids(client):
    ok = client.patch(
        "/api/settings",
        json={"home_favorites": ["light.a", "light.a", "fan.b"], "home_hidden": ["switch.c"]},
    ).json()
    assert ok["home_favorites"] == ["light.a", "fan.b"]  # de-duplicated, order kept
    assert ok["home_hidden"] == ["switch.c"]
    assert client.patch("/api/settings", json={"home_favorites": "light.a"}).status_code == 400
    assert client.patch("/api/settings", json={"home_hidden": [1]}).status_code == 400


def test_home_layout_is_saved_for_every_screen_and_defaults_to_nothing_chosen(client):
    first = client.get("/api/settings").json()["home_layout"]
    assert first == {"rooms": [], "hidden_rooms": [], "wide_rooms": [], "devices": {}, "scenes": []}
    layout = {
        "rooms": ["kitchen", "living_room", "kitchen"],
        "hidden_rooms": ["other"],
        "wide_rooms": ["living_room"],
        "devices": {"living_room": ["media_player.living_room_tv", "light.living_room_lamp"]},
        "scenes": ["script.goodnight", "scene.movie_night"],
    }
    out = client.patch("/api/settings", json={"home_layout": layout}).json()["home_layout"]
    assert out["rooms"] == ["kitchen", "living_room"]  # de-duplicated, order kept
    assert out["devices"]["living_room"][0] == "media_player.living_room_tv"
    assert out["scenes"] == ["script.goodnight", "scene.movie_night"]
    # A second client sees the same thing, and it survives other settings changing.
    client.patch("/api/settings", json={"theme": "midnight"})
    assert client.get("/api/settings").json()["home_layout"] == out


def test_home_layout_fills_in_what_was_left_out_and_can_be_reset(client):
    client.patch("/api/settings", json={"home_layout": {"rooms": ["kitchen"]}})
    got = client.get("/api/settings").json()["home_layout"]
    assert got["rooms"] == ["kitchen"] and got["devices"] == {} and got["scenes"] == []
    empty = {"rooms": [], "hidden_rooms": [], "wide_rooms": [], "devices": {}, "scenes": []}
    reset = client.patch("/api/settings", json={"home_layout": empty}).json()
    assert reset["home_layout"]["rooms"] == []


@pytest.mark.parametrize(
    "bad",
    [
        "kitchen",
        ["kitchen"],
        {"rooms": "kitchen"},
        {"rooms": [1]},
        {"rooms": [""]},
        {"rooms": ["x" * 200]},
        {"rooms": [f"r{i}" for i in range(1001)]},
        {"devices": ["light.a"]},
        {"devices": {"den": "light.a"}},
        {"devices": {"den": [3]}},
        {"devices": {f"r{i}": [] for i in range(201)}},
        {"colour": "red"},
    ],
)
def test_a_malformed_home_layout_is_refused_and_changes_nothing(client, bad):
    client.patch("/api/settings", json={"home_layout": {"rooms": ["kitchen"]}})
    assert client.patch("/api/settings", json={"home_layout": bad}).status_code == 400
    assert client.get("/api/settings").json()["home_layout"]["rooms"] == ["kitchen"]


def test_the_layout_never_touches_hidden_devices(client):
    client.patch("/api/settings", json={"home_hidden": ["light.a"]})
    client.patch("/api/settings", json={"home_layout": {"rooms": ["den"]}})
    assert client.get("/api/settings").json()["home_hidden"] == ["light.a"]


# ------------------------------------------------------------------ connection test


def test_connection_test_messages(client, ha):
    out = client.post("/api/home/test").json()
    assert out["ok"] is False and out["status"] == "not_configured"

    connect(client, ha, token="wrong")
    out = client.post("/api/home/test").json()
    assert (out["ok"], out["status"]) == (False, "invalid_token")

    connect(client, ha)
    out = client.post("/api/home/test").json()
    assert out["ok"] is True and "Connected" in out["message"] and "4 rooms" in out["message"]

    client.patch("/api/settings", json={"ha_base_url": "http://127.0.0.1:9"})
    out = client.post("/api/home/test").json()
    assert (out["ok"], out["status"]) == (False, "unreachable")


# ------------------------------------------------------------------ actions


def act(client, entity_id, action, **extra):
    return client.post(f"/api/home/entities/{entity_id}/action", json={"action": action, **extra})


@pytest.mark.parametrize(
    ("entity_id", "action", "extra", "service", "data"),
    [
        ("light.living_room_lamp", "turn_off", {}, ("light", "turn_off"), {}),
        ("light.kitchen_pendant", "turn_on", {}, ("light", "turn_on"), {}),
        ("light.kitchen_pendant", "toggle", {}, ("light", "toggle"), {}),
        (
            "light.living_room_lamp",
            "set_level",
            {"value": 40},
            ("light", "turn_on"),
            {"brightness_pct": 40},
        ),
        ("light.living_room_lamp", "set_level", {"value": 0}, ("light", "turn_off"), {}),
        ("switch.porch", "toggle", {}, ("switch", "toggle"), {}),
        (
            "fan.bedroom_fan",
            "set_level",
            {"value": 33},
            ("fan", "set_percentage"),
            {"percentage": 33},
        ),
        ("cover.den_shade", "open", {}, ("cover", "open_cover"), {}),
        ("cover.den_shade", "close", {}, ("cover", "close_cover"), {}),
        ("cover.den_shade", "stop", {}, ("cover", "stop_cover"), {}),
        (
            "cover.den_shade",
            "set_level",
            {"value": 25},
            ("cover", "set_cover_position"),
            {"position": 25},
        ),
        ("media_player.living_room_tv", "turn_off", {}, ("media_player", "turn_off"), {}),
        ("media_player.living_room_tv", "turn_on", {}, ("media_player", "turn_on"), {}),
        ("media_player.living_room_tv", "volume_up", {}, ("media_player", "volume_up"), {}),
        ("media_player.living_room_tv", "volume_down", {}, ("media_player", "volume_down"), {}),
        (
            "media_player.living_room_tv",
            "mute",
            {},
            ("media_player", "volume_mute"),
            {"is_volume_muted": True},
        ),
        (
            "media_player.living_room_tv",
            "unmute",
            {},
            ("media_player", "volume_mute"),
            {"is_volume_muted": False},
        ),
        (
            "media_player.living_room_tv",
            "set_level",
            {"value": 40},
            ("media_player", "volume_set"),
            {"volume_level": 0.4},
        ),
        (
            "media_player.living_room_tv",
            "select_source",
            {"value": "HDMI2"},
            ("media_player", "select_source"),
            {"source": "HDMI2"},
        ),
        ("scene.movie_night", "activate", {}, ("scene", "turn_on"), {}),
        ("script.goodnight", "activate", {}, ("script", "turn_on"), {}),
        (
            "climate.upstairs",
            "set_temperature",
            {"value": 71},
            ("climate", "set_temperature"),
            {"temperature": 71},
        ),
        (
            "climate.upstairs",
            "set_hvac_mode",
            {"value": "cool"},
            ("climate", "set_hvac_mode"),
            {"hvac_mode": "cool"},
        ),
    ],
)
def test_actions_become_service_calls(client, ha, entity_id, action, extra, service, data):
    connect(client, ha)
    assert act(client, entity_id, action, **extra).status_code == 200
    domain, name, sent = ha.calls[-1]
    assert (domain, name) == service
    assert sent == {"entity_id": entity_id, **data}


def test_locks_need_a_confirmation(client, ha):
    connect(client, ha)
    refused = act(client, "lock.front_door", "unlock")
    assert refused.status_code == 400
    assert refused.json()["error"]["code"] == "confirmation_required"
    assert ha.calls == []
    assert act(client, "lock.front_door", "unlock", confirm=True).status_code == 200
    assert ha.calls[-1][:2] == ("lock", "unlock")
    assert act(client, "lock.front_door", "toggle", confirm=True).status_code == 400  # no such verb


@pytest.mark.parametrize(
    ("entity_id", "action", "extra"),
    [
        ("sensor.cpu", "turn_on", {}),  # not a control
        ("light.living_room_lamp", "format_disk", {}),
        ("light.living_room_lamp", "set_level", {"value": 101}),
        ("light.living_room_lamp", "set_level", {"value": "bright"}),
        ("climate.upstairs", "set_hvac_mode", {"value": "melt"}),
        ("climate.upstairs", "set_temperature", {"value": 900}),
        ("scene.movie_night", "turn_off", {}),
        ("media_player.living_room_tv", "select_source", {}),
        ("media_player.living_room_tv", "select_source", {"value": 5}),
        ("media_player.living_room_tv", "select_source", {"value": "x" * 200}),
        ("media_player.living_room_tv", "set_level", {"value": 101}),
        ("media_player.living_room_tv", "play_media", {"value": "http://x"}),
        ("light.living_room_lamp", "mute", {}),
        ("light.bad id", "turn_on", {}),
    ],
)
def test_nonsense_is_refused_without_calling_home_assistant(client, ha, entity_id, action, extra):
    connect(client, ha)
    assert act(client, entity_id, action, **extra).status_code == 400
    assert ha.calls == []


def test_action_failures_are_explained(client, ha):
    assert act(client, "light.living_room_lamp", "turn_on").status_code == 409  # not set up
    connect(client, ha)
    ha.reject_services = True
    bad = act(client, "light.living_room_lamp", "turn_on")
    assert bad.status_code == 502 and bad.json()["error"]["code"] == "error"
    connect(client, ha, token="wrong")
    ha.reject_services = False
    wrong = act(client, "light.living_room_lamp", "turn_on")
    assert wrong.status_code == 502 and wrong.json()["error"]["code"] == "invalid_token"
    client.patch("/api/settings", json={"ha_base_url": "http://127.0.0.1:9"})
    gone = act(client, "light.living_room_lamp", "turn_on")
    assert gone.status_code == 502 and gone.json()["error"]["code"] == "unreachable"


# ------------------------------------------------------------------ live stream


_iterators: dict[int, object] = {}


def read_events(response, want, limit=60):
    """Collect SSE frames until `want(frames)` is true (keeps its place between calls)."""
    lines = _iterators.setdefault(id(response), response.iter_lines())
    frames, block = [], []
    for line in lines:
        if line:
            block.append(line)
            continue
        if block:
            fields = dict(item.split(": ", 1) for item in block if ": " in item)
            if "event" in fields:
                frames.append((fields["event"], json.loads(fields.get("data", "{}"))))
            block = []
            if want(frames) or len(frames) >= limit:
                break
    return frames


def has(frames, event, pred=lambda d: True):
    return any(e == event and pred(d) for e, d in frames)


def test_stream_says_not_configured(client):
    with client.stream("GET", "/api/home/live", timeout=10) as response:
        assert response.headers["content-type"].startswith("text/event-stream")
        frames = read_events(
            response, lambda f: has(f, "status", lambda d: d["status"] == "not_configured")
        )
    assert has(frames, "status", lambda d: d["status"] == "not_configured")


def test_stream_relays_a_wall_switch_and_registry_changes(client, ha):
    connect(client, ha)
    with client.stream("GET", "/api/home/live", timeout=10) as response:
        frames = read_events(response, lambda f: has(f, "status", lambda d: d["status"] == "ok"))
        assert has(frames, "status", lambda d: d["status"] == "ok")
        deadline = time.time() + 5
        while ha.subscriber_count() == 0 and time.time() < deadline:
            time.sleep(0.05)

        ha.push_state("light.living_room_lamp", "off", brightness=None)
        frames = read_events(
            response,
            lambda f: has(f, "state", lambda d: d["entity_id"] == "light.living_room_lamp"),
        )
        state = next(
            d for e, d in frames if e == "state" and d["entity_id"] == "light.living_room_lamp"
        )
        assert state["on"] is False and state["level"] == 0

        ha.push_state("fan.bedroom_fan", "on", percentage=100)
        frames = read_events(
            response, lambda f: has(f, "state", lambda d: d["entity_id"] == "fan.bedroom_fan")
        )
        assert next(d for e, d in frames if e == "state")["level"] == 100

        ha.push_registry_change()
        frames = read_events(response, lambda f: has(f, "refresh"))
        assert has(frames, "refresh")


def test_a_tv_turned_off_with_its_remote_reaches_the_stream(client, ha):
    connect(client, ha)
    with client.stream("GET", "/api/home/live", timeout=10) as response:
        read_events(response, lambda f: has(f, "status", lambda d: d["status"] == "ok"))
        deadline = time.time() + 5
        while ha.subscriber_count() == 0 and time.time() < deadline:
            time.sleep(0.05)
        ha.push_state("media_player.living_room_tv", "off")
        frames = read_events(
            response,
            lambda f: has(f, "state", lambda d: d["entity_id"] == "media_player.living_room_tv"),
        )
        tv = next(d for e, d in frames if e == "state")
        assert tv["on"] is False and tv["available"] is True


def test_controlling_from_mantel_shows_up_on_the_stream(client, ha):
    connect(client, ha)
    with client.stream("GET", "/api/home/live", timeout=10) as response:
        read_events(response, lambda f: has(f, "status", lambda d: d["status"] == "ok"))
        deadline = time.time() + 5
        while ha.subscriber_count() == 0 and time.time() < deadline:
            time.sleep(0.05)
        assert act(client, "light.kitchen_pendant", "set_level", value=60).status_code == 200
        frames = read_events(
            response, lambda f: has(f, "state", lambda d: d["entity_id"] == "light.kitchen_pendant")
        )
        state = next(
            d for e, d in frames if e == "state" and d["entity_id"] == "light.kitchen_pendant"
        )
        assert state["on"] is True and state["level"] == 60


def test_stream_reports_a_bad_token_then_recovers_after_the_token_is_fixed(client, ha, monkeypatch):
    monkeypatch.setattr(ha_home, "_BACKOFF", (0.2,))
    connect(client, ha, token="wrong")
    with client.stream("GET", "/api/home/live", timeout=15) as response:
        frames = read_events(
            response, lambda f: has(f, "status", lambda d: d["status"] == "invalid_token")
        )
        assert has(frames, "status", lambda d: d["status"] == "invalid_token")
        connect(client, ha)  # saving settings reconnects with the new token
        frames = read_events(response, lambda f: has(f, "status", lambda d: d["status"] == "ok"))
        assert has(frames, "status", lambda d: d["status"] == "ok")


def test_home_assistant_socket_closes_when_the_last_screen_leaves(ha, monkeypatch):
    """Driven directly: the stream is what holds the socket, not the HTTP layer."""
    import asyncio

    monkeypatch.setattr(ha_home, "IDLE_CLOSE_SECONDS", 0.5)

    async def scenario():
        stream = ha_home.HomeStream(load=lambda: _config(ha))
        queue = stream.subscribe()
        for _ in range(100):
            if ha.subscriber_count():
                break
            await asyncio.sleep(0.05)
        assert ha.subscriber_count() == 1
        stream.unsubscribe(queue)
        for _ in range(100):
            if not ha.subscriber_count():
                break
            await asyncio.sleep(0.1)
        left = ha.subscriber_count()
        await stream.stop()
        return left

    assert asyncio.run(scenario()) == 0


async def _config(ha):
    return ha_home.HAConfig(ha.url, TOKEN)

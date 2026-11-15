"""Chores, stars, and rewards.

The balance is the sum of the ledger. These tests pin the cases where getting
that wrong would hand out stars twice, or take them without giving them back.
"""

from datetime import UTC, datetime

from sqlalchemy import inspect, select, text

from app.db import engine
from app.models import StarEntry
from app.schema_sync import sync
from app.services.chores import household_today, occurs_on


def user(client, name, **extra):
    return client.post("/api/users", json={"name": name, **extra}).json()


def chore(client, assignee_ids, **extra):
    body = {"title": "Make bed", "assignee_ids": assignee_ids, "points": 2}
    body.update(extra)
    return client.post("/api/chores", json=body)


def reward(client, **extra):
    body = {"title": "Pick the movie", "points_cost": 5}
    body.update(extra)
    return client.post("/api/rewards", json=body)


# -------------------------------- schedule -----------------------------------


def test_weekly_chore_uses_sunday_as_zero():
    sunday = datetime(2026, 11, 15).date()
    monday = datetime(2026, 11, 16).date()
    assert occurs_on("weekly", "0", None, sunday)
    assert not occurs_on("weekly", "0", None, monday)
    assert occurs_on("weekly", "1,3", None, monday)
    assert not occurs_on("weekly", "1,3", None, sunday)
    assert occurs_on("once", None, sunday, sunday)
    assert not occurs_on("once", None, sunday, monday)
    assert not occurs_on("weekly", None, None, sunday)
    assert not occurs_on("nope", None, None, sunday)


def test_household_today_follows_the_zone_not_utc():
    # 14:00 UTC on the 15th is already the 16th in Auckland.
    now = datetime(2026, 11, 15, 14, 0, tzinfo=UTC)
    assert household_today("Pacific/Auckland", now).isoformat() == "2026-11-16"
    assert household_today("America/New_York", now).isoformat() == "2026-11-15"
    assert household_today("Not/AZone", now).isoformat() == "2026-11-15"


# --------------------------------- chores ------------------------------------


def test_create_lists_and_retires(client):
    sam = user(client, "Sam")
    created = chore(client, [sam["id"]], schedule="daily").json()
    assert created["title"] == "Make bed"
    assert created["points"] == 2
    assert created["icon"] == "🛏️"
    assert created["assignee_ids"] == [sam["id"]]
    assert created["schedule"] == "daily"

    listed = client.get("/api/chores").json()
    assert [row["id"] for row in listed] == [created["id"]]

    assert client.delete(f"/api/chores/{created['id']}").status_code == 204
    assert client.get("/api/chores").json() == []
    assert client.patch(f"/api/chores/{created['id']}", json={"title": "Nope"}).status_code == 404


def test_weekly_and_once_need_their_fields(client):
    sam = user(client, "Sam")
    missing_days = chore(client, [sam["id"]], schedule="weekly")
    assert missing_days.status_code == 400
    assert "weekday" in missing_days.json()["error"]["message"]

    missing_date = chore(client, [sam["id"]], schedule="once")
    assert missing_date.status_code == 400

    bad_day = chore(client, [sam["id"]], schedule="weekly", weekdays=[7])
    assert bad_day.status_code == 400

    no_one = client.post("/api/chores", json={"title": "Dishes", "assignee_ids": []})
    assert no_one.status_code == 422


def test_unknown_person_is_404(client):
    assert chore(client, [99]).status_code == 404


def test_board_shows_a_chore_only_on_its_days(client):
    sam = user(client, "Sam", color="#112233")
    alex = user(client, "Alex", color="#abcdef")
    chore(client, [sam["id"], alex["id"]], schedule="weekly", weekdays=[0], title="Trash", points=1)
    chore(
        client,
        [sam["id"]],
        schedule="once",
        due_on="2026-11-16",
        title="Library books",
        points=3,
    )

    sunday = client.get("/api/chores/board?on=2026-11-15").json()
    assert sunday["on"] == "2026-11-15"
    by_name = {p["name"]: p for p in sunday["people"]}
    assert [c["title"] for c in by_name["Sam"]["chores"]] == ["Trash"]
    assert [c["title"] for c in by_name["Alex"]["chores"]] == ["Trash"]
    assert by_name["Sam"]["stars"] == 0
    assert by_name["Sam"]["color"] == "#112233"

    monday = client.get("/api/chores/board?on=2026-11-16").json()
    by_name = {p["name"]: p for p in monday["people"]}
    assert [c["title"] for c in by_name["Sam"]["chores"]] == ["Library books"]
    assert by_name["Alex"]["chores"] == []

    assert client.get("/api/chores/board?on=tomorrow").status_code == 400


def test_checking_awards_stars_once_and_unchecking_returns_them(client, db):
    sam = user(client, "Sam")
    row = chore(client, [sam["id"]], points=4).json()

    first = client.post(
        f"/api/chores/{row['id']}/complete",
        json={"user_id": sam["id"], "on": "2026-11-15", "done": True},
    ).json()
    assert first["completion"]["status"] == "done"
    assert first["completion"]["points_awarded"] == 4

    again = client.post(
        f"/api/chores/{row['id']}/complete",
        json={"user_id": sam["id"], "on": "2026-11-15", "done": True},
    ).json()
    assert again["completion"]["id"] == first["completion"]["id"]

    board = client.get("/api/chores/board?on=2026-11-15").json()
    assert board["people"][0]["stars"] == 4
    assert db.scalar(select(StarEntry).where(StarEntry.delta > 0)) is not None
    assert db.query(StarEntry).count() == 1, "a second check must not mint more stars"

    cleared = client.post(
        f"/api/chores/{row['id']}/complete",
        json={"user_id": sam["id"], "on": "2026-11-15", "done": False},
    ).json()
    assert cleared["completion"] is None
    board = client.get("/api/chores/board?on=2026-11-15").json()
    assert board["people"][0]["stars"] == 0
    assert board["people"][0]["chores"][0]["completion"] is None


def test_one_person_checking_does_not_complete_the_other(client):
    sam = user(client, "Sam")
    alex = user(client, "Alex")
    row = chore(client, [sam["id"], alex["id"]], points=1).json()
    client.post(
        f"/api/chores/{row['id']}/complete",
        json={"user_id": sam["id"], "on": "2026-11-15"},
    )
    board = client.get("/api/chores/board?on=2026-11-15").json()
    by_name = {p["name"]: p for p in board["people"]}
    assert by_name["Sam"]["chores"][0]["completion"]["status"] == "done"
    assert by_name["Alex"]["chores"][0]["completion"] is None
    assert by_name["Sam"]["stars"] == 1
    assert by_name["Alex"]["stars"] == 0


def test_cannot_complete_for_someone_else_or_the_wrong_day(client):
    sam = user(client, "Sam")
    alex = user(client, "Alex")
    row = chore(client, [sam["id"]], schedule="once", due_on="2026-11-15").json()

    other = client.post(
        f"/api/chores/{row['id']}/complete",
        json={"user_id": alex["id"], "on": "2026-11-15"},
    )
    assert other.status_code == 400

    wrong_day = client.post(
        f"/api/chores/{row['id']}/complete",
        json={"user_id": sam["id"], "on": "2026-11-16"},
    )
    assert wrong_day.status_code == 400


def test_approval_holds_stars_until_someone_says_yes(client):
    sam = user(client, "Sam")
    row = chore(client, [sam["id"]], points=3, requires_approval=True).json()
    checked = client.post(
        f"/api/chores/{row['id']}/complete",
        json={"user_id": sam["id"], "on": "2026-11-15"},
    ).json()["completion"]
    assert checked["status"] == "pending"
    assert checked["points_awarded"] == 0

    board = client.get("/api/chores/board?on=2026-11-15").json()
    assert board["people"][0]["stars"] == 0
    assert board["pending_approvals"][0]["completion_id"] == checked["id"]
    assert board["pending_approvals"][0]["points"] == 3

    approved = client.post(f"/api/chores/completions/{checked['id']}/approve").json()
    assert approved["status"] == "done"
    assert approved["points_awarded"] == 3
    board = client.get("/api/chores/board?on=2026-11-15").json()
    assert board["people"][0]["stars"] == 3
    assert board["pending_approvals"] == []

    again = client.post(f"/api/chores/completions/{checked['id']}/approve")
    assert again.status_code == 200
    assert again.json()["points_awarded"] == 3
    board = client.get("/api/chores/board?on=2026-11-15").json()
    assert board["people"][0]["stars"] == 3


def test_rejecting_a_pending_check_awards_nothing(client):
    sam = user(client, "Sam")
    row = chore(client, [sam["id"]], points=3, requires_approval=True).json()
    checked = client.post(
        f"/api/chores/{row['id']}/complete",
        json={"user_id": sam["id"], "on": "2026-11-15"},
    ).json()["completion"]
    assert client.post(f"/api/chores/completions/{checked['id']}/reject").status_code == 204
    board = client.get("/api/chores/board?on=2026-11-15").json()
    assert board["people"][0]["stars"] == 0
    assert board["people"][0]["chores"][0]["completion"] is None
    assert board["pending_approvals"] == []


def test_retiring_a_chore_keeps_stars_and_drops_pending(client):
    sam = user(client, "Sam")
    done = chore(client, [sam["id"]], points=2, title="Dishes").json()
    waiting = chore(client, [sam["id"]], points=5, requires_approval=True, title="Homework").json()
    client.post(
        f"/api/chores/{done['id']}/complete",
        json={"user_id": sam["id"], "on": "2026-11-15"},
    )
    client.post(
        f"/api/chores/{waiting['id']}/complete",
        json={"user_id": sam["id"], "on": "2026-11-15"},
    )
    client.delete(f"/api/chores/{done['id']}")
    client.delete(f"/api/chores/{waiting['id']}")

    board = client.get("/api/chores/board?on=2026-11-15").json()
    assert board["people"][0]["chores"] == []
    assert board["people"][0]["stars"] == 2
    assert board["pending_approvals"] == []


def test_edit_replaces_assignees_and_schedule(client):
    sam = user(client, "Sam")
    alex = user(client, "Alex")
    row = chore(client, [sam["id"]]).json()
    edited = client.patch(
        f"/api/chores/{row['id']}",
        json={"assignee_ids": [alex["id"]], "schedule": "weekly", "weekdays": [1], "points": 9},
    ).json()
    assert edited["assignee_ids"] == [alex["id"]]
    assert edited["weekdays"] == [1]
    assert edited["points"] == 9

    sunday = client.get("/api/chores/board?on=2026-11-15").json()
    assert all(person["chores"] == [] for person in sunday["people"])
    monday = client.get("/api/chores/board?on=2026-11-16").json()
    by_name = {p["name"]: p for p in monday["people"]}
    assert [c["title"] for c in by_name["Alex"]["chores"]] == ["Make bed"]
    assert by_name["Sam"]["chores"] == []


# -------------------------------- rewards ------------------------------------


def test_redeem_holds_stars_until_it_is_given_or_sent_back(client):
    sam = user(client, "Sam")
    row = chore(client, [sam["id"]], points=8).json()
    client.post(
        f"/api/chores/{row['id']}/complete",
        json={"user_id": sam["id"], "on": "2026-11-15"},
    )
    movie = reward(client, points_cost=5, title="Pick the movie").json()
    assert movie["icon"] == "🎬"

    broke = reward(client, points_cost=100, title="Pony")
    denied = client.post(f"/api/rewards/{broke.json()['id']}/redeem", json={"user_id": sam["id"]})
    assert denied.status_code == 400
    assert "Not enough stars" in denied.json()["error"]["message"]

    redeemed = client.post(f"/api/rewards/{movie['id']}/redeem", json={"user_id": sam["id"]}).json()
    assert redeemed["status"] == "pending"
    assert redeemed["points_spent"] == 5
    board = client.get("/api/chores/board?on=2026-11-15").json()
    assert board["people"][0]["stars"] == 3
    assert board["pending_redemptions"][0]["id"] == redeemed["id"]

    # A second tap while this request is still open does not spend the stars again.
    again = client.post(
        f"/api/rewards/{movie['id']}/redeem",
        json={"user_id": sam["id"], "request_id": "tap-2"},
    )
    assert again.status_code == 201
    assert again.json()["id"] == redeemed["id"]
    board = client.get("/api/chores/board?on=2026-11-15").json()
    assert board["people"][0]["stars"] == 3

    fulfilled = client.post(f"/api/redemptions/{redeemed['id']}/fulfill").json()
    assert fulfilled["status"] == "fulfilled"
    board = client.get("/api/chores/board?on=2026-11-15").json()
    assert board["people"][0]["stars"] == 3
    assert board["pending_redemptions"] == []

    twice = client.post(f"/api/redemptions/{redeemed['id']}/deny")
    assert twice.status_code == 400


def test_denying_a_reward_returns_the_stars(client):
    sam = user(client, "Sam")
    row = chore(client, [sam["id"]], points=8).json()
    client.post(
        f"/api/chores/{row['id']}/complete",
        json={"user_id": sam["id"], "on": "2026-11-15"},
    )
    movie = reward(client, points_cost=5).json()
    redeemed = client.post(f"/api/rewards/{movie['id']}/redeem", json={"user_id": sam["id"]}).json()
    client.post(f"/api/redemptions/{redeemed['id']}/deny")
    board = client.get("/api/chores/board?on=2026-11-15").json()
    assert board["people"][0]["stars"] == 8
    assert board["pending_redemptions"] == []


def test_retiring_a_reward_sends_open_requests_back(client):
    sam = user(client, "Sam")
    row = chore(client, [sam["id"]], points=8).json()
    client.post(
        f"/api/chores/{row['id']}/complete",
        json={"user_id": sam["id"], "on": "2026-11-15"},
    )
    movie = reward(client).json()
    client.post(f"/api/rewards/{movie['id']}/redeem", json={"user_id": sam["id"]})
    assert client.delete(f"/api/rewards/{movie['id']}").status_code == 204
    assert client.get("/api/rewards").json() == []
    board = client.get("/api/chores/board?on=2026-11-15").json()
    assert board["people"][0]["stars"] == 8
    assert board["rewards"] == []
    assert board["pending_redemptions"] == []


def test_zero_point_chore_writes_no_ledger_row(client, db):
    sam = user(client, "Sam")
    row = chore(client, [sam["id"]], points=0, title="Stretch").json()
    done = client.post(
        f"/api/chores/{row['id']}/complete",
        json={"user_id": sam["id"], "on": "2026-11-15"},
    ).json()
    assert done["completion"]["status"] == "done"
    assert done["completion"]["points_awarded"] == 0
    assert db.query(StarEntry).count() == 0


def test_monday_does_not_complete_tuesday(client):
    sam = user(client, "Sam")
    row = chore(client, [sam["id"]], points=2).json()
    client.post(
        f"/api/chores/{row['id']}/complete",
        json={"user_id": sam["id"], "on": "2026-11-15", "request_id": "mon"},
    )
    tuesday = client.get("/api/chores/board?on=2026-11-16").json()
    assert tuesday["people"][0]["chores"][0]["completion"] is None
    assert tuesday["people"][0]["stars"] == 2

    client.post(
        f"/api/chores/{row['id']}/complete",
        json={"user_id": sam["id"], "on": "2026-11-16", "request_id": "tue"},
    )
    board = client.get("/api/chores/board?on=2026-11-16").json()
    assert board["people"][0]["chores"][0]["completion"]["status"] == "done"
    assert board["people"][0]["stars"] == 4
    monday = client.get("/api/chores/board?on=2026-11-15").json()
    assert monday["people"][0]["chores"][0]["completion"]["status"] == "done"


def test_replaying_a_request_id_does_not_award_or_spend_twice(client, db):
    sam = user(client, "Sam")
    row = chore(client, [sam["id"]], points=4).json()
    body = {"user_id": sam["id"], "on": "2026-11-15", "done": True, "request_id": "check-1"}
    first = client.post(f"/api/chores/{row['id']}/complete", json=body).json()
    second = client.post(f"/api/chores/{row['id']}/complete", json=body).json()
    assert second["completion"]["id"] == first["completion"]["id"]
    assert client.get("/api/chores/board?on=2026-11-15").json()["people"][0]["stars"] == 4
    assert db.query(StarEntry).count() == 1

    movie = reward(client, points_cost=3).json()
    redeem_body = {"user_id": sam["id"], "request_id": "redeem-1"}
    bought = client.post(f"/api/rewards/{movie['id']}/redeem", json=redeem_body).json()
    replay = client.post(f"/api/rewards/{movie['id']}/redeem", json=redeem_body).json()
    assert replay["id"] == bought["id"]
    assert client.get("/api/chores/board?on=2026-11-15").json()["people"][0]["stars"] == 1
    assert db.query(StarEntry).count() == 2, "the replay must not write a second spend"


def test_replaying_an_uncheck_does_not_take_the_stars_twice(client, db):
    """The offline queue sends the same request_id again when the link returns.
    That retry must not write a second reversal."""
    sam = user(client, "Sam")
    row = chore(client, [sam["id"]], points=4).json()
    client.post(
        f"/api/chores/{row['id']}/complete",
        json={"user_id": sam["id"], "on": "2026-11-15", "done": True, "request_id": "on"},
    )
    undo = {"user_id": sam["id"], "on": "2026-11-15", "done": False, "request_id": "off"}
    first = client.post(f"/api/chores/{row['id']}/complete", json=undo)
    replay = client.post(f"/api/chores/{row['id']}/complete", json=undo)
    assert first.status_code == 200, first.text
    assert replay.status_code == 200, replay.text
    assert replay.json()["completion"] is None
    assert client.get("/api/chores/board?on=2026-11-15").json()["people"][0]["stars"] == 0
    assert db.query(StarEntry).count() == 2


def test_a_child_needs_no_account(client):
    """A family member is a name and a color. Chores do not require a login
    or a linked Google or iCloud account."""
    kid = user(client, "Sam", color="#22c55e", avatar_emoji="🦊")
    assert kid["color"] == "#22c55e"
    row = chore(client, [kid["id"]], points=1, title="Feed the cat").json()
    done = client.post(
        f"/api/chores/{row['id']}/complete",
        json={"user_id": kid["id"], "on": "2026-11-15"},
    ).json()
    assert done["completion"]["status"] == "done"
    board = client.get("/api/chores/board?on=2026-11-15").json()
    assert board["people"][0]["stars"] == 1
    assert board["people"][0]["avatar_emoji"] == "🦊"


def test_older_database_gains_the_chore_tables(client):
    """New tables, not new columns. An install from before this release boots
    and create_all adds them; nothing on users, events, or lists changes."""
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE point_requests"))
        conn.execute(text("DROP TABLE star_entries"))
        conn.execute(text("DROP TABLE reward_redemptions"))
        conn.execute(text("DROP TABLE rewards"))
        conn.execute(text("DROP TABLE chore_completions"))
        conn.execute(text("DROP TABLE chore_assignees"))
        conn.execute(text("DROP TABLE chores"))
    names = set(inspect(engine).get_table_names())
    assert "chores" not in names and "rewards" not in names

    sync(engine)

    names = set(inspect(engine).get_table_names())
    assert {
        "chores",
        "chore_assignees",
        "chore_completions",
        "star_entries",
        "point_requests",
        "rewards",
        "reward_redemptions",
    } <= names
    assert "users" in names and "events" in names

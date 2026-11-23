"""In-process change notices for every open screen.

One household, one process (see AGENTS.md). A pull from Google commits dozens of
rows; publishing each row would make every tablet refetch the week that many
times. Commits inside a short window become one notice, and a reconnect that
still has the missed ids replays those topics instead of asking for a full
resync.

The queue is thread-safe because the sync loops commit off the event loop.
"""

from __future__ import annotations

import json
import queue
import threading
from collections import deque
from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import event
from sqlalchemy.orm import Session

# Tables that change what a screen draws. Devices, pairing codes and the
# weather cache are bookkeeping and must not wake every display.
_TABLE_TOPICS: dict[str, tuple[str, ...]] = {
    "events": ("events",),
    "calendars": ("calendars", "sync"),
    "linked_accounts": ("accounts", "sync"),
    "users": ("users",),
    "app_settings": ("settings",),
    "lists": ("lists",),
    "list_items": ("lists",),
    "chores": ("chores",),
    "chore_assignees": ("chores",),
    "chore_completions": ("chores",),
    "star_entries": ("chores", "rewards"),
    "rewards": ("chores", "rewards"),
    "reward_redemptions": ("chores", "rewards"),
    "dashboard_widgets": ("widgets",),
    "photos": ("photos",),
    "family_messages": ("messages",),
}

# Long enough to fold a multi-calendar pull into one notice, short enough that
# a chore tap still shows up on the other screen inside a second.
_COALESCE_SECONDS = 0.25
KEEPALIVE_TICK_SECONDS = 1.0
KEEPALIVE_EVERY = 15
_BUFFER = 200

TIMEOUT = object()


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class _Subscriber:
    def __init__(self) -> None:
        self.queue: queue.Queue = queue.Queue(maxsize=32)
        self.overflow = False

    def push(self, item: dict) -> None:
        if self.overflow:
            return
        try:
            self.queue.put_nowait(item)
        except queue.Full:
            # A screen that fell behind refetches once instead of applying a
            # partial backlog out of order.
            self.overflow = True
            while True:
                try:
                    self.queue.get_nowait()
                except queue.Empty:
                    break

    def get(self, timeout: float):
        if self.overflow:
            self.overflow = False
            return "resync"
        try:
            return self.queue.get(timeout=timeout)
        except queue.Empty:
            return TIMEOUT


class LiveHub:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._seq = 0
        self._recent: deque[dict] = deque(maxlen=_BUFFER)
        self._subs: set[_Subscriber] = set()
        self._pending: set[str] = set()
        self._timer: threading.Timer | None = None

    @property
    def latest_id(self) -> int:
        with self._lock:
            return self._seq

    def note(self, topics: Iterable[str]) -> None:
        pending = {t for t in topics if t}
        if not pending:
            return
        with self._lock:
            self._pending |= pending
            if self._timer is None:
                timer = threading.Timer(_COALESCE_SECONDS, self._fire)
                timer.daemon = True
                self._timer = timer
                timer.start()

    def flush(self) -> None:
        """Publish anything waiting. Tests use this so they do not sleep."""
        with self._lock:
            timer = self._timer
            self._timer = None
            topics = self._pending
            self._pending = set()
        if timer is not None:
            timer.cancel()
        if topics:
            self._emit(topics)

    def _fire(self) -> None:
        with self._lock:
            self._timer = None
            topics = self._pending
            self._pending = set()
        if topics:
            self._emit(topics)

    def _emit(self, topics: set[str]) -> None:
        with self._lock:
            self._seq += 1
            item = {"id": self._seq, "topics": sorted(topics), "at": _now()}
            self._recent.append(item)
            subs = list(self._subs)
        for sub in subs:
            sub.push(item)

    def open(self, last_id: int | None) -> tuple[_Subscriber, list[dict] | None]:
        """Subscribe, then say which notices were missed.

        ``None`` means the id is no longer in the buffer (or belongs to a
        previous process). The caller should ask the screen to refetch.
        Subscribing under the same lock as ``_emit`` is what keeps a commit
        that lands mid-connect from disappearing.
        """
        with self._lock:
            sub = _Subscriber()
            self._subs.add(sub)
            if last_id is None:
                return sub, []
            if last_id > self._seq or last_id < 0:
                return sub, None
            if not self._recent:
                return sub, ([] if last_id == self._seq else None)
            oldest = self._recent[0]["id"]
            if last_id < oldest - 1:
                return sub, None
            return sub, [item for item in self._recent if item["id"] > last_id]

    def close(self, sub: _Subscriber) -> None:
        with self._lock:
            self._subs.discard(sub)

    def reset(self) -> None:
        """Drop buffered notices. Tests that share the process call this."""
        self.flush()
        with self._lock:
            self._seq = 0
            self._recent.clear()
            self._pending.clear()


hub = LiveHub()


def announce(*topics: str) -> None:
    hub.note(topics)


def encode_change(item: dict) -> str:
    payload = json.dumps({"topics": item["topics"], "at": item["at"]}, separators=(",", ":"))
    return f"id: {item['id']}\nevent: change\ndata: {payload}\n\n"


def encode_hello(seq: int) -> str:
    payload = json.dumps({"id": seq})
    return f"id: {seq}\nevent: hello\ndata: {payload}\n\n"


def encode_resync() -> str:
    return 'event: resync\ndata: {"reason":"gap"}\n\n'


def _topics_of(obj: object) -> tuple[str, ...]:
    name = getattr(obj, "__tablename__", None)
    if not isinstance(name, str):
        return ()
    return _TABLE_TOPICS.get(name, ())


def _collect(session: Session, flush_context, instances) -> None:  # noqa: ARG001
    topics: set[str] = session.info.setdefault("live_topics", set())
    for obj in list(session.new) + list(session.deleted):
        topics.update(_topics_of(obj))
    for obj in list(session.dirty):
        if session.is_modified(obj, include_collections=False):
            topics.update(_topics_of(obj))


def _collect_bulk(state) -> None:
    if not state.is_delete and not state.is_update:
        return
    table = None
    mapper = state.bind_mapper
    if mapper is not None:
        table = mapper.local_table.name
    else:
        target = getattr(state.statement, "table", None)
        table = getattr(target, "name", None)
    mapped = _TABLE_TOPICS.get(table or "", ())
    if mapped:
        state.session.info.setdefault("live_topics", set()).update(mapped)


def _after_commit(session: Session) -> None:
    topics = session.info.pop("live_topics", None)
    if topics:
        hub.note(topics)


def _after_rollback(session: Session) -> None:
    session.info.pop("live_topics", None)


def install() -> None:
    if getattr(install, "done", False):
        return
    event.listen(Session, "before_flush", _collect)
    event.listen(Session, "do_orm_execute", _collect_bulk)
    event.listen(Session, "after_commit", _after_commit)
    event.listen(Session, "after_rollback", _after_rollback)
    install.done = True  # type: ignore[attr-defined]


install()

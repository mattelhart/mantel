import asyncio
import contextlib
import logging

from ..config import get_settings
from ..db import SessionLocal
from . import messaging, sync_engine, update_check
from .pullsignal import register_pull_signal
from .pushqueue import register_push_signal

log = logging.getLogger(__name__)


async def _pull_loop(signal: asyncio.Event) -> None:
    interval = get_settings().sync_interval_seconds
    while True:
        # Same shape as the push loop: the five-minute tick is the background
        # cadence, and claiming a calendar wakes it early so somebody watching the
        # screen sees that person's events appear instead of waiting out the timer.
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(signal.wait(), timeout=interval)
        signal.clear()
        try:
            # Google's client is blocking, so it runs off the event loop.
            changed = await asyncio.to_thread(_pull_once)
            if changed:
                log.info("Pulled %s changes from Google", changed)
        except Exception:
            log.exception("Scheduled pull failed")


async def _push_loop(signal: asyncio.Event) -> None:
    interval = get_settings().push_interval_seconds
    while True:
        # Wakes immediately when someone saves an event, otherwise ticks on the interval
        # so a push that failed earlier gets retried.
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(signal.wait(), timeout=interval)
        signal.clear()
        try:
            pushed = await asyncio.to_thread(_push_once)
            if pushed:
                log.info("Pushed %s changes to Google", pushed)
        except Exception:
            log.exception("Scheduled push failed")


# Long enough that a container restart storm or slow boot isn't made slower by an outbound
# request, short enough that a fresh install shows its answer the same session.
UPDATE_CHECK_STARTUP_DELAY_SECONDS = 60


async def _update_check_loop() -> None:
    await asyncio.sleep(UPDATE_CHECK_STARTUP_DELAY_SECONDS)
    interval = max(1, get_settings().update_check_interval_hours) * 3600
    while True:
        try:
            await asyncio.to_thread(_update_check_once)
        except Exception:
            # check_now already swallows network errors; this covers the database.
            log.exception("Scheduled update check failed")
        await asyncio.sleep(interval)


def _update_check_once() -> None:
    with SessionLocal() as db:
        update_check.check_now(db)


def _pull_once() -> int:
    with SessionLocal() as db:
        return sync_engine.pull_all(db)


def _push_once() -> int:
    with SessionLocal() as db:
        return sync_engine.push_pending(db)


async def _messages_loop() -> None:
    """Pull inbound texts and delivery status for the active messaging provider.

    No webhook is used, so the wall can stay off the public internet. The
    interval is short enough to feel nearly live. When the provider is not
    set up the tick is a cheap no-op.
    """
    while True:
        # Sleep first so a freshly started process (and the test suite) does
        # not touch the database in a thread the moment the API comes up.
        await asyncio.sleep(messaging.poll_interval_seconds())
        try:
            await asyncio.to_thread(messaging.poll_once)
        except Exception:
            log.exception("Scheduled message poll failed")


def start(loop: asyncio.AbstractEventLoop) -> list[asyncio.Task]:
    # Separate from the sync flag: pausing calendar sync says nothing about wanting to
    # hear about a new release.
    tasks: list[asyncio.Task] = []
    if get_settings().update_check_enabled:
        tasks.append(asyncio.create_task(_update_check_loop()))
    else:
        log.info("Update check is disabled (UPDATE_CHECK_ENABLED=false)")
    tasks.append(asyncio.create_task(_messages_loop()))
    if not get_settings().sync_enabled:
        log.info("Google sync is disabled (SYNC_ENABLED=false)")
        return tasks
    push_signal = asyncio.Event()
    register_push_signal(push_signal, loop)
    pull_signal = asyncio.Event()
    register_pull_signal(pull_signal, loop)
    tasks += [
        asyncio.create_task(_pull_loop(pull_signal)),
        asyncio.create_task(_push_loop(push_signal)),
    ]
    return tasks


async def stop(tasks: list[asyncio.Task]) -> None:
    for task in tasks:
        task.cancel()
    for task in tasks:
        with contextlib.suppress(asyncio.CancelledError):
            await task

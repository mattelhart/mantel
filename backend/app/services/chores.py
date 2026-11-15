"""When a chore is due, and which calendar day 'today' is for the household.

The board is a list of occurrences, not of definitions. A weekly chore stored
once has to be asked, for a particular date, whether that date is one of its
days. Dates here are calendar days in the household timezone: Tuesday's dishes
are Tuesday even if the server clock is UTC.
"""

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def mantel_weekday(day: date) -> int:
    """0 = Sunday … 6 = Saturday, the same numbering as `first_day_of_week`."""
    return (day.weekday() + 1) % 7


def parse_weekdays(raw: str | None) -> set[int]:
    if not raw:
        return set()
    out: set[int] = set()
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        value = int(part)
        if value < 0 or value > 6:
            raise ValueError(part)
        out.add(value)
    return out


def occurs_on(schedule: str, weekdays: str | None, due_on: date | None, day: date) -> bool:
    """Whether this definition has an occurrence on `day`.

    Anything that is not daily, weekly, or once is treated as not scheduled.
    A weekly chore with no days, or a one-off with no date, is not due — the
    API rejects those on write, and this keeps a bad row off the board rather
    than showing it every day.
    """
    if schedule == "daily":
        return True
    if schedule == "weekly":
        return mantel_weekday(day) in parse_weekdays(weekdays)
    if schedule == "once":
        return due_on is not None and due_on == day
    return False


def household_today(zone_name: str, now: datetime | None = None) -> date:
    """The calendar day the family is on, not the UTC day the server happens to be in."""
    try:
        zone = ZoneInfo(zone_name)
    except ZoneInfoNotFoundError:
        zone = ZoneInfo("UTC")
    moment = now or datetime.now(UTC)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(zone).date()

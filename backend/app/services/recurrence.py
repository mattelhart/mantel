"""Recurring event expansion.

Whether a series is expanded here depends on whether its provider expands it
first. Google is asked for `singleEvents=true` and hands back the individual
instances, so expanding those again would double every occurrence. CalDAV hands
back the master with its RRULE and leaves the expansion to the client, which is
what this module does -- the same as for a calendar that lives only in this app.

That asymmetry is the reason for `Event.is_master`: a locally created recurring
event on a Google calendar is stored once as a master, pushed as an RRULE, and
then hidden from queries so Google's own instances are the only thing displayed.
An iCloud series stays visible and is expanded below. See
`sync_engine._push_one` and `CalendarProvider.expands_recurrence`.

Occurrences can also be *removed* from a series without the rule changing: an
EXDATE on the master, or an occurrence somebody moved, which iCloud sends as a
separate component and this app stores as its own row. Both arrive here as
`Event.exdates`, and both must be skipped or the calendar shows an event that was
cancelled and, in the second case, shows it twice.
"""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil import rrule as rrule_lib
from sqlalchemy.orm.attributes import set_committed_value

from ..models import Event

# A runaway rule (no COUNT, no UNTIL, DAILY) must not be able to generate a
# million rows for a wide query. A decade of daily events is far past anything a
# family calendar view asks for.
MAX_OCCURRENCES = 3660

FREQUENCIES = {
    "DAILY": rrule_lib.DAILY,
    "WEEKLY": rrule_lib.WEEKLY,
    "MONTHLY": rrule_lib.MONTHLY,
    "YEARLY": rrule_lib.YEARLY,
}


class RecurrenceError(ValueError):
    """An RRULE we can't parse. The message is safe to show the user."""


def _naive_until(rule: str) -> str:
    """Drop the trailing Z from UNTIL.

    Every datetime in this database is naive UTC. dateutil refuses to compare a
    timezone-aware UNTIL against a naive DTSTART and yields *no occurrences at
    all* rather than raising -- so `FREQ=WEEKLY;UNTIL=20261231T000000Z`, which is
    the standard form and exactly what Google emits, would silently make an event
    vanish. Stripping the Z keeps both sides naive UTC, which they already are.
    """
    out = []
    for piece in rule.split(";"):
        if piece.startswith("UNTIL=") and piece.endswith("Z"):
            piece = piece[:-1]
        out.append(piece)
    return ";".join(out)


def validate(rule: str) -> str:
    """Normalise and sanity-check an RRULE before it is stored."""
    text = rule.strip().upper()
    if text.startswith("RRULE:"):
        text = text[len("RRULE:") :]
    if not text:
        raise RecurrenceError("Empty recurrence rule")

    text = _naive_until(text)
    parts = dict(
        piece.split("=", 1) for piece in text.split(";") if "=" in piece
    )
    freq = parts.get("FREQ")
    if freq not in FREQUENCIES:
        raise RecurrenceError(
            f"Unsupported FREQ={freq!r}. Use DAILY, WEEKLY, MONTHLY or YEARLY."
        )

    # Parse it for real so a malformed BYDAY/UNTIL is caught at write time rather
    # than blowing up inside a calendar query later.
    try:
        rrule_lib.rrulestr(text, dtstart=datetime(2026, 1, 1))
    except (ValueError, TypeError) as exc:
        raise RecurrenceError(f"Could not read that recurrence rule: {exc}") from exc

    return text


def zoneinfo(name: str | None) -> ZoneInfo | None:
    if not name:
        return None
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return None


def _utc_to_local(moment: datetime, zone: ZoneInfo) -> datetime:
    return moment.replace(tzinfo=UTC).astimezone(zone).replace(tzinfo=None)


def _local_to_utc(moment: datetime, zone: ZoneInfo) -> datetime:
    """Wall-clock time in `zone` back to naive UTC.

    The hour a spring-forward skips does not exist. Attaching the zone and
    converting shifts that instant forward instead of raising, so a series that
    lands in the gap still has a start. The hour a fall-back repeats is taken
    as the first one (still on daylight time).
    """
    return moment.replace(tzinfo=zone).astimezone(UTC).replace(tzinfo=None)


def _rule_for_zone(rule: str, zone: ZoneInfo) -> str:
    """UNTIL is stored as naive UTC. dateutil compares it to DTSTART as-is, so a
    DTSTART expressed as a wall-clock time needs UNTIL on that same clock."""
    parts = []
    for piece in _naive_until(rule).split(";"):
        if piece.startswith("UNTIL=") and "T" in piece:
            raw = piece.split("=", 1)[1]
            try:
                until = datetime.strptime(raw[:15], "%Y%m%dT%H%M%S")
            except ValueError:
                parts.append(piece)
                continue
            local = _utc_to_local(until, zone)
            parts.append("UNTIL=" + local.strftime("%Y%m%dT%H%M%S"))
            continue
        parts.append(piece)
    return ";".join(parts)


def series_end(
    rule: str | None, dtstart: datetime, duration: timedelta, zone: str | None = None
) -> datetime | None:
    """When a finite series stops, or None if it never does.

    Stored on the row so `list_events` can skip finished series in SQL. Without
    it every series ever created is loaded and re-expanded on every request, and
    the cost grows with the age of the install rather than the size of the window.
    """
    if not rule:
        return None
    zi = zoneinfo(zone)
    try:
        if zi is None:
            parsed = rrule_lib.rrulestr(_naive_until(rule), dtstart=dtstart)
        else:
            parsed = rrule_lib.rrulestr(
                _rule_for_zone(rule, zi), dtstart=_utc_to_local(dtstart, zi)
            )
    except (ValueError, TypeError):
        return None

    # An unbounded rule has neither; asking for its last occurrence would hang.
    upper = rule.upper()
    if "COUNT=" not in upper and "UNTIL=" not in upper:
        return None

    last = None
    for count, occurrence in enumerate(parsed):
        last = occurrence
        if count >= MAX_OCCURRENCES:
            return None  # pathologically long; treat as unbounded
    if last is None:
        return None
    # `last` is a wall-clock time when a zone was applied, and already UTC otherwise.
    end_start = _local_to_utc(last, zi) if zi is not None else last
    return end_start + duration


def occurrences(
    event: Event,
    window_start: datetime,
    window_end: datetime,
    zone: str | None = None,
) -> list[datetime]:
    """Start times for `event` that fall inside the window.

    The window is widened backwards by the event's duration so a long occurrence
    that started before the window but is still running is included -- the same
    overlap rule single events already follow.
    """
    if not event.recurrence_rule:
        return []

    duration = event.end_at - event.start_at
    search_from = window_start - duration
    excluded = excluded_starts(event)
    # All-day series are dates with an exclusive end, not instants. Running them
    # through a zone would move the day. A timed series is expanded on the wall
    # clock of its zone (or the household zone, passed in) and converted back to
    # UTC per occurrence. Adding a fixed UTC offset instead is what makes a 4pm
    # weekly event read as 3pm after daylight saving ends.
    zi = None if event.all_day else zoneinfo(event.timezone or zone)

    try:
        # Defensive: rules stored before normalisation existed, or written straight
        # into the database, may still carry a Z-suffixed UNTIL.
        if zi is None:
            rule = rrule_lib.rrulestr(_naive_until(event.recurrence_rule), dtstart=event.start_at)
        else:
            rule = rrule_lib.rrulestr(
                _rule_for_zone(event.recurrence_rule, zi),
                dtstart=_utc_to_local(event.start_at, zi),
            )
    except (ValueError, TypeError):
        return []

    found: list[datetime] = []
    for occurrence in rule:
        utc = _local_to_utc(occurrence, zi) if zi is not None else occurrence
        if utc >= window_end:
            break
        if utc > search_from and utc not in excluded:
            found.append(utc)
            if len(found) >= MAX_OCCURRENCES:
                break
    return found


def excluded_starts(event: Event) -> set[datetime]:
    """Occurrences that must not be drawn, from `Event.exdates`.

    Stored as a comma-separated list of naive-UTC ISO timestamps rather than its
    own table: it is read only alongside the event it belongs to, and never
    queried on.
    """
    if not event.exdates:
        return set()

    out: set[datetime] = set()
    for piece in event.exdates.split(","):
        piece = piece.strip()
        if not piece:
            continue
        try:
            out.add(datetime.fromisoformat(piece))
        except ValueError:
            # One unreadable exclusion must not take the whole series with it; the
            # cost of skipping it is a single extra occurrence on screen.
            continue
    return out


def materialise(
    event: Event, window_start: datetime, window_end: datetime, zone: str | None = None
) -> list[Event]:
    """Detached copies of `event`, one per occurrence in the window.

    These are never added to the session -- they exist only to be serialised. The
    id is kept so the UI can open and edit the underlying series.

    The calendar is attached with `set_committed_value` rather than a plain
    assignment. `Event.calendar` has a back_populates to `Calendar.events`, whose
    cascade includes save-update, so `instance.calendar = ...` would append these
    transient duplicate-primary-key rows to the persistent collection -- and the
    next flush would try to INSERT them. set_committed_value writes the attribute
    as if it had been loaded from the database, firing no events and touching no
    backref.
    """
    duration = event.end_at - event.start_at
    out: list[Event] = []

    for start in occurrences(event, window_start, window_end, zone=zone):
        instance = Event(
            id=event.id,
            calendar_id=event.calendar_id,
            google_event_id=event.google_event_id,
            title=event.title,
            description=event.description,
            location=event.location,
            start_at=start,
            end_at=start + duration,
            all_day=event.all_day,
            timezone=event.timezone,
            recurrence_rule=event.recurrence_rule,
            recurring_event_id=event.recurring_event_id,
            status=event.status,
            origin=event.origin,
            sync_state=event.sync_state,
        )
        set_committed_value(instance, "calendar", event.calendar)
        out.append(instance)

    return out


def describe(rule: str | None) -> str | None:
    """Short human phrasing for the UI, e.g. 'Every week on Mon, Wed'."""
    if not rule:
        return None
    try:
        parts = dict(p.split("=", 1) for p in rule.split(";") if "=" in p)
    except ValueError:
        return "Repeats"

    freq = parts.get("FREQ", "")
    interval = int(parts.get("INTERVAL", 1))
    unit = {"DAILY": "day", "WEEKLY": "week", "MONTHLY": "month", "YEARLY": "year"}.get(freq)
    if unit is None:
        return "Repeats"

    text = f"Every {unit}" if interval == 1 else f"Every {interval} {unit}s"

    if freq == "WEEKLY" and parts.get("BYDAY"):
        names = {
            "MO": "Mon", "TU": "Tue", "WE": "Wed", "TH": "Thu",
            "FR": "Fri", "SA": "Sat", "SU": "Sun",
        }
        days = [names.get(d, d) for d in parts["BYDAY"].split(",")]
        text += " on " + ", ".join(days)

    if parts.get("COUNT"):
        text += f", {parts['COUNT']} times"
    elif parts.get("UNTIL"):
        raw = parts["UNTIL"]
        try:
            until = datetime.strptime(raw[:8], "%Y%m%d")
            text += f", until {until.strftime('%b %-d, %Y')}"
        except ValueError:
            pass

    return text


def next_occurrence_after(
    event: Event, moment: datetime, zone: str | None = None
) -> datetime | None:
    """First start time at or after `moment`, for countdowns and reminders."""
    found = occurrences(event, moment, moment + timedelta(days=365 * 3), zone=zone)
    return found[0] if found else None

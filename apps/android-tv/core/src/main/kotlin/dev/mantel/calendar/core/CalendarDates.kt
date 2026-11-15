package dev.mantel.calendar.core

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

enum class ViewKind { AGENDA, WEEK, MONTH }

fun todayIn(zone: ZoneId, now: Instant = Instant.now()): LocalDate = now.atZone(zone).toLocalDate()

fun startOfWeek(day: LocalDate, weekStartsOn: Int): LocalDate {
    val target = if (weekStartsOn == 1) DayOfWeek.MONDAY else DayOfWeek.SUNDAY
    val delta = (day.dayOfWeek.value - target.value + 7) % 7
    return day.minusDays(delta.toLong())
}

fun weekDays(anchor: LocalDate, weekStartsOn: Int): List<LocalDate> {
    val start = startOfWeek(anchor, weekStartsOn)
    return (0..6).map { start.plusDays(it.toLong()) }
}

/** Whole weeks, so the month grid is a rectangle. Includes the leading and trailing days. */
fun monthGrid(anchor: LocalDate, weekStartsOn: Int): List<LocalDate> {
    val first = anchor.withDayOfMonth(1)
    val last = anchor.withDayOfMonth(anchor.lengthOfMonth())
    val start = startOfWeek(first, weekStartsOn)
    val endExclusive = startOfWeek(last, weekStartsOn).plusDays(7)
    val count = ChronoUnit.DAYS.between(start, endExclusive).toInt()
    return (0 until count).map { start.plusDays(it.toLong()) }
}

fun step(kind: ViewKind, anchor: LocalDate, direction: Int): LocalDate = when (kind) {
    ViewKind.AGENDA -> anchor.plusDays(direction.toLong())
    ViewKind.WEEK -> anchor.plusDays(7L * direction)
    ViewKind.MONTH -> anchor.plusMonths(direction.toLong())
}

/**
 * Query a day past either end. All-day events are UTC dates, so a home zone
 * west of UTC would otherwise clip the first morning of a local week.
 */
fun fetchInstants(first: LocalDate, endExclusive: LocalDate, zone: ZoneId): Pair<Instant, Instant> {
    val start = first.minusDays(1).atStartOfDay(zone).toInstant()
    val end = endExclusive.plusDays(1).atStartOfDay(zone).toInstant()
    return start to end
}

fun occursOn(event: CalEvent, day: LocalDate, home: ZoneId): Boolean {
    if (event.allDay) {
        val start = utcDate(event.startAt)
        val end = utcDate(event.endAt)
        return !day.isBefore(start) && day.isBefore(end)
    }
    val zone = eventZone(event, home)
    val start = parseInstant(event.startAt).atZone(zone)
    val end = parseInstant(event.endAt).atZone(zone)
    val dayStart = day.atStartOfDay(zone)
    val dayEnd = day.plusDays(1).atStartOfDay(zone)
    return start.isBefore(dayEnd) && end.isAfter(dayStart)
}

fun eventsOn(events: List<CalEvent>, day: LocalDate, home: ZoneId): List<CalEvent> =
    events.filter { occursOn(it, day, home) }.sortedWith(compareBy({ !it.allDay }, { it.startAt }))

fun eventZone(event: CalEvent, home: ZoneId): ZoneId {
    val name = event.timezone ?: return home
    return try {
        ZoneId.of(name)
    } catch (_: Exception) {
        home
    }
}

fun parseInstant(iso: String): Instant = Instant.parse(iso)

fun utcDate(iso: String): LocalDate = parseInstant(iso).atZone(ZoneOffset.UTC).toLocalDate()

/** If the end is not after the start, keep a 30 minute event instead of saving a backwards one. */
fun endMinutes(startMinutes: Int, endMinutes: Int): Int =
    if (endMinutes > startMinutes) endMinutes else startMinutes + 30

fun timedRange(day: LocalDate, startMinutes: Int, endMinutes: Int, zone: ZoneId): Pair<String, String> {
    val end = endMinutes(startMinutes, endMinutes)
    val start = day.atStartOfDay(zone).plusMinutes(startMinutes.toLong()).toInstant()
    val endInstant = day.atStartOfDay(zone).plusMinutes(end.toLong()).toInstant()
    return start.toString() to endInstant.toString()
}

/** All-day events are UTC midnights with an exclusive end. One day is start..start+1. */
fun allDayRange(day: LocalDate): Pair<String, String> {
    val start = day.toString()
    val end = day.plusDays(1).toString()
    return "${start}T00:00:00Z" to "${end}T00:00:00Z"
}

private val DAY_LABEL = DateTimeFormatter.ofPattern("EEE, MMM d")

fun dayLabel(day: LocalDate): String = day.format(DAY_LABEL)

fun formatWhen(event: CalEvent, home: ZoneId, use24h: Boolean): String {
    if (event.allDay) {
        val start = utcDate(event.startAt)
        val end = utcDate(event.endAt).minusDays(1)
        return if (end == start) "All day" else "All day · ${dayLabel(start)} – ${dayLabel(end)}"
    }
    val zone = eventZone(event, home)
    val start = parseInstant(event.startAt).atZone(zone)
    val end = parseInstant(event.endAt).atZone(zone)
    val sameDay = start.toLocalDate() == end.toLocalDate()
    val clock = { value: java.time.ZonedDateTime -> clockLabel(value, use24h) }
    return if (sameDay) "${clock(start)} – ${clock(end)}" else "${dayLabel(start.toLocalDate())} ${clock(start)}"
}

fun clockLabel(value: java.time.ZonedDateTime, use24h: Boolean): String {
    val time = value.toLocalTime()
    if (use24h) return "%02d:%02d".format(time.hour, time.minute)
    val hour = time.hour % 12
    val shown = if (hour == 0) 12 else hour
    val suffix = if (time.hour < 12) "AM" else "PM"
    return "$shown:${"%02d".format(time.minute)} $suffix"
}

fun zoneOrUtc(name: String): ZoneId = try {
    ZoneId.of(name)
} catch (_: Exception) {
    ZoneOffset.UTC
}

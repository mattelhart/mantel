package dev.mantel.calendar.phone

import dev.mantel.calendar.core.CalEvent
import dev.mantel.calendar.core.eventsOn
import dev.mantel.calendar.core.formatWhen
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

data class AgendaLine(val title: String, val whenText: String, val color: String)

fun visibleEvents(events: List<CalEvent>, hiddenUserIds: Set<Int>): List<CalEvent> =
    events.filter { event -> event.userId == null || event.userId !in hiddenUserIds }

fun agendaLines(
    events: List<CalEvent>,
    day: LocalDate,
    zone: ZoneId,
    use24h: Boolean,
    limit: Int = 5,
): List<AgendaLine> =
    eventsOn(events, day, zone).take(limit).map { event ->
        AgendaLine(event.title, formatWhen(event, zone, use24h), event.color)
    }

fun reminderKey(event: CalEvent): String = "${event.id}|${event.startAt}"

/**
 * A timed event that starts within the next hour, or started in the last few
 * minutes and has not ended. All-day events stay quiet: they are already on
 * the home-screen widget.
 */
fun dueForReminder(
    event: CalEvent,
    now: Instant,
    leadMinutes: Long = 60,
    graceMinutes: Long = 10,
): Boolean {
    if (event.allDay) return false
    val start = runCatching { Instant.parse(event.startAt) }.getOrNull() ?: return false
    val end = runCatching { Instant.parse(event.endAt) }.getOrNull() ?: return false
    if (!end.isAfter(now)) return false
    val from = now.minusSeconds(graceMinutes * 60)
    val to = now.plusSeconds(leadMinutes * 60)
    return !start.isBefore(from) && !start.isAfter(to)
}

/** Turns a camera Y plane upright. Degrees follow ImageProxy.imageInfo.rotationDegrees. */
fun rotateLuma(luma: ByteArray, width: Int, height: Int, degrees: Int): Triple<ByteArray, Int, Int> {
    val turns = ((degrees % 360) + 360) % 360
    if (turns == 0 || luma.size < width * height) return Triple(luma, width, height)
    if (turns == 180) {
        val out = ByteArray(width * height)
        val last = width * height - 1
        for (i in 0..last) out[last - i] = luma[i]
        return Triple(out, width, height)
    }
    val out = ByteArray(width * height)
    val clockwise = turns == 90
    for (y in 0 until height) {
        for (x in 0 until width) {
            val src = y * width + x
            val dst = if (clockwise) x * height + (height - 1 - y) else (width - 1 - x) * height + y
            out[dst] = luma[src]
        }
    }
    return Triple(out, height, width)
}

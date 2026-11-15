package dev.mantel.calendar.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import dev.mantel.calendar.core.CalEvent
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

class AgendaTest {
    private val zone = ZoneOffset.UTC
    private val day = LocalDate.of(2026, 11, 15)

    @Test
    fun agendaKeepsAllDayFirstAndStopsAtTheLimit() {
        val events = listOf(
            event(1, "Late", "2026-11-15T22:00:00Z", "2026-11-15T23:00:00Z"),
            event(2, "Trip", "2026-11-15T00:00:00Z", "2026-11-16T00:00:00Z", allDay = true),
            event(3, "Other day", "2026-11-16T15:00:00Z", "2026-11-16T16:00:00Z"),
        )
        val lines = agendaLines(events, day, zone, use24h = true, limit = 1)
        assertEquals("Trip", lines.single().title)
        assertEquals("All day", lines.single().whenText)
    }

    @Test
    fun hidingAPersonLeavesUnclaimedEvents() {
        val events = listOf(
            event(1, "Sam", "2026-11-15T15:00:00Z", "2026-11-15T16:00:00Z", userId = 1),
            event(2, "Family", "2026-11-15T18:00:00Z", "2026-11-15T19:00:00Z", userId = null),
        )
        val shown = visibleEvents(events, setOf(1))
        assertEquals(listOf("Family"), shown.map { it.title })
    }

    @Test
    fun remindersAreTimedEventsStartingSoon() {
        val now = Instant.parse("2026-11-15T18:00:00Z")
        val soon = event(1, "Pickup", "2026-11-15T18:30:00Z", "2026-11-15T19:00:00Z")
        val later = event(2, "Dinner", "2026-11-15T21:00:00Z", "2026-11-15T22:00:00Z")
        val allDay = event(3, "Trip", "2026-11-15T00:00:00Z", "2026-11-16T00:00:00Z", allDay = true)
        val justStarted = event(4, "Call", "2026-11-15T17:55:00Z", "2026-11-15T18:30:00Z")
        val alreadyOver = event(5, "Morning", "2026-11-15T15:00:00Z", "2026-11-15T16:00:00Z")
        assertTrue(dueForReminder(soon, now))
        assertFalse(dueForReminder(later, now))
        assertFalse(dueForReminder(allDay, now))
        assertTrue(dueForReminder(justStarted, now))
        assertFalse(dueForReminder(alreadyOver, now))
        assertEquals("1|2026-11-15T18:30:00Z", reminderKey(soon))
    }

    @Test
    fun rotatingLumaTurnsACornerPixel() {
        val luma = byteArrayOf(1, 2, 3, 4)
        val (turned, width, height) = rotateLuma(luma, 2, 2, 90)
        assertEquals(2, width)
        assertEquals(2, height)
        // 1 2    clockwise    3 1
        // 3 4                 4 2
        assertEquals(3, turned[0].toInt())
        assertEquals(1, turned[1].toInt())
        assertEquals(4, turned[2].toInt())
        assertEquals(2, turned[3].toInt())
    }

    private fun event(
        id: Int,
        title: String,
        start: String,
        end: String,
        allDay: Boolean = false,
        userId: Int? = 1,
    ) = CalEvent(
        id = id,
        calendarId = 1,
        title = title,
        startAt = start,
        endAt = end,
        allDay = allDay,
        userId = userId,
        color = "#3b82f6",
    )
}

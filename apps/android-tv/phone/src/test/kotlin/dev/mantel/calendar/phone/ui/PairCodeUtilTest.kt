package dev.mantel.calendar.phone.ui

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PairCodeUtilTest {
    private val now = Instant.parse("2026-11-21T23:30:00Z")

    @Test
    fun roundsUpToWholeMinutesAndStopsAtZero() {
        assertEquals(10L, minutesLeft("2026-11-21T23:40:00Z", now))
        assertEquals(1L, minutesLeft("2026-11-21T23:30:20Z", now))
        assertEquals(0L, minutesLeft("2026-11-21T23:30:00Z", now))
        assertEquals(0L, minutesLeft("2026-11-21T23:00:00Z", now))
    }

    @Test
    fun anUnreadableTimeIsNotTreatedAsExpired() {
        assertNull(minutesLeft("soon", now))
    }
}

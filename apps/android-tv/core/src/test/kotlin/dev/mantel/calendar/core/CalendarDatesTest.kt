package dev.mantel.calendar.core

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class ServerAddressTest {
    @Test
    fun bareIpUsesTheServerPort() {
        assertEquals("http://192.168.1.20:8080", normalizeServer("192.168.1.20"))
        assertEquals("http://192.168.1.20:9090", normalizeServer("192.168.1.20:9090"))
    }

    @Test
    fun hostnameAndExplicitUrlAreKept() {
        assertEquals("http://familycal.local:8080", normalizeServer("familycal.local"))
        assertEquals("http://familycal.local:8080", normalizeServer("http://familycal.local:8080"))
        assertEquals("http://familycal.local:8080", normalizeServer("http://familycal.local:8080/calendar"))
        assertEquals("https://calendar.example", normalizeServer("https://calendar.example"))
    }

    @Test
    fun blankAndCredentialsAreRejected() {
        assertNull(normalizeServer("  "))
        assertNull(normalizeServer("http://user:pass@192.168.1.20:8080"))
    }

    @Test
    fun discoveryTriesTheSavedAddressThenTheHostname() {
        assertEquals(
            listOf("http://10.0.0.8:8080", "http://familycal.local:8080"),
            discoveryCandidates("10.0.0.8"),
        )
        assertEquals(listOf(FAMILYCAL_ORIGIN), discoveryCandidates(null))
        assertEquals(listOf(FAMILYCAL_ORIGIN), discoveryCandidates("http://familycal.local:8080"))
        assertEquals(listOf(FAMILYCAL_ORIGIN), discoveryCandidates("not a url %%"))
    }

    @Test
    fun aSavedAddressIsProbedTwiceBeforeTheShortHostnameGuess() {
        val steps = probeSchedule("10.0.0.8")
        assertEquals(listOf("http://10.0.0.8:8080", "http://10.0.0.8:8080", FAMILYCAL_ORIGIN), steps.map { it.origin })
        assertTrue(steps[0].saved && steps[1].saved)
        assertFalse(steps[2].saved)
        assertEquals(SAVED_PROBE_TIMEOUT_MS, steps[0].timeoutMs)
        assertEquals(DISCOVERY_TIMEOUT_MS, steps[2].timeoutMs)
        assertTrue("familycal.local should give up before the saved address does", DISCOVERY_TIMEOUT_MS < SAVED_PROBE_TIMEOUT_MS)
    }

    @Test
    fun theSavedHostnameIsNotProbedAgainAsDiscovery() {
        val steps = probeSchedule("familycal.local")
        assertEquals(SAVED_PROBE_ATTEMPTS, steps.size)
        assertTrue(steps.all { it.origin == FAMILYCAL_ORIGIN && it.saved && it.timeoutMs == SAVED_PROBE_TIMEOUT_MS })
    }

    @Test
    fun firstReachableReturnsTheSavedAddressWithoutTryingTheHostname() = runBlocking {
        val seen = mutableListOf<String>()
        val found = firstReachable(probeSchedule("10.1.1.1"), probe = { origin, _ ->
            seen += origin
            origin.contains("10.1.1.1")
        })
        assertEquals("http://10.1.1.1:8080", found)
        assertEquals(listOf("http://10.1.1.1:8080"), seen)
    }

    @Test
    fun aDeadSavedAddressWaitsOnceThenTriesFamilycalQuickly() = runBlocking {
        val pauses = mutableListOf<Long>()
        val seen = mutableListOf<Pair<String, Long>>()
        val found = firstReachable(
            probeSchedule("10.1.1.1"),
            probe = { origin, timeoutMs ->
                seen += origin to timeoutMs
                origin == FAMILYCAL_ORIGIN
            },
            pause = { pauses += it },
        )
        assertEquals(FAMILYCAL_ORIGIN, found)
        assertEquals(
            listOf(
                "http://10.1.1.1:8080" to SAVED_PROBE_TIMEOUT_MS,
                "http://10.1.1.1:8080" to SAVED_PROBE_TIMEOUT_MS,
                FAMILYCAL_ORIGIN to DISCOVERY_TIMEOUT_MS,
            ),
            seen,
        )
        assertEquals(listOf(PROBE_BACKOFF_MS), pauses)
    }

    @Test
    fun nothingReachableLeavesTheSavedAddressToPrefill() = runBlocking {
        val found = firstReachable(probeSchedule("192.168.1.20"), probe = { _, _ -> false })
        assertNull(found)
        assertEquals("http://192.168.1.20:8080", savedAddressPrefill("192.168.1.20"))
        assertEquals("", savedAddressPrefill(null))
        assertEquals("", savedAddressPrefill("   "))
        val missed = discoveryMissMessage("192.168.1.20")
        assertTrue(missed.contains("saved"))
        assertFalse(missed.contains("Pi"))
        val fresh = discoveryMissMessage(null)
        assertTrue(fresh.contains("familycal.local"))
        assertFalse(fresh.contains("Pi"))
    }

    @Test
    fun aPublicAddressIsSkippedSoTheHostnameCanStillAnswer() = runBlocking {
        val seen = mutableListOf<String>()
        val found = firstReachable(
            probeSchedule("8.8.8.8"),
            probe = { origin, _ ->
                seen += origin
                true
            },
            allow = ::cleartextPermitted,
        )
        assertEquals(FAMILYCAL_ORIGIN, found)
        assertEquals(listOf(FAMILYCAL_ORIGIN), seen)
    }

    @Test
    fun anIpPrefersTheNumericKeypadAndANameDoesNot() {
        assertTrue(prefersNumericKeypad(""))
        assertTrue(prefersNumericKeypad("192.168.1.20"))
        assertTrue(prefersNumericKeypad("http://10.0.0.8:8080"))
        assertFalse(prefersNumericKeypad("familycal.local"))
        assertFalse(prefersNumericKeypad("http://familycal.local:8080"))
    }

    @Test
    fun anUnreachableServerNamesTheAddress() {
        val text = unreachableMessage("http://192.168.1.20:8080")
        assertTrue(text.contains("192.168.1.20"))
        assertTrue(text.contains("calendar server"))
        assertFalse(text.contains("Pi"))
        val down = ServerProbe.Down.failureMessage("http://10.0.0.8:8080")
        assertTrue(down!!.contains("10.0.0.8"))
        val sick = ServerProbe.Unhealthy(503).failureMessage("http://10.0.0.8:8080")
        assertTrue(sick!!.contains("503"))
    }

    @Test
    fun anExpiredPairingCodeIsToldApartFromARevokedDevice() {
        val expired = pairingFailureMessage(401, "That pairing code is wrong or has expired.")
        assertTrue(expired.contains("expired"))
        val bare = pairingFailureMessage(401, "This API needs a device token.")
        assertTrue(bare.contains("expired") || bare.contains("already used"))
        assertEquals(
            "Too many pairing attempts. Wait a few minutes and try again.",
            pairingFailureMessage(429, "  "),
        )
        val revoked = revokedDeviceMessage()
        assertTrue(revoked.contains("no longer paired"))
        assertFalse(revoked.contains("Pi"))
    }
}

class CalendarDatesTest {
    private val ny = ZoneId.of("America/New_York")
    private val sunday = LocalDate.of(2026, 11, 15)

    @Test
    fun weekRespectsTheHouseholdStartDay() {
        assertEquals(sunday, weekDays(sunday, weekStartsOn = 0).first())
        assertEquals(LocalDate.of(2026, 11, 9), weekDays(sunday, weekStartsOn = 1).first())
        assertEquals(7, weekDays(sunday, 0).size)
    }

    @Test
    fun november2026GridStartsOnSundayWhenTheWeekDoes() {
        val grid = monthGrid(sunday, weekStartsOn = 0)
        assertEquals(LocalDate.of(2026, 11, 1), grid.first())
        assertEquals(0, grid.size % 7)
        assertTrue(grid.contains(LocalDate.of(2026, 11, 30)))
    }

    @Test
    fun mondayWeeksIncludeTheTrailingDaysOfOctober() {
        assertEquals(LocalDate.of(2026, 10, 26), monthGrid(sunday, weekStartsOn = 1).first())
    }

    @Test
    fun steppingMovesADayAWeekOrAMonth() {
        assertEquals(LocalDate.of(2026, 11, 16), step(ViewKind.AGENDA, sunday, 1))
        assertEquals(LocalDate.of(2026, 11, 22), step(ViewKind.WEEK, sunday, 1))
        assertEquals(LocalDate.of(2026, 12, 15), step(ViewKind.MONTH, sunday, 1))
    }

    @Test
    fun allDayEventsUseUtcDatesAndAnExclusiveEnd() {
        val trip = event(allDay = true, start = "2026-08-01T00:00:00Z", end = "2026-08-03T00:00:00Z")
        val la = ZoneId.of("America/Los_Angeles")
        assertTrue(occursOn(trip, LocalDate.of(2026, 8, 1), la))
        assertTrue(occursOn(trip, LocalDate.of(2026, 8, 2), la))
        assertFalse("the exclusive end is not a third day", occursOn(trip, LocalDate.of(2026, 8, 3), la))
        assertFalse("a west-of-UTC zone must not drag it onto July 31", occursOn(trip, LocalDate.of(2026, 7, 31), la))
    }

    @Test
    fun aLateUtcInstantCanBeThePreviousEveningAtHome() {
        val pickup = event(start = "2026-11-15T04:00:00Z", end = "2026-11-15T05:00:00Z")
        assertTrue(occursOn(pickup, LocalDate.of(2026, 11, 14), ny))
        assertFalse(occursOn(pickup, LocalDate.of(2026, 11, 15), ny))
    }

    @Test
    fun anEventThatCrossesMidnightShowsOnBothDays() {
        val late = event(start = "2026-11-16T04:30:00Z", end = "2026-11-16T05:30:00Z")
        // 23:30–00:30 in New York.
        assertTrue(occursOn(late, LocalDate.of(2026, 11, 15), ny))
        assertTrue(occursOn(late, LocalDate.of(2026, 11, 16), ny))
    }

    @Test
    fun endFollowsStartWhenItWouldOtherwiseBeBackwards() {
        assertEquals(15 * 60, endMinutes(14 * 60, 15 * 60))
        assertEquals(23 * 60 + 60, endMinutes(23 * 60 + 30, 23 * 60))
    }

    @Test
    fun allDayRangeIsAnExclusiveUtcDay() {
        val (start, end) = allDayRange(LocalDate.of(2026, 8, 1))
        assertEquals("2026-08-01T00:00:00Z", start)
        assertEquals("2026-08-02T00:00:00Z", end)
    }

    @Test
    fun todayFollowsTheHouseholdZone() {
        val now = Instant.parse("2026-11-15T14:00:00Z")
        assertEquals(LocalDate.of(2026, 11, 16), todayIn(ZoneId.of("Pacific/Auckland"), now))
        assertEquals(LocalDate.of(2026, 11, 15), todayIn(ny, now))
    }

    @Test
    fun fetchWindowPadsADayEitherSide() {
        val (start, end) = fetchInstants(LocalDate.of(2026, 11, 15), LocalDate.of(2026, 11, 16), ny)
        assertTrue(start.isBefore(Instant.parse("2026-11-15T05:00:00Z")))
        assertTrue(end.isAfter(Instant.parse("2026-11-16T05:00:00Z")))
    }

    private fun event(start: String, end: String, allDay: Boolean = false) = CalEvent(
        id = 1,
        calendarId = 1,
        title = "Trip",
        startAt = start,
        endAt = end,
        allDay = allDay,
    )
}

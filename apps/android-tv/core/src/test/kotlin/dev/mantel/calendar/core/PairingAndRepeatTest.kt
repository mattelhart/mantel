package dev.mantel.calendar.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class PairingAndRepeatTest {
    @Test
    fun cleartextIsAllowedOnTheLanAndOnTailscale() {
        assertTrue(cleartextPermitted("192.168.1.20"))
        assertTrue(cleartextPermitted("http://10.8.0.4:8080"))
        assertTrue(cleartextPermitted("http://172.16.4.2:8080"))
        assertTrue(cleartextPermitted("http://100.64.0.1:8080"))
        assertTrue(cleartextPermitted("http://100.127.255.9:8080"))
        assertTrue(cleartextPermitted("http://familycal.local:8080"))
        assertTrue(cleartextPermitted("http://localhost:8080"))
        assertTrue(cleartextPermitted("https://calendar.example"))
    }

    @Test
    fun aPublicIpOverHttpIsRefused() {
        assertFalse("a port-forward is not how a phone should reach Homie", cleartextPermitted("http://8.8.8.8:8080"))
        assertFalse(cleartextPermitted("http://100.128.0.1:8080"))
        assertFalse(cleartextPermitted("http://100.63.1.1:8080"))
        assertFalse(cleartextPermitted("http://172.32.0.1:8080"))
    }

    @Test
    fun thePairingQrCarriesTheServerAndTheCode() {
        val link = parsePairingLink(
            "mantel://pair?v=1&base=http%3A%2F%2F192.168.1.20%3A8080&code=K7NQ-4RMP",
        )
        assertEquals("http://192.168.1.20:8080", link?.base)
        assertEquals("K7NQ4RMP", link?.code)
        assertTrue(pairCodeComplete("k7nq-4rmp"))
        assertFalse("0, O, 1 and I are not in the alphabet", pairCodeComplete("K7NQ0RMP"))
        assertNull(parsePairingLink("https://example.com"))
        assertNull(parsePairingLink("mantel://pair?base=http%3A%2F%2F10.0.0.2%3A8080&code=SHORT"))
    }

    @Test
    fun theQrTheWallShowsNowIsReadByThePhone() {
        // Exactly what backend/app/routers/auth.py builds for the Pi at 10.0.15.178.
        val payload = "mantel://pair?v=1&base=http%3A%2F%2F10.0.15.178%3A8080&code=TFT3-L6Y7"
        val link = parsePairingLink(payload)
        assertEquals("http://10.0.15.178:8080", link?.base)
        assertEquals("TFT3L6Y7", link?.code)
        assertTrue(cleartextPermitted(link!!.base))
    }

    @Test
    fun aCodeTypedWithOrWithoutTheDashIsTheSameCode() {
        for (typed in listOf("TFT3-L6Y7", "tft3-l6y7", "TFT3L6Y7", " TFT3 L6Y7 ", "TFT3\u2013L6Y7")) {
            assertTrue(typed, pairCodeComplete(typed))
            assertEquals("TFT3L6Y7", normalizePairCode(typed))
        }
        assertFalse(pairCodeComplete("TFT3-L6Y"))
        assertFalse("a typed 0 is not in the alphabet", pairCodeComplete("TFT3-L6Y0"))
    }

    @Test
    fun weeklyRuleRoundTripsTheDaysTheWallSends() {
        val choice = RepeatChoice(RepeatFreq.WEEKLY, listOf("WE", "MO"), "2026-12-31")
        val rule = buildRepeat(choice)
        assertEquals("FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T235959", rule)
        val parsed = parseRepeat(rule)
        assertEquals(RepeatFreq.WEEKLY, parsed.freq)
        assertEquals(listOf("MO", "WE"), parsed.byday)
        assertEquals("2026-12-31", parsed.until)
        assertNull(buildRepeat(RepeatChoice()))
    }

    @Test
    fun aSeriesAndASingleGoogleOccurrenceAreEditedDifferently() {
        val series = event(recurring = true, rule = "FREQ=DAILY")
        val occurrence = event(recurring = true, rule = null)
        val once = event(recurring = false, rule = null)
        val locked = once.copy(editable = false)
        assertEquals(EventEditKind.Series, eventEditKind(series))
        assertEquals(EventEditKind.Occurrence, eventEditKind(occurrence))
        assertEquals(EventEditKind.Single, eventEditKind(once))
        assertEquals(EventEditKind.ReadOnly, eventEditKind(locked))
        assertEquals(EventEditKind.Create, eventEditKind(null))
    }

    @Test
    fun sundayIsTheFirstWeekdayCode() {
        assertEquals("SU", weekdayCode(LocalDate.of(2026, 11, 15)))
        assertEquals("MO", weekdayCode(LocalDate.of(2026, 11, 16)))
    }

    @Test
    fun anAllDaySpanKeepsTheLastDay() {
        val (start, end) = allDaySpan(LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 3))
        assertEquals("2026-08-01T00:00:00Z", start)
        assertEquals("2026-08-04T00:00:00Z", end)
    }

    private fun event(recurring: Boolean, rule: String?) = CalEvent(
        id = 1,
        calendarId = 1,
        title = "Practice",
        startAt = "2026-11-15T19:00:00Z",
        endAt = "2026-11-15T20:00:00Z",
        recurring = recurring,
        recurrenceRule = rule,
    )
}

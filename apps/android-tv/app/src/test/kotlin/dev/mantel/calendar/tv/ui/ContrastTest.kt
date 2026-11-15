package dev.mantel.calendar.tv.ui

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ContrastTest {
    @Test
    fun textOnTheWarmPaperClearsAa() {
        assertAtLeast(4.5, Ink, Paper, "body text")
        assertAtLeast(4.5, Dim, Paper, "field label and placeholder")
        assertAtLeast(4.5, Ember, Paper, "accent text")
        assertAtLeast(4.5, Danger, Paper, "error")
        assertAtLeast(4.5, Line, Paper, "border used as text")
        assertAtLeast(4.5, Ink, Card, "text on a card")
        assertAtLeast(4.5, Ember, Card, "count on a day cell")
    }

    @Test
    fun textOnButtonFillsClearsAa() {
        assertAtLeast(4.5, Ink, Coral, "label on an orange button")
        assertAtLeast(4.5, Ink, Sun, "label on a yellow button")
        assertAtLeast(4.5, Ink, Sky, "label on a blue button")
        assertTrue("white on the orange button is below AA", wcagContrast(Color.White, Coral) < 4.5)
    }

    @Test
    fun nightTextClearsAa() {
        assertAtLeast(4.5, NightInk, NightPaper, "body text")
        assertAtLeast(4.5, NightInk, NightCard, "text on a card")
        assertAtLeast(4.5, NightDim, NightPaper, "field label and placeholder")
        assertAtLeast(4.5, NightDim, NightCard, "placeholder on the field")
        assertAtLeast(4.5, NightEmber, NightPaper, "accent text")
        assertAtLeast(4.5, NightDanger, NightPaper, "error")
        assertAtLeast(4.5, NightLine, NightPaper, "border used as text")
        assertAtLeast(4.5, Ink, Coral, "label on an orange button at night")
    }

    @Test
    fun aDarkPersonColourGetsWhiteText() {
        assertEquals(Color.White, readableOn(Color(0xFF1D4ED8)))
        assertEquals(Ink, readableOn(Paper))
    }

    private fun assertAtLeast(min: Double, foreground: Color, background: Color, what: String) {
        val ratio = wcagContrast(foreground, background)
        assertTrue("$what is ${"%.2f".format(ratio)}:1, needs $min:1", ratio >= min)
    }
}

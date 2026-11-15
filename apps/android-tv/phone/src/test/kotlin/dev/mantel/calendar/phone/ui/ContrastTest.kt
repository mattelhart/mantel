package dev.mantel.calendar.phone.ui

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.pow

class ContrastTest {
    @Test
    fun lightConnectScreenClearsAa() {
        val light = mantelLight()
        assertAtLeast(4.5, light.onSurface, light.surface, "typed text on the field")
        assertAtLeast(4.5, light.onSurface, light.background, "body text on paper")
        assertAtLeast(4.5, light.onSurfaceVariant, light.surface, "placeholder on the field")
        assertAtLeast(4.5, light.onSurfaceVariant, light.background, "label on paper")
        assertAtLeast(4.5, light.error, light.background, "error on paper")
        assertAtLeast(4.5, light.error, light.surface, "error on the field")
        assertAtLeast(4.5, light.primary, light.background, "outlined button text on paper")
        assertAtLeast(4.5, light.onPrimary, light.primary, "text on a rust fill")
        assertAtLeast(4.5, Ink, Coral, "text on the orange connect button")
        assertAtLeast(4.5, light.onSecondaryContainer, light.secondaryContainer, "selected navigation label")
        assertAtLeast(4.5, light.onErrorContainer, light.errorContainer, "text on an error banner")
        assertAtLeast(4.5, light.outline, light.surface, "day number outside the month")
    }

    @Test
    fun darkTextClearsAa() {
        val dark = mantelDark()
        assertAtLeast(4.5, dark.onSurface, dark.background, "body text")
        assertAtLeast(4.5, dark.onSurface, dark.surface, "text on a card")
        assertAtLeast(4.5, dark.onSurfaceVariant, dark.background, "secondary text")
        assertAtLeast(4.5, dark.onSurfaceVariant, dark.surface, "placeholder on a card")
        assertAtLeast(4.5, dark.error, dark.background, "error")
        assertAtLeast(4.5, dark.primary, dark.background, "outlined button text")
        assertAtLeast(4.5, dark.onPrimary, dark.primary, "text on a filled button")
        assertAtLeast(4.5, dark.onErrorContainer, dark.errorContainer, "text on an error banner")
        assertAtLeast(4.5, dark.onSecondaryContainer, dark.secondaryContainer, "selected navigation label")
    }

    private fun assertAtLeast(min: Double, foreground: Color, background: Color, what: String) {
        val ratio = wcag(foreground, background)
        assertTrue("$what is ${"%.2f".format(ratio)}:1, needs $min:1", ratio >= min)
    }
}

private fun wcag(foreground: Color, background: Color): Double {
    fun channel(c: Float): Double {
        val x = c.toDouble()
        return if (x <= 0.04045) x / 12.92 else ((x + 0.055) / 1.055).pow(2.4)
    }
    fun lum(color: Color) = 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue)
    val hi = maxOf(lum(foreground), lum(background))
    val lo = minOf(lum(foreground), lum(background))
    return (hi + 0.05) / (lo + 0.05)
}

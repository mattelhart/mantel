package dev.mantel.calendar.phone.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** Near-black ink. Typed text and body copy. */
internal val Ink = Color(0xFF1C2430)

/** Warm paper behind the screens. */
internal val Paper = Color(0xFFF6F3EE)

/** Bright orange for a filled button. Ink on this clears 4.5:1; white does not. */
internal val Coral = Color(0xFFE36A3A)

/** Dark rust. Primary text on paper: outlined buttons, labels, links. */
internal val Ember = Color(0xFF8C3A16)

/** Dark red for errors on paper. Light mode only; dark mode uses a light red. */
internal val Danger = Color(0xFF9B1C1C)

/** Secondary text, placeholders, field labels. Clears 4.5:1 on paper and white. */
internal val Dim = Color(0xFF3D4A5C)

/** Field and chip borders, and day numbers outside the month. */
internal val Line = Color(0xFF4E5968)

fun parseHex(hex: String, fallback: Color = Color(0xFF3B82F6)): Color {
    val body = hex.removePrefix("#")
    val value = body.toLongOrNull(16) ?: return fallback
    return when (body.length) {
        6 -> Color(0xFF000000 or value)
        8 -> Color(value)
        else -> fallback
    }
}

fun onColor(color: Color): Color {
    val luminance = 0.299f * color.red + 0.587f * color.green + 0.114f * color.blue
    return if (luminance > 0.62f) Color(0xFF1C2430) else Color.White
}

fun Modifier.touchTarget(): Modifier = heightIn(min = 56.dp)

@Composable
private fun lightSurface(): Boolean = MaterialTheme.colorScheme.background.luminance() > 0.5f

/** Filled actions stay the warm orange. The scheme primary is the darker rust, because that color is also drawn as text. */
@Composable
fun WarmButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    val scheme = MaterialTheme.colorScheme
    val light = lightSurface()
    Button(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (light) Coral else scheme.primary,
            contentColor = if (light) Ink else scheme.onPrimary,
            disabledContainerColor = scheme.surfaceVariant,
            disabledContentColor = scheme.onSurfaceVariant,
        ),
        content = content,
    )
}

@Composable
fun warmContainer(): Color = if (lightSurface()) Coral else MaterialTheme.colorScheme.primary

@Composable
fun warmOnContainer(): Color = if (lightSurface()) Ink else MaterialTheme.colorScheme.onPrimary

/** Input, label, and placeholder are set explicitly. The defaults were rendering as pale gray on this paper. */
@Composable
fun mantelFieldColors(): TextFieldColors {
    val scheme = MaterialTheme.colorScheme
    return OutlinedTextFieldDefaults.colors(
        focusedTextColor = scheme.onSurface,
        unfocusedTextColor = scheme.onSurface,
        disabledTextColor = scheme.onSurface,
        errorTextColor = scheme.onSurface,
        focusedLabelColor = scheme.primary,
        unfocusedLabelColor = scheme.onSurfaceVariant,
        disabledLabelColor = scheme.onSurfaceVariant,
        errorLabelColor = scheme.error,
        focusedPlaceholderColor = scheme.onSurfaceVariant,
        unfocusedPlaceholderColor = scheme.onSurfaceVariant,
        disabledPlaceholderColor = scheme.onSurfaceVariant,
        cursorColor = scheme.primary,
        errorCursorColor = scheme.error,
        focusedBorderColor = scheme.primary,
        unfocusedBorderColor = scheme.outline,
        disabledBorderColor = scheme.outline,
        errorBorderColor = scheme.error,
    )
}

@Composable
fun OfflineBanner(text: String) {
    Box(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.tertiaryContainer)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        Text(text, color = MaterialTheme.colorScheme.onTertiaryContainer, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun MessageBanner(text: String) {
    Text(
        text,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .background(MaterialTheme.colorScheme.errorContainer, RoundedCornerShape(12.dp))
            .padding(12.dp),
        color = MaterialTheme.colorScheme.onErrorContainer,
    )
}

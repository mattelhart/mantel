package dev.mantel.calendar.tv.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import kotlin.math.pow
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Border
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.Surface

val Ink = Color(0xFF1C2430)
val Paper = Color(0xFFFFFFFF)
val Sun = Color(0xFFDCEFF1)
val Coral = Color(0xFFBDE2EA)
val Sky = Color(0xFFD7F0FF)
val Card = Color.White

/** Text on paper. Coral itself is about 2.4:1 on this paper, so it stays a button fill. */
val Ember = Color(0xFF176B7C)
val Danger = Color(0xFF9B1C1C)
val Dim = Color(0xFF3D4A5C)
val Line = Color(0xFF4E5968)

/** Ink when it clears AA on [background], otherwise white. Person colours are chosen by the family. */
fun readableOn(background: Color): Color =
    if (wcagContrast(Ink, background) >= 4.5) Ink else Color.White

fun wcagContrast(foreground: Color, background: Color): Double {
    fun lum(color: Color): Double {
        fun channel(c: Float): Double {
            val x = c.toDouble()
            return if (x <= 0.04045) x / 12.92 else ((x + 0.055) / 1.055).pow(2.4)
        }
        return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue)
    }
    val hi = maxOf(lum(foreground), lum(background))
    val lo = minOf(lum(foreground), lum(background))
    return (hi + 0.05) / (lo + 0.05)
}

private val Round = RoundedCornerShape(20.dp)

@Composable
fun SunnyButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    container: Color = Card,
    content: @Composable BoxScope.() -> Unit,
) {
    Surface(
        onClick = onClick,
        modifier = modifier,
        shape = ClickableSurfaceDefaults.shape(shape = Round, focusedShape = Round, pressedShape = Round),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = container,
            focusedContainerColor = Sun,
            contentColor = Ink,
            focusedContentColor = Ink,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.05f),
        border = ClickableSurfaceDefaults.border(
            border = Border(border = BorderStroke(2.dp, Color(0xFFE1E6EB)), shape = Round),
            focusedBorder = Border(border = BorderStroke(4.dp, Color(0xFF1D4ED8)), shape = Round),
        ),
        content = content,
    )
}

@Composable
fun SunnyField(
    value: String,
    onValue: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    keyboardType: KeyboardType = KeyboardType.Text,
    onSubmit: (() -> Unit)? = null,
) {
    val focus = LocalFocusManager.current
    val scheme = MaterialTheme.colorScheme
    OutlinedTextField(
        value = value,
        onValueChange = onValue,
        label = { Text(label, fontSize = 18.sp) },
        singleLine = true,
        textStyle = TextStyle(fontSize = 24.sp, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold),
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = scheme.surface,
            unfocusedContainerColor = scheme.surface,
            disabledContainerColor = scheme.surface,
            errorContainerColor = scheme.surface,
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
            cursorColor = scheme.primary,
            errorCursorColor = scheme.error,
            focusedBorderColor = scheme.primary,
            unfocusedBorderColor = scheme.outline,
            errorBorderColor = scheme.error,
        ),
        keyboardOptions = KeyboardOptions(
            keyboardType = keyboardType,
            imeAction = if (onSubmit == null) ImeAction.Default else ImeAction.Done,
            autoCorrectEnabled = keyboardType == KeyboardType.Text,
        ),
        keyboardActions = KeyboardActions(
            onDone = {
                onSubmit?.invoke()
                focus.clearFocus()
            },
        ),
        modifier = modifier.onPreviewKeyEvent { event ->
            if (event.type == KeyEventType.KeyUp && event.key == Key.Back) {
                focus.clearFocus()
                true
            } else {
                false
            }
        },
    )
}

@Composable
fun BigTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier = modifier.padding(bottom = 8.dp), color = MaterialTheme.colorScheme.onSurface, fontSize = 36.sp, fontFamily = androidx.compose.ui.text.font.FontFamily.Serif, fontWeight = FontWeight.Medium)
}

fun parseColor(hex: String): Color {
    val body = hex.removePrefix("#")
    val value = body.toLongOrNull(16) ?: return Coral
    return when (body.length) {
        6 -> Color(0xFF000000 or value)
        8 -> Color(value)
        else -> Coral
    }
}

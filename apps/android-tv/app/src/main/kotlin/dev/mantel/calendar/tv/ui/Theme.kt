package dev.mantel.calendar.tv.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusManager
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Border
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.Surface

val Ink = Color(0xFF1C2430)
val Paper = Color(0xFFFFF6E4)
val Sun = Color(0xFFFFE38A)
val Coral = Color(0xFFFF7A45)
val Sky = Color(0xFFD7F0FF)
val Card = Color.White

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
            border = Border(border = BorderStroke(2.dp, Color(0xFFFFD78A)), shape = Round),
            focusedBorder = Border(border = BorderStroke(5.dp, Ink), shape = Round),
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
) {
    val focus = LocalFocusManager.current
    OutlinedTextField(
        value = value,
        onValueChange = onValue,
        label = { Text(label, fontSize = 18.sp) },
        singleLine = true,
        textStyle = TextStyle(fontSize = 24.sp, color = Ink, fontWeight = FontWeight.SemiBold),
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
    Text(text, modifier = modifier.padding(bottom = 8.dp), color = Ink, fontSize = 40.sp, fontWeight = FontWeight.Bold)
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

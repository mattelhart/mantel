package dev.mantel.calendar.phone.ui

import android.graphics.Bitmap
import android.util.Base64
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.mantel.calendar.core.Conversation
import dev.mantel.calendar.core.ConversationMessage
import dev.mantel.calendar.core.conversationPreview
import dev.mantel.calendar.core.messageMediaId
import dev.mantel.calendar.core.messageStatusLabel
import dev.mantel.calendar.phone.PhoneState
import dev.mantel.calendar.phone.PhoneViewModel
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.delay

private val KidMin = 64.dp
private val DoodleColors = listOf(
    Color(0xFF1C2430),
    Color(0xFFC0392B),
    Color(0xFFD35400),
    Color(0xFFF1C40F),
    Color(0xFF27AE60),
    Color(0xFF2980B9),
    Color(0xFF8E44AD),
    Color.White,
)
private val TimeFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("h:mm a")

private data class DoodleStroke(
    val color: Color,
    val width: Float,
    val points: List<Offset>,
    val erase: Boolean,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MessagesScreen(state: PhoneState, vm: PhoneViewModel, open: (Page) -> Unit) {
    val listing = state.conversations
    PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (!listing.configured) {
                Text(
                    "Ask a grown-up to turn on Messages in Settings so you can send notes and pictures.",
                    style = MaterialTheme.typography.titleMedium,
                )
            } else if (listing.conversations.isEmpty()) {
                Text(
                    "Ask a grown-up to add your family in Settings, then you can send messages.",
                    style = MaterialTheme.typography.titleMedium,
                )
            }
            WarmButton(
                onClick = { open(Page.Draw(null)) },
                modifier = Modifier.fillMaxWidth().heightIn(min = KidMin),
            ) { Text("Draw a picture") }
            listing.conversations.forEach { item ->
                Surface(
                    onClick = { open(Page.Thread(item.id)) },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 96.dp),
                    shape = RoundedCornerShape(24.dp),
                ) {
                    Row(
                        Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        PersonAvatar(item.name, item.color, item.avatarEmoji, 72.dp)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(item.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                            Text(
                                conversationPreview(item),
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                            )
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MessageThreadScreen(id: String, state: PhoneState, vm: PhoneViewModel, openDraw: () -> Unit) {
    LaunchedEffect(id) { vm.openThread(id) }
    val thread = state.threads[id] ?: state.conversations.conversations.find { it.id == id }
    val media by vm.media.collectAsStateWithLifecycle()
    var text by remember(id) { mutableStateOf("") }
    var error by remember(id) { mutableStateOf<String?>(null) }
    var justSent by remember(id) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()
    val messages = thread?.messages.orEmpty()
    val canSend = thread?.canSend == true && listingConfigured(state) && thread.userId != null
    val quick = state.conversations.quickReplies.ifEmpty { listOf("Dinner's ready", "Call me", "On my way?") }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
    }
    LaunchedEffect(justSent) {
        if (justSent) {
            delay(3200)
            justSent = false
        }
    }

    if (thread == null) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Loading conversation…", style = MaterialTheme.typography.titleMedium)
        }
        return
    }

    fun send(body: String, media: String? = null) {
        val userId = thread.userId ?: return
        val trimmed = body.trim()
        if (trimmed.isEmpty() && media.isNullOrBlank()) return
        busy = true
        error = null
        vm.sendMessage(userId, trimmed, media) { message ->
            busy = false
            if (message == null) {
                text = ""
                justSent = true
            } else {
                error = message
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            PersonAvatar(thread.name, thread.color, thread.avatarEmoji, 56.dp)
            Text(thread.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        }
        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (messages.isEmpty()) {
                item {
                    Text(
                        if (canSend) "No messages yet. Send a note or draw a picture." else "No messages yet.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            items(messages, key = { it.id }) { message ->
                MessageBubble(message, thread.color, media, vm.zone())
            }
        }
        if (canSend) {
            Column(
                Modifier.fillMaxWidth().padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    quick.forEach { chip ->
                        OutlinedButton(
                            onClick = { send(chip) },
                            modifier = Modifier.heightIn(min = KidMin),
                        ) { Text(chip) }
                    }
                }
                OutlinedTextField(
                    text,
                    { text = it },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("Write a note…") },
                    enabled = !busy,
                    colors = mantelFieldColors(),
                )
                if (justSent && error == null) {
                    Text(
                        "Sent!",
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(16.dp))
                            .background(MaterialTheme.colorScheme.primaryContainer)
                            .padding(12.dp),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                    )
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.titleMedium) }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(onClick = openDraw, modifier = Modifier.weight(1f).heightIn(min = KidMin)) {
                        Text("Draw")
                    }
                    WarmButton(
                        onClick = { send(text) },
                        enabled = !busy && text.isNotBlank(),
                        modifier = Modifier.weight(1f).heightIn(min = KidMin),
                    ) { Text(if (busy) "Sending…" else "Send") }
                }
            }
        } else {
            Surface(
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                shape = RoundedCornerShape(20.dp),
            ) {
                Text(
                    if (thread.unknown) {
                        "This isn't someone in the family, so you can't send a message."
                    } else {
                        "Ask a grown-up to add a phone number so you can send messages to ${thread.name}."
                    },
                    modifier = Modifier.padding(18.dp),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DrawMessageScreen(conversationId: String?, state: PhoneState, vm: PhoneViewModel, back: () -> Unit) {
    val thread = conversationId?.let { id ->
        state.threads[id] ?: state.conversations.conversations.find { it.id == id }
    }
    var color by remember { mutableStateOf(DoodleColors.first()) }
    var eraser by remember { mutableStateOf(false) }
    val strokes = remember { mutableStateListOf<DoodleStroke>() }
    var canvasSize by remember { mutableStateOf(IntSize.Zero) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var justSent by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf(false) }
    var png by remember { mutableStateOf<String?>(null) }
    var chosenId by remember { mutableStateOf(thread?.userId) }
    val brush = with(LocalDensity.current) { 22.dp.toPx() }
    val empty = strokes.isEmpty()
    val people = state.conversations.conversations
    val chosen = people.find { it.userId == chosenId && it.canSend }

    LaunchedEffect(justSent) {
        if (justSent) {
            delay(900)
            back()
        }
    }

    if (picking) {
        Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Who should get this?", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            people.forEach { person ->
                val ready = person.canSend && person.userId != null
                Surface(
                    onClick = { if (ready) chosenId = person.userId },
                    enabled = ready,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 96.dp),
                    shape = RoundedCornerShape(24.dp),
                    color = if (chosenId == person.userId) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
                ) {
                    Row(
                        Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        PersonAvatar(person.name, person.color, person.avatarEmoji, 72.dp)
                        Column(Modifier.weight(1f)) {
                            Text(person.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                            Text(
                                if (ready) "Tap to pick" else "Ask a grown-up to add a phone number",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.titleMedium) }
            if (justSent) {
                Text("Sent!", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                OutlinedButton(onClick = { picking = false }, modifier = Modifier.weight(1f).heightIn(min = KidMin)) { Text("Back") }
                WarmButton(
                    onClick = {
                        val userId = chosen?.userId
                        val image = png
                        if (userId == null || image == null) {
                            error = "Pick someone to send this to."
                            return@WarmButton
                        }
                        busy = true
                        error = null
                        vm.sendMessage(userId, "", image) { message ->
                            busy = false
                            if (message == null) justSent = true else error = message
                        }
                    },
                    enabled = !busy && chosen != null && png != null,
                    modifier = Modifier.weight(1f).heightIn(min = KidMin),
                ) { Text(if (busy) "Sending…" else if (justSent) "Sent!" else "Send") }
            }
        }
        return
    }

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Draw a picture", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        if (chosen != null) {
            Text("For ${chosen.name}", style = MaterialTheme.typography.titleMedium)
        }
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            DoodleColors.forEach { value ->
                Box(
                    Modifier
                        .size(56.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(value)
                        .border(
                            3.dp,
                            if (!eraser && color == value) MaterialTheme.colorScheme.primary else Color(0x33000000),
                            RoundedCornerShape(16.dp),
                        )
                        .clickable {
                            color = value
                            eraser = false
                        },
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ToolButton("Eraser", eraser) { eraser = !eraser }
            ToolButton("Undo", false) { if (strokes.isNotEmpty()) strokes.removeAt(strokes.lastIndex) }
            ToolButton("Clear", false) { strokes.clear() }
        }
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .clip(RoundedCornerShape(24.dp))
                .background(Color(0xFFF4F1EA))
                .onSizeChanged { canvasSize = it }
                .pointerInput(color, eraser, brush) {
                    detectDragGestures(
                        onDragStart = { start ->
                            strokes.add(DoodleStroke(color, brush, listOf(start), eraser))
                        },
                        onDrag = { change, _ ->
                            change.consume()
                            if (strokes.isEmpty()) return@detectDragGestures
                            val last = strokes.removeAt(strokes.lastIndex)
                            strokes.add(last.copy(points = last.points + change.position))
                        },
                    )
                },
        ) {
            Canvas(Modifier.fillMaxSize()) {
                strokes.forEach { stroke -> drawDoodleStroke(stroke) }
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.titleMedium) }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
            OutlinedButton(onClick = back, modifier = Modifier.weight(1f).heightIn(min = KidMin)) { Text("Cancel") }
            WarmButton(
                onClick = {
                    val image = exportDoodle(strokes, canvasSize) ?: return@WarmButton
                    png = image
                    if (chosen?.userId != null) {
                        busy = true
                        error = null
                        vm.sendMessage(chosen.userId!!, "", image) { message ->
                            busy = false
                            if (message == null) justSent = true else error = message
                        }
                    } else {
                        picking = true
                    }
                },
                enabled = !busy && !empty,
                modifier = Modifier.weight(1f).heightIn(min = KidMin),
            ) { Text(if (busy) "Sending…" else if (justSent) "Sent!" else "Send") }
        }
    }
}

@Composable
private fun ToolButton(label: String, on: Boolean, onClick: () -> Unit) {
    if (on) {
        Button(onClick = onClick, modifier = Modifier.heightIn(min = KidMin)) { Text(label) }
    } else {
        OutlinedButton(onClick = onClick, modifier = Modifier.heightIn(min = KidMin)) { Text(label) }
    }
}

@Composable
private fun PersonAvatar(name: String, color: String, emoji: String?, size: androidx.compose.ui.unit.Dp) {
    val fill = parseHex(color)
    Box(
        Modifier.size(size).clip(CircleShape).background(fill),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            emoji?.takeIf { it.isNotBlank() } ?: name.trim().firstOrNull()?.uppercase().orEmpty().ifEmpty { "?" },
            color = onColor(fill),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun MessageBubble(
    message: ConversationMessage,
    personColor: String,
    media: Map<Int, ByteArray>,
    zone: ZoneId,
) {
    val outgoing = message.direction == "out"
    val mediaId = messageMediaId(message.mediaUrl)
    val bytes = mediaId?.let { media[it] }
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (outgoing) Alignment.End else Alignment.Start,
    ) {
        Surface(
            modifier = Modifier.widthIn(max = 320.dp),
            shape = RoundedCornerShape(22.dp),
            color = if (outgoing) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
            contentColor = if (outgoing) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
        ) {
            Column(
                Modifier
                    .then(
                        if (outgoing) Modifier else Modifier.border(
                            0.dp,
                            Color.Transparent,
                            RoundedCornerShape(22.dp),
                        )
                    )
                    .then(
                        if (outgoing) Modifier else Modifier.padding(0.dp)
                    )
                    .background(
                        if (outgoing) Color.Transparent else MaterialTheme.colorScheme.surface,
                    )
                    .padding(start = if (outgoing) 16.dp else 12.dp)
                    .padding(end = 16.dp, top = 12.dp, bottom = 12.dp),
            ) {
                if (!outgoing) {
                    Box(
                        Modifier
                            .padding(bottom = 8.dp)
                            .height(0.dp),
                    )
                }
                bytes?.let { data ->
                    val bitmap = remember(data) {
                        android.graphics.BitmapFactory.decodeByteArray(data, 0, data.size)
                    }
                    if (bitmap != null) {
                        androidx.compose.foundation.Image(
                            bitmap = bitmap.asImageBitmap(),
                            contentDescription = if (outgoing) "Sent drawing" else "Received picture",
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(16.dp))
                                .padding(bottom = 8.dp),
                        )
                    }
                }
                message.body?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.titleMedium)
                }
                val time = formatMessageTime(message.createdAt, zone)
                val status = if (outgoing) messageStatusLabel(message.status) else ""
                val extra = message.errorMessage.orEmpty()
                val meta = listOf(time, status, extra).filter { it.isNotBlank() }.joinToString(" · ")
                if (meta.isNotEmpty()) {
                    Spacer(Modifier.height(4.dp))
                    Text(meta, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        if (!outgoing) {
            Box(
                Modifier
                    .padding(start = 4.dp, top = 2.dp)
                    .height(8.dp).padding(0.dp)
                    .background(parseHex(personColor)),
            )
        }
    }
}

@Composable
private fun listingConfigured(state: PhoneState) = state.conversations.configured

private fun formatMessageTime(value: String?, zone: ZoneId): String {
    if (value.isNullOrBlank()) return ""
    val instant = runCatching { Instant.parse(value) }.getOrNull() ?: return ""
    return TimeFormat.format(instant.atZone(zone))
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawDoodleStroke(stroke: DoodleStroke) {
    if (stroke.points.isEmpty()) return
    val paintColor = if (stroke.erase) Color(0xFFF4F1EA) else stroke.color
    if (stroke.points.size == 1) {
        drawCircle(paintColor, stroke.width / 2f, stroke.points.first())
        return
    }
    val path = androidx.compose.ui.graphics.Path().apply {
        moveTo(stroke.points.first().x, stroke.points.first().y)
        stroke.points.drop(1).forEach { lineTo(it.x, it.y) }
    }
    drawPath(
        path,
        color = paintColor,
        style = Stroke(width = stroke.width, cap = StrokeCap.Round, join = StrokeJoin.Round),
    )
}

private fun exportDoodle(strokes: List<DoodleStroke>, size: IntSize): String? {
    if (size.width <= 0 || size.height <= 0) return null
    val bitmap = Bitmap.createBitmap(size.width, size.height, Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(bitmap)
    canvas.drawColor(android.graphics.Color.WHITE)
    val paint = android.graphics.Paint().apply {
        isAntiAlias = true
        strokeCap = android.graphics.Paint.Cap.ROUND
        strokeJoin = android.graphics.Paint.Join.ROUND
        style = android.graphics.Paint.Style.STROKE
    }
    strokes.forEach { stroke ->
        paint.strokeWidth = stroke.width
        if (stroke.erase) {
            paint.color = android.graphics.Color.WHITE
            paint.xfermode = null
        } else {
            paint.color = stroke.color.toArgb()
            paint.xfermode = null
        }
        if (stroke.points.size == 1) {
            paint.style = android.graphics.Paint.Style.FILL
            canvas.drawCircle(stroke.points[0].x, stroke.points[0].y, stroke.width / 2f, paint)
            paint.style = android.graphics.Paint.Style.STROKE
        } else {
            val path = android.graphics.Path()
            path.moveTo(stroke.points[0].x, stroke.points[0].y)
            stroke.points.drop(1).forEach { path.lineTo(it.x, it.y) }
            canvas.drawPath(path, paint)
        }
    }
    val out = ByteArrayOutputStream()
    if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)) return null
    return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
}

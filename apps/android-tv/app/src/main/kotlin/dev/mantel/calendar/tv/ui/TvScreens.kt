package dev.mantel.calendar.tv.ui

import androidx.activity.compose.BackHandler
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.mantel.calendar.core.CalEvent
import dev.mantel.calendar.core.ViewKind
import dev.mantel.calendar.core.prefersNumericKeypad
import dev.mantel.calendar.core.dayLabel
import dev.mantel.calendar.core.endMinutes
import dev.mantel.calendar.core.eventsOn
import dev.mantel.calendar.core.formatWhen
import dev.mantel.calendar.core.monthGrid
import dev.mantel.calendar.core.step
import dev.mantel.calendar.core.weekDays
import dev.mantel.calendar.tv.Phase
import dev.mantel.calendar.tv.TvState
import dev.mantel.calendar.tv.TvViewModel
import java.time.LocalDate

private enum class Tab { Today, Agenda, Week, Month, Lists, Chores, Meals }

private sealed interface Overlay {
    data class Event(val event: CalEvent) : Overlay
    data class Edit(val event: CalEvent?, val day: LocalDate) : Overlay
    data class ListDetail(val id: Int) : Overlay
    data class Day(val day: LocalDate) : Overlay
    data object AddChore : Overlay
    data object Rewards : Overlay
}

@Composable
fun MantelTvApp(vm: TvViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) vm.refreshIfReady()
        }
        lifecycle.lifecycle.addObserver(observer)
        onDispose { lifecycle.lifecycle.removeObserver(observer) }
    }
    MaterialTheme(
        colorScheme = if (state.phase != Phase.Ready) darkColorScheme(
            primary = Color(0xFFFFB086),
            background = Color(0xFF12151C),
            onBackground = Color(0xFFF4EFE6),
            surface = Color(0xFF1C2230),
            onSurface = Color(0xFFF4EFE6),
            onSurfaceVariant = Color(0xFFD7C4B0),
            outline = Color(0xFFC4B3A0),
            error = Color(0xFFFFB4AB),
        ) else lightColorScheme(
            primary = Ember,
            onPrimary = Card,
            background = Paper,
            onBackground = Ink,
            surface = Card,
            onSurface = Ink,
            onSurfaceVariant = Dim,
            outline = Line,
            error = Danger,
            onError = Card,
        ),
    ) {
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(36.dp)) {
            when (state.phase) {
                Phase.Loading -> BigTitle(state.message ?: "Looking for the calendar…")
                Phase.Address -> AddressScreen(state.message, state.origin, vm::connect)
                Phase.Pair -> PairScreen(state.message, vm::pair)
                Phase.Ready -> Home(state, vm)
            }
        }
    }
}

@Composable
private fun AddressScreen(message: String?, prefill: String?, onConnect: (String) -> Unit) {
    var address by remember(prefill) { mutableStateOf(prefill.orEmpty()) }
    var numeric by remember(prefill) { mutableStateOf(prefersNumericKeypad(prefill.orEmpty())) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(prefill) { runCatching { focus.requestFocus() } }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        BigTitle("Where's the calendar?")
        Text(
            "Enter the calendar server's address. A bare address uses port 8080.",
            color = MaterialTheme.colorScheme.onSurface,
            fontSize = 22.sp,
        )
        Text(
            "Number keys on the remote type an IP. The number pad has the dot. Select Type a name for a hostname.",
            color = MaterialTheme.colorScheme.onSurface,
            fontSize = 20.sp,
        )
        if (message != null) Text(message, color = MaterialTheme.colorScheme.error, fontSize = 20.sp)
        SunnyField(
            address,
            { address = it },
            "Server address",
            Modifier.fillMaxWidth().focusRequester(focus),
            keyboardType = if (numeric) KeyboardType.Decimal else KeyboardType.Uri,
            onSubmit = { onConnect(address) },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SunnyButton(onClick = { numeric = true }, container = if (numeric) Sun else Card) {
                Text("IP address", modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp), fontSize = 20.sp, fontWeight = FontWeight.Bold)
            }
            SunnyButton(
                onClick = {
                    numeric = false
                    runCatching { focus.requestFocus() }
                },
                container = if (numeric) Card else Sun,
            ) {
                Text("Type a name", modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp), fontSize = 20.sp, fontWeight = FontWeight.Bold)
            }
        }
        SunnyButton(onClick = { onConnect(address) }) {
            Text("Connect", modifier = Modifier.padding(18.dp), fontSize = 22.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun PairScreen(message: String?, onPair: (String) -> Unit) {
    var code by remember { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        BigTitle("Pair this TV")
        Text(
            "On the wall: Settings → Devices → Pair a phone, or on the phone app: Settings → Pair a TV. Type that code.",
            color = MaterialTheme.colorScheme.onSurface,
            fontSize = 22.sp,
        )
        if (message != null) Text(message, color = MaterialTheme.colorScheme.error, fontSize = 20.sp)
        SunnyField(code, { code = it }, "Pairing code", Modifier.fillMaxWidth())
        SunnyButton(onClick = { onPair(code) }) {
            Text("Pair", modifier = Modifier.padding(18.dp), fontSize = 22.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun Home(state: TvState, vm: TvViewModel) {
    var tab by remember { mutableStateOf(Tab.Today) }
    var stack by remember { mutableStateOf(listOf<Overlay>()) }
    BackHandler(enabled = stack.isNotEmpty()) { stack = stack.dropLast(1) }
    val displayName by vm.displayName.collectAsStateWithLifecycle()
    LaunchedEffect(vm, displayName) {
        while (displayName.isNotBlank()) {
            try {
                val target = when (vm.pollDisplay(displayName)) {
                    "today" -> Tab.Today
                    "week" -> Tab.Week
                    "month" -> Tab.Month
                    "lists" -> Tab.Lists
                    "meals" -> Tab.Meals
                    else -> null
                }
                if (target != null) {
                    tab = target
                    stack = emptyList()
                }
            } catch (cancelled: kotlinx.coroutines.CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // Try again when the connection comes back.
            }
            kotlinx.coroutines.delay(3000)
        }
    }
    val pop = { stack = stack.dropLast(1) }
    val push = { page: Overlay -> stack = stack + page }
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (state.offline) {
            Text(
                state.offlineDetail.ifBlank { "Offline, last synced earlier" },
                color = Ember,
                fontSize = 20.sp,
            )
        }
        Text("Family calendar", color = Ink, fontSize = 30.sp, fontFamily = androidx.compose.ui.text.font.FontFamily.Serif)
        Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            Column(
                Modifier.width(140.dp).verticalScroll(rememberScrollState()).padding(6.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Tab.entries.forEach { item ->
                    SunnyButton(
                        onClick = { tab = item; stack = emptyList() },
                        modifier = Modifier.fillMaxWidth(),
                        container = if (item == tab && stack.isEmpty()) Sun else Card,
                    ) {
                        Text(if (item == Tab.Agenda) "Schedule" else if (item == Tab.Chores) "Tasks" else item.name,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 16.dp), fontSize = 19.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                    }
                }
                SunnyButton(onClick = { push(Overlay.Rewards) }, modifier = Modifier.fillMaxWidth()) {
                    Text("Rewards", modifier = Modifier.padding(12.dp), fontSize = 19.sp, maxLines = 1)
                }
                SunnyButton(onClick = { vm.forgetServer() }, modifier = Modifier.fillMaxWidth()) {
                    Text("Server", modifier = Modifier.padding(12.dp), fontSize = 19.sp, maxLines = 1)
                }
            }
        Box(Modifier.weight(1f).fillMaxSize()) {
            val top = stack.lastOrNull()
            if (top == null) {
                when (tab) {
                    Tab.Today -> {
                        val today = LocalDate.now(vm.zone())
                        Column {
                            Text("Chores today: " + (state.board?.takeIf { it.on == today.toString() }
                                ?.people?.sumOf { person -> person.chores.count { it.completion == null } }?.toString() ?: "Open Tasks"),
                                color = Ink, fontSize = 20.sp)
                            Box(Modifier.weight(1f)) { Agenda(state, vm, today, push, fixedDay = true) }
                        }
                    }
                    Tab.Meals -> TvMealsScreen(vm)
                    Tab.Agenda -> Agenda(state, vm, state.anchor, push)
                    Tab.Week -> Week(state, vm, push)
                    Tab.Month -> Month(state, vm, push)
                    Tab.Lists -> ListsHome(state, vm, push)
                    Tab.Chores -> ChoresHome(state, vm, { push(Overlay.AddChore) }) { push(Overlay.Rewards) }
                }
            } else {
                when (top) {
                    is Overlay.Event -> EventDetail(top.event, state, vm, onEdit = { push(Overlay.Edit(top.event, state.anchor)) }, onBack = pop)
                    is Overlay.Edit -> EditEvent(top.event, top.day, state, vm, onDone = pop)
                    is Overlay.ListDetail -> ListDetail(top.id, state, vm)
                    is Overlay.Day -> Agenda(state, vm, top.day, push)
                    Overlay.AddChore -> AddChoreScreen(state, vm, pop)
                    Overlay.Rewards -> Rewards(state, vm)
                }
            }
        }
    }
    }
}

@Composable
private fun Agenda(state: TvState, vm: TvViewModel, day: LocalDate, push: (Overlay) -> Unit, fixedDay: Boolean = false) {
    val events = eventsOn(state.events, day, vm.zone())
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (!fixedDay) StepButton("Previous day") { vm.setAnchor(step(ViewKind.AGENDA, day, -1)) }
            Text(dayLabel(day), color = Ink, fontSize = 32.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            if (!fixedDay) StepButton("Next day") { vm.setAnchor(step(ViewKind.AGENDA, day, 1)) }
            SunnyButton(onClick = { push(Overlay.Edit(null, day)) }, container = Coral) {
                Text("Add", modifier = Modifier.padding(16.dp), color = Ink, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            }
        }
        if (events.isEmpty()) Text("Nothing on this day.", color = Ink, fontSize = 24.sp)
        events.forEach { event ->
            EventCard(event, state, vm) { push(Overlay.Event(event)) }
        }
    }
}

@Composable
private fun Week(state: TvState, vm: TvViewModel, push: (Overlay) -> Unit) {
    val days = weekDays(state.anchor, state.settings.firstDayOfWeek)
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            StepButton("Previous week") { vm.setAnchor(step(ViewKind.WEEK, state.anchor, -1)) }
            Text(dayLabel(days.first()), color = Ink, fontSize = 28.sp, fontWeight = FontWeight.Bold)
            StepButton("Next week") { vm.setAnchor(step(ViewKind.WEEK, state.anchor, 1)) }
        }
        Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            days.forEach { day ->
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                    SunnyButton(onClick = { push(Overlay.Day(day)) }, modifier = Modifier.fillMaxWidth()) {
                        Text("${day.dayOfWeek.name.take(3)} ${day.dayOfMonth}", modifier = Modifier.padding(8.dp), fontWeight = FontWeight.Bold, fontSize = 22.sp)
                    }
                    eventsOn(state.events, day, vm.zone()).forEach { event ->
                        EventCard(event, state, vm, compact = true) { push(Overlay.Event(event)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun Month(state: TvState, vm: TvViewModel, push: (Overlay) -> Unit) {
    val days = monthGrid(state.anchor, state.settings.firstDayOfWeek)
    val names = if (state.settings.firstDayOfWeek == 1) {
        listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
    } else {
        listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            StepButton("Previous month") { vm.setAnchor(step(ViewKind.MONTH, state.anchor, -1)) }
            Text(state.anchor.month.name.lowercase().replaceFirstChar { it.uppercase() }, color = Ink, fontSize = 32.sp, fontWeight = FontWeight.Bold)
            StepButton("Next month") { vm.setAnchor(step(ViewKind.MONTH, state.anchor, 1)) }
        }
        Row(Modifier.fillMaxWidth()) {
            names.forEach { Text(it, modifier = Modifier.weight(1f), color = Ink, fontSize = 16.sp, fontWeight = FontWeight.Bold) }
        }
        days.chunked(7).forEach { week ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                week.forEach { day ->
                    val inMonth = day.month == state.anchor.month
                    val count = eventsOn(state.events, day, vm.zone()).size
                    SunnyButton(onClick = { push(Overlay.Day(day)) }, modifier = Modifier.weight(1f).height(72.dp), container = if (inMonth) Card else Sun) {
                        Column(Modifier.padding(6.dp)) {
                            Text(day.dayOfMonth.toString(), fontWeight = FontWeight.Bold, fontSize = 18.sp)
                            if (count > 0) Text("$count", color = Ember, fontSize = 14.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun EventCard(event: CalEvent, state: TvState, vm: TvViewModel, compact: Boolean = false, onClick: () -> Unit) {
    SunnyButton(onClick = onClick, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp), container = lerp(Card, parseColor(event.color), 0.18f)) {
        Row(Modifier.padding(if (compact) 6.dp else 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.size(if (compact) 12.dp else 18.dp).clip(CircleShape).background(parseColor(event.color)))
            Column {
                Text(event.title, color = Ink, fontSize = if (compact) 14.sp else 24.sp, fontWeight = FontWeight.Bold, maxLines = if (compact) 3 else 1, overflow = TextOverflow.Ellipsis)
                Text(
                    formatWhen(event, vm.zone(), state.settings.timeFormat24h),
                    color = Ink,
                    fontSize = if (compact) 12.sp else 18.sp,
                )
            }
        }
    }
}

@Composable
private fun EventDetail(event: CalEvent, state: TvState, vm: TvViewModel, onEdit: () -> Unit, onBack: () -> Unit) {
    var confirm by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(event.title, color = Ink, fontSize = 40.sp, fontWeight = FontWeight.Bold)
        Text(formatWhen(event, vm.zone(), state.settings.timeFormat24h), color = Ink, fontSize = 24.sp)
        Text(event.calendarName, color = parseColor(event.color), fontSize = 22.sp, fontWeight = FontWeight.Bold)
        if (!event.location.isNullOrBlank()) Text(event.location!!, color = Ink, fontSize = 22.sp)
        if (!event.description.isNullOrBlank()) Text(event.description!!, color = Ink, fontSize = 20.sp)
        if (event.recurrenceText != null) Text(event.recurrenceText!!, color = Ink, fontSize = 20.sp)
        if (event.recurrenceRule != null) Text("Saving changes the whole series.", color = Ember, fontSize = 20.sp)
        error?.let { Text(it, color = Danger, fontSize = 20.sp) }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (event.editable) {
                SunnyButton(onClick = onEdit) { Text("Edit", modifier = Modifier.padding(16.dp), fontSize = 20.sp) }
                SunnyButton(onClick = {
                    if (!confirm) {
                        confirm = true
                    } else {
                        vm.deleteEvent(event.id, onDone = onBack, onError = { error = it })
                    }
                }, container = if (confirm) Coral else Card) {
                    Text(if (confirm) "Yes, delete" else "Delete", modifier = Modifier.padding(16.dp), fontSize = 20.sp)
                }
            } else {
                Text("This one can't be changed from here.", color = Ink, fontSize = 20.sp)
            }
        }
    }
}

@Composable
private fun EditEvent(existing: CalEvent?, day0: LocalDate, state: TvState, vm: TvViewModel, onDone: () -> Unit) {
    var title by remember { mutableStateOf(existing?.title ?: "") }
    var allDay by remember { mutableStateOf(existing?.allDay ?: false) }
    var day by remember { mutableStateOf(day0) }
    var startHour by remember { mutableIntStateOf(16) }
    var startMinute by remember { mutableIntStateOf(0) }
    var endHour by remember { mutableIntStateOf(17) }
    var endMinute by remember { mutableIntStateOf(0) }
    var person by remember { mutableStateOf(state.users.firstOrNull()?.id) }
    val calendars = vm.writableCalendars(person)
    var calendarId by remember { mutableStateOf(existing?.calendarId ?: calendars.firstOrNull()?.id) }
    var error by remember { mutableStateOf<String?>(null) }
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        BigTitle(if (existing == null) "New event" else "Edit event")
        if (existing?.recurrenceRule != null) Text("This changes the whole series.", color = Ember, fontSize = 20.sp)
        SunnyField(title, { title = it }, "Title", Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SunnyButton(onClick = { allDay = true }, container = if (allDay) Sun else Card) { Text("All day", modifier = Modifier.padding(12.dp)) }
            SunnyButton(onClick = { allDay = false }, container = if (!allDay) Sun else Card) { Text("Timed", modifier = Modifier.padding(12.dp)) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            StepButton("Previous") { day = day.minusDays(1) }
            Text(dayLabel(day), fontSize = 22.sp, fontWeight = FontWeight.Bold)
            StepButton("Next") { day = day.plusDays(1) }
        }
        if (!allDay) {
            MinuteRow("Start", startHour, startMinute, state.settings.timeFormat24h, { startHour = it }, { startMinute = it })
            MinuteRow("End", endHour, endMinute, state.settings.timeFormat24h, { endHour = it }, { endMinute = it })
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            state.users.forEach { user ->
                SunnyButton(onClick = {
                    person = user.id
                    calendarId = vm.writableCalendars(user.id).firstOrNull()?.id
                }, container = if (person == user.id) parseColor(user.color) else Card) {
                    Text(user.name, modifier = Modifier.padding(12.dp), fontWeight = FontWeight.Bold)
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            calendars.forEach { cal ->
                SunnyButton(onClick = { calendarId = cal.id }, container = if (calendarId == cal.id) Sun else Card) {
                    Text(cal.name, modifier = Modifier.padding(12.dp))
                }
            }
        }
        error?.let { Text(it, color = Danger) }
        val chosen = calendarId
        SunnyButton(onClick = {
            if (chosen == null) {
                error = "Pick a calendar"
            } else {
                val start = startHour * 60 + startMinute
                val end = endMinutes(start, endHour * 60 + endMinute)
                vm.saveEvent(existing, title, day, allDay, start, end, chosen, onDone = { onDone() }, onError = { error = it })
            }
        }, container = Coral) {
            Text("Save", modifier = Modifier.padding(16.dp), color = Ink, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun MinuteRow(label: String, hour: Int, minute: Int, use24: Boolean, onHour: (Int) -> Unit, onMinute: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, modifier = Modifier.width(70.dp), fontSize = 20.sp, fontWeight = FontWeight.Bold)
        StepButton("Hour down") { onHour((hour + 23) % 24) }
        Text(clock(hour, minute, use24), fontSize = 22.sp, fontWeight = FontWeight.Bold)
        StepButton("Hour up") { onHour((hour + 1) % 24) }
        StepButton("Minutes", "+15") { onMinute((minute + 15) % 60) }
    }
}

private fun clock(hour: Int, minute: Int, use24: Boolean): String {
    if (use24) return "%02d:%02d".format(hour, minute)
    val h = hour % 12
    val shown = if (h == 0) 12 else h
    val suffix = if (hour < 12) "AM" else "PM"
    return "$shown:${"%02d".format(minute)} $suffix"
}

@Composable
private fun ListsHome(state: TvState, vm: TvViewModel, push: (Overlay) -> Unit) {
    var name by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        BigTitle("Lists")
        if (state.lists.isEmpty()) Text("No lists yet.", fontSize = 22.sp)
        state.lists.forEach { list ->
            SunnyButton(onClick = { push(Overlay.ListDetail(list.id)) }, modifier = Modifier.fillMaxWidth()) {
                Text("${list.icon ?: "📝"}  ${list.name}   ${list.itemCount} left", modifier = Modifier.padding(16.dp), fontSize = 24.sp, fontWeight = FontWeight.Bold)
            }
        }
        SunnyField(name, { name = it }, "New list", Modifier.fillMaxWidth())
        error?.let { Text(it, color = Danger) }
        SunnyButton(onClick = { vm.addList(name) { error = it }; name = "" }, container = Coral) {
            Text("Add list", modifier = Modifier.padding(14.dp), color = Ink, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun ListDetail(id: Int, state: TvState, vm: TvViewModel) {
    val list = state.lists.find { it.id == id }
    var text by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    if (list == null) {
        Text("That list is gone.", fontSize = 24.sp)
        return
    }
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        BigTitle("${list.icon ?: ""} ${list.name}")
        list.items.forEach { item ->
            SunnyButton(onClick = { vm.toggleItem(list.id, item.id, !item.checked) }, modifier = Modifier.fillMaxWidth(), container = if (item.checked) Sun else Card) {
                Text(if (item.checked) "✓  ${item.text}" else item.text, modifier = Modifier.padding(14.dp), fontSize = 24.sp)
            }
        }
        SunnyField(text, { text = it }, "Add an item", Modifier.fillMaxWidth())
        error?.let { Text(it, color = Danger) }
        SunnyButton(onClick = { vm.addItem(list.id, text) { error = it }; text = "" }, container = Coral) {
            Text("Add", modifier = Modifier.padding(14.dp), color = Ink, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun ChoresHome(state: TvState, vm: TvViewModel, onAdd: () -> Unit, onRewards: () -> Unit) {
    val people = state.board?.people.orEmpty()
    var selected by remember { mutableStateOf(people.firstOrNull()?.userId) }
    val person = people.find { it.userId == selected } ?: people.firstOrNull()
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Chores", color = Ink, fontSize = 36.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            SunnyButton(onClick = onAdd) { Text("Add chore", modifier = Modifier.padding(14.dp)) }
            SunnyButton(onClick = onRewards, container = Sky) {
                Text("Rewards", modifier = Modifier.padding(14.dp), fontWeight = FontWeight.Bold, fontSize = 20.sp)
            }
        }
        Text(state.board?.on ?: "", color = Ink, fontSize = 20.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            people.forEach { member ->
                val chip = if (person?.userId == member.userId) parseColor(member.color) else Card
                SunnyButton(onClick = { selected = member.userId }, container = chip) {
                    Text("${member.name}  ${member.stars}★", modifier = Modifier.padding(12.dp), fontWeight = FontWeight.Bold, fontSize = 20.sp, color = readableOn(chip))
                }
            }
        }
        if (person == null || person.chores.isEmpty()) Text("Nothing due.", fontSize = 22.sp)
        person?.chores?.forEach { chore ->
            val completion = chore.completion
            if (completion != null && completion.status == "pending") {
                Text("${chore.icon ?: "⭐"} ${chore.title} is waiting", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SunnyButton(onClick = { vm.approve(completion.id) }, container = Coral) { Text("Approve", modifier = Modifier.padding(12.dp), color = Ink) }
                    SunnyButton(onClick = { vm.reject(completion.id) }) { Text("Not yet", modifier = Modifier.padding(12.dp)) }
                }
            } else {
                val done = completion?.status == "done"
                SunnyButton(
                    onClick = { vm.completeChore(chore.choreId, person.userId, state.board!!.on, !done) },
                    modifier = Modifier.fillMaxWidth(),
                    container = if (done) Sun else Card,
                ) {
                    Text(
                        "${if (done) "✓" else "○"}  ${chore.icon ?: ""} ${chore.title}   ${chore.points}★",
                        modifier = Modifier.padding(14.dp),
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    }
}

@Composable
private fun Rewards(state: TvState, vm: TvViewModel) {
    val people = state.board?.people.orEmpty()
    var selected by remember { mutableStateOf(people.firstOrNull()?.userId) }
    val person = people.find { it.userId == selected } ?: people.firstOrNull()
    var error by remember { mutableStateOf<String?>(null) }
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        BigTitle("Rewards")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            people.forEach { member ->
                val chip = if (person?.userId == member.userId) parseColor(member.color) else Card
                SunnyButton(onClick = { selected = member.userId }, container = chip) {
                    Text("${member.name}  ${member.stars}★", modifier = Modifier.padding(12.dp), fontWeight = FontWeight.Bold, color = readableOn(chip))
                }
            }
        }
        error?.let { Text(it, color = Danger, fontSize = 20.sp) }
        state.board?.rewards?.forEach { reward ->
            SunnyButton(onClick = {
                val who = person ?: return@SunnyButton
                vm.redeem(reward.id, who.userId) { error = it }
            }, modifier = Modifier.fillMaxWidth(), container = Sky) {
                Text("${reward.icon ?: "🎁"}  ${reward.title}   ${reward.pointsCost}★", modifier = Modifier.padding(14.dp), fontSize = 24.sp, fontWeight = FontWeight.Bold)
            }
        }
        state.board?.pendingRedemptions?.forEach { row ->
            Text("${row.userName} wants ${row.rewardTitle}", fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SunnyButton(onClick = { vm.fulfill(row.id) }, container = Coral) { Text("Given", modifier = Modifier.padding(12.dp), color = Ink) }
                SunnyButton(onClick = { vm.deny(row.id) }) { Text("Send back", modifier = Modifier.padding(12.dp)) }
            }
        }
    }
}

@Composable
private fun StepButton(label: String, glyph: String? = null, onClick: () -> Unit) {
    val mark = glyph ?: if (label.startsWith("Next") || label.endsWith("up")) "›" else "‹"
    SunnyButton(onClick = onClick) {
        Text(mark, modifier = Modifier.padding(12.dp), fontSize = 22.sp, fontWeight = FontWeight.Bold)
    }
}

@file:OptIn(ExperimentalMaterial3Api::class)

package dev.mantel.calendar.phone.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.mantel.calendar.core.CalEvent
import dev.mantel.calendar.core.RepeatChoice
import dev.mantel.calendar.core.RepeatFreq
import dev.mantel.calendar.core.ViewKind
import dev.mantel.calendar.core.WEEKDAY_CODES
import dev.mantel.calendar.core.dayLabel
import dev.mantel.calendar.core.endMinutes
import dev.mantel.calendar.core.eventDay
import dev.mantel.calendar.core.eventEditKind
import dev.mantel.calendar.core.eventMinutes
import dev.mantel.calendar.core.eventsOn
import dev.mantel.calendar.core.formatWhen
import dev.mantel.calendar.core.monthGrid
import dev.mantel.calendar.core.parseRepeat
import dev.mantel.calendar.core.step
import dev.mantel.calendar.core.utcDate
import dev.mantel.calendar.core.weekDays
import dev.mantel.calendar.core.weekdayCode
import dev.mantel.calendar.phone.PhoneState
import dev.mantel.calendar.phone.PhoneViewModel
import dev.mantel.calendar.phone.visibleEvents
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneOffset
import java.time.format.TextStyle
import java.util.Locale

@Composable
fun TodayScreen(state: PhoneState, vm: PhoneViewModel, open: (Page) -> Unit) {
    val day = state.anchor
    val events = eventsOn(visibleEvents(state.events, state.hiddenUserIds), day, vm.zone())
    PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 88.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            DayStrip(state, vm)
            PersonStrip(state, vm)
            Text(dayLabel(day), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            if (events.isEmpty()) Text("Nothing on this day.", style = MaterialTheme.typography.titleMedium)
            events.forEach { event ->
                EventRow(event, state, vm) { open(Page.Event(event)) }
            }
        }
        FloatingActionButton(
            onClick = { open(Page.Edit(null, day)) },
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
            containerColor = warmContainer(),
            contentColor = warmOnContainer(),
        ) {
            Icon(Icons.Filled.Add, contentDescription = "Add event")
        }
    }
}

@Composable
fun MonthScreen(state: PhoneState, vm: PhoneViewModel, open: (Page) -> Unit) {
    val zone = vm.zone()
    val grid = monthGrid(state.anchor, state.settings.firstDayOfWeek)
    val shown = visibleEvents(state.events, state.hiddenUserIds)
    val month = YearMonth.of(state.anchor.year, state.anchor.month)
    PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { vm.setAnchor(step(ViewKind.MONTH, state.anchor, -1)) }, modifier = Modifier.touchTarget()) {
                    Icon(Icons.Filled.ChevronLeft, contentDescription = "Previous month")
                }
                Text(
                    state.anchor.month.getDisplayName(TextStyle.FULL, Locale.getDefault()) + " " + state.anchor.year,
                    modifier = Modifier.weight(1f),
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
                IconButton(onClick = { vm.setAnchor(step(ViewKind.MONTH, state.anchor, 1)) }, modifier = Modifier.touchTarget()) {
                    Icon(Icons.Filled.ChevronRight, contentDescription = "Next month")
                }
            }
            PersonStrip(state, vm)
            val labels = if (state.settings.firstDayOfWeek == 1) {
                listOf("M", "T", "W", "T", "F", "S", "S")
            } else {
                listOf("S", "M", "T", "W", "T", "F", "S")
            }
            Row(Modifier.fillMaxWidth()) {
                labels.forEach { label ->
                    Text(label, modifier = Modifier.weight(1f), textAlign = TextAlign.Center, fontWeight = FontWeight.Bold)
                }
            }
            grid.chunked(7).forEach { week ->
                Row(Modifier.fillMaxWidth()) {
                    week.forEach { day ->
                        val inMonth = YearMonth.from(day) == month
                        val count = eventsOn(shown, day, zone)
                        Column(
                            Modifier
                                .weight(1f)
                                .height(64.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .clickable { vm.setAnchor(day) }
                                .background(if (day == state.anchor) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface)
                                .padding(2.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(
                                day.dayOfMonth.toString(),
                                color = if (inMonth) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.outline,
                                fontWeight = if (day == state.anchor) FontWeight.Bold else FontWeight.Normal,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                                count.take(3).forEach { event ->
                                    Box(Modifier.size(6.dp).clip(CircleShape).background(parseHex(event.color)))
                                }
                            }
                        }
                    }
                }
            }
            Text(dayLabel(state.anchor), fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
            val dayEvents = eventsOn(shown, state.anchor, zone)
            if (dayEvents.isEmpty()) Text("Nothing on this day.")
            dayEvents.forEach { event -> EventRow(event, state, vm) { open(Page.Event(event)) } }
            WarmButton(onClick = { open(Page.Edit(null, state.anchor)) }, modifier = Modifier.fillMaxWidth().touchTarget()) {
                Text("Add on this day")
            }
        }
    }
}

@Composable
private fun DayStrip(state: PhoneState, vm: PhoneViewModel) {
    val days = weekDays(state.anchor, state.settings.firstDayOfWeek)
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { vm.setAnchor(step(ViewKind.AGENDA, state.anchor, -1)) }, modifier = Modifier.touchTarget()) {
            Icon(Icons.Filled.ChevronLeft, contentDescription = "Previous day")
        }
        Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            days.forEach { day ->
                val selected = day == state.anchor
                FilterChip(
                    selected = selected,
                    onClick = { vm.setAnchor(day) },
                    label = { Text("${day.dayOfWeek.name.take(1)} ${day.dayOfMonth}") },
                    modifier = Modifier.touchTarget(),
                )
            }
        }
        IconButton(onClick = { vm.setAnchor(step(ViewKind.AGENDA, state.anchor, 1)) }, modifier = Modifier.touchTarget()) {
            Icon(Icons.Filled.ChevronRight, contentDescription = "Next day")
        }
    }
}

@Composable
fun PersonStrip(state: PhoneState, vm: PhoneViewModel) {
    if (state.users.isEmpty()) return
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        state.users.forEach { user ->
            val hidden = user.id in state.hiddenUserIds
            val color = parseHex(user.color)
            FilterChip(
                selected = !hidden,
                onClick = { vm.toggleUser(user.id) },
                label = { Text(user.name) },
                modifier = Modifier.touchTarget(),
                leadingIcon = {
                    Box(Modifier.size(12.dp).clip(CircleShape).background(if (hidden) MaterialTheme.colorScheme.outline else color))
                },
            )
        }
    }
}

@Composable
fun EventRow(event: CalEvent, state: PhoneState, vm: PhoneViewModel, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .touchTarget()
            .clip(RoundedCornerShape(16.dp))
            .background(lerp(MaterialTheme.colorScheme.surface, parseHex(event.color), 0.16f))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.width(6.dp).height(40.dp).clip(RoundedCornerShape(3.dp)).background(parseHex(event.color)))
        Column(Modifier.weight(1f)) {
            Text(event.title, fontWeight = FontWeight.SemiBold, maxLines = 3, overflow = TextOverflow.Ellipsis)
            Text(
                formatWhen(event, vm.zone(), state.settings.timeFormat24h) + " · " + event.calendarName,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
fun EventDetail(event: CalEvent, state: PhoneState, vm: PhoneViewModel, onEdit: () -> Unit, onBack: () -> Unit) {
    val kind = eventEditKind(event)
    var confirm by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Delete this event?") },
            text = {
                Text(
                    if (kind == dev.mantel.calendar.core.EventEditKind.Series) "This deletes the whole series."
                    else "This removes it from the calendar.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    vm.deleteEvent(event.id, onDone = onBack, onError = { error = it; confirm = false })
                }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
        )
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.size(18.dp).clip(CircleShape).background(parseHex(event.color)))
            Text(event.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        }
        Text(formatWhen(event, vm.zone(), state.settings.timeFormat24h), style = MaterialTheme.typography.titleMedium)
        Text(event.calendarName, color = parseHex(event.color), fontWeight = FontWeight.SemiBold)
        if (!event.location.isNullOrBlank()) Text(event.location!!)
        if (!event.description.isNullOrBlank()) Text(event.description!!)
        event.recurrenceText?.let { Text(it) }
        editNote(kind)?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (kind != dev.mantel.calendar.core.EventEditKind.ReadOnly) {
            WarmButton(onClick = onEdit, modifier = Modifier.fillMaxWidth().touchTarget()) { Text("Edit") }
            TextButton(onClick = { confirm = true }, modifier = Modifier.fillMaxWidth().touchTarget()) { Text("Delete") }
        }
    }
}

@Composable
fun EditEvent(existing: CalEvent?, day0: LocalDate, state: PhoneState, vm: PhoneViewModel, onDone: () -> Unit) {
    val zone = vm.zone()
    val kind = eventEditKind(existing)
    var title by remember { mutableStateOf(existing?.title ?: "") }
    var location by remember { mutableStateOf(existing?.location ?: "") }
    var description by remember { mutableStateOf(existing?.description ?: "") }
    var allDay by remember { mutableStateOf(existing?.allDay ?: false) }
    var startDay by remember { mutableStateOf(existing?.let { eventDay(it, zone) } ?: day0) }
    var endDay by remember {
        mutableStateOf(
            existing?.let { if (it.allDay) utcDate(it.endAt).minusDays(1) else eventDay(it, zone) } ?: day0,
        )
    }
    val initialMinutes = existing?.let { eventMinutes(it, zone) }
    var startMinutes by remember { mutableIntStateOf(initialMinutes?.first ?: 16 * 60) }
    var endMinuteValue by remember { mutableIntStateOf(initialMinutes?.second ?: 17 * 60) }
    var repeat by remember { mutableStateOf(parseRepeat(existing?.recurrenceRule)) }
    var person by remember { mutableStateOf(existing?.userId ?: state.users.firstOrNull()?.id) }
    val calendars = vm.writableCalendars(person)
    var calendarId by remember { mutableStateOf(existing?.calendarId ?: calendars.firstOrNull()?.id) }
    var error by remember { mutableStateOf<String?>(null) }
    var pickStartDate by remember { mutableStateOf(false) }
    var pickEndDate by remember { mutableStateOf(false) }
    var pickUntil by remember { mutableStateOf(false) }
    var pickStartTime by remember { mutableStateOf(false) }
    var pickEndTime by remember { mutableStateOf(false) }
    if (pickStartDate) DateDialog(startDay) { picked ->
        pickStartDate = false
        if (picked != null) {
            startDay = picked
            if (endDay.isBefore(picked)) endDay = picked
        }
    }
    if (pickEndDate) DateDialog(endDay) { picked ->
        pickEndDate = false
        if (picked != null) endDay = picked
    }
    if (pickUntil) DateDialog(startDay) { picked ->
        pickUntil = false
        if (picked != null) repeat = repeat.copy(until = picked.toString())
    }
    if (pickStartTime) TimeDialog(startMinutes, state.settings.timeFormat24h) { minutes ->
        pickStartTime = false
        if (minutes != null) startMinutes = minutes
    }
    if (pickEndTime) TimeDialog(endMinuteValue, state.settings.timeFormat24h) { minutes ->
        pickEndTime = false
        if (minutes != null) endMinuteValue = minutes
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        editNote(kind)?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
        OutlinedTextField(title, { title = it }, label = { Text("Title") }, modifier = Modifier.fillMaxWidth(), singleLine = true, colors = mantelFieldColors(), textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface))
        OutlinedTextField(location, { location = it }, label = { Text("Place") }, modifier = Modifier.fillMaxWidth(), singleLine = true, colors = mantelFieldColors(), textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface))
        OutlinedTextField(description, { description = it }, label = { Text("Notes") }, modifier = Modifier.fillMaxWidth(), colors = mantelFieldColors(), textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
            Text("All day", style = MaterialTheme.typography.titleMedium)
            Switch(checked = allDay, onCheckedChange = { allDay = it })
        }
        TextButton(onClick = { pickStartDate = true }, modifier = Modifier.touchTarget()) { Text(if (allDay) "Starts ${dayLabel(startDay)}" else dayLabel(startDay)) }
        if (allDay) {
            TextButton(onClick = { pickEndDate = true }, modifier = Modifier.touchTarget()) { Text("Ends ${dayLabel(endDay)}") }
        } else {
            TextButton(onClick = { pickStartTime = true }, modifier = Modifier.touchTarget()) {
                Text("Starts ${minutesLabel(startMinutes, state.settings.timeFormat24h)}")
            }
            TextButton(onClick = { pickEndTime = true }, modifier = Modifier.touchTarget()) {
                Text("Ends ${minutesLabel(endMinuteValue, state.settings.timeFormat24h)}")
            }
        }
        if (kind != dev.mantel.calendar.core.EventEditKind.Occurrence && kind != dev.mantel.calendar.core.EventEditKind.ReadOnly) {
            Text("Repeats", fontWeight = FontWeight.Bold)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(
                    RepeatFreq.NONE to "Once",
                    RepeatFreq.DAILY to "Daily",
                    RepeatFreq.WEEKLY to "Weekly",
                    RepeatFreq.MONTHLY to "Monthly",
                    RepeatFreq.YEARLY to "Yearly",
                ).forEach { (freq, label) ->
                    FilterChip(
                        selected = repeat.freq == freq,
                        onClick = {
                            val days = if (freq == RepeatFreq.WEEKLY && repeat.byday.isEmpty()) listOf(weekdayCode(startDay)) else repeat.byday
                            repeat = RepeatChoice(freq, if (freq == RepeatFreq.WEEKLY) days else emptyList(), repeat.until)
                        },
                        label = { Text(label) },
                        modifier = Modifier.touchTarget(),
                    )
                }
            }
            if (repeat.freq == RepeatFreq.WEEKLY) {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    WEEKDAY_CODES.forEach { code ->
                        FilterChip(
                            selected = code in repeat.byday,
                            onClick = {
                                val next = if (code in repeat.byday) repeat.byday - code else repeat.byday + code
                                repeat = repeat.copy(byday = next)
                            },
                            label = { Text(code) },
                        )
                    }
                }
            }
            if (repeat.freq != RepeatFreq.NONE) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { pickUntil = true }, modifier = Modifier.touchTarget()) {
                        Text(if (repeat.until.isBlank()) "Add an end date" else "Ends ${repeat.until}")
                    }
                    if (repeat.until.isNotBlank()) {
                        TextButton(onClick = { repeat = repeat.copy(until = "") }) { Text("Clear") }
                    }
                }
            }
        }
        if (kind != dev.mantel.calendar.core.EventEditKind.Occurrence) {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                state.users.forEach { user ->
                    val color = parseHex(user.color)
                    FilterChip(
                        selected = person == user.id,
                        onClick = {
                            person = user.id
                            calendarId = vm.writableCalendars(user.id).firstOrNull()?.id
                        },
                        label = { Text(user.name, color = if (person == user.id) onColor(color) else MaterialTheme.colorScheme.onSurface) },
                        modifier = Modifier.touchTarget(),
                    )
                }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                calendars.forEach { cal ->
                    FilterChip(
                        selected = calendarId == cal.id,
                        onClick = { calendarId = cal.id },
                        label = { Text(cal.name) },
                        modifier = Modifier.touchTarget(),
                    )
                }
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        val chosen = calendarId
        WarmButton(
            onClick = {
                if (chosen == null) {
                    error = "Pick a calendar"
                } else {
                    val end = endMinutes(startMinutes, endMinuteValue)
                    vm.saveEvent(
                        existing, title, location, description, startDay, endDay, allDay, startMinutes, end, chosen, repeat,
                        onDone = onDone,
                        onError = { error = it },
                    )
                }
            },
            enabled = kind != dev.mantel.calendar.core.EventEditKind.ReadOnly,
            modifier = Modifier.fillMaxWidth().touchTarget(),
        ) { Text("Save") }
    }
}

private fun editNote(kind: dev.mantel.calendar.core.EventEditKind): String? = when (kind) {
    dev.mantel.calendar.core.EventEditKind.Series ->
        "Saving changes the whole series. One occurrence can't be edited on its own."
    dev.mantel.calendar.core.EventEditKind.Occurrence ->
        "This is one occurrence. Changes apply to this time only."
    dev.mantel.calendar.core.EventEditKind.ReadOnly ->
        "This calendar is read-only, so it can't be changed here."
    else -> null
}

@Composable
private fun DateDialog(current: LocalDate, onResult: (LocalDate?) -> Unit) {
    val state = rememberDatePickerState(initialSelectedDateMillis = current.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
    DatePickerDialog(
        onDismissRequest = { onResult(null) },
        confirmButton = {
            TextButton(onClick = {
                val millis = state.selectedDateMillis
                onResult(if (millis == null) null else Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate())
            }) { Text("OK") }
        },
        dismissButton = { TextButton(onClick = { onResult(null) }) { Text("Cancel") } },
    ) { DatePicker(state) }
}

@Composable
private fun TimeDialog(minutes: Int, use24: Boolean, onResult: (Int?) -> Unit) {
    val state = rememberTimePickerState(initialHour = minutes / 60, initialMinute = minutes % 60, is24Hour = use24)
    AlertDialog(
        onDismissRequest = { onResult(null) },
        confirmButton = { TextButton(onClick = { onResult(state.hour * 60 + state.minute) }) { Text("OK") } },
        dismissButton = { TextButton(onClick = { onResult(null) }) { Text("Cancel") } },
        text = { TimePicker(state) },
    )
}

private fun minutesLabel(minutes: Int, use24: Boolean): String {
    val hour = (minutes / 60) % 24
    val minute = minutes % 60
    if (use24) return "%02d:%02d".format(hour, minute)
    val shown = hour % 12
    val hourText = if (shown == 0) 12 else shown
    val suffix = if (hour < 12) "AM" else "PM"
    return "$hourText:${"%02d".format(minute)} $suffix"
}

@Composable
fun WeekScreen(state: PhoneState, vm: PhoneViewModel, open: (Page) -> Unit) {
    val days = weekDays(state.anchor, state.settings.firstDayOfWeek)
    val shown = visibleEvents(state.events, state.hiddenUserIds)
    val today = LocalDate.now(vm.zone())
    Column(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconButton(
                onClick = { vm.setAnchor(state.anchor.minusWeeks(1)) },
                modifier = Modifier.touchTarget(),
            ) { Icon(Icons.Filled.ChevronLeft, contentDescription = "Previous week") }
            Text(
                dayLabel(days.first()),
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            TextButton(onClick = { vm.setAnchor(today) }, modifier = Modifier.touchTarget()) { Text("Today") }
            IconButton(
                onClick = { vm.setAnchor(state.anchor.plusWeeks(1)) },
                modifier = Modifier.touchTarget(),
            ) { Icon(Icons.Filled.ChevronRight, contentDescription = "Next week") }
        }
        PersonStrip(state, vm)
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            val dayWidth = maxOf(164.dp, (maxWidth - 48.dp) / 7)
            Row(
                Modifier.fillMaxSize().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                days.forEach { day ->
                    Column(
                        Modifier.width(dayWidth).fillMaxSize()
                            .clip(RoundedCornerShape(18.dp))
                            .background(if (day == today) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface)
                            .padding(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Column(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(day.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.getDefault()))
                            Text(day.dayOfMonth.toString(), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                        }
                        Column(
                            Modifier.weight(1f).verticalScroll(rememberScrollState()),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            val events = eventsOn(shown, day, vm.zone())
                            if (events.isEmpty()) Text("Nothing planned", style = MaterialTheme.typography.bodyMedium)
                            events.forEach { event -> EventRow(event, state, vm) { open(Page.Event(event)) } }
                            TextButton(
                                onClick = { open(Page.Edit(null, day)) },
                                modifier = Modifier.fillMaxWidth().touchTarget(),
                            ) {
                                Icon(Icons.Filled.Add, contentDescription = null)
                                Text("Add event")
                            }
                        }
                    }
                }
            }
        }
    }
}

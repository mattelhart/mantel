@file:OptIn(ExperimentalMaterial3Api::class)
package dev.mantel.calendar.phone.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.mantel.calendar.core.ChoreDefinition
import dev.mantel.calendar.phone.PhoneState
import dev.mantel.calendar.phone.PhoneViewModel
import kotlinx.serialization.json.*
import java.time.LocalDate
import java.time.Instant
import java.time.ZoneOffset

@Composable
fun AllChoresScreen(state: PhoneState, vm: PhoneViewModel, open: (Page) -> Unit) {
    var chores by remember { mutableStateOf<List<ChoreDefinition>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var revision by remember { mutableIntStateOf(0) }
    var removing by remember { mutableStateOf<ChoreDefinition?>(null) }
    LaunchedEffect(revision) { vm.loadChores { rows, message -> chores = rows; error = message } }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        WarmButton(onClick = { open(Page.EditChore()) }, modifier = Modifier.fillMaxWidth().touchTarget()) { Text("Add chore") }
        if (chores == null && error == null) CircularProgressIndicator()
        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error)
            TextButton(onClick = { error = null; revision++ }) { Text("Retry") }
        }
        if (chores?.isEmpty() == true) Text("Add a chore for anyone in your family, including adults.")
        chores?.forEach { chore ->
            Surface(shape = MaterialTheme.shapes.large, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(chore.title, style = MaterialTheme.typography.titleLarge)
                    Text(state.users.filter { it.id in chore.assigneeIds }.joinToString { it.name })
                    Text(when (chore.schedule) {
                        "once" -> "Once · ${chore.dueOn}"
                        "weekly" -> chore.weekdays.joinToString { listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")[it] }
                        else -> "Daily"
                    })
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        OutlinedButton(onClick = { open(Page.EditChore(chore)) }, modifier = Modifier.touchTarget()) { Text("Edit") }
                        TextButton(onClick = { removing = chore }, modifier = Modifier.touchTarget()) { Text("Delete", color = MaterialTheme.colorScheme.error) }
                    }
                }
            }
        }
    }
    removing?.let { chore ->
        DeleteDialog("Delete ${chore.title}?", "This removes future occurrences for everyone assigned. Earned stars stay in their balances.", { removing = null }) { result ->
            vm.removeChore(chore.id) { message -> result(message); if (message == null) revision++ }
        }
    }
}

@Composable
fun ChoreEditor(chore: ChoreDefinition?, state: PhoneState, vm: PhoneViewModel, close: () -> Unit) {
    var title by remember { mutableStateOf(chore?.title.orEmpty()) }
    var notes by remember { mutableStateOf(chore?.notes.orEmpty()) }
    var people by remember { mutableStateOf(chore?.assigneeIds?.toSet() ?: emptySet<Int>()) }
    var schedule by remember { mutableStateOf(chore?.schedule ?: "daily") }
    var weekdays by remember { mutableStateOf(chore?.weekdays?.toSet() ?: emptySet<Int>()) }
    var due by remember { mutableStateOf(chore?.dueOn ?: state.choreDay.toString()) }
    var points by remember { mutableIntStateOf(chore?.points ?: 0) }
    var approval by remember { mutableStateOf(chore?.requiresApproval ?: false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var pickingDate by remember { mutableStateOf(false) }
    val valid = title.isNotBlank() && title.trim().length <= 200 && people.isNotEmpty() &&
        (schedule != "weekly" || weekdays.isNotEmpty())
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedTextField(title, { title = it }, label = { Text("Chore name") }, modifier = Modifier.fillMaxWidth(), enabled = !busy, colors = mantelFieldColors())
        OutlinedTextField(notes, { notes = it }, label = { Text("Instructions (optional)") }, modifier = Modifier.fillMaxWidth(), enabled = !busy, colors = mantelFieldColors())
        Text("Assign to", fontWeight = FontWeight.Bold)
        Text("Each selected person completes their own chore.", style = MaterialTheme.typography.bodyMedium)
        if (state.users.isEmpty()) Text("Add family profiles in the wall display's settings first.")
        state.users.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { person ->
                    FilterChip(selected = person.id in people, enabled = !busy, onClick = {
                        people = if (person.id in people) people - person.id else people + person.id
                    }, label = { Text(person.name) }, modifier = Modifier.touchTarget())
                }
            }
        }
        Text("Schedule", fontWeight = FontWeight.Bold)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("daily" to "Daily", "weekly" to "Choose days", "once" to "Once").forEach { (value, label) ->
                FilterChip(selected = schedule == value, enabled = !busy, onClick = { schedule = value }, label = { Text(label) }, modifier = Modifier.touchTarget())
            }
        }
        if (schedule == "weekly") {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat").forEachIndexed { index, label ->
                    FilterChip(selected = index in weekdays, enabled = !busy, onClick = {
                        weekdays = if (index in weekdays) weekdays - index else weekdays + index
                    }, label = { Text(label) }, modifier = Modifier.touchTarget())
                }
            }
        }
        if (schedule == "once") OutlinedButton(enabled = !busy, onClick = { pickingDate = true }, modifier = Modifier.touchTarget()) { Text("Due $due") }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Stars: $points", modifier = Modifier.weight(1f))
            OutlinedButton(enabled = !busy && points > 0, onClick = { points-- }, modifier = Modifier.touchTarget()) { Text("−") }
            OutlinedButton(enabled = !busy && points < 100, onClick = { points++ }, modifier = Modifier.touchTarget()) { Text("+") }
        }
        Text("Use 0 for chores without rewards.", style = MaterialTheme.typography.bodyMedium)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Require approval", modifier = Modifier.weight(1f))
            Switch(checked = approval, enabled = !busy, onCheckedChange = { approval = it })
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        WarmButton(enabled = !busy && valid, modifier = Modifier.fillMaxWidth().touchTarget(), onClick = {
            busy = true
            error = null
            val body = buildJsonObject {
                put("title", title.trim())
                put("notes", notes.trim().ifEmpty { null }?.let(::JsonPrimitive) ?: JsonNull)
                put("points", points)
                put("schedule", schedule)
                put("weekdays", JsonArray(weekdays.sorted().map(::JsonPrimitive)))
                put("due_on", if (schedule == "once") JsonPrimitive(due) else JsonNull)
                put("requires_approval", approval)
                put("assignee_ids", JsonArray(people.sorted().map(::JsonPrimitive)))
            }
            vm.saveChore(chore?.id, body) { message ->
                busy = false
                error = message
                if (message == null) close()
            }
        }) { Text(if (busy) "Saving…" else "Save chore") }
        TextButton(enabled = !busy, onClick = close, modifier = Modifier.touchTarget()) { Text("Cancel") }
    }
    if (pickingDate) {
        val picker = rememberDatePickerState(initialSelectedDateMillis = LocalDate.parse(due).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
        DatePickerDialog(onDismissRequest = { pickingDate = false }, confirmButton = {
            TextButton(onClick = {
                picker.selectedDateMillis?.let { due = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString() }
                pickingDate = false
            }) { Text("Choose date") }
        }, dismissButton = { TextButton(onClick = { pickingDate = false }) { Text("Cancel") } }) { DatePicker(picker) }
    }
}

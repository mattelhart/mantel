package dev.mantel.calendar.tv.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.mantel.calendar.tv.TvState
import dev.mantel.calendar.tv.TvViewModel
import kotlinx.serialization.json.*
import java.time.LocalDate

@Composable
fun AddChoreScreen(state: TvState, vm: TvViewModel, close: () -> Unit) {
    var title by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var people by remember { mutableStateOf(emptySet<Int>()) }
    var schedule by remember { mutableStateOf("daily") }
    var days by remember { mutableStateOf(emptySet<Int>()) }
    var due by remember { mutableStateOf(LocalDate.now(vm.zone()).toString()) }
    var stars by remember { mutableIntStateOf(0) }
    var approval by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        BigTitle("Add chore")
        SunnyField(title, { title = it }, "Chore name", Modifier.fillMaxWidth())
        SunnyField(notes, { notes = it }, "Instructions", Modifier.fillMaxWidth())
        Text("Assign to — each person completes their own chore", color = Ink)
        state.users.chunked(4).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { person ->
                    SunnyButton(onClick = { people = if (person.id in people) people - person.id else people + person.id }, container = if (person.id in people) Sky else Card) {
                        Text(person.name, modifier = Modifier.padding(14.dp))
                    }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            listOf("daily", "weekly", "once").forEach { value ->
                SunnyButton(onClick = { schedule = value }, container = if (schedule == value) Sky else Card) { Text(value.replaceFirstChar { it.uppercase() }, modifier = Modifier.padding(14.dp)) }
            }
        }
        if (schedule == "weekly") Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat").forEachIndexed { index, label ->
                SunnyButton(onClick = { days = if (index in days) days - index else days + index }, container = if (index in days) Sky else Card) { Text(label, modifier = Modifier.padding(12.dp)) }
            }
        }
        if (schedule == "once") SunnyField(due, { due = it }, "Due date (YYYY-MM-DD)")
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            SunnyButton(onClick = { stars = (stars - 1).coerceAtLeast(0) }) { Text("−", modifier = Modifier.padding(14.dp)) }
            Text("$stars stars", color = Ink, modifier = Modifier.padding(14.dp))
            SunnyButton(onClick = { stars = (stars + 1).coerceAtMost(100) }) { Text("+", modifier = Modifier.padding(14.dp)) }
            SunnyButton(onClick = { approval = !approval }) { Text(if (approval) "Approval required" else "No approval required", modifier = Modifier.padding(14.dp)) }
        }
        error?.let { Text(it, color = Danger) }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            SunnyButton(onClick = {
                if (!busy) {
                    error = when {
                        title.isBlank() || title.trim().length > 200 -> "Enter a chore name of 1–200 characters."
                        people.isEmpty() -> "Choose at least one family member."
                        schedule == "weekly" && days.isEmpty() -> "Choose at least one weekday."
                        schedule == "once" && runCatching { LocalDate.parse(due) }.isFailure -> "Enter a valid date as YYYY-MM-DD."
                        else -> null
                    }
                    if (error == null) {
                        busy = true
                        val body = buildJsonObject {
                            put("title", title.trim()); put("notes", notes.trim()); put("schedule", schedule)
                            put("points", stars); put("requires_approval", approval)
                            put("assignee_ids", JsonArray(people.sorted().map(::JsonPrimitive)))
                            put("weekdays", JsonArray(days.sorted().map(::JsonPrimitive)))
                            put("due_on", if (schedule == "once") JsonPrimitive(due) else JsonNull)
                        }
                        vm.saveChore(body) { message -> busy = false; error = message; if (message == null) close() }
                    }
                }
            }, container = Sky) { Text(if (busy) "Saving…" else "Save chore", modifier = Modifier.padding(16.dp)) }
            SunnyButton(onClick = { if (!busy) close() }) { Text("Cancel", modifier = Modifier.padding(16.dp)) }
        }
    }
}

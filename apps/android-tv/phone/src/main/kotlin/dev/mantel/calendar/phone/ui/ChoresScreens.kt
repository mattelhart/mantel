@file:OptIn(ExperimentalMaterial3Api::class)

package dev.mantel.calendar.phone.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.ui.draw.clip
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.mantel.calendar.core.ChoreDef
import dev.mantel.calendar.core.dayLabel
import dev.mantel.calendar.phone.PhoneState
import dev.mantel.calendar.phone.PhoneViewModel
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

@Composable
fun ChoresScreen(state: PhoneState, vm: PhoneViewModel, open: (Page) -> Unit) {
    val people = state.board?.people.orEmpty()
    var selected by remember { mutableIntStateOf(people.firstOrNull()?.userId ?: -1) }
    val person = people.find { it.userId == selected } ?: people.firstOrNull()
    PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { vm.setChoreDay(state.choreDay.minusDays(1)) }, modifier = Modifier.touchTarget()) {
                    Icon(Icons.Filled.ChevronLeft, contentDescription = "Previous day")
                }
                Text(dayLabel(state.choreDay), modifier = Modifier.weight(1f), fontWeight = FontWeight.Bold)
                IconButton(onClick = { vm.setChoreDay(state.choreDay.plusDays(1)) }, modifier = Modifier.touchTarget()) {
                    Icon(Icons.Filled.ChevronRight, contentDescription = "Next day")
                }
            }
            WarmButton(onClick = { open(Page.Rewards) }, modifier = Modifier.fillMaxWidth().touchTarget()) {
                val stars = person?.stars ?: 0
                Text(if (person == null) "Rewards" else "${person.name} · $stars stars")
            }
            WarmButton(onClick = { open(Page.ChoreForm(null)) }, modifier = Modifier.fillMaxWidth().touchTarget()) {
                Text("Add a chore")
            }
            val waiting = state.board?.pendingApprovals.orEmpty()
            if (waiting.isNotEmpty()) {
                Text("Waiting for a parent", fontWeight = FontWeight.Bold)
                waiting.forEach { item ->
                    Text("${item.userName} · ${item.title} · ${item.points} stars · ${item.on}", fontWeight = FontWeight.SemiBold)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        WarmButton(onClick = { vm.approve(item.completionId) }, modifier = Modifier.touchTarget()) { Text("Approve") }
                        OutlinedButton(onClick = { vm.reject(item.completionId) }, modifier = Modifier.touchTarget()) { Text("Not yet") }
                    }
                }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                people.forEach { member ->
                    FilterChip(
                        selected = person?.userId == member.userId,
                        onClick = { selected = member.userId },
                        label = { Text("${member.name}  ${member.stars}★") },
                        modifier = Modifier.touchTarget(),
                    )
                }
            }
            if (person == null || person.chores.isEmpty()) Text("Nothing due.", style = MaterialTheme.typography.titleMedium)
            person?.chores?.forEach { chore ->
                val completion = chore.completion
                val done = completion?.status == "done"
                val pending = completion?.status == "pending"
                val label = buildString {
                    append(if (done) "✓  " else if (pending) "…  " else "○  ")
                    if (!chore.icon.isNullOrBlank()) append(chore.icon).append(' ')
                    append(chore.title)
                    append("   ")
                    append(chore.points)
                    append("★")
                    if (pending) append("  waiting")
                }
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .touchTarget()
                        .clip(RoundedCornerShape(16.dp))
                        .clickable(enabled = !pending) {
                            vm.completeChore(chore.choreId, person.userId, state.board?.on ?: state.choreDay.toString(), !done)
                        },
                    shape = RoundedCornerShape(16.dp),
                    color = if (done) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
                ) {
                    Text(label, modifier = Modifier.padding(16.dp), style = MaterialTheme.typography.titleMedium)
                }
            }
        }
    }
}

@Composable
fun ChoreFormScreen(state: PhoneState, vm: PhoneViewModel, choreId: Int?, onOpen: (Int?) -> Unit, onDone: () -> Unit) {
    key(choreId) {
        ChoreFormBody(state, vm, choreId, onOpen, onDone)
    }
}

@Composable
private fun ChoreFormBody(state: PhoneState, vm: PhoneViewModel, choreId: Int?, onOpen: (Int?) -> Unit, onDone: () -> Unit) {
    val editing = choreId != null
    var title by remember { mutableStateOf("") }
    var points by remember { mutableIntStateOf(1) }
    var schedule by remember { mutableStateOf("daily") }
    var days by remember { mutableStateOf(setOf(1, 2, 3, 4, 5)) }
    var due by remember { mutableStateOf(state.choreDay) }
    var approval by remember { mutableStateOf(false) }
    var picked by remember { mutableStateOf<Set<Int>?>(null) }
    var catalog by remember { mutableStateOf<List<ChoreDef>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var pickDate by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val everyone = state.users.map { it.id }.toSet()
    val chosen = picked ?: everyone

    LaunchedEffect(choreId) {
        vm.loadChoreDefs(
            onDone = { defs ->
                catalog = defs
                val existing = defs.find { it.id == choreId } ?: return@loadChoreDefs
                title = existing.title
                points = existing.points
                schedule = existing.schedule
                if (existing.weekdays.isNotEmpty()) days = existing.weekdays.toSet()
                existing.dueOn?.let { runCatching { LocalDate.parse(it) }.getOrNull() }?.let { due = it }
                approval = existing.requiresApproval
                picked = existing.assigneeIds.toSet()
            },
            onError = { error = it },
        )
    }

    if (pickDate) {
        ChoreDateDialog(due) { pickedDate ->
            pickDate = false
            if (pickedDate != null) due = pickedDate
        }
    }
    if (confirmDelete && choreId != null) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete this chore?") },
            text = { Text("It leaves the board. Stars already earned stay.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmDelete = false
                        busy = true
                        vm.deleteChore(
                            choreId,
                            onDone = onDone,
                            onError = {
                                busy = false
                                error = it
                            },
                        )
                    },
                ) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Keep it") } },
        )
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            if (editing) "Edit chore" else "Add a chore",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface,
        )
        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold)
        }
        if (state.users.isEmpty()) {
            Text("Add someone in Settings first.", color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold)
        }
        OutlinedTextField(
            value = title,
            onValueChange = { title = it },
            label = { Text("Chore") },
            placeholder = { Text("Make the bed") },
            modifier = Modifier.fillMaxWidth(),
            colors = mantelFieldColors(),
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
            singleLine = true,
        )
        Text("Stars", color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { points = (points - 1).coerceAtLeast(0) }, modifier = Modifier.touchTarget()) { Text("−") }
            Text("$points", style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Bold)
            OutlinedButton(onClick = { points = (points + 1).coerceAtMost(100) }, modifier = Modifier.touchTarget()) { Text("+") }
        }
        Text("Schedule", color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("daily" to "Every day", "weekly" to "Weekly", "once" to "One day").forEach { (value, label) ->
                FilterChip(
                    selected = schedule == value,
                    onClick = { schedule = value },
                    label = { Text(label) },
                    modifier = Modifier.touchTarget(),
                    colors = choreChipColors(),
                )
            }
        }
        if (schedule == "weekly") {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                WEEKDAY_LABELS.forEachIndexed { index, label ->
                    FilterChip(
                        selected = index in days,
                        onClick = {
                            days = if (index in days) days - index else days + index
                        },
                        label = { Text(label) },
                        modifier = Modifier.touchTarget(),
                        colors = choreChipColors(),
                    )
                }
            }
        }
        if (schedule == "once") {
            OutlinedButton(onClick = { pickDate = true }, modifier = Modifier.fillMaxWidth().touchTarget()) {
                Text("Due ${due}")
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Text(
                "Needs approval before stars",
                modifier = Modifier.weight(1f),
                color = MaterialTheme.colorScheme.onSurface,
            )
            Switch(checked = approval, onCheckedChange = { approval = it })
        }
        Text("Who it's for", color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            state.users.forEach { person ->
                FilterChip(
                    selected = person.id in chosen,
                    onClick = {
                        val base = picked ?: everyone
                        picked = if (person.id in base) base - person.id else base + person.id
                    },
                    label = { Text(person.name) },
                    modifier = Modifier.touchTarget(),
                    colors = choreChipColors(),
                )
            }
        }
        WarmButton(
            onClick = {
                error = null
                busy = true
                vm.saveChore(
                    existingId = choreId,
                    title = title,
                    points = points,
                    schedule = schedule,
                    weekdays = days.sorted(),
                    dueOn = if (schedule == "once") due.toString() else null,
                    requiresApproval = approval,
                    assigneeIds = chosen.sorted(),
                    onDone = onDone,
                    onError = {
                        busy = false
                        error = it
                    },
                )
            },
            enabled = !busy && state.users.isNotEmpty(),
            modifier = Modifier.fillMaxWidth().touchTarget(),
        ) {
            Text(if (editing) "Save chore" else "Add chore")
        }
        if (editing) {
            OutlinedButton(
                onClick = { confirmDelete = true },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().touchTarget(),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.error),
            ) { Text("Delete chore") }
            TextButton(onClick = { onOpen(null) }) { Text("Add a different chore") }
        }
        if (catalog.isNotEmpty()) {
            Text("Your chores", color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Bold)
            catalog.forEach { chore ->
                val current = chore.id == choreId
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.surface,
                ) {
                    Row(
                        Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(chore.title, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold)
                            Text(choreWhen(chore), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (current) {
                            Text("Editing", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
                        } else {
                            TextButton(onClick = { onOpen(chore.id) }) { Text("Edit") }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun choreChipColors() = FilterChipDefaults.filterChipColors(
    labelColor = MaterialTheme.colorScheme.onSurface,
    iconColor = MaterialTheme.colorScheme.onSurface,
    selectedLabelColor = MaterialTheme.colorScheme.onSecondaryContainer,
    selectedLeadingIconColor = MaterialTheme.colorScheme.onSecondaryContainer,
    containerColor = MaterialTheme.colorScheme.surface,
    selectedContainerColor = MaterialTheme.colorScheme.secondaryContainer,
)

@Composable
private fun ChoreDateDialog(current: LocalDate, onResult: (LocalDate?) -> Unit) {
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
    ) { DatePicker(state = state) }
}

private val WEEKDAY_LABELS = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")

private fun choreWhen(chore: ChoreDef): String = when (chore.schedule) {
    "weekly" -> chore.weekdays.mapNotNull { WEEKDAY_LABELS.getOrNull(it) }.joinToString(", ").ifBlank { "Weekly" }
    "once" -> chore.dueOn ?: "Once"
    else -> "Every day"
}

@Composable
fun RewardsScreen(state: PhoneState, vm: PhoneViewModel) {
    val people = state.board?.people.orEmpty()
    var selected by remember { mutableIntStateOf(people.firstOrNull()?.userId ?: -1) }
    val person = people.find { it.userId == selected } ?: people.firstOrNull()
    var error by remember { mutableStateOf<String?>(null) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            people.forEach { member ->
                FilterChip(
                    selected = person?.userId == member.userId,
                    onClick = { selected = member.userId },
                    label = { Text("${member.name}  ${member.stars}★") },
                    modifier = Modifier.touchTarget(),
                )
            }
        }
        Text("${person?.stars ?: 0} stars", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        state.board?.rewards?.forEach { reward ->
            val who = person
            val short = who != null && who.stars < reward.pointsCost
            WarmButton(
                onClick = {
                    if (who == null) return@WarmButton
                    if (short) {
                        error = "${who.name} needs ${reward.pointsCost - who.stars} more stars."
                    } else {
                        error = null
                        vm.redeem(reward.id, who.userId) { error = it }
                    }
                },
                modifier = Modifier.fillMaxWidth().touchTarget(),
            ) {
                Text("${reward.icon ?: "🎁"}  ${reward.title}   ${reward.pointsCost}★")
            }
        }
        if (state.board?.rewards.isNullOrEmpty()) Text("No rewards yet. Add them on the wall.")
        state.board?.pendingRedemptions?.forEach { row ->
            Text("${row.userName} wants ${row.rewardTitle}", fontWeight = FontWeight.Bold)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                WarmButton(onClick = { vm.fulfill(row.id) }, modifier = Modifier.touchTarget()) { Text("Given") }
                OutlinedButton(onClick = { vm.deny(row.id) }, modifier = Modifier.touchTarget()) { Text("Send back") }
            }
        }
    }
}

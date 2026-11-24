package dev.mantel.calendar.phone.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.mantel.calendar.core.DisplayTarget
import dev.mantel.calendar.core.dayLabel
import dev.mantel.calendar.phone.PhoneViewModel
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val meals = listOf("breakfast", "lunch", "dinner")
private fun String.label() = replaceFirstChar { it.uppercase() }

@Composable
fun MealsScreen(vm: PhoneViewModel) {
    var week by remember { mutableStateOf(LocalDate.now(vm.zone()).with(TemporalAdjusters.previousOrSame(DayOfWeek.SUNDAY))) }
    var plan by remember(week) { mutableStateOf<Map<String, String>?>(null) }
    var edit by remember { mutableStateOf<Pair<LocalDate, String>?>(null) }
    var title by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(week) {
        error = null
        try {
            plan = vm.mealPlan(week)
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { error = "Could not load meals." }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { week = week.minusWeeks(1) }) { Text("Previous week") }
            OutlinedButton(onClick = { week = week.plusWeeks(1) }) { Text("Next week") }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        repeat(7) { index ->
            val day = week.plusDays(index.toLong())
            Text(dayLabel(day), style = MaterialTheme.typography.titleLarge)
            meals.forEach { meal ->
                val value = plan?.get("$day:$meal").orEmpty()
                OutlinedButton(enabled = plan != null, onClick = { edit = day to meal; title = value }, modifier = Modifier.fillMaxWidth()) {
                    Text(meal.label() + if (value.isBlank()) " +" else ": $value")
                }
            }
        }
    }
    edit?.let { (day, meal) ->
        AlertDialog(
            onDismissRequest = { if (!saving) edit = null },
            title = { Text(meal.label() + " · " + dayLabel(day)) },
            text = { Column {
                OutlinedTextField(title, { title = it.take(200) }, label = { Text("Meal name") })
                Text("Clear the name and save to remove the meal.")
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            } },
            confirmButton = { TextButton(enabled = !saving, onClick = {
                saving = true
                scope.launch {
                    try {
                        vm.saveMeal(day, meal, title)
                        plan = plan.orEmpty().plus("$day:$meal" to title.trim())
                        error = null
                        edit = null
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { error = "Could not save the meal." }
                    finally { saving = false }
                }
            }) { Text("Save") } },
            dismissButton = { TextButton(enabled = !saving, onClick = { edit = null }) { Text("Cancel") } },
        )
    }
}

@Composable
fun ShowOnTvScreen(vm: PhoneViewModel) {
    var destination by remember { mutableStateOf("today") }
    var displays by remember { mutableStateOf<List<DisplayTarget>>(emptyList()) }
    var status by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(vm) {
        while (true) {
            try { displays = vm.displays() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { displays = emptyList() }
            delay(3000)
        }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("What to show", style = MaterialTheme.typography.titleLarge)
        listOf("today", "week", "month", "lists", "photos", "meals").forEach { item ->
            FilterChip(selected = destination == item, onClick = { destination = item; status = "" }, label = { Text(item.label()) })
        }
        if (displays.isEmpty()) Text("Open Homie on the TV and set its name under Show on TV.")
        displays.forEach { device ->
            OutlinedButton(enabled = !busy, onClick = {
                busy = true
                val page = destination
                scope.launch {
                    try { vm.showOnDisplay(device.id, page); status = "Sent to ${device.name}." }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { status = "Could not send. Check that Homie is open on the TV." }
                    finally { busy = false }
                }
            }) { Text("Show on ${device.name}") }
        }
        if (status.isNotEmpty()) Text(status)
    }
}

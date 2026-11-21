package dev.mantel.calendar.phone.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.mantel.calendar.core.dayLabel
import dev.mantel.calendar.core.eventsOn
import dev.mantel.calendar.phone.PhoneState
import dev.mantel.calendar.phone.PhoneTab
import dev.mantel.calendar.phone.PhoneViewModel
import dev.mantel.calendar.phone.visibleEvents
import java.time.LocalDate

private data class HomeTile(val title: String, val icon: ImageVector, val color: Color, val action: () -> Unit)

@Composable
fun FamilyHomeScreen(state: PhoneState, vm: PhoneViewModel, selectTab: (PhoneTab) -> Unit, open: (Page) -> Unit) {
    val today = LocalDate.now(vm.zone())
    val events = eventsOn(visibleEvents(state.events, state.hiddenUserIds), today, vm.zone())
    val tiles = listOf(
        HomeTile("Calendar", Icons.Default.CalendarMonth, Color(0xFFFCE1DC)) { selectTab(PhoneTab.Today) },
        HomeTile("Tasks", Icons.Default.CheckCircle, Color(0xFFE4EFD5)) { selectTab(PhoneTab.Chores) },
        HomeTile("Rewards", Icons.Default.Star, Color(0xFFFFF0CC)) { open(Page.Rewards) },
        HomeTile("Lists", Icons.Default.Checklist, Color(0xFFF5EED5)) { selectTab(PhoneTab.Lists) },
        HomeTile("Week", Icons.Default.DateRange, Color(0xFFDDEEF4)) { selectTab(PhoneTab.Week) },
        HomeTile("Add chore", Icons.Default.Add, Color(0xFFEDE1F4)) { open(Page.EditChore()) },
    )
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        tiles.chunked(3).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { tile ->
                    Column(
                        Modifier.weight(1f).clip(RoundedCornerShape(20.dp)).clickable(onClick = tile.action).padding(vertical = 12.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Box(Modifier.size(76.dp).background(tile.color, CircleShape), contentAlignment = Alignment.Center) {
                            Icon(tile.icon, contentDescription = null, tint = Ink, modifier = Modifier.size(32.dp))
                        }
                        Text(tile.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { open(Page.Meals) }) { Text("Meals") }
            OutlinedButton(onClick = { open(Page.ShowOnTv) }) { Text("Show on TV") }
            OutlinedButton(onClick = { open(Page.HomeControl) }) { Text("Lights") }
            OutlinedButton(onClick = { open(Page.PairTv) }) { Text("Pair TV") }
        }
        Text(dayLabel(today), style = MaterialTheme.typography.headlineMedium, fontFamily = FontFamily.Serif)
        if (events.isEmpty()) Text("No events today. A little room to breathe.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        events.take(5).forEach { event -> EventRow(event, state, vm) { open(Page.Event(event)) } }
        Text("Chores today", style = MaterialTheme.typography.titleLarge)
        val board = state.board?.takeIf { it.on == today.toString() }
        if (board != null) {
            val remaining = board.people.map { person ->
                person to person.chores.filter { it.completion == null }
            }.filter { it.second.isNotEmpty() }
            if (remaining.isEmpty()) Text("No chores left to do.")
            remaining.forEach { (person, chores) ->
                Text(person.name, fontWeight = FontWeight.SemiBold)
                Text(chores.joinToString(" · ") { it.title })
            }
        }
        TextButton(onClick = { vm.setChoreDay(today); selectTab(PhoneTab.Chores) }) {
            Text("Open today's chores")
        }
        OutlinedButton(onClick = { vm.setAnchor(today); selectTab(PhoneTab.Today) }, modifier = Modifier.fillMaxWidth().touchTarget()) {
            Text("View today's schedule")
        }
        WarmButton(onClick = { open(Page.Edit(null, today)) }, modifier = Modifier.fillMaxWidth().touchTarget()) {
            Text("Add event")
        }
    }
}

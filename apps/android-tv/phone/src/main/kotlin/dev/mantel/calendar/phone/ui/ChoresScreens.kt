@file:OptIn(ExperimentalMaterial3Api::class)

package dev.mantel.calendar.phone.ui

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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Text
import androidx.compose.ui.draw.clip
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.mantel.calendar.core.dayLabel
import dev.mantel.calendar.phone.PhoneState
import dev.mantel.calendar.phone.PhoneViewModel

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
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                WarmButton(onClick = { open(Page.EditChore()) }, modifier = Modifier.touchTarget()) { Text("Add chore") }
                OutlinedButton(onClick = { open(Page.AllChores) }, modifier = Modifier.touchTarget()) { Text("All chores / edit") }
            }
            person?.let { member ->
                val completed = member.chores.count { it.completion?.status == "done" }
                Text("${member.name}: $completed of ${member.chores.size} complete", fontWeight = FontWeight.Bold)
                LinearProgressIndicator(
                    progress = { if (member.chores.isEmpty()) 0f else completed.toFloat() / member.chores.size },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            WarmButton(onClick = { open(Page.Rewards) }, modifier = Modifier.fillMaxWidth().touchTarget()) {
                val stars = person?.stars ?: 0
                Text(if (person == null) "Rewards" else "${person.name} · $stars stars")
            }
            val waiting = state.board?.pendingApprovals.orEmpty()
            if (waiting.isNotEmpty()) {
                Text("Waiting for approval", fontWeight = FontWeight.Bold)
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
                    if (chore.points > 0) append("   ${chore.points}★")
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

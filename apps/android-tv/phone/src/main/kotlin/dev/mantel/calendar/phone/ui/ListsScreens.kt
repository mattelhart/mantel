@file:OptIn(ExperimentalMaterial3Api::class)

package dev.mantel.calendar.phone.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Text
import androidx.compose.ui.draw.clip
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import dev.mantel.calendar.phone.PhoneState
import dev.mantel.calendar.phone.PhoneViewModel

@Composable
fun ListsScreen(state: PhoneState, vm: PhoneViewModel, open: (Page) -> Unit) {
    var name by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (state.lists.isEmpty()) Text("No lists yet.", style = MaterialTheme.typography.titleMedium)
            state.lists.forEach { list ->
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .touchTarget()
                        .clip(RoundedCornerShape(16.dp))
                        .clickable { open(Page.ListDetail(list.id)) },
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.surface,
                ) {
                    Text(
                        "${list.icon ?: "📝"}  ${list.name}   ${list.itemCount} left",
                        modifier = Modifier.padding(16.dp),
                        style = MaterialTheme.typography.titleMedium,
                    )
                }
            }
            OutlinedTextField(
                name,
                { name = it },
                label = { Text("New list") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                colors = mantelFieldColors(),
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
            )
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            WarmButton(
                onClick = {
                    vm.addList(name) { error = it }
                    name = ""
                },
                modifier = Modifier.fillMaxWidth().touchTarget(),
            ) { Text("Add list") }
        }
    }
}

@Composable
fun ListDetail(id: Int, state: PhoneState, vm: PhoneViewModel) {
    val list = state.lists.find { it.id == id }
    var text by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    if (list == null) {
        Text("That list is gone.", modifier = Modifier.padding(20.dp), style = MaterialTheme.typography.titleMedium)
        return
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text("${list.icon ?: ""} ${list.name}".trim(), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        list.items.forEach { item ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().touchTarget()) {
                Checkbox(checked = item.checked, onCheckedChange = { vm.toggleItem(list.id, item.id, it) })
                Text(
                    item.text,
                    modifier = Modifier.weight(1f).clickable { vm.toggleItem(list.id, item.id, !item.checked) },
                    textDecoration = if (item.checked) TextDecoration.LineThrough else null,
                    style = MaterialTheme.typography.titleMedium,
                )
                IconButton(onClick = { vm.deleteItem(list.id, item.id) }, modifier = Modifier.touchTarget()) {
                    Text("✕")
                }
            }
        }
        OutlinedTextField(
            text,
            { text = it },
            label = { Text("Add an item") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            colors = mantelFieldColors(),
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
        )
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        WarmButton(
            onClick = {
                vm.addItem(list.id, text) { error = it }
                text = ""
            },
            modifier = Modifier.fillMaxWidth().touchTarget(),
        ) { Text("Add") }
        if (list.items.any { it.checked }) {
            TextButton(onClick = { vm.clearChecked(list.id) }, modifier = Modifier.touchTarget()) {
                Text("Clear checked")
            }
        }
    }
}

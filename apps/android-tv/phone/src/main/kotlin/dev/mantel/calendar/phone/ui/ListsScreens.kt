@file:OptIn(ExperimentalMaterial3Api::class)
package dev.mantel.calendar.phone.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import dev.mantel.calendar.core.ListItem
import dev.mantel.calendar.phone.PhoneState
import dev.mantel.calendar.phone.PhoneViewModel

@Composable
fun ListsScreen(state: PhoneState, vm: PhoneViewModel, open: (Page) -> Unit) {
    var adding by remember { mutableStateOf(false) }
    PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            WarmButton(onClick = { adding = true }, modifier = Modifier.fillMaxWidth().touchTarget()) { Text("Add list") }
            if (state.lists.isEmpty()) Text("Create a grocery, packing, or family to-do list.")
            state.lists.forEach { list ->
                Surface(onClick = { open(Page.ListDetail(list.id)) }, modifier = Modifier.fillMaxWidth().touchTarget(), shape = RoundedCornerShape(16.dp)) {
                    Column(Modifier.padding(16.dp)) {
                        Text("${list.icon ?: "📝"} ${list.name}", style = MaterialTheme.typography.titleMedium)
                        Text("${list.itemCount} remaining · ${list.items.size} total", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
    if (adding) EditTextDialog("New list", "", 100, { adding = false }, vm::createList)
}

@Composable
fun ListDetail(id: Int, state: PhoneState, vm: PhoneViewModel, back: () -> Unit) {
    val list = state.lists.find { it.id == id }
    var text by remember(id) { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var rename by remember { mutableStateOf(false) }
    var delete by remember { mutableStateOf(false) }
    var clear by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<ListItem?>(null) }
    var deleting by remember { mutableStateOf<ListItem?>(null) }
    if (list == null) {
        Column(Modifier.padding(20.dp)) {
            Text("This list is no longer available.")
            TextButton(onClick = back) { Text("Back to lists") }
        }
        return
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(list.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = { rename = true }, modifier = Modifier.touchTarget()) { Text("Rename list") }
            TextButton(onClick = { delete = true }, modifier = Modifier.touchTarget()) { Text("Delete list", color = MaterialTheme.colorScheme.error) }
        }
        list.items.forEach { item ->
            Column(Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = item.checked, onCheckedChange = { vm.toggleItem(id, item.id, it) })
                    Text(item.text, modifier = Modifier.weight(1f).clickable { editing = item },
                        textDecoration = if (item.checked) TextDecoration.LineThrough else null,
                        style = MaterialTheme.typography.titleMedium)
                }
                Row(Modifier.padding(start = 40.dp)) {
                    TextButton(onClick = { editing = item }) { Text("Edit") }
                    TextButton(onClick = { deleting = item }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
                }
            }
        }
        OutlinedTextField(text, { text = it }, label = { Text("Add an item") }, modifier = Modifier.fillMaxWidth(),
            enabled = !busy, colors = mantelFieldColors())
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        WarmButton(enabled = !busy && text.isNotBlank() && text.trim().length <= 500, onClick = {
            busy = true
            error = null
            vm.createItem(id, text) { message ->
                busy = false
                error = message
                if (message == null) text = ""
            }
        }, modifier = Modifier.fillMaxWidth().touchTarget()) { Text(if (busy) "Adding…" else "Add item") }
        if (list.items.any { it.checked }) TextButton(onClick = { clear = true }, modifier = Modifier.touchTarget()) { Text("Clear completed items") }
    }
    if (rename) EditTextDialog("Rename list", list.name, 100, { rename = false }) { value, result -> vm.renameList(id, value, result) }
    if (delete) DeleteDialog("Delete ${list.name}?", "This deletes the list and all ${list.items.size} items for everyone.", { delete = false }) { result ->
        vm.removeList(id) { message -> result(message); if (message == null) back() }
    }
    if (clear) DeleteDialog("Delete completed items?", "This removes ${list.items.count { it.checked }} completed items for everyone.", { clear = false }) { vm.removeChecked(id, it) }
    editing?.let { item -> EditTextDialog("Edit item", item.text, 500, { editing = null }) { value, result -> vm.renameItem(id, item.id, value, result) } }
    deleting?.let { item -> DeleteDialog("Delete item?", item.text, { deleting = null }) { vm.removeItem(id, item.id, it) } }
}

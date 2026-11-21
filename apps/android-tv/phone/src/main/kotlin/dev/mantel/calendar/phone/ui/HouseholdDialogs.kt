package dev.mantel.calendar.phone.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*

@Composable
fun EditTextDialog(title: String, initial: String, limit: Int, close: () -> Unit, save: (String, (String?) -> Unit) -> Unit) {
    var value by remember { mutableStateOf(initial) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!busy) close() },
        title = { Text(title) },
        text = {
            Column {
                OutlinedTextField(value, { value = it }, enabled = !busy, label = { Text("Name") }, colors = mantelFieldColors())
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && value.isNotBlank() && value.trim().length <= limit, onClick = {
                busy = true
                error = null
                save(value.trim()) { message ->
                    busy = false
                    error = message
                    if (message == null) close()
                }
            }) { Text(if (busy) "Saving…" else "Save") }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = close) { Text("Cancel") } },
    )
}

@Composable
fun DeleteDialog(title: String, explanation: String, close: () -> Unit, remove: ((String?) -> Unit) -> Unit) {
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!busy) close() },
        title = { Text(title) },
        text = { Column { Text(explanation); error?.let { Text(it, color = MaterialTheme.colorScheme.error) } } },
        confirmButton = {
            TextButton(enabled = !busy, onClick = {
                busy = true
                remove { message ->
                    busy = false
                    error = message
                    if (message == null) close()
                }
            }) { Text(if (busy) "Deleting…" else "Delete", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = close) { Text("Cancel") } },
    )
}

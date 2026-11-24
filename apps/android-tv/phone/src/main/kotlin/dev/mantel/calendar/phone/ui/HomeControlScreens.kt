package dev.mantel.calendar.phone.ui

import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import dev.mantel.calendar.core.HomeEntity
import dev.mantel.calendar.core.HomeSetup
import dev.mantel.calendar.core.HomeSnapshot
import dev.mantel.calendar.core.PairingCode
import dev.mantel.calendar.phone.PhoneViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private fun errText(e: Exception, fallback: String) = e.message?.takeIf { it.isNotBlank() } ?: fallback

private fun qrBitmap(text: String): Bitmap {
    val matrix = QRCodeWriter().encode(
        text, BarcodeFormat.QR_CODE, 0, 0,
        mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 1),
    )
    val bitmap = Bitmap.createBitmap(matrix.width, matrix.height, Bitmap.Config.ARGB_8888)
    for (x in 0 until matrix.width) for (y in 0 until matrix.height) {
        bitmap.setPixel(x, y, if (matrix[x, y]) AndroidColor.BLACK else AndroidColor.WHITE)
    }
    return bitmap
}

/** Shows a code for a TV to type, and the same thing as a QR for another phone to scan. */
@Composable
fun PairTvScreen(vm: PhoneViewModel) {
    var code by remember { mutableStateOf<PairingCode?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var left by remember { mutableStateOf<Long?>(null) }
    val scope = rememberCoroutineScope()

    val mint: () -> Unit = {
        if (!busy) {
            busy = true
            error = null
            scope.launch {
                try {
                    code = vm.createPairingCode()
                } catch (c: CancellationException) {
                    throw c
                } catch (e: Exception) {
                    error = errText(e, "Could not make a code.")
                } finally {
                    busy = false
                }
            }
        }
    }
    LaunchedEffect(Unit) { mint() }
    LaunchedEffect(code) {
        val current = code ?: return@LaunchedEffect
        while (true) {
            left = minutesLeft(current.expiresAt)
            if (left == 0L) break
            delay(15_000)
        }
    }
    val expired = left == 0L
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("On the TV, open Homie. When it says “Pair this TV”, type this code with the remote.")
        val current = code
        if (current != null) {
            Text(
                if (expired) "Expired" else current.code,
                fontSize = 44.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                color = if (expired) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onBackground,
            )
            if (!expired && current.qrPayload.isNotBlank()) {
                val bitmap = remember(current.qrPayload) { qrBitmap(current.qrPayload) }
                Image(
                    bitmap = bitmap.asImageBitmap(),
                    contentDescription = "Pairing QR for another phone",
                    modifier = Modifier.size(220.dp),
                    filterQuality = FilterQuality.None,
                )
                Text(
                    "Another phone can scan this instead.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                when {
                    expired -> "That code has run out. Make a new one."
                    left == null -> "Works once."
                    left == 1L -> "Works once, for about a minute."
                    else -> "Works once, for about $left minutes."
                },
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else if (busy) {
            Text("Making a code…")
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        WarmButton(onClick = mint, enabled = !busy, modifier = Modifier.fillMaxWidth().touchTarget()) {
            Text(if (code == null) "Show a code" else "New code")
        }
        Text(
            "A TV on your home network is let in without a code, so it may never ask. " +
                "A new code replaces the old one. Revoke a TV from the wall under Settings → Devices.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * Home Assistant address and long-lived token. The token is typed here, sent to the server once,
 * and the field is emptied. It is never kept in saved state and never read back: the server only
 * says whether one is saved.
 */
@Composable
fun HomeSettingsSection(vm: PhoneViewModel, openHome: () -> Unit) {
    var setup by remember { mutableStateOf<HomeSetup?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var address by remember { mutableStateOf<String?>(null) }
    var token by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<String?>(null) }
    var resultOk by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    suspend fun load() {
        try {
            setup = vm.homeSetup()
            loadError = null
        } catch (c: CancellationException) {
            throw c
        } catch (e: Exception) {
            loadError = errText(e, "Could not read the Home settings.")
        }
    }
    LaunchedEffect(Unit) { load() }

    Text("Home control", fontWeight = FontWeight.Bold)
    Text(
        "Homie controls lights, fans, shades and locks through Home Assistant. In Home Assistant: your profile → Security → Long-lived access tokens → Create token. Paste it here.",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    val current = setup
    if (current == null) {
        Text(loadError ?: "Loading…", color = if (loadError != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    val shownAddress = address ?: current.haBaseUrl
    val tokenSaved = current.server.haTokenSet
    val dirty = (address != null && address != current.haBaseUrl) || token.isNotBlank()

    OutlinedTextField(
        value = shownAddress,
        onValueChange = { address = it },
        modifier = Modifier.fillMaxWidth().touchTarget(),
        singleLine = true,
        label = { Text("Home Assistant address") },
        placeholder = { Text("http://10.0.15.178:8123") },
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
        colors = mantelFieldColors(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
    )
    OutlinedTextField(
        value = token,
        onValueChange = { token = it },
        modifier = Modifier.fillMaxWidth().touchTarget(),
        singleLine = true,
        label = { Text("Long-lived access token") },
        placeholder = { Text(if (tokenSaved) "•••••••• saved. Paste a new one to replace it" else "Paste the token") },
        visualTransformation = PasswordVisualTransformation(),
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
        colors = mantelFieldColors(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
    )
    Text(
        if (tokenSaved) "Token saved on the server" else "No token saved yet",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )

    suspend fun save(): Boolean {
        return try {
            vm.saveHomeConnection(
                baseUrl = address?.takeIf { it != current.haBaseUrl },
                token = token.takeIf { it.isNotBlank() },
            )
            token = ""
            address = null
            load()
            true
        } catch (c: CancellationException) {
            throw c
        } catch (e: Exception) {
            resultOk = false
            result = errText(e, "Could not save.")
            false
        }
    }

    WarmButton(
        onClick = { scope.launch { busy = true; result = null; if (save()) { resultOk = true; result = "Saved." }; busy = false } },
        enabled = dirty && !busy,
        modifier = Modifier.fillMaxWidth().touchTarget(),
    ) { Text("Save") }
    OutlinedButton(
        onClick = {
            scope.launch {
                busy = true
                result = null
                if (!dirty || save()) {
                    try {
                        val r = vm.testHome()
                        resultOk = r.ok
                        result = r.message
                    } catch (c: CancellationException) {
                        throw c
                    } catch (e: Exception) {
                        resultOk = false
                        result = errText(e, "The test failed.")
                    }
                }
                busy = false
            }
        },
        enabled = !busy && (tokenSaved || token.isNotBlank()),
        modifier = Modifier.fillMaxWidth().touchTarget(),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.primary),
    ) { Text(if (busy) "Working…" else "Test connection") }
    result?.let {
        Text(
            (if (resultOk) "✓ " else "") + it,
            color = if (resultOk) MaterialTheme.colorScheme.onBackground else MaterialTheme.colorScheme.error,
        )
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (tokenSaved) {
            TextButton(
                onClick = {
                    scope.launch {
                        busy = true
                        try {
                            vm.saveHomeConnection(null, null, clearToken = true)
                            result = null
                            load()
                        } catch (c: CancellationException) {
                            throw c
                        } catch (e: Exception) {
                            resultOk = false
                            result = errText(e, "Could not remove it.")
                        }
                        busy = false
                    }
                },
                enabled = !busy,
                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
            ) { Text("Remove token") }
        }
        TextButton(onClick = openHome) { Text("Open lights") }
    }
}

private val onOffDomains = setOf("light", "fan", "switch", "input_boolean")

private fun HomeEntity.subtitle(): String = when {
    !available -> "Unavailable"
    domain == "cover" -> when {
        state == "closed" -> "Closed"
        level != null && level!! < 100 -> "Open $level%"
        else -> "Open"
    }
    domain == "lock" -> state.replaceFirstChar { it.uppercase() }
    domain == "climate" -> state.replaceFirstChar { it.uppercase() }
    on == true -> if (level != null && adjustable) "$level%" else "On"
    else -> "Off"
}

/** Rooms with a switch per device, a slider for dimmers, fans and shades, and scenes on top. Refreshes every few seconds while open. */
@Composable
fun HomeControlScreen(vm: PhoneViewModel, onSetup: () -> Unit) {
    var home by remember { mutableStateOf<HomeSnapshot?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var lock by remember { mutableStateOf<HomeEntity?>(null) }
    var reload by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(reload) {
        while (true) {
            try {
                home = vm.home()
                failure = null
            } catch (c: CancellationException) {
                throw c
            } catch (e: Exception) {
                failure = errText(e, "Could not reach Homie.")
            }
            delay(4000)
        }
    }

    fun act(entity: HomeEntity, action: String, value: Int? = null, confirm: Boolean = false) {
        scope.launch {
            try {
                vm.homeAction(entity.entityId, action, value, confirm)
                notice = null
            } catch (c: CancellationException) {
                throw c
            } catch (e: Exception) {
                notice = errText(e, "That didn't work.")
            }
            reload += 1
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        val snapshot = home
        if (snapshot == null) {
            Text(failure ?: "Loading…", color = if (failure != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
            return@Column
        }
        failure?.let { Text("$it Showing the last known state.", color = MaterialTheme.colorScheme.error) }
        if (snapshot.status != "ok") {
            Text(
                when (snapshot.status) {
                    "not_configured" -> "Home control isn't set up yet."
                    "invalid_token" -> "Home Assistant rejected the access token."
                    "unreachable" -> "Homie can't reach Home Assistant."
                    else -> "Home control is unavailable."
                },
                style = MaterialTheme.typography.titleMedium,
            )
            if (snapshot.message.isNotBlank()) Text(snapshot.message, color = MaterialTheme.colorScheme.onSurfaceVariant)
            WarmButton(onClick = onSetup, modifier = Modifier.fillMaxWidth().touchTarget()) { Text("Open Settings") }
            return@Column
        }
        notice?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (snapshot.actions.isNotEmpty()) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                snapshot.actions.take(3).forEach { scene ->
                    FilterChip(
                        selected = false,
                        enabled = scene.available,
                        onClick = { act(scene, "activate") },
                        label = { Text(scene.name) },
                        modifier = Modifier.touchTarget(),
                    )
                }
            }
            if (snapshot.actions.size > 3) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    snapshot.actions.drop(3).take(3).forEach { scene ->
                        FilterChip(selected = false, enabled = scene.available, onClick = { act(scene, "activate") }, label = { Text(scene.name) }, modifier = Modifier.touchTarget())
                    }
                }
            }
        }
        if (snapshot.rooms.isEmpty()) Text("Home Assistant has nothing to show yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        snapshot.rooms.forEach { room ->
            Card(
                Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(room.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    room.entities.forEach { e ->
                        Row(
                            Modifier.fillMaxWidth().touchTarget(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(e.name, fontWeight = FontWeight.SemiBold)
                                Text(e.subtitle(), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                            }
                            when {
                                e.domain in onOffDomains -> Switch(
                                    checked = e.on == true,
                                    enabled = e.available,
                                    onCheckedChange = { act(e, if (it) "turn_on" else "turn_off") },
                                )
                                e.domain == "cover" -> OutlinedButton(enabled = e.available, onClick = { act(e, if (e.on == true) "close" else "open") }) {
                                    Text(if (e.on == true) "Close" else "Open")
                                }
                                e.domain == "lock" -> OutlinedButton(enabled = e.available, onClick = { lock = e }) {
                                    Text(if (e.on == true) "Lock" else "Unlock")
                                }
                            }
                        }
                        if (e.adjustable && e.available && e.on == true && e.domain != "climate" && e.level != null) {
                            var draft by remember(e.entityId, e.level) { mutableStateOf(e.level!!.toFloat()) }
                            Slider(
                                value = draft,
                                onValueChange = { draft = it },
                                onValueChangeFinished = { act(e, "set_level", draft.toInt()) },
                                valueRange = 0f..100f,
                                steps = 19,
                            )
                        }
                    }
                }
            }
        }
    }
    lock?.let { e ->
        val unlocking = e.on != true
        AlertDialog(
            onDismissRequest = { lock = null },
            title = { Text((if (unlocking) "Unlock " else "Lock ") + e.name + "?") },
            text = { Text(if (unlocking) "Anyone nearby can walk in once it is unlocked." else "It will lock right away.") },
            confirmButton = {
                TextButton(onClick = {
                    lock = null
                    act(e, if (unlocking) "unlock" else "lock", confirm = true)
                }) { Text(if (unlocking) "Unlock" else "Lock") }
            },
            dismissButton = { TextButton(onClick = { lock = null }) { Text("Cancel") } },
        )
    }
}

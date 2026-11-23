@file:OptIn(ExperimentalMaterial3Api::class)

package dev.mantel.calendar.phone.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import android.app.Activity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material.icons.filled.Today
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.isSystemInDarkTheme
import dev.mantel.calendar.core.eventDay
import dev.mantel.calendar.phone.Phase
import dev.mantel.calendar.phone.PhoneState
import dev.mantel.calendar.phone.PhoneTab
import dev.mantel.calendar.phone.PhoneViewModel
import dev.mantel.calendar.phone.ThemeChoice

internal fun mantelLight() = lightColorScheme(
    primary = Ember,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFDCEFF1),
    onPrimaryContainer = Ink,
    secondary = Ember,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFDCEFF1),
    onSecondaryContainer = Ink,
    background = Paper,
    onBackground = Ink,
    surface = Color.White,
    onSurface = Ink,
    surfaceVariant = Color(0xFFF0F2F5),
    onSurfaceVariant = Dim,
    outline = Line,
    error = Danger,
    onError = Color.White,
    errorContainer = Color(0xFFF8D4CE),
    onErrorContainer = Color(0xFF6E2B12),
    tertiaryContainer = Color(0xFFDCEFF1),
    onTertiaryContainer = Ink,
)

internal fun mantelDark() = darkColorScheme(
    primary = Color(0xFFFF8A5B),
    onPrimary = Color(0xFF2A1208),
    primaryContainer = Color(0xFF4A3418),
    onPrimaryContainer = Color(0xFFFFE3C2),
    secondary = Color(0xFFFFB086),
    onSecondary = Color(0xFF2A1208),
    secondaryContainer = Color(0xFF4A3418),
    onSecondaryContainer = Color(0xFFF4EFE6),
    background = Color(0xFF12151C),
    onBackground = Color(0xFFF4EFE6),
    surface = Color(0xFF1C2230),
    onSurface = Color(0xFFF4EFE6),
    surfaceVariant = Color(0xFF2A3142),
    onSurfaceVariant = Color(0xFFD7C4B0),
    outline = Color(0xFFC4B3A0),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF3B0907),
    errorContainer = Color(0xFF5C2018),
    onErrorContainer = Color(0xFFFFD0C8),
    tertiaryContainer = Color(0xFF4A3418),
    onTertiaryContainer = Color(0xFFFFE3C2),
)

@Composable
fun MantelPhoneApp(vm: PhoneViewModel, initialLink: String?) {
    val state by vm.state.collectAsStateWithLifecycle()
    val dark = when (state.theme) {
        ThemeChoice.System -> isSystemInDarkTheme()
        ThemeChoice.Dark -> true
        ThemeChoice.Light -> false
    }
    var scanning by remember { mutableStateOf(false) }
    var stack by remember { mutableStateOf(listOf<Page>()) }
    var tab by remember { mutableStateOf(PhoneTab.Home) }
    val lifecycle = LocalLifecycleOwner.current
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) vm.refresh()
        }
        lifecycle.lifecycle.addObserver(observer)
        onDispose { lifecycle.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(initialLink) {
        if (!initialLink.isNullOrBlank()) vm.openPairingLink(initialLink, fromIntent = true)
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    var asked by remember { mutableStateOf(false) }
    LaunchedEffect(state.phase) {
        if (state.phase == Phase.Ready && !asked && Build.VERSION.SDK_INT >= 33) {
            asked = true
            permission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    // System back: close the scanner, then pop a page, then return to the Home tab. Only Back
    // on the Home tab itself leaves the app.
    BackHandler(enabled = scanning || stack.isNotEmpty() || (state.phase == Phase.Ready && tab != PhoneTab.Home)) {
        when {
            scanning -> scanning = false
            stack.isNotEmpty() -> stack = stack.dropLast(1)
            else -> tab = PhoneTab.Home
        }
    }
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            val bars = WindowCompat.getInsetsController(window, view)
            bars.isAppearanceLightStatusBars = !dark
            bars.isAppearanceLightNavigationBars = !dark
        }
    }
    MaterialTheme(colorScheme = if (dark) mantelDark() else mantelLight()) {
      // Edge to edge draws under a landscape camera cutout; keep content beside it.
      Box(
          Modifier.fillMaxSize()
              .background(MaterialTheme.colorScheme.background)
              .windowInsetsPadding(WindowInsets.displayCutout.only(WindowInsetsSides.Horizontal)),
      ) {
        if (scanning) {
            QrScanner(onResult = {
                scanning = false
                vm.openPairingLink(it)
            }, onClose = { scanning = false })
        } else when (state.phase) {
            Phase.Loading -> Loading(state.message)
            Phase.Address -> AddressScreen(state, vm, onScan = { scanning = true })
            Phase.Pair -> PairScreen(state, vm, onScan = { scanning = true })
            Phase.Ready -> Scaffold(
                topBar = {
                    TopAppBar(
                        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                        navigationIcon = {
                            if (stack.isNotEmpty()) {
                                TextButton(onClick = { stack = stack.dropLast(1) }) { Text("Back") }
                            }
                        },
                        title = {
                            Column {
                                Text(titleFor(tab, stack.lastOrNull()), fontFamily = FontFamily.Serif, fontWeight = FontWeight.Medium)
                                Text(
                                    if (state.offline) state.offlineDetail.ifBlank { "Offline, last synced earlier" } else state.syncedDetail,
                                    style = MaterialTheme.typography.labelMedium,
                                    color = if (state.offline) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        },
                        actions = {
                            if (stack.isEmpty()) {
                                IconButton(onClick = { stack = stack + Page.Settings }) {
                                    Icon(Icons.Filled.Settings, contentDescription = "Settings")
                                }
                            }
                        },
                    )
                },
                bottomBar = {
                    if (stack.isEmpty()) {
                        NavigationBar(containerColor = MaterialTheme.colorScheme.surface, tonalElevation = 0.dp) {
                            listOf(PhoneTab.Home, PhoneTab.Today, PhoneTab.Chores, PhoneTab.Lists, PhoneTab.Messages).forEach { item ->
                                NavigationBarItem(
                                    selected = tab == item || (item == PhoneTab.Today && tab in listOf(PhoneTab.Week, PhoneTab.Month)),
                                    onClick = {
                                        tab = item
                                        stack = emptyList()
                                    },
                                    icon = { Icon(item.icon(), contentDescription = item.label()) },
                                    label = { Text(item.label()) },
                                    alwaysShowLabel = true,
                                )
                            }
                        }
                    }
                },
            ) { padding ->
                Column(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding).imePadding()) {
                    if (state.offline) OfflineBanner(state.offlineDetail.ifBlank { "Offline, last synced earlier" })
                    state.message?.let { text ->
                        MessageBanner(text)
                        TextButton(
                            onClick = vm::dismissMessage,
                            modifier = Modifier.padding(horizontal = 8.dp),
                            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.primary),
                        ) {
                            Text("Dismiss")
                        }
                    }
                    if (stack.isEmpty() && tab in listOf(PhoneTab.Today, PhoneTab.Week, PhoneTab.Month)) {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf(PhoneTab.Today, PhoneTab.Week, PhoneTab.Month).forEach { view ->
                                FilterChip(selected = tab == view, onClick = { tab = view }, label = { Text(if (view == PhoneTab.Today) "Schedule" else view.label()) }, modifier = Modifier.touchTarget())
                            }
                        }
                    }
                    val page = stack.lastOrNull()
                    Box(Modifier.weight(1f).fillMaxWidth()) {
                        if (page == null) {
                            when (tab) {
                                PhoneTab.Home -> FamilyHomeScreen(state, vm, selectTab = { tab = it }, open = { stack = stack + it })
                                PhoneTab.Today -> TodayScreen(state, vm) { stack = stack + it }
                                PhoneTab.Week -> WeekScreen(state, vm) { stack = stack + it }
                                PhoneTab.Month -> MonthScreen(state, vm) { stack = stack + it }
                                PhoneTab.Chores -> ChoresScreen(state, vm) { stack = stack + it }
                                PhoneTab.Lists -> ListsScreen(state, vm) { stack = stack + it }
                                PhoneTab.Messages -> MessagesScreen(state, vm) { stack = stack + it }
                            }
                        } else {
                            when (page) {
                                is Page.Event -> EventDetail(page.event, state, vm, onEdit = {
                                    stack = stack + Page.Edit(page.event, eventDay(page.event, vm.zone()))
                                }, onBack = { stack = stack.dropLast(1) })
                                is Page.Edit -> EditEvent(page.event, page.day, state, vm) { stack = stack.dropLast(1) }
                                is Page.ListDetail -> ListDetail(page.id, state, vm) { stack = stack.dropLast(1) }
                                is Page.EditChore -> ChoreEditor(page.chore, state, vm) { stack = stack.dropLast(1) }
                                Page.AllChores -> AllChoresScreen(state, vm) { stack = stack + it }
                                Page.Rewards -> RewardsScreen(state, vm)
                                Page.Meals -> MealsScreen(vm)
                                Page.ShowOnTv -> ShowOnTvScreen(vm)
                                Page.PairTv -> PairTvScreen(vm)
                                Page.HomeControl -> HomeControlScreen(vm, onSetup = { stack = stack.dropLast(1) + Page.Settings })
                                Page.Settings -> SettingsScreen(state, vm, open = { stack = stack + it })
                                is Page.Thread -> MessageThreadScreen(page.id, state, vm, openDraw = { stack = stack + Page.Draw(page.id) })
                                is Page.Draw -> DrawMessageScreen(page.conversationId, state, vm) { stack = stack.dropLast(1) }
                            }
                        }
                    }
                }
            }
        }
      }
    }
}

private fun titleFor(tab: PhoneTab, page: Page?): String = when (page) {
    is Page.Event -> "Event"
    is Page.Edit -> if (page.event == null) "New event" else "Edit event"
    is Page.ListDetail -> "List"
    is Page.EditChore -> if (page.chore == null) "New chore" else "Edit chore"
    Page.AllChores -> "All chores"
    Page.Rewards -> "Rewards"
    Page.Meals -> "Meal plan"
    Page.ShowOnTv -> "Show on TV"
    Page.PairTv -> "Pair a TV"
    Page.HomeControl -> "Home control"
    Page.Settings -> "Settings"
    is Page.Thread -> "Messages"
    is Page.Draw -> "Draw a picture"
    null -> if (tab == PhoneTab.Home) "Family calendar" else tab.label()
}

private fun PhoneTab.label(): String = when (this) {
    PhoneTab.Home -> "Home"
    PhoneTab.Today -> "Calendar"
    PhoneTab.Week -> "Week"
    PhoneTab.Month -> "Month"
    PhoneTab.Chores -> "Chores"
    PhoneTab.Lists -> "Lists"
    PhoneTab.Messages -> "Messages"
}

private fun PhoneTab.icon(): ImageVector = when (this) {
    PhoneTab.Home -> Icons.Filled.Home
    PhoneTab.Today -> Icons.Filled.Today
    PhoneTab.Week -> Icons.Filled.DateRange
    PhoneTab.Month -> Icons.Filled.CalendarMonth
    PhoneTab.Chores -> Icons.Filled.CheckCircle
    PhoneTab.Lists -> Icons.Filled.Checklist
    PhoneTab.Messages -> Icons.AutoMirrored.Filled.Chat
}

@Composable
private fun Loading(message: String?) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator()
        Text(message ?: "Looking for the calendar server…", modifier = Modifier.padding(top = 16.dp))
    }
}

@Composable
private fun AddressScreen(state: PhoneState, vm: PhoneViewModel, onScan: () -> Unit) {
    var address by remember(state.origin) { mutableStateOf(state.origin.orEmpty()) }
    val submit = { vm.connect(address) }
    SetupColumn(state.message) {
        Text("Connect to your calendar", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text("The calendar server's address. Reachable at home, or over a VPN such as WireGuard.")
        OutlinedTextField(
            value = address,
            onValueChange = { address = it },
            modifier = Modifier.fillMaxWidth().touchTarget(),
            placeholder = { Text("http://192.168.1.10:8080") },
            singleLine = true,
            label = { Text("Calendar server") },
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
            colors = mantelFieldColors(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { submit() }),
        )
        WarmButton(onClick = submit, modifier = Modifier.fillMaxWidth().touchTarget()) {
            Text("Connect")
        }
        OutlinedButton(
            onClick = onScan,
            modifier = Modifier.fillMaxWidth().touchTarget(),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.primary),
        ) {
            Text("Scan pairing QR")
        }
    }
}

@Composable
private fun PairScreen(state: PhoneState, vm: PhoneViewModel, onScan: () -> Unit) {
    var code by remember { mutableStateOf("") }
    SetupColumn(state.message) {
        Text("Pair this phone", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text("On the wall: Settings → Devices → Pair a phone. Scan the QR, or type the 8-character code.")
        state.origin?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        OutlinedTextField(
            value = code,
            onValueChange = { code = it },
            modifier = Modifier.fillMaxWidth().touchTarget(),
            placeholder = { Text("K7NQ-4RMP") },
            singleLine = true,
            label = { Text("Pairing code") },
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
            colors = mantelFieldColors(),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
        )
        WarmButton(onClick = { vm.pair(code) }, modifier = Modifier.fillMaxWidth().touchTarget()) { Text("Pair") }
        OutlinedButton(
            onClick = onScan,
            modifier = Modifier.fillMaxWidth().touchTarget(),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.primary),
        ) { Text("Scan pairing QR") }
        TextButton(
            onClick = vm::editServer,
            modifier = Modifier.touchTarget(),
            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.primary),
        ) { Text("Use a different server") }
    }
}

@Composable
private fun SetupColumn(message: String?, content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = mantelDark()) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background,
            contentColor = MaterialTheme.colorScheme.onBackground,
        ) {
            Column(
                Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                content()
                if (message != null) Text(message, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@Composable
fun SettingsScreen(state: PhoneState, vm: PhoneViewModel, open: (Page) -> Unit = {}) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Appearance", fontWeight = FontWeight.Bold)
        Text(
            "System follows this phone. Light and Dark stay put.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ThemeChoice.entries.forEach { choice ->
                FilterChip(
                    selected = state.theme == choice,
                    onClick = { vm.setTheme(choice) },
                    label = { Text(choice.name) },
                    modifier = Modifier.touchTarget(),
                )
            }
        }
        Text("TVs", fontWeight = FontWeight.Bold)
        Text(
            "Show a code here and type it on the TV to sign it in. A TV on your home network may not ask for one.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        WarmButton(onClick = { open(Page.PairTv) }, modifier = Modifier.fillMaxWidth().touchTarget()) {
            Text("Pair a TV")
        }
        HomeSettingsSection(vm, openHome = { open(Page.HomeControl) })
        Text("Server", fontWeight = FontWeight.Bold)
        Text(state.origin ?: "Not connected")
        Text(if (state.offline) state.offlineDetail else state.syncedDetail, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            "The token stays in the Android Keystore. Revoke this phone from the wall and it will ask to pair again.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(
            onClick = vm::forgetServer,
            modifier = Modifier.fillMaxWidth().touchTarget(),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.primary),
        ) {
            Text("Forget this server")
        }
    }
}

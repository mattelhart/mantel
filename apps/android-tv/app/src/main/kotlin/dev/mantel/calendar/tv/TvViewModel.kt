package dev.mantel.calendar.tv

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.mantel.calendar.core.CalEvent
import dev.mantel.calendar.core.CalInfo
import dev.mantel.calendar.core.ChoreBoard
import dev.mantel.calendar.core.CONNECT_TIMEOUT_MS
import dev.mantel.calendar.core.FAMILYCAL_ORIGIN
import dev.mantel.calendar.core.FamilyMember
import dev.mantel.calendar.core.HouseholdSettings
import dev.mantel.calendar.core.MantelClient
import dev.mantel.calendar.core.LiveMessage
import dev.mantel.calendar.core.MantelException
import dev.mantel.calendar.core.PendingWrite
import dev.mantel.calendar.core.ScreenCache
import dev.mantel.calendar.core.ScreenCacheStore
import dev.mantel.calendar.core.ServerProbe
import dev.mantel.calendar.core.SharedList
import dev.mantel.calendar.core.SseParser
import dev.mantel.calendar.core.WriteOutbox
import dev.mantel.calendar.core.allDayRange
import dev.mantel.calendar.core.applyChoreCheck
import dev.mantel.calendar.core.applyListCheck
import dev.mantel.calendar.core.applyRedeem
import dev.mantel.calendar.core.discoveryMissMessage
import dev.mantel.calendar.core.fetchInstants
import dev.mantel.calendar.core.firstReachable
import dev.mantel.calendar.core.normalizeServer
import dev.mantel.calendar.core.offlineLabel
import dev.mantel.calendar.core.pairingFailureMessage
import dev.mantel.calendar.core.probeSchedule
import dev.mantel.calendar.core.reconnectDelayMs
import dev.mantel.calendar.core.revokedDeviceMessage
import dev.mantel.calendar.core.savedAddressPrefill
import dev.mantel.calendar.core.timedRange
import dev.mantel.calendar.core.zoneOrUtc
import dev.mantel.calendar.device.SecureTokenStore
import io.ktor.client.engine.cio.CIO
import kotlinx.coroutines.delay
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.atomic.AtomicBoolean

enum class Phase { Loading, Address, Pair, Ready }

data class TvState(
    val phase: Phase = Phase.Loading,
    val message: String? = null,
    val offline: Boolean = false,
    val origin: String? = null,
    val settings: HouseholdSettings = HouseholdSettings(),
    val users: List<FamilyMember> = emptyList(),
    val calendars: List<CalInfo> = emptyList(),
    val events: List<CalEvent> = emptyList(),
    val lists: List<SharedList> = emptyList(),
    val board: ChoreBoard? = null,
    val anchor: LocalDate = LocalDate.now(),
    val offlineDetail: String = "",
)

class TvViewModel(app: Application) : AndroidViewModel(app) {
    private val store = SecureTokenStore(app)
    private val origin = MutableStateFlow<String?>(null)
    private val token = MutableStateFlow<String?>(null)
    private val client = MantelClient(CIO.create(), { origin.value ?: FAMILYCAL_ORIGIN }, { token.value })
    private val snapshots = dev.mantel.calendar.core.FileSnapshotStore(File(app.filesDir, "mantel-cache"))
    private val screenCache = ScreenCacheStore(snapshots)
    private val outbox = WriteOutbox(snapshots)
    private val live = AtomicBoolean(false)
    private var lastEventId: Long? = null
    private var lastSynced: String? = null
    private val pendingTopics = mutableSetOf<String>()
    private var wantResync = false
    private var coalescing = false

    private val _state = MutableStateFlow(TvState())
    val state: StateFlow<TvState> = _state

    init {
        viewModelScope.launch { boot() }
        viewModelScope.launch {
            while (isActive) {
                delay(60_000)
                // The stream is the fast path. This is the fallback when it is down.
                if (_state.value.phase == Phase.Ready && !live.get()) refresh()
            }
        }
        viewModelScope.launch { listen() }
    }

    fun refreshIfReady() {
        if (_state.value.phase == Phase.Ready) viewModelScope.launch { refresh() }
    }

    fun connect(raw: String) {
        val normalized = normalizeServer(raw)
        if (normalized == null) {
            _state.update { it.copy(message = "Enter an address like 192.168.1.20") }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(phase = Phase.Loading, message = null, origin = normalized) }
            val probe = client.probeServer(normalized, CONNECT_TIMEOUT_MS)
            if (probe !is ServerProbe.Up) {
                _state.update {
                    it.copy(phase = Phase.Address, origin = normalized, message = probe.failureMessage(normalized))
                }
                return@launch
            }
            origin.value = normalized
            store.saveOrigin(normalized)
            enter()
        }
    }

    fun pair(code: String) {
        viewModelScope.launch {
            _state.update { it.copy(phase = Phase.Loading, message = null) }
            try {
                val paired = client.pair(code, "Living room TV")
                token.value = paired.token
                store.saveToken(paired.token)
                enter()
            } catch (e: MantelException) {
                _state.update { it.copy(phase = Phase.Pair, message = pairingFailureMessage(e.status, e.message)) }
            }
        }
    }

    fun forgetServer() {
        viewModelScope.launch {
            origin.value = null
            token.value = null
            store.clear()
            _state.update { TvState(phase = Phase.Address) }
        }
    }

    fun setAnchor(day: LocalDate) {
        _state.update { it.copy(anchor = day) }
        viewModelScope.launch { refresh() }
    }

    fun saveEvent(
        existing: CalEvent?,
        title: String,
        day: LocalDate,
        allDay: Boolean,
        startMinutes: Int,
        endMinutes: Int,
        calendarId: Int,
        onDone: (CalEvent) -> Unit,
        onError: (String) -> Unit,
    ) {
        val name = title.trim()
        if (name.isEmpty()) {
            onError("Add a title")
            return
        }
        val zone = zone()
        val (start, end) = if (allDay) {
            allDayRange(day)
        } else {
            timedRange(day, startMinutes, endMinutes, zone)
        }
        val body = buildJsonObject {
            put("calendar_id", calendarId)
            put("title", name)
            put("start_at", start)
            put("end_at", end)
            put("all_day", allDay)
            if (!allDay) put("timezone", _state.value.settings.homeTimezone)
        }
        viewModelScope.launch {
            try {
                val saved = if (existing == null) client.createEvent(body) else client.updateEvent(existing.id, body)
                refresh()
                onDone(saved)
            } catch (e: MantelException) {
                onError(e.message ?: "Could not save")
            }
        }
    }

    fun deleteEvent(id: Int, onDone: () -> Unit, onError: (String) -> Unit) {
        viewModelScope.launch {
            try {
                client.deleteEvent(id)
                refresh()
                onDone()
            } catch (e: MantelException) {
                onError(e.message ?: "Could not delete")
            }
        }
    }

    fun toggleItem(listId: Int, itemId: Int, checked: Boolean) {
        viewModelScope.launch {
            try {
                client.setItemChecked(listId, itemId, checked)
                refreshTopics(setOf("lists"))
            } catch (e: MantelException) {
                if (e.status != 0) {
                    _state.update { it.copy(message = e.message) }
                    return@launch
                }
                val body = buildJsonObject { put("checked", checked) }.toString()
                outbox.add(PendingWrite("list-$listId-$itemId-$checked", "PATCH", "/lists/$listId/items/$itemId", body, null))
                _state.update {
                    it.copy(
                        lists = applyListCheck(it.lists, listId, itemId, checked),
                        offline = true,
                        offlineDetail = offlineNow(),
                    )
                }
            }
        }
    }

    fun addItem(listId: Int, text: String, onError: (String) -> Unit) {
        if (text.isBlank()) return
        viewModelScope.launch {
            try {
                client.addItem(listId, text.trim())
                refresh()
            } catch (e: MantelException) {
                onError(e.message ?: "Could not add that")
            }
        }
    }

    fun addList(name: String, onError: (String) -> Unit) {
        if (name.isBlank()) return
        viewModelScope.launch {
            try {
                client.addList(name.trim())
                refresh()
            } catch (e: MantelException) {
                onError(e.message ?: "Could not add that")
            }
        }
    }

    fun completeChore(choreId: Int, userId: Int, on: String, done: Boolean) {
        val requestId = java.util.UUID.randomUUID().toString()
        val body = buildJsonObject {
            put("user_id", userId)
            put("on", on)
            put("done", done)
            put("request_id", requestId)
        }.toString()
        viewModelScope.launch {
            try {
                client.completeChore(choreId, userId, on, done, requestId)
                refreshTopics(setOf("chores"))
            } catch (e: MantelException) {
                if (e.status != 0) {
                    _state.update { it.copy(message = e.message) }
                    return@launch
                }
                outbox.add(PendingWrite(requestId, "POST", "/chores/$choreId/complete", body, requestId))
                _state.update {
                    it.copy(
                        board = it.board?.let { board -> applyChoreCheck(board, userId, choreId, done) },
                        offline = true,
                        offlineDetail = offlineNow(),
                    )
                }
            }
        }
    }

    fun approve(id: Int) = mutate { client.approveChore(id) }

    fun reject(id: Int) = mutate { client.rejectChore(id) }

    fun redeem(rewardId: Int, userId: Int, onError: (String) -> Unit) {
        val requestId = java.util.UUID.randomUUID().toString()
        val body = buildJsonObject {
            put("user_id", userId)
            put("request_id", requestId)
        }.toString()
        viewModelScope.launch {
            try {
                client.redeem(rewardId, userId, requestId)
                refreshTopics(setOf("rewards"))
            } catch (e: MantelException) {
                if (e.status == 0) {
                    outbox.add(PendingWrite(requestId, "POST", "/rewards/$rewardId/redeem", body, requestId))
                    _state.update {
                        it.copy(
                            board = it.board?.let { board -> applyRedeem(board, userId, rewardId) },
                            offline = true,
                            offlineDetail = offlineNow(),
                        )
                    }
                } else {
                    onError(e.message ?: "Could not redeem")
                }
            }
        }
    }

    fun fulfill(id: Int) = mutate { client.fulfill(id) }

    fun deny(id: Int) = mutate { client.deny(id) }

    fun zone(): ZoneId = zoneOrUtc(_state.value.settings.homeTimezone)

    fun writableCalendars(userId: Int?): List<CalInfo> {
        val writable = _state.value.calendars.filter { it.writable }
        if (userId == null) return writable
        val mine = writable.filter { it.claimedByUserId == userId }
        return mine.ifEmpty { writable }
    }

    private suspend fun boot() {
        val saved = store.read()
        token.value = saved.token
        val found = firstReachable(
            probeSchedule(saved.origin),
            probe = { candidate, timeoutMs -> client.reachable(candidate, timeoutMs) },
            pause = { delay(it) },
        )
        if (found == null) {
            val prefill = savedAddressPrefill(saved.origin)
            val cached = screenCache.load()
            if (prefill.isNotEmpty() && cached != null) {
                origin.value = prefill
                showCached(cached)
                _state.update { it.copy(phase = Phase.Ready, origin = prefill, message = null) }
                return
            }
            _state.update {
                it.copy(
                    phase = Phase.Address,
                    origin = prefill.ifEmpty { null },
                    message = discoveryMissMessage(saved.origin),
                )
            }
            return
        }
        origin.value = found
        store.saveOrigin(found)
        enter()
    }

    private suspend fun enter() {
        try {
            val status = client.authStatus()
            if (status.authorizationRequired && token.value.isNullOrBlank()) {
                _state.update { it.copy(phase = Phase.Pair, message = null, origin = origin.value) }
                return
            }
            refresh()
            // refresh() keeps a 401 or a total miss on the address/pair screen.
            if (_state.value.phase == Phase.Pair || _state.value.phase == Phase.Address) return
            _state.update { it.copy(phase = Phase.Ready, message = null, origin = origin.value) }
        } catch (e: MantelException) {
            if (e.status == 401) {
                token.value = null
                store.saveToken(null)
                _state.update { it.copy(phase = Phase.Pair, message = revokedDeviceMessage(), origin = origin.value) }
            } else {
                val cached = screenCache.load()
                if (cached != null) {
                    showCached(cached)
                    _state.update { it.copy(phase = Phase.Ready, message = null, origin = origin.value) }
                } else {
                    _state.update { it.copy(phase = Phase.Address, message = e.message, origin = origin.value) }
                }
            }
        }
    }

    private suspend fun refresh() {
        outbox.replay { write -> client.replayWrite(write.method, write.path, write.body) }
        try {
            val settings = client.settings()
            val zone = zoneOrUtc(settings.homeTimezone)
            val anchor = _state.value.anchor
            val (start, end) = fetchInstants(anchor.minusDays(7), anchor.plusDays(45), zone)
            val users = client.users()
            val calendars = client.calendars()
            val events = client.events(start.toString(), end.toString())
            val lists = client.lists()
            val board = client.choreBoard()
            val at = Instant.now().toString()
            lastSynced = at
            _state.update {
                it.copy(
                    settings = settings,
                    users = users,
                    calendars = calendars,
                    events = events,
                    lists = lists,
                    board = board,
                    offline = false,
                    offlineDetail = "",
                    anchor = if (it.phase == Phase.Loading) dev.mantel.calendar.core.todayIn(zone) else it.anchor,
                )
            }
            screenCache.save(ScreenCache(at, settings, users, calendars, events, lists, board))
        } catch (e: MantelException) {
            onRefreshFailed(e)
        }
    }

    private suspend fun refreshTopics(topics: Set<String>) {
        if (topics.isEmpty()) {
            refresh()
            return
        }
        try {
            val current = _state.value
            var settings = current.settings
            var users = current.users
            var calendars = current.calendars
            var events = current.events
            var lists = current.lists
            var board = current.board
            if ("settings" in topics) settings = client.settings()
            if ("users" in topics) users = client.users()
            if ("calendars" in topics || "accounts" in topics) calendars = client.calendars()
            if ("events" in topics) {
                val zone = zoneOrUtc(settings.homeTimezone)
                val (start, end) = fetchInstants(current.anchor.minusDays(7), current.anchor.plusDays(45), zone)
                events = client.events(start.toString(), end.toString())
            }
            if ("lists" in topics) lists = client.lists()
            if ("chores" in topics || "rewards" in topics) board = client.choreBoard()
            val at = Instant.now().toString()
            lastSynced = at
            _state.update {
                it.copy(
                    settings = settings,
                    users = users,
                    calendars = calendars,
                    events = events,
                    lists = lists,
                    board = board,
                    offline = false,
                    offlineDetail = "",
                )
            }
            screenCache.save(ScreenCache(at, settings, users, calendars, events, lists, board))
        } catch (e: MantelException) {
            onRefreshFailed(e)
        }
    }

    private fun onRefreshFailed(e: MantelException) {
        if (e.status == 401) {
            token.value = null
            viewModelScope.launch { store.saveToken(null) }
            _state.update { it.copy(phase = Phase.Pair, message = revokedDeviceMessage(), offline = false) }
            return
        }
        val haveMemory = _state.value.events.isNotEmpty() || _state.value.board != null || _state.value.lists.isNotEmpty()
        if (!haveMemory) {
            val cached = screenCache.load()
            if (cached != null) showCached(cached)
            else if (_state.value.phase != Phase.Ready) {
                _state.update { it.copy(phase = Phase.Address, message = e.message, offline = true, origin = origin.value) }
                return
            }
        }
        _state.update { it.copy(offline = true, offlineDetail = offlineNow(), message = null) }
    }

    private fun showCached(cached: ScreenCache) {
        lastSynced = cached.savedAt
        _state.update {
            it.copy(
                settings = cached.settings,
                users = cached.users,
                calendars = cached.calendars,
                events = cached.events,
                lists = cached.lists,
                board = cached.board,
                offline = true,
                offlineDetail = offlineLabel(cached.savedAt, zoneOrUtc(cached.settings.homeTimezone)),
            )
        }
    }

    private fun offlineNow(): String = offlineLabel(lastSynced, zone())

    private fun queueTopics(topics: Set<String>, resync: Boolean) {
        synchronized(pendingTopics) {
            if (resync) wantResync = true
            pendingTopics.addAll(topics)
            if (coalescing) return
            coalescing = true
        }
        viewModelScope.launch {
            delay(200)
            val full: Boolean
            val ready: Set<String>
            synchronized(pendingTopics) {
                full = wantResync
                ready = pendingTopics.toSet()
                pendingTopics.clear()
                wantResync = false
                coalescing = false
            }
            if (full) refresh() else refreshTopics(ready)
        }
    }

    private suspend fun listen() {
        var attempt = 0
        val parser = SseParser()
        while (coroutineContext.isActive) {
            if (_state.value.phase != Phase.Ready) {
                delay(500)
                continue
            }
            parser.reset()
            try {
                client.listen(lastEventId) { line ->
                    live.set(true)
                    for (message in parser.feed(line)) {
                        when (message) {
                            is LiveMessage.Hello -> if (message.id != null) lastEventId = message.id
                            is LiveMessage.Change -> {
                                if (message.id != null) lastEventId = message.id
                                queueTopics(message.topics, false)
                            }
                            is LiveMessage.Resync -> queueTopics(emptySet(), true)
                        }
                    }
                }
                live.set(false)
                attempt = 1
            } catch (e: MantelException) {
                live.set(false)
                if (e.status == 401) {
                    token.value = null
                    store.saveToken(null)
                    _state.update { it.copy(phase = Phase.Pair, message = revokedDeviceMessage(), offline = false) }
                    attempt = 6
                } else {
                    if (e.status == 0) {
                        _state.update { it.copy(offline = true, offlineDetail = offlineNow()) }
                    }
                    attempt += 1
                }
            }
            delay(reconnectDelayMs(attempt.coerceAtLeast(1), (0..400).random().toLong()))
        }
    }

    private fun mutate(block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                block()
                refresh()
            } catch (e: MantelException) {
                _state.update { it.copy(message = e.message, offline = e.status == 0) }
            }
        }
    }

    override fun onCleared() {
        client.close()
    }
}

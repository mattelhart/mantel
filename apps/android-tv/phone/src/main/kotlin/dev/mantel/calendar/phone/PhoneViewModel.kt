package dev.mantel.calendar.phone

import android.app.Application
import android.content.Context
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.mantel.calendar.core.CalEvent
import dev.mantel.calendar.core.messageMediaId
import dev.mantel.calendar.core.friendlySendError
import dev.mantel.calendar.core.ConversationsListing
import dev.mantel.calendar.core.Conversation
import dev.mantel.calendar.core.CalInfo
import dev.mantel.calendar.core.ChoreDefinition
import dev.mantel.calendar.core.ChoreBoard
import dev.mantel.calendar.core.FAMILYCAL_ORIGIN
import dev.mantel.calendar.core.FamilyMember
import dev.mantel.calendar.core.HouseholdSettings
import dev.mantel.calendar.core.LiveMessage
import dev.mantel.calendar.core.MantelClient
import dev.mantel.calendar.core.MantelException
import dev.mantel.calendar.core.PendingWrite
import dev.mantel.calendar.core.RepeatChoice
import dev.mantel.calendar.core.ScreenCache
import dev.mantel.calendar.core.ScreenCacheStore
import dev.mantel.calendar.core.SharedList
import dev.mantel.calendar.core.SseParser
import dev.mantel.calendar.core.WriteOutbox
import dev.mantel.calendar.core.allDaySpan
import dev.mantel.calendar.core.applyChoreCheck
import dev.mantel.calendar.core.applyListCheck
import dev.mantel.calendar.core.applyRedeem
import dev.mantel.calendar.core.buildRepeat
import dev.mantel.calendar.core.CONNECT_TIMEOUT_MS
import dev.mantel.calendar.core.ServerProbe
import dev.mantel.calendar.core.cleartextPermitted
import dev.mantel.calendar.core.discoveryMissMessage
import dev.mantel.calendar.core.eventEditKind
import dev.mantel.calendar.core.EventEditKind
import dev.mantel.calendar.core.fetchInstants
import dev.mantel.calendar.core.firstReachable
import dev.mantel.calendar.core.normalizePairCode
import dev.mantel.calendar.core.normalizeServer
import dev.mantel.calendar.core.offlineLabel
import dev.mantel.calendar.core.pairCodeComplete
import dev.mantel.calendar.core.pairingFailureMessage
import dev.mantel.calendar.core.parsePairingLink
import dev.mantel.calendar.core.probeSchedule
import dev.mantel.calendar.core.reconnectDelayMs
import dev.mantel.calendar.core.revokedDeviceMessage
import dev.mantel.calendar.core.savedAddressPrefill
import dev.mantel.calendar.core.syncedLabel
import dev.mantel.calendar.core.timedRange
import dev.mantel.calendar.core.todayIn
import dev.mantel.calendar.core.weekdayCode
import dev.mantel.calendar.core.zoneOrUtc
import dev.mantel.calendar.device.SecureTokenStore
import dev.mantel.calendar.phone.notify.UpcomingNotifier
import dev.mantel.calendar.phone.widget.AgendaWidget
import io.ktor.client.engine.cio.CIO
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.coroutineContext

enum class Phase { Loading, Address, Pair, Ready }

enum class ThemeChoice { System, Light, Dark }

enum class PhoneTab { Home, Today, Week, Month, Chores, Lists, Messages }

data class PhoneState(
    val phase: Phase = Phase.Loading,
    val message: String? = null,
    val offline: Boolean = false,
    val refreshing: Boolean = false,
    val origin: String? = null,
    val settings: HouseholdSettings = HouseholdSettings(),
    val users: List<FamilyMember> = emptyList(),
    val calendars: List<CalInfo> = emptyList(),
    val events: List<CalEvent> = emptyList(),
    val lists: List<SharedList> = emptyList(),
    val board: ChoreBoard? = null,
    val conversations: ConversationsListing = ConversationsListing(),
    val threads: Map<String, Conversation> = emptyMap(),
    val anchor: LocalDate = LocalDate.now(),
    val choreDay: LocalDate = LocalDate.now(),
    val offlineDetail: String = "",
    val syncedDetail: String = "Not synced yet",
    val theme: ThemeChoice = ThemeChoice.Light,
    val hiddenUserIds: Set<Int> = emptySet(),
)

const val CACHE_DIR = "mantel-cache"
const val STORE_NAME = "mantel_phone"
const val STORE_ALIAS = "mantel_phone_token"

private const val PUBLIC_HTTP =
    "That address is on the public internet. Use the address on your LAN or VPN, or https."

class PhoneViewModel(app: Application) : AndroidViewModel(app) {
    private val store = SecureTokenStore(app, STORE_NAME, STORE_ALIAS)
    private val prefs = app.getSharedPreferences("mantel_phone_ui", Context.MODE_PRIVATE)
    private val origin = MutableStateFlow<String?>(null)
    private val token = MutableStateFlow<String?>(null)
    suspend fun mealPlan(start: LocalDate) = client.mealPlan(start.toString(), start.plusDays(6).toString())
    suspend fun saveMeal(day: LocalDate, meal: String, title: String) = client.saveMeal(day.toString(), meal, title)
    suspend fun displays() = client.displays()
    suspend fun showOnDisplay(id: String, destination: String) = client.showOnDisplay(id, destination)

    /** A code for a TV to type. It embeds this phone's own address, the one it already reaches the server on. */
    suspend fun createPairingCode() = client.createPairingCode(origin.value ?: FAMILYCAL_ORIGIN)
    suspend fun homeSetup() = client.homeSetup()
    suspend fun saveHomeConnection(baseUrl: String?, token: String?, clearToken: Boolean = false) =
        client.saveHomeConnection(baseUrl, token, clearToken)
    suspend fun testHome() = client.testHome()
    suspend fun home() = client.home()
    suspend fun homeAction(entityId: String, action: String, value: Int? = null, confirm: Boolean = false) =
        client.homeAction(entityId, action, value, confirm)

    private val client = MantelClient(CIO.create(), { origin.value ?: FAMILYCAL_ORIGIN }, { token.value })
    private val snapshots = dev.mantel.calendar.core.FileSnapshotStore(File(app.filesDir, CACHE_DIR))
    private val screenCache = ScreenCacheStore(snapshots)
    private val outbox = WriteOutbox(snapshots)
    private val live = AtomicBoolean(false)
    private var lastEventId: Long? = null
    private var lastSynced: String? = null
    private val pendingTopics = mutableSetOf<String>()
    private var wantResync = false
    private var coalescing = false
    private var choreTouched = false

    private val _state = MutableStateFlow(PhoneState(theme = loadTheme()))
    val state: StateFlow<PhoneState> = _state
    private val _media = MutableStateFlow<Map<Int, ByteArray>>(emptyMap())
    val media: StateFlow<Map<Int, ByteArray>> = _media

    /** The start-up probe of the saved server. A pairing link must not race it: boot() would
     *  otherwise finish later and put the screen (and the saved address) back to what it found. */
    private var bootJob: Job? = null
    private var linkJob: Job? = null

    init {
        bootJob = viewModelScope.launch { boot() }
        viewModelScope.launch {
            while (isActive) {
                delay(60_000)
                if (_state.value.phase == Phase.Ready && !live.get()) reload()
            }
        }
        viewModelScope.launch { listen() }
    }


    fun deleteMessage(threadId: String, messageId: Int, result: (String?) -> Unit) {
        viewModelScope.launch {
            try {
                client.deleteMessage(messageId)
                openThread(threadId)
                reload()
                result(null)
            } catch (e: MantelException) {
                result(e.message ?: "Could not delete this message.")
            }
        }
    }

    fun openThread(id: String) {
        viewModelScope.launch {
            try {
                val thread = client.conversation(id)
                _state.update { it.copy(threads = it.threads + (id to thread), offline = false) }
                thread.messages.forEach { message ->
                    val mediaId = messageMediaId(message.mediaUrl) ?: return@forEach
                    loadMessageMedia(mediaId)
                }
            } catch (e: MantelException) {
                if (e.status == 404) return@launch
                onRefreshFailed(e)
            }
        }
    }

    fun loadMessageMedia(id: Int) {
        if (_media.value.containsKey(id)) return
        viewModelScope.launch {
            try {
                val bytes = client.messageMedia(id)
                _media.update { it + (id to bytes) }
            } catch (_: Exception) {
                /* The picture stays hidden if it cannot be fetched. */
            }
        }
    }

    private data class SendAttempt(val body: String, val media: String?, val id: String)
    private val pendingSends = mutableMapOf<Int, SendAttempt>()

    fun sendMessage(userId: Int, body: String, mediaBase64: String? = null, result: (String?) -> Unit) {
        viewModelScope.launch {
            try {
                val attempt = pendingSends[userId]?.takeIf { it.body == body && it.media == mediaBase64 }
                    ?: SendAttempt(body, mediaBase64, java.util.UUID.randomUUID().toString())
                pendingSends[userId] = attempt
                val row = client.sendMessage(userId, body, mediaBase64, attempt.id)
                val listing = client.conversations()
                val updated = _state.value.threads.mapValues { (id, current) ->
                    runCatching { client.conversation(id) }.getOrDefault(current)
                }
                _state.update {
                    it.copy(conversations = listing, threads = updated, offline = false)
                }
                updated.values.forEach { thread ->
                    thread.messages.forEach { message ->
                        val mediaId = messageMediaId(message.mediaUrl) ?: return@forEach
                        loadMessageMedia(mediaId)
                    }
                }
                if (row.status != "unconfirmed" && pendingSends[userId] == attempt) {
                    pendingSends.remove(userId)
                }
                result(when (row.status) {
                    "unconfirmed" -> "Delivery unconfirmed. Check the conversation."
                    "failed" -> "Send failed. Try again."
                    else -> null
                })
            } catch (e: MantelException) {
                result(friendlySendError(e.message))
            }
        }
    }

    fun refresh() {
        if (_state.value.phase != Phase.Ready && origin.value == null) return
        viewModelScope.launch { reload(spinner = true) }
    }

    fun connect(raw: String) {
        val normalized = normalizeServer(raw)
        if (normalized == null) {
            _state.update { it.copy(message = "Enter an address like 192.168.1.20") }
            return
        }
        if (!cleartextPermitted(normalized)) {
            _state.update { it.copy(phase = Phase.Address, origin = normalized, message = PUBLIC_HTTP) }
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
        val normalized = normalizePairCode(code)
        if (!pairCodeComplete(normalized)) {
            _state.update { it.copy(phase = Phase.Pair, message = "The code is 8 characters, with no 0, O, 1 or I.") }
            return
        }
        viewModelScope.launch { pairNormalized(normalized) }
    }

    /**
     * Pair from a `mantel://pair` link: the in-app scanner, or the camera app opening it.
     * [fromIntent] is true when Android delivered it. Android hands the same intent to a
     * recreated activity (a rotation, a theme change, the process being restored), and
     * the code is single-use, so a link that already paired this phone is ignored then,
     * instead of failing with "already used" and dropping a paired phone back to the code screen.
     */
    fun openPairingLink(raw: String, fromIntent: Boolean = false) {
        val link = parsePairingLink(raw)
        if (link != null && fromIntent) {
            if (prefs.getString(PAIRED_LINK_KEY, null) == raw) return
            if (linkJob?.isActive == true) return
        }
        if (link == null) {
            if (pairCodeComplete(raw) && !origin.value.isNullOrBlank()) pair(raw)
            else _state.update { it.copy(message = "That QR isn't a Mantel pairing code.") }
            return
        }
        if (!cleartextPermitted(link.base)) {
            _state.update { it.copy(phase = Phase.Address, origin = link.base, message = PUBLIC_HTTP) }
            return
        }
        linkJob = viewModelScope.launch {
            bootJob?.cancel()
            _state.update { it.copy(phase = Phase.Loading, message = null) }
            origin.value = link.base
            store.saveOrigin(link.base)
            val probe = client.probeServer(link.base, CONNECT_TIMEOUT_MS)
            if (probe !is ServerProbe.Up) {
                _state.update {
                    it.copy(phase = Phase.Address, origin = link.base, message = probe.failureMessage(link.base))
                }
                return@launch
            }
            if (pairNormalized(link.code)) prefs.edit().putString(PAIRED_LINK_KEY, raw).apply()
        }
    }

    fun editServer() {
        _state.update { it.copy(phase = Phase.Address, message = null) }
    }

    fun forgetServer() {
        viewModelScope.launch {
            origin.value = null
            token.value = null
            store.clear()
            _state.update { PhoneState(phase = Phase.Address, theme = it.theme) }
        }
    }

    fun dismissMessage() {
        _state.update { it.copy(message = null) }
    }

    private fun savedAnchor(today: LocalDate): LocalDate =
        runCatching { LocalDate.parse(prefs.getString("calendar_anchor", null)) }.getOrDefault(today)

    fun setAnchor(day: LocalDate) {
        prefs.edit().putString("calendar_anchor", day.toString()).apply()
        _state.update { it.copy(anchor = day) }
        viewModelScope.launch { reload() }
    }

    fun setChoreDay(day: LocalDate) {
        choreTouched = true
        _state.update { it.copy(choreDay = day) }
        viewModelScope.launch { refreshTopics(setOf("chores")) }
    }

    fun toggleUser(id: Int) {
        _state.update { state ->
            val hidden = state.hiddenUserIds.toMutableSet()
            if (!hidden.add(id)) hidden.remove(id)
            state.copy(hiddenUserIds = hidden)
        }
    }

    fun setTheme(choice: ThemeChoice) {
        prefs.edit().putString("theme", choice.name).apply()
        _state.update { it.copy(theme = choice) }
    }

    fun saveEvent(
        existing: CalEvent?,
        title: String,
        location: String,
        description: String,
        startDay: LocalDate,
        endDay: LocalDate,
        allDay: Boolean,
        startMinutes: Int,
        endMinutes: Int,
        calendarId: Int,
        repeat: RepeatChoice,
        onDone: () -> Unit,
        onError: (String) -> Unit,
    ) {
        val name = title.trim()
        if (name.isEmpty()) {
            onError("Add a title")
            return
        }
        val kind = eventEditKind(existing)
        if (kind == EventEditKind.ReadOnly) {
            onError("This calendar is read-only, so it can't be changed here.")
            return
        }
        val chosen = if (repeat.freq == dev.mantel.calendar.core.RepeatFreq.WEEKLY && repeat.byday.isEmpty()) {
            repeat.copy(byday = listOf(weekdayCode(startDay)))
        } else {
            repeat
        }
        val rule = buildRepeat(chosen)
        val zone = zone()
        val (start, end) = if (allDay) allDaySpan(startDay, endDay) else timedRange(startDay, startMinutes, endMinutes, zone)
        val body = buildJsonObject {
            if (kind != EventEditKind.Occurrence) put("calendar_id", calendarId)
            put("title", name)
            if (location.isBlank()) put("location", JsonNull) else put("location", location.trim())
            if (description.isBlank()) put("description", JsonNull) else put("description", description.trim())
            put("start_at", start)
            put("end_at", end)
            put("all_day", allDay)
            if (!allDay) put("timezone", _state.value.settings.homeTimezone)
            if (kind != EventEditKind.Occurrence) {
                if (rule != null) put("recurrence_rule", rule)
                else if (kind == EventEditKind.Series) put("recurrence_rule", JsonNull)
            }
        }
        viewModelScope.launch {
            try {
                if (existing == null) client.createEvent(body) else client.updateEvent(existing.id, body)
                reload()
                onDone()
            } catch (e: MantelException) {
                onError(if (e.status == 0) OFFLINE_EDIT else e.message ?: "Could not save")
            }
        }
    }

    fun deleteEvent(id: Int, onDone: () -> Unit, onError: (String) -> Unit) {
        viewModelScope.launch {
            try {
                client.deleteEvent(id)
                reload()
                onDone()
            } catch (e: MantelException) {
                onError(if (e.status == 0) OFFLINE_EDIT else e.message ?: "Could not delete")
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

    fun createList(name: String, result: (String?) -> Unit) = saveHouseholdChange("lists", result) {
        client.addList(name.trim())
    }

    fun createItem(listId: Int, text: String, result: (String?) -> Unit) = saveHouseholdChange("lists", result) {
        client.addItem(listId, text.trim())
    }

    fun renameList(id: Int, name: String, result: (String?) -> Unit) = saveHouseholdChange("lists", result) {
        client.renameList(id, name.trim())
    }

    fun removeList(id: Int, result: (String?) -> Unit) = saveHouseholdChange("lists", result) {
        client.deleteList(id)
    }

    fun renameItem(listId: Int, itemId: Int, text: String, result: (String?) -> Unit) = saveHouseholdChange("lists", result) {
        client.renameItem(listId, itemId, text.trim())
    }

    fun removeItem(listId: Int, itemId: Int, result: (String?) -> Unit) = saveHouseholdChange("lists", result) {
        client.deleteItem(listId, itemId)
    }

    fun removeChecked(listId: Int, result: (String?) -> Unit) = saveHouseholdChange("lists", result) {
        client.clearChecked(listId)
    }

    fun loadChores(result: (List<ChoreDefinition>?, String?) -> Unit) {
        viewModelScope.launch {
            try {
                result(client.chores(), null)
            } catch (e: MantelException) {
                result(null, if (e.status == 0) OFFLINE_EDIT else e.message ?: "Could not load chores")
            }
        }
    }

    fun saveChore(id: Int?, body: JsonObject, result: (String?) -> Unit) = saveHouseholdChange("chores", result) {
        client.saveChore(id, body)
    }

    fun removeChore(id: Int, result: (String?) -> Unit) = saveHouseholdChange("chores", result) {
        client.deleteChore(id)
    }

    private fun saveHouseholdChange(topic: String, result: (String?) -> Unit, action: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                action()
            } catch (e: MantelException) {
                result(if (e.status == 0) OFFLINE_EDIT else e.message ?: "Could not save changes")
                return@launch
            }
            // A successful write must not be resubmitted because refreshing the screen failed.
            result(null)
            refreshTopics(setOf(topic))
        }
    }

    fun completeChore(choreId: Int, userId: Int, on: String, done: Boolean) {
        val requestId = UUID.randomUUID().toString()
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
        val requestId = UUID.randomUUID().toString()
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

    /** True when the phone is paired (the screen after that is whatever enter() decides). */
    private suspend fun pairNormalized(code: String): Boolean {
        _state.update { it.copy(phase = Phase.Loading, message = null) }
        return try {
            val paired = client.pair(code, deviceName())
            token.value = paired.token
            store.saveToken(paired.token)
            enter()
            true
        } catch (e: MantelException) {
            _state.update {
                it.copy(phase = Phase.Pair, origin = origin.value, message = pairingFailureMessage(e.status, e.message))
            }
            false
        }
    }

    private suspend fun boot() {
        val saved = store.read()
        token.value = saved.token
        val found = firstReachable(
            probeSchedule(saved.origin),
            probe = { candidate, timeoutMs -> client.reachable(candidate, timeoutMs) },
            pause = { delay(it) },
            allow = ::cleartextPermitted,
        )
        if (found == null) {
            val prefill = savedAddressPrefill(saved.origin)
            val cached = screenCache.load()
            if (prefill.isNotEmpty() && cached != null && cleartextPermitted(prefill)) {
                origin.value = prefill
                showCached(cached, resetDay = true)
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
            reload()
            if (_state.value.phase == Phase.Pair || _state.value.phase == Phase.Address) return
            _state.update { it.copy(phase = Phase.Ready, message = null, origin = origin.value) }
        } catch (e: MantelException) {
            if (e.status == 401) {
                token.value = null
                store.saveToken(null)
                _state.update {
                    it.copy(phase = Phase.Pair, message = revokedDeviceMessage(), origin = origin.value)
                }
            } else {
                val cached = screenCache.load()
                if (cached != null) {
                    showCached(cached, resetDay = true)
                    _state.update { it.copy(phase = Phase.Ready, message = null, origin = origin.value) }
                } else {
                    _state.update { it.copy(phase = Phase.Address, message = e.message, origin = origin.value) }
                }
            }
        }
    }

    private suspend fun reload(spinner: Boolean = false) {
        if (spinner) _state.update { it.copy(refreshing = true) }
        try {
            outbox.replay { write -> client.replayWrite(write.method, write.path, write.body) }
            val settings = client.settings()
            val zone = zoneOrUtc(settings.homeTimezone)
            val today = todayIn(zone)
            val first = _state.value.phase == Phase.Loading
            val anchor = if (first) savedAnchor(today) else _state.value.anchor
            val choreOn = if (first && !choreTouched) today else _state.value.choreDay
            val (start, end) = fetchInstants(anchor.minusDays(7), anchor.plusDays(45), zone)
            val users = client.users()
            val calendars = client.calendars()
            val events = client.events(start.toString(), end.toString())
            val lists = client.lists()
            val board = client.choreBoard(choreOn.toString())
            val conversations = client.conversations()
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
                    conversations = conversations,
                    offline = false,
                    offlineDetail = "",
                    syncedDetail = syncedLabel(at, zone),
                    anchor = anchor,
                    choreDay = choreOn,
                    origin = origin.value,
                )
            }
            screenCache.save(
                ScreenCache(at, settings, users, calendars, _state.value.events, lists, _state.value.board, conversations),
            )
            publish()
        } catch (e: MantelException) {
            onRefreshFailed(e)
        } finally {
            if (spinner) _state.update { it.copy(refreshing = false) }
        }
    }

    private suspend fun refreshTopics(topics: Set<String>) {
        if (topics.isEmpty()) {
            reload()
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
            var conversations = current.conversations
            var threads = current.threads
            if ("settings" in topics) settings = client.settings()
            if ("users" in topics) users = client.users()
            if ("calendars" in topics || "accounts" in topics) calendars = client.calendars()
            if ("events" in topics || "sync" in topics) {
                val zone = zoneOrUtc(settings.homeTimezone)
                val (start, end) = fetchInstants(current.anchor.minusDays(7), current.anchor.plusDays(45), zone)
                events = client.events(start.toString(), end.toString())
            }
            if ("lists" in topics) lists = client.lists()
            if ("chores" in topics || "rewards" in topics) board = client.choreBoard(current.choreDay.toString())
            if ("messages" in topics) {
                conversations = client.conversations()
                threads = threads.mapValues { (id, currentThread) ->
                    runCatching { client.conversation(id) }.getOrDefault(currentThread)
                }
            }
            val at = Instant.now().toString()
            lastSynced = at
            val zone = zoneOrUtc(settings.homeTimezone)
            _state.update {
                it.copy(
                    settings = settings,
                    users = users,
                    calendars = calendars,
                    events = events,
                    lists = lists,
                    board = board,
                    conversations = conversations,
                    threads = threads,
                    offline = false,
                    offlineDetail = "",
                    syncedDetail = syncedLabel(at, zone),
                )
            }
            screenCache.save(ScreenCache(at, settings, users, calendars, events, lists, board, conversations))
            publish()
        } catch (e: MantelException) {
            onRefreshFailed(e)
        }
    }

    private fun onRefreshFailed(error: MantelException) {
        if (error.status == 401) {
            token.value = null
            viewModelScope.launch { store.saveToken(null) }
            _state.update { it.copy(phase = Phase.Pair, message = revokedDeviceMessage(), offline = false) }
            return
        }
        val haveMemory = _state.value.events.isNotEmpty() || _state.value.board != null || _state.value.lists.isNotEmpty() || _state.value.conversations.conversations.isNotEmpty()
        if (!haveMemory) {
            val cached = screenCache.load()
            if (cached != null) showCached(cached, resetDay = _state.value.phase != Phase.Ready)
            else if (_state.value.phase != Phase.Ready) {
                _state.update { it.copy(phase = Phase.Address, message = error.message, offline = true, origin = origin.value) }
                return
            }
        }
        _state.update { it.copy(offline = true, offlineDetail = offlineNow(), message = null) }
    }

    private fun showCached(cached: ScreenCache, resetDay: Boolean) {
        val zone = zoneOrUtc(cached.settings.homeTimezone)
        val today = todayIn(zone)
        val chore = runCatching { LocalDate.parse(cached.board?.on) }.getOrDefault(today)
        lastSynced = cached.savedAt
        _state.update {
            it.copy(
                settings = cached.settings,
                users = cached.users,
                calendars = cached.calendars,
                events = cached.events,
                lists = cached.lists,
                board = cached.board,
                conversations = cached.conversations,
                anchor = if (resetDay) savedAnchor(today) else it.anchor,
                choreDay = if (resetDay) chore else it.choreDay,
                offline = true,
                offlineDetail = offlineLabel(cached.savedAt, zone),
                syncedDetail = syncedLabel(cached.savedAt, zone),
            )
        }
        AgendaWidget.updateAll(getApplication())
    }

    private fun publish() {
        val app = getApplication<Application>()
        val snapshot = _state.value
        AgendaWidget.updateAll(app)
        UpcomingNotifier.consider(app, snapshot.events, zoneOrUtc(snapshot.settings.homeTimezone), snapshot.settings.timeFormat24h)
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
            if (full) reload() else refreshTopics(ready)
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
                reload()
            } catch (e: MantelException) {
                _state.update {
                    it.copy(
                        message = if (e.status == 0) "Offline. That one needs the calendar." else e.message,
                        offline = e.status == 0 || it.offline,
                        offlineDetail = if (e.status == 0) offlineNow() else it.offlineDetail,
                    )
                }
            }
        }
    }

    private fun loadTheme(): ThemeChoice {
        // The white redesign becomes the initial appearance once; later choices remain saved.
        if (!prefs.getBoolean("white_redesign_applied", false)) {
            prefs.edit().putBoolean("white_redesign_applied", true).putString("theme", "Light").apply()
            return ThemeChoice.Light
        }
        return runCatching { ThemeChoice.valueOf(prefs.getString("theme", "Light") ?: "Light") }
            .getOrDefault(ThemeChoice.Light)
    }

    private fun deviceName(): String {
        val maker = Build.MANUFACTURER?.takeIf { it.isNotBlank() && !it.equals("unknown", true) }.orEmpty()
        val model = Build.MODEL?.takeIf { it.isNotBlank() && !it.equals("unknown", true) }.orEmpty()
        val name = listOf(maker, model).filter { it.isNotBlank() }.distinct().joinToString(" ")
        return name.ifBlank { "Android phone" }.take(60)
    }

    override fun onCleared() {
        client.close()
    }

    private companion object {
        /** The last `mantel://pair` link that paired this phone (see openPairingLink). */
        const val PAIRED_LINK_KEY = "paired_link"
        const val OFFLINE_EDIT = "Offline. The calendar on the server was kept, and this change was not saved."
    }
}

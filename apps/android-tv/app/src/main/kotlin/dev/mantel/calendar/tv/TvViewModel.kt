package dev.mantel.calendar.tv

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.mantel.calendar.core.CalEvent
import dev.mantel.calendar.core.CalInfo
import dev.mantel.calendar.core.ChoreBoard
import dev.mantel.calendar.core.FAMILYCAL_ORIGIN
import dev.mantel.calendar.core.FamilyMember
import dev.mantel.calendar.core.HouseholdSettings
import dev.mantel.calendar.core.MantelClient
import dev.mantel.calendar.core.MantelException
import dev.mantel.calendar.core.SharedList
import dev.mantel.calendar.core.allDayRange
import dev.mantel.calendar.core.discoveryCandidates
import dev.mantel.calendar.core.fetchInstants
import dev.mantel.calendar.core.normalizeServer
import dev.mantel.calendar.core.timedRange
import dev.mantel.calendar.core.zoneOrUtc
import dev.mantel.calendar.tv.data.SecureTokenStore
import io.ktor.client.engine.cio.CIO
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.LocalDate
import java.time.ZoneId

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
)

class TvViewModel(app: Application) : AndroidViewModel(app) {
    private val store = SecureTokenStore(app)
    private val origin = MutableStateFlow<String?>(null)
    private val token = MutableStateFlow<String?>(null)
    private val client = MantelClient(CIO.create(), { origin.value ?: FAMILYCAL_ORIGIN }, { token.value })

    private val _state = MutableStateFlow(TvState())
    val state: StateFlow<TvState> = _state

    init {
        viewModelScope.launch { boot() }
        viewModelScope.launch {
            while (isActive) {
                delay(60_000)
                if (_state.value.phase == Phase.Ready) refresh()
            }
        }
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
            _state.update { it.copy(phase = Phase.Loading, message = null) }
            if (!client.reachable(normalized)) {
                _state.update { it.copy(phase = Phase.Address, message = "Can't reach $normalized") }
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
                _state.update { it.copy(phase = Phase.Pair, message = e.message) }
            }
        }
    }

    fun forgetServer() {
        viewModelScope.launch {
            origin.value = null
            token.value = null
            store.saveToken(null)
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

    fun toggleItem(listId: Int, itemId: Int, checked: Boolean) = mutate { client.setItemChecked(listId, itemId, checked) }

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

    fun completeChore(choreId: Int, userId: Int, on: String, done: Boolean) = mutate {
        client.completeChore(choreId, userId, on, done, java.util.UUID.randomUUID().toString())
    }

    fun approve(id: Int) = mutate { client.approveChore(id) }

    fun reject(id: Int) = mutate { client.rejectChore(id) }

    fun redeem(rewardId: Int, userId: Int, onError: (String) -> Unit) {
        viewModelScope.launch {
            try {
                client.redeem(rewardId, userId, java.util.UUID.randomUUID().toString())
                refresh()
            } catch (e: MantelException) {
                onError(e.message ?: "Could not redeem")
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
        var found: String? = null
        for (candidate in discoveryCandidates(saved.origin)) {
            if (client.reachable(candidate)) {
                found = candidate
                break
            }
        }
        if (found == null) {
            _state.update { it.copy(phase = Phase.Address, message = "Couldn't find familycal.local. Enter the Pi's address.") }
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
            _state.update { it.copy(phase = Phase.Ready, message = null, origin = origin.value) }
        } catch (e: MantelException) {
            if (e.status == 401) {
                token.value = null
                store.saveToken(null)
                _state.update { it.copy(phase = Phase.Pair, message = "That token is no longer valid. Pair again.", origin = origin.value) }
            } else {
                _state.update { it.copy(phase = Phase.Address, message = e.message, origin = origin.value) }
            }
        }
    }

    private suspend fun refresh() {
        try {
            val settings = client.settings()
            val zone = zoneOrUtc(settings.homeTimezone)
            val anchor = _state.value.anchor
            val (start, end) = fetchInstants(anchor.minusDays(7), anchor.plusDays(45), zone)
            _state.update {
                it.copy(
                    settings = settings,
                    users = client.users(),
                    calendars = client.calendars(),
                    events = client.events(start.toString(), end.toString()),
                    lists = client.lists(),
                    board = client.choreBoard(),
                    offline = false,
                    anchor = if (it.phase == Phase.Loading) dev.mantel.calendar.core.todayIn(zone) else it.anchor,
                )
            }
        } catch (e: MantelException) {
            if (e.status == 401) {
                token.value = null
                store.saveToken(null)
                _state.update { it.copy(phase = Phase.Pair, message = "Pair this TV again.", offline = false) }
            } else if (_state.value.events.isEmpty() && _state.value.phase != Phase.Ready) {
                _state.update { it.copy(message = e.message, offline = true) }
            } else {
                _state.update { it.copy(offline = true, message = e.message) }
            }
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

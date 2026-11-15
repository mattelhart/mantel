package dev.mantel.calendar.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

data class CachedBlob(val body: String, val savedAt: String)

interface SnapshotStore {
    fun write(name: String, body: String, savedAt: String)
    fun read(name: String): CachedBlob?
}

class MemorySnapshotStore : SnapshotStore {
    private val data = mutableMapOf<String, CachedBlob>()
    override fun write(name: String, body: String, savedAt: String) {
        data[name] = CachedBlob(body, savedAt)
    }
    override fun read(name: String): CachedBlob? = data[name]
}

/** Plain files, so a phone app can point this at its own directory. */
class FileSnapshotStore(private val dir: File) : SnapshotStore {
    override fun write(name: String, body: String, savedAt: String) {
        dir.mkdirs()
        File(dir, "${safe(name)}.json").writeText(body)
        File(dir, "${safe(name)}.at").writeText(savedAt)
    }

    override fun read(name: String): CachedBlob? {
        val body = File(dir, "${safe(name)}.json")
        if (!body.isFile) return null
        val at = File(dir, "${safe(name)}.at").takeIf { it.isFile }?.readText().orEmpty()
        return CachedBlob(body.readText(), at)
    }

    private fun safe(name: String): String = name.filter { it.isLetterOrDigit() || it == '-' }
}

@Serializable
data class ScreenCache(
    val savedAt: String,
    val settings: HouseholdSettings = HouseholdSettings(),
    val users: List<FamilyMember> = emptyList(),
    val calendars: List<CalInfo> = emptyList(),
    val events: List<CalEvent> = emptyList(),
    val lists: List<SharedList> = emptyList(),
    val board: ChoreBoard? = null,
)

class ScreenCacheStore(private val store: SnapshotStore) {
    fun save(cache: ScreenCache) {
        store.write("screen", mantelJson.encodeToString(cache), cache.savedAt)
    }

    fun load(): ScreenCache? {
        val blob = store.read("screen") ?: return null
        return runCatching { mantelJson.decodeFromString<ScreenCache>(blob.body) }.getOrNull()
    }
}

@Serializable
data class PendingWrite(
    val id: String,
    val method: String,
    val path: String,
    val body: String,
    val requestId: String? = null,
)

enum class ReplayOutcome { Done, Retry, Drop }

class WriteOutbox(private val store: SnapshotStore) {
    fun load(): List<PendingWrite> {
        val blob = store.read("outbox") ?: return emptyList()
        return runCatching { mantelJson.decodeFromString<List<PendingWrite>>(blob.body) }.getOrDefault(emptyList())
    }

    fun save(items: List<PendingWrite>) {
        store.write("outbox", mantelJson.encodeToString(items), Instant.now().toString())
    }

    fun add(item: PendingWrite) {
        save(load() + item)
    }

    /** Same order as the taps. A retry stops the line so a later one cannot pass it. */
    suspend fun replay(send: suspend (PendingWrite) -> ReplayOutcome): List<PendingWrite> {
        val remaining = load().toMutableList()
        while (remaining.isNotEmpty()) {
            when (send(remaining.first())) {
                ReplayOutcome.Retry -> break
                ReplayOutcome.Done, ReplayOutcome.Drop -> remaining.removeAt(0)
            }
        }
        save(remaining)
        return remaining
    }
}

fun applyChoreCheck(board: ChoreBoard, userId: Int, choreId: Int, done: Boolean): ChoreBoard {
    return board.copy(
        people = board.people.map { person ->
            if (person.userId != userId) person
            else {
                var stars = person.stars
                val chores = person.chores.map { chore ->
                    if (chore.choreId != choreId) chore
                    else if (!done) {
                        stars -= chore.completion?.pointsAwarded ?: 0
                        chore.copy(completion = null)
                    } else if (chore.completion != null) {
                        chore
                    } else {
                        val awarded = if (chore.requiresApproval) 0 else chore.points
                        stars += awarded
                        chore.copy(
                            completion = ChoreCompletion(
                                id = 0,
                                choreId = choreId,
                                userId = userId,
                                on = board.on,
                                status = if (chore.requiresApproval) "pending" else "done",
                                pointsAwarded = awarded,
                            ),
                        )
                    }
                }
                person.copy(stars = stars.coerceAtLeast(0), chores = chores)
            }
        },
    )
}

fun applyRedeem(board: ChoreBoard, userId: Int, rewardId: Int): ChoreBoard {
    val reward = board.rewards.find { it.id == rewardId } ?: return board
    val person = board.people.find { it.userId == userId } ?: return board
    return board.copy(
        people = board.people.map { row ->
            if (row.userId != userId) row else row.copy(stars = (row.stars - reward.pointsCost).coerceAtLeast(0))
        },
        pendingRedemptions = board.pendingRedemptions + RedemptionInfo(
            id = 0,
            rewardId = rewardId,
            rewardTitle = reward.title,
            userId = userId,
            userName = person.name,
            color = person.color,
            pointsSpent = reward.pointsCost,
            status = "pending",
        ),
    )
}

fun applyListCheck(lists: List<SharedList>, listId: Int, itemId: Int, checked: Boolean): List<SharedList> {
    return lists.map { list ->
        if (list.id != listId) list
        else {
            var delta = 0
            val items = list.items.map { item ->
                if (item.id != itemId || item.checked == checked) item
                else {
                    delta += if (checked) -1 else 1
                    item.copy(checked = checked)
                }
            }
            list.copy(items = items, itemCount = (list.itemCount + delta).coerceAtLeast(0))
        }
    }
}

fun offlineLabel(savedAtIso: String?, zone: ZoneId = ZoneId.systemDefault(), now: Instant = Instant.now()): String {
    val whenText = syncedWhen(savedAtIso, zone, now) ?: return "Offline, last synced earlier"
    return "Offline, last synced $whenText"
}

fun syncedLabel(savedAtIso: String?, zone: ZoneId = ZoneId.systemDefault(), now: Instant = Instant.now()): String {
    val whenText = syncedWhen(savedAtIso, zone, now) ?: return "Not synced yet"
    return "Synced $whenText"
}

private fun syncedWhen(savedAtIso: String?, zone: ZoneId, now: Instant): String? {
    if (savedAtIso.isNullOrBlank()) return null
    val then = runCatching { Instant.parse(savedAtIso) }.getOrNull() ?: return null
    val zoned = then.atZone(zone)
    val time = DateTimeFormatter.ofPattern("h:mm a").format(zoned)
    return if (zoned.toLocalDate() == now.atZone(zone).toLocalDate()) time
    else "${zoned.monthValue}/${zoned.dayOfMonth} $time"
}

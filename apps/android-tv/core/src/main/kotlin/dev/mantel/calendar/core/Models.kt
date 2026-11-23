package dev.mantel.calendar.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

val mantelJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    namingStrategy = kotlinx.serialization.json.JsonNamingStrategy.SnakeCase
}

@Serializable
data class ErrorEnvelope(val error: ErrorDetail = ErrorDetail())

@Serializable
data class ErrorDetail(val code: String = "error", val message: String = "Something went wrong")

class MantelException(val code: String, message: String, val status: Int) : Exception(message)

@Serializable
data class AuthStatus(
    val authMode: String = "lan",
    val networkTrusted: Boolean = false,
    val authorizationRequired: Boolean = false,
)

@Serializable
data class DeviceInfo(
    val id: Int,
    val name: String,
    val tokenPrefix: String = "",
    val createdAt: String = "",
    val lastUsedAt: String? = null,
)

@Serializable
data class PairResult(val token: String, val tokenType: String = "bearer", val device: DeviceInfo)

@Serializable
data class HouseholdSettings(
    val firstDayOfWeek: Int = 0,
    val timeFormat24h: Boolean = false,
    val homeTimezone: String = "UTC",
)

@Serializable
data class FamilyMember(
    val id: Int,
    val name: String,
    val color: String = "#3b82f6",
    val avatarEmoji: String? = null,
    val sortOrder: Int = 0,
)

@Serializable
data class CalInfo(
    val id: Int,
    val name: String,
    val color: String = "#3b82f6",
    val claimedByUserId: Int? = null,
    val writable: Boolean = false,
)

@Serializable
data class CalEvent(
    val id: Int,
    val calendarId: Int,
    val calendarName: String = "",
    val color: String = "#3b82f6",
    val userId: Int? = null,
    val title: String,
    val description: String? = null,
    val location: String? = null,
    val startAt: String,
    val endAt: String,
    val allDay: Boolean = false,
    val timezone: String? = null,
    val recurring: Boolean = false,
    val recurrenceRule: String? = null,
    val recurrenceText: String? = null,
    val origin: String = "local",
    val syncState: String = "synced",
    val editable: Boolean = true,
)

@Serializable
data class ListItem(
    val id: Int,
    val listId: Int,
    val text: String,
    val checked: Boolean = false,
    val color: String? = null,
)

@Serializable
data class SharedList(
    val id: Int,
    val name: String,
    val icon: String? = null,
    val itemCount: Int = 0,
    val items: List<ListItem> = emptyList(),
)

@Serializable
data class ChoreCompletion(
    val id: Int,
    val choreId: Int,
    val userId: Int,
    val on: String,
    val status: String,
    val pointsAwarded: Int = 0,
)

@Serializable
data class BoardChore(
    val choreId: Int,
    val title: String,
    val icon: String? = null,
    val points: Int = 0,
    val requiresApproval: Boolean = false,
    val completion: ChoreCompletion? = null,
)

@Serializable
data class PersonBoard(
    val userId: Int,
    val name: String,
    val color: String = "#3b82f6",
    val avatarEmoji: String? = null,
    val stars: Int = 0,
    val chores: List<BoardChore> = emptyList(),
)

@Serializable
data class RewardInfo(
    val id: Int,
    val title: String,
    val pointsCost: Int,
    val icon: String? = null,
)

@Serializable
data class RedemptionInfo(
    val id: Int,
    val rewardId: Int,
    val rewardTitle: String,
    val userId: Int,
    val userName: String,
    val color: String = "#3b82f6",
    val pointsSpent: Int,
    val status: String,
)

@Serializable
data class PendingApproval(
    val completionId: Int,
    val choreId: Int,
    val title: String,
    val userId: Int,
    val userName: String,
    val color: String = "#3b82f6",
    val points: Int,
    val on: String,
)

@Serializable
data class ChoreBoard(
    val on: String,
    val people: List<PersonBoard> = emptyList(),
    val rewards: List<RewardInfo> = emptyList(),
    val pendingRedemptions: List<RedemptionInfo> = emptyList(),
    val pendingApprovals: List<PendingApproval> = emptyList(),
)

@Serializable
data class CompleteResult(val completion: ChoreCompletion? = null)

@Serializable
data class ChoreDefinition(
    val id: Int,
    val title: String,
    val notes: String? = null,
    val points: Int = 0,
    val schedule: String = "daily",
    val weekdays: List<Int> = emptyList(),
    val dueOn: String? = null,
    val requiresApproval: Boolean = false,
    val icon: String? = null,
    val assigneeIds: List<Int> = emptyList(),
)

@Serializable
data class DisplayTarget(val id: String, val name: String)

/** A single-use code a phone or TV exchanges for a token. The server also returns an SVG; the app draws its own QR. */
@Serializable
data class PairingCode(val code: String, val expiresAt: String, val qrPayload: String = "")

/** What Settings > Home needs to know. The token itself is never in this: only whether one is saved. */
@Serializable
data class HomeSetup(val haBaseUrl: String = "", val server: HomeSetupServer = HomeSetupServer())

@Serializable
data class HomeSetupServer(val haTokenSet: Boolean = false)

@Serializable
data class HomeTestResult(val ok: Boolean = false, val status: String = "", val message: String = "")

@Serializable
data class HomeEntity(
    val entityId: String,
    val domain: String,
    val name: String,
    val state: String = "",
    val available: Boolean = true,
    val on: Boolean? = null,
    val level: Int? = null,
    val adjustable: Boolean = false,
)

@Serializable
data class HomeRoom(val areaId: String? = null, val name: String = "", val entities: List<HomeEntity> = emptyList())

/** `GET /api/home`. [status] is ok, not_configured, unreachable or invalid_token, with a [message] a person can act on. */
@Serializable
data class HomeSnapshot(
    val status: String = "ok",
    val message: String = "",
    val rooms: List<HomeRoom> = emptyList(),
    val actions: List<HomeEntity> = emptyList(),
)

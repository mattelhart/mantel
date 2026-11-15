package dev.mantel.calendar.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.timeout
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.prepareGet
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsChannel
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.content.TextContent
import io.ktor.utils.io.readUTF8Line
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The HTTP calls a Mantel screen makes. No Android types, so a phone app can
 * use the same client. The TV keeps the token and the server address itself.
 */
class MantelClient(
    engine: HttpClientEngine,
    private val origin: () -> String,
    private val token: () -> String?,
) {
    private val http = HttpClient(engine) {
        expectSuccess = false
        install(HttpTimeout) {
            connectTimeoutMillis = 10_000
            requestTimeoutMillis = 30_000
            socketTimeoutMillis = 30_000
        }
    }

    suspend fun reachable(base: String): Boolean = try {
        val response = http.get("$base/api/health")
        response.status.value in 200..299
    } catch (_: Exception) {
        false
    }

    suspend fun authStatus(): AuthStatus = get("/auth/status")

    suspend fun pair(code: String, name: String): PairResult = post(
        "/auth/pair",
        buildJsonObject {
            put("code", code.trim())
            put("name", name.trim().ifEmpty { "Living room TV" })
        },
    )

    suspend fun settings(): HouseholdSettings = get("/settings")

    suspend fun users(): List<FamilyMember> = get("/users")

    suspend fun calendars(): List<CalInfo> = get("/calendars")

    suspend fun events(start: String, end: String): List<CalEvent> =
        get("/events", mapOf("start" to start, "end" to end))

    suspend fun createEvent(body: JsonObject): CalEvent = post("/events", body)

    suspend fun updateEvent(id: Int, body: JsonObject): CalEvent = send(HttpMethod.Patch, "/events/$id", body)

    suspend fun deleteEvent(id: Int) {
        send<Unit>(HttpMethod.Delete, "/events/$id", null)
    }

    suspend fun lists(): List<SharedList> = get("/lists")

    suspend fun setItemChecked(listId: Int, itemId: Int, checked: Boolean): ListItem =
        send(HttpMethod.Patch, "/lists/$listId/items/$itemId", buildJsonObject { put("checked", checked) })

    suspend fun addItem(listId: Int, text: String): ListItem =
        post("/lists/$listId/items", buildJsonObject { put("text", text) })

    suspend fun addList(name: String): SharedList =
        post("/lists", buildJsonObject { put("name", name) })

    suspend fun choreBoard(on: String? = null): ChoreBoard =
        get("/chores/board", if (on == null) emptyMap() else mapOf("on" to on))

    suspend fun completeChore(
        choreId: Int,
        userId: Int,
        on: String,
        done: Boolean,
        requestId: String? = null,
    ): CompleteResult = post(
        "/chores/$choreId/complete",
        buildJsonObject {
            put("user_id", userId)
            put("on", on)
            put("done", done)
            if (requestId != null) put("request_id", requestId)
        },
    )

    suspend fun approveChore(completionId: Int): ChoreCompletion =
        post("/chores/completions/$completionId/approve", buildJsonObject {})

    suspend fun rejectChore(completionId: Int) {
        send<Unit>(HttpMethod.Post, "/chores/completions/$completionId/reject", buildJsonObject {})
    }

    suspend fun redeem(rewardId: Int, userId: Int, requestId: String? = null): RedemptionInfo =
        post(
            "/rewards/$rewardId/redeem",
            buildJsonObject {
                put("user_id", userId)
                if (requestId != null) put("request_id", requestId)
            },
        )

    suspend fun fulfill(redemptionId: Int): RedemptionInfo =
        post("/redemptions/$redemptionId/fulfill", buildJsonObject {})

    suspend fun deny(redemptionId: Int): RedemptionInfo =
        post("/redemptions/$redemptionId/deny", buildJsonObject {})

    /**
     * Blocks until the stream ends. Callers reconnect with [reconnectDelayMs]
     * and pass the last id they saw so a short drop does not refetch everything.
     */
    suspend fun listen(lastId: Long?, onLine: (String) -> Unit) {
        try {
            http.prepareGet(url("/live")) {
                auth()
                header(HttpHeaders.Accept, "text/event-stream")
                if (lastId != null) header("Last-Event-ID", lastId.toString())
                timeout {
                    // The client default would close a quiet stream at 30s.
                    // Keepalives arrive every 15s; this only bounds a dead socket.
                    requestTimeoutMillis = Long.MAX_VALUE
                    socketTimeoutMillis = 45_000
                }
            }.execute { response ->
                if (response.status.value !in 200..299) {
                    val text = response.bodyAsText()
                    val envelope = runCatching { mantelJson.decodeFromString<ErrorEnvelope>(text) }.getOrNull()
                    throw MantelException(
                        envelope?.error?.code ?: "error",
                        envelope?.error?.message ?: "The calendar could not do that",
                        response.status.value,
                    )
                }
                val channel = response.bodyAsChannel()
                while (!channel.isClosedForRead) {
                    val line = channel.readUTF8Line() ?: break
                    onLine(line)
                }
            }
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            throw unreachable(e)
        }
    }

    /** Replays one queued tap. 2xx is done, a refusal is dropped, a dead network is retried. */
    suspend fun replayWrite(method: String, path: String, body: String?): ReplayOutcome {
        val httpMethod = when (method) {
            "PATCH" -> HttpMethod.Patch
            "DELETE" -> HttpMethod.Delete
            else -> HttpMethod.Post
        }
        val response = try {
            http.request(url(path)) {
                this.method = httpMethod
                auth()
                if (body != null) setBody(TextContent(body, ContentType.Application.Json))
            }
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            return ReplayOutcome.Retry
        }
        val status = response.status.value
        runCatching { response.bodyAsText() }
        return when {
            status in 200..299 -> ReplayOutcome.Done
            status == 401 || status == 408 || status == 429 || status >= 500 -> ReplayOutcome.Retry
            else -> ReplayOutcome.Drop
        }
    }

    fun close() = http.close()

    private suspend inline fun <reified T> get(path: String, query: Map<String, String> = emptyMap()): T {
        val response = try {
            http.get(url(path)) {
                query.forEach { (key, value) -> parameter(key, value) }
                auth()
            }
        } catch (e: Exception) {
            throw unreachable(e)
        }
        return read(response)
    }

    private suspend inline fun <reified T> post(path: String, body: JsonObject): T =
        send(HttpMethod.Post, path, body)

    private suspend inline fun <reified T> send(method: HttpMethod, path: String, body: JsonObject?): T {
        val response = try {
            http.request(url(path)) {
                this.method = method
                auth()
                if (body != null) {
                    setBody(TextContent(body.toString(), ContentType.Application.Json))
                }
            }
        } catch (e: Exception) {
            throw unreachable(e)
        }
        if (response.status.value == 204) {
            @Suppress("UNCHECKED_CAST")
            return Unit as T
        }
        return read(response)
    }

    private fun io.ktor.client.request.HttpRequestBuilder.auth() {
        token()?.takeIf { it.isNotBlank() }?.let { header(HttpHeaders.Authorization, "Bearer $it") }
    }

    private suspend inline fun <reified T> read(response: HttpResponse): T {
        val text = response.bodyAsText()
        if (response.status.value !in 200..299) {
            val envelope = runCatching { mantelJson.decodeFromString<ErrorEnvelope>(text) }.getOrNull()
            throw MantelException(
                envelope?.error?.code ?: "error",
                envelope?.error?.message ?: "The calendar could not do that",
                response.status.value,
            )
        }
        return mantelJson.decodeFromString(text)
    }

    private fun url(path: String): String = origin().trimEnd('/') + "/api" + path

    private fun unreachable(error: Exception): MantelException {
        if (error is MantelException) return error
        return MantelException("unreachable", "Can't reach the calendar", 0)
    }
}

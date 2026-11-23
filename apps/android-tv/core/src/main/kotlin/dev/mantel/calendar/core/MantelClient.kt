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
import io.ktor.client.statement.readBytes
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

    suspend fun reachable(base: String, timeoutMs: Long = CONNECT_TIMEOUT_MS): Boolean =
        probeServer(base, timeoutMs) is ServerProbe.Up

    /**
     * A short timeout belongs on discovery. The client default is ten seconds to
     * connect, which is how a missing familycal.local used to hold the spinner.
     * Cancellation must still propagate, or leaving the screen would look like
     * "the server is down".
     */
    suspend fun probeServer(base: String, timeoutMs: Long = CONNECT_TIMEOUT_MS): ServerProbe {
        try {
            val response = http.get("$base/api/health") {
                timeout {
                    connectTimeoutMillis = timeoutMs
                    requestTimeoutMillis = timeoutMs
                    socketTimeoutMillis = timeoutMs
                }
            }
            val status = response.status.value
            runCatching { response.bodyAsText() }
            return if (status in 200..299) ServerProbe.Up else ServerProbe.Unhealthy(status)
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            return ServerProbe.Down
        }
    }

    suspend fun authStatus(): AuthStatus = get("/auth/status")

    suspend fun pair(code: String, name: String): PairResult = post(
        "/auth/pair",
        buildJsonObject {
            put("code", code.trim())
            put("name", name.trim().ifEmpty { "Living room TV" })
        },
        authenticate = false,
    )

    suspend fun settings(): HouseholdSettings = get("/settings")

    /** Mint a code for a TV (or another phone) to type. Needs this phone's own token, or a trusted network. */
    suspend fun createPairingCode(baseUrl: String): PairingCode =
        post("/auth/pairing-codes?base_url=${java.net.URLEncoder.encode(baseUrl, "UTF-8")}", buildJsonObject {})

    suspend fun homeSetup(): HomeSetup = get("/settings")

    /**
     * Saves the Home Assistant address and token on the server. A null argument leaves that
     * value alone; [clearToken] removes the saved token. The token goes out once and is never
     * read back: the server only reports whether one is saved.
     */
    suspend fun saveHomeConnection(baseUrl: String? = null, token: String? = null, clearToken: Boolean = false) {
        val body = buildJsonObject {
            if (baseUrl != null) put("ha_base_url", baseUrl.trim())
            if (clearToken) put("ha_token", kotlinx.serialization.json.JsonNull)
            else if (!token.isNullOrBlank()) put("ha_token", token.trim())
        }
        send<JsonObject>(HttpMethod.Patch, "/settings", body)
    }

    suspend fun testHome(): HomeTestResult = post("/home/test", buildJsonObject {})

    suspend fun home(): HomeSnapshot = get("/home")

    suspend fun homeAction(entityId: String, action: String, value: Int? = null, confirm: Boolean = false) {
        post<JsonObject>(
            "/home/entities/$entityId/action",
            buildJsonObject {
                put("action", action)
                if (value != null) put("value", value)
                put("confirm", confirm)
            },
        )
    }

    suspend fun users(): List<FamilyMember> = get("/users")

    suspend fun calendars(): List<CalInfo> = get("/calendars")

    suspend fun events(start: String, end: String): List<CalEvent> =
        get("/events", mapOf("start" to start, "end" to end))

    suspend fun createEvent(body: JsonObject): CalEvent = post("/events", body)

    suspend fun updateEvent(id: Int, body: JsonObject): CalEvent = send(HttpMethod.Patch, "/events/$id", body)

    suspend fun deleteEvent(id: Int) {
        send<Unit>(HttpMethod.Delete, "/events/$id", null)
    }

    suspend fun mealPlan(start: String, end: String): Map<String, String> =
        get("/meals?start=$start&end=$end")

    suspend fun saveMeal(day: String, meal: String, title: String): Unit {
        post<JsonObject>("/meals", buildJsonObject { put("day", day); put("meal", meal); put("title", title) })
    }

    suspend fun pollDisplay(id: String, name: String): String? =
        post<JsonObject>("/displays/$id/poll", buildJsonObject { put("name", name) })["destination"]
            ?.let { it as? kotlinx.serialization.json.JsonPrimitive }
            ?.takeUnless { it is kotlinx.serialization.json.JsonNull }
            ?.content

    suspend fun displays(): List<DisplayTarget> = get("/displays")

    suspend fun showOnDisplay(id: String, destination: String): Unit {
        post<JsonObject>("/displays/$id/show", buildJsonObject { put("destination", destination) })
    }

    suspend fun lists(): List<SharedList> = get("/lists")

    suspend fun setItemChecked(listId: Int, itemId: Int, checked: Boolean): ListItem =
        send(HttpMethod.Patch, "/lists/$listId/items/$itemId", buildJsonObject { put("checked", checked) })

    suspend fun addItem(listId: Int, text: String): ListItem =
        post("/lists/$listId/items", buildJsonObject { put("text", text) })

    suspend fun addList(name: String): SharedList =
        post("/lists", buildJsonObject { put("name", name) })

    suspend fun deleteItem(listId: Int, itemId: Int) {
        send<Unit>(HttpMethod.Delete, "/lists/$listId/items/$itemId", null)
    }

    suspend fun clearChecked(listId: Int): SharedList =
        post("/lists/$listId/clear-checked", buildJsonObject {})

    suspend fun renameList(id: Int, name: String): SharedList =
        send(HttpMethod.Patch, "/lists/$id", buildJsonObject { put("name", name) })

    suspend fun deleteList(id: Int) {
        send<Unit>(HttpMethod.Delete, "/lists/$id", null)
    }

    suspend fun renameItem(listId: Int, itemId: Int, text: String): ListItem =
        send(HttpMethod.Patch, "/lists/$listId/items/$itemId", buildJsonObject { put("text", text) })

    suspend fun chores(): List<ChoreDefinition> = get("/chores")

    suspend fun saveChore(id: Int?, body: JsonObject): ChoreDefinition =
        if (id == null) post("/chores", body) else send(HttpMethod.Patch, "/chores/$id", body)

    suspend fun deleteChore(id: Int) {
        send<Unit>(HttpMethod.Delete, "/chores/$id", null)
    }

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

    suspend fun conversations(): ConversationsListing = get("/messages/conversations")

    suspend fun conversation(id: String): Conversation = get("/messages/conversations/$id")

    suspend fun sendMessage(userId: Int, body: String, mediaBase64: String? = null,
                            requestId: String = java.util.UUID.randomUUID().toString()): ConversationMessage =
        post(
            "/messages",
            buildJsonObject {
                put("request_id", requestId)
                put("user_id", userId)
                put("body", body)
                if (!mediaBase64.isNullOrBlank()) put("media_base64", mediaBase64)
            },
        )

    suspend fun messageMedia(id: Int): ByteArray {
        val response = try {
            http.get(url("/messages/$id/media")) { auth() }
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            throw unreachable(e)
        }
        if (response.status.value !in 200..299) {
            val text = runCatching { response.bodyAsText() }.getOrDefault("")
            val envelope = runCatching { mantelJson.decodeFromString<ErrorEnvelope>(text) }.getOrNull()
            throw MantelException(
                envelope?.error?.code ?: "error",
                envelope?.error?.message ?: "The calendar could not do that",
                response.status.value,
            )
        }
        return response.readBytes()
    }


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
            if (e is CancellationException) throw e
            throw unreachable(e)
        }
        return read(response)
    }

    private suspend inline fun <reified T> post(path: String, body: JsonObject, authenticate: Boolean = true): T =
        send(HttpMethod.Post, path, body, authenticate)

    private suspend inline fun <reified T> send(
        method: HttpMethod,
        path: String,
        body: JsonObject?,
        authenticate: Boolean = true,
    ): T {
        val response = try {
            http.request(url(path)) {
                this.method = method
                // Pairing is how a revoked token gets replaced. Sending the old
                // bearer would only confuse a proxy, and the route does not want it.
                if (authenticate) auth()
                if (body != null) {
                    setBody(TextContent(body.toString(), ContentType.Application.Json))
                }
            }
        } catch (e: Exception) {
            if (e is CancellationException) throw e
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
        val target = origin().ifBlank { "the calendar server" }
        return MantelException("unreachable", unreachableMessage(target), 0)
    }
}

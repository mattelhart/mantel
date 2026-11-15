package dev.mantel.calendar.core

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.http.content.TextContent
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class MantelClientTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    @Test
    fun eventsRequestSendsTheBearerTokenAndTheRange() = runBlocking {
        var seenAuth: String? = null
        var seenUrl = ""
        val client = client(
            MockEngine { request ->
                seenAuth = request.headers[HttpHeaders.Authorization]
                seenUrl = request.url.toString()
                respond(EVENTS, HttpStatusCode.OK, json)
            },
        )
        val events = client.events("2026-11-15T00:00:00Z", "2026-11-16T00:00:00Z")
        assertEquals("Bearer mantel_secret", seenAuth)
        assertTrue(seenUrl.contains("/api/events"))
        assertTrue(seenUrl.contains("start=2026-11-15T00%3A00%3A00Z") || seenUrl.contains("start=2026-11-15T00:00:00Z"))
        assertEquals("Soccer", events.single().title)
        assertEquals("#3b82f6", events.single().color)
        assertFalse(events.single().allDay)
        client.close()
    }

    @Test
    fun errorEnvelopeBecomesAMantelException() = runBlocking {
        val client = client(
            MockEngine {
                respond(
                    """{"error":{"code":"bad_request","message":"Not enough stars. Sam has 1 and this costs 10."}}""",
                    HttpStatusCode.BadRequest,
                    json,
                )
            },
        )
        try {
            client.redeem(1, 2)
            fail("expected the error envelope")
        } catch (e: MantelException) {
            assertEquals("bad_request", e.code)
            assertEquals(400, e.status)
            assertTrue(e.message!!.contains("Not enough stars"))
        }
        client.close()
    }

    @Test
    fun pairPostsTheCodeAndReadsTheToken() = runBlocking {
        var body = ""
        var seenAuth: String? = "sent"
        val client = client(
            MockEngine { request ->
                body = (request.body as TextContent).text
                seenAuth = request.headers[HttpHeaders.Authorization]
                respond(
                    """{"token":"mantel_abc","token_type":"bearer","device":{"id":3,"name":"Living room TV","token_prefix":"mantel_ab","created_at":"2026-11-15T00:00:00Z"}}""",
                    HttpStatusCode.Created,
                    json,
                )
            },
        )
        val paired = client.pair("k7nq-4rmp", "Living room TV")
        assertEquals("mantel_abc", paired.token)
        assertTrue(body.contains("k7nq-4rmp"))
        assertNull("a revoked bearer must not ride along on the pairing call", seenAuth)
        client.close()
    }

    @Test
    fun aNetworkFailureIsUnreachableRatherThanACrash() = runBlocking {
        val client = client(MockEngine { throw java.net.ConnectException("refused") })
        try {
            client.lists()
            fail("expected unreachable")
        } catch (e: MantelException) {
            assertEquals("unreachable", e.code)
            assertEquals(0, e.status)
            assertTrue(e.message!!.contains("familycal.local"))
            assertTrue(e.message!!.contains("calendar server"))
        }
        client.close()
    }

    @Test
    fun aRefusedHealthCheckIsDownRatherThanACrash() = runBlocking {
        val client = client(MockEngine { throw java.net.ConnectException("refused") })
        val probe = client.probeServer("http://10.0.0.8:8080", 500)
        assertTrue(probe is ServerProbe.Down)
        assertTrue(probe.failureMessage("http://10.0.0.8:8080")!!.contains("10.0.0.8"))
        assertFalse(client.reachable("http://10.0.0.8:8080", 500))
        client.close()
    }

    @Test
    fun healthOkMeansTheServerIsUp() = runBlocking {
        var path = ""
        val client = client(
            MockEngine { request ->
                path = request.url.encodedPath
                respond("""{"status":"ok"}""", HttpStatusCode.OK, json)
            },
        )
        assertTrue(client.probeServer("http://10.0.0.8:8080", 500) is ServerProbe.Up)
        assertTrue(path.endsWith("/api/health"))
        client.close()
    }

    @Test
    fun aHealthCheckThatErrorsIsNotTreatedAsSilence() = runBlocking {
        val client = client(MockEngine { respond("no", HttpStatusCode.ServiceUnavailable, json) })
        val probe = client.probeServer("http://10.0.0.8:8080", 500)
        assertTrue(probe is ServerProbe.Unhealthy)
        assertEquals(503, (probe as ServerProbe.Unhealthy).status)
        val message = probe.failureMessage("http://10.0.0.8:8080")
        assertTrue(message!!.contains("503"))
        assertTrue(message.contains("not ready"))
        client.close()
    }

    @Test
    fun boardParsesStarsAndAPendingCheck() = runBlocking {
        val client = client(MockEngine { respond(BOARD, HttpStatusCode.OK, json) })
        val board = client.choreBoard("2026-11-15")
        assertEquals("2026-11-15", board.on)
        assertEquals(4, board.people.single().stars)
        assertEquals("pending", board.people.single().chores.single().completion?.status)
        assertEquals("Pick the movie", board.rewards.single().title)
        client.close()
    }

    @Test
    fun checkingAChorePostsThePersonAndTheDay() = runBlocking {
        var body = ""
        var path = ""
        val client = client(
            MockEngine { request ->
                path = request.url.encodedPath
                body = (request.body as TextContent).text
                respond("""{"completion":null}""", HttpStatusCode.OK, json)
            },
        )
        val result = client.completeChore(7, 2, "2026-11-15", done = false)
        assertTrue(path.endsWith("/api/chores/7/complete"))
        assertTrue(body.contains("\"user_id\":2"))
        assertTrue(body.contains("\"done\":false"))
        assertEquals(null, result.completion)
        client.close()
    }

    @Test
    fun createChorePostsTheSameFieldsAsTheWallForm() = runBlocking {
        var method = ""
        var path = ""
        var body = ""
        val client = client(
            MockEngine { request ->
                method = request.method.value
                path = request.url.encodedPath
                body = (request.body as TextContent).text
                respond(CHORE, HttpStatusCode.Created, json)
            },
        )
        val saved = client.createChore("Make bed", 2, "weekly", listOf(1, 3), null, true, listOf(1, 2))
        assertEquals("POST", method)
        assertTrue(path.endsWith("/api/chores"))
        assertTrue(body.contains("\"title\":\"Make bed\""))
        assertTrue(body.contains("\"points\":2"))
        assertTrue(body.contains("\"schedule\":\"weekly\""))
        assertTrue(body.contains("\"weekdays\":[1,3]"))
        assertFalse("a weekly chore has no due date", body.contains("due_on"))
        assertTrue(body.contains("\"requires_approval\":true"))
        assertTrue(body.contains("\"assignee_ids\":[1,2]"))
        assertEquals(4, saved.id)
        assertEquals(listOf(1, 3), saved.weekdays)
        assertEquals(listOf(1, 2), saved.assigneeIds)
        client.close()
    }

    @Test
    fun aOneDayChoreSendsItsDueDate() = runBlocking {
        var body = ""
        val client = client(
            MockEngine { request ->
                body = (request.body as TextContent).text
                respond(CHORE, HttpStatusCode.Created, json)
            },
        )
        client.createChore("Library books", 1, "once", emptyList(), "2026-11-20", false, listOf(1))
        assertTrue(body.contains("\"schedule\":\"once\""))
        assertTrue(body.contains("\"due_on\":\"2026-11-20\""))
        assertFalse("a one-day chore has no weekday list", body.contains("weekdays"))
        client.close()
    }

    @Test
    fun editingAndDeletingAChoreUsePatchAndDelete() = runBlocking {
        val seen = mutableListOf<String>()
        val client = client(
            MockEngine { request ->
                seen += "${request.method.value} ${request.url.encodedPath}"
                if (request.method.value == "DELETE") {
                    respond("", HttpStatusCode.NoContent, json)
                } else {
                    respond(CHORE, HttpStatusCode.OK, json)
                }
            },
        )
        client.updateChore(4, "Make bed", 2, "daily", emptyList(), null, false, listOf(1))
        client.deleteChore(4)
        assertTrue(seen[0].startsWith("PATCH ") && seen[0].endsWith("/api/chores/4"))
        assertTrue(seen[1].startsWith("DELETE ") && seen[1].endsWith("/api/chores/4"))
        client.close()
    }

    @Test
    fun createEventRoundTripsTheBodyTheServerExpects() = runBlocking {
        var body = ""
        val client = client(
            MockEngine { request ->
                body = (request.body as TextContent).text
                respond(EVENT, HttpStatusCode.Created, json)
            },
        )
        client.createEvent(
            buildJsonObject {
                put("calendar_id", 1)
                put("title", "Dentist")
                put("start_at", "2026-11-15T19:00:00Z")
                put("end_at", "2026-11-15T20:00:00Z")
                put("all_day", false)
            },
        )
        assertTrue(body.contains("\"calendar_id\":1"))
        assertTrue(body.contains("Dentist"))
        client.close()
    }

    private fun client(engine: MockEngine) = MantelClient(engine, { "http://familycal.local:8080" }, { "mantel_secret" })
}

private const val EVENT = """
{
  "id": 12,
  "calendar_id": 1,
  "calendar_name": "Family",
  "color": "#3b82f6",
  "user_id": 1,
  "title": "Soccer",
  "description": null,
  "location": "Park",
  "start_at": "2026-11-15T19:00:00Z",
  "end_at": "2026-11-15T20:00:00Z",
  "all_day": false,
  "timezone": "America/New_York",
  "recurring": false,
  "recurrence_rule": null,
  "recurrence_text": null,
  "origin": "local",
  "sync_state": "synced",
  "editable": true
}
"""

private const val EVENTS = "[$EVENT]"

private const val CHORE = """
{
  "id": 4,
  "title": "Make bed",
  "notes": null,
  "points": 2,
  "schedule": "weekly",
  "weekdays": [1, 3],
  "due_on": null,
  "requires_approval": true,
  "icon": "🛏️",
  "assignee_ids": [1, 2]
}
"""

private const val BOARD = """
{
  "on": "2026-11-15",
  "people": [{
    "user_id": 1,
    "name": "Sam",
    "color": "#f97316",
    "avatar_emoji": null,
    "stars": 4,
    "chores": [{
      "chore_id": 3,
      "title": "Make bed",
      "icon": "🛏️",
      "points": 1,
      "requires_approval": true,
      "schedule": "daily",
      "completion": {"id": 9, "chore_id": 3, "user_id": 1, "on": "2026-11-15", "status": "pending", "points_awarded": 0}
    }]
  }],
  "rewards": [{"id": 1, "title": "Pick the movie", "description": null, "points_cost": 10, "icon": "🎬"}],
  "pending_redemptions": [],
  "pending_approvals": []
}
"""

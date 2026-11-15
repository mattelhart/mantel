package dev.mantel.calendar.core

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.time.Instant
import java.time.ZoneOffset

class LiveOfflineTest {
    @Test
    fun backoffGrowsAndThenCaps() {
        assertEquals(1000L, reconnectDelayMs(1))
        assertEquals(2000L, reconnectDelayMs(2))
        assertEquals(4000L, reconnectDelayMs(3))
        assertEquals(30_000L, reconnectDelayMs(20))
        assertEquals(1250L, reconnectDelayMs(1, 250))
    }

    @Test
    fun parserReadsTopicsAndAGap() {
        val parser = SseParser()
        val text = """
            id: 4
            event: change
            data: {"topics":["chores","rewards"],"at":"2026-11-15T12:00:00Z"}

            event: resync
            data: {"reason":"gap"}

        """.trimIndent() + "\n"
        val messages = mutableListOf<LiveMessage>()
        for (line in text.split('\n')) messages += parser.feed(line)
        assertTrue(messages[0] is LiveMessage.Change)
        assertEquals(setOf("chores", "rewards"), (messages[0] as LiveMessage.Change).topics)
        assertEquals(4L, (messages[0] as LiveMessage.Change).id)
        assertTrue(messages[1] is LiveMessage.Resync)
    }

    @Test
    fun listenSendsTheBearerTokenAndTheLastEventId() = runBlocking {
        var auth: String? = null
        var last: String? = null
        val client = MantelClient(
            MockEngine { request ->
                auth = request.headers[HttpHeaders.Authorization]
                last = request.headers["Last-Event-ID"]
                respond(
                    "id: 3\nevent: change\ndata: {\"topics\":[\"events\"]}\n\n",
                    HttpStatusCode.OK,
                    headersOf(HttpHeaders.ContentType, "text/event-stream"),
                )
            },
            { "http://familycal.local:8080" },
            { "mantel_secret" },
        )
        val parser = SseParser()
        val messages = mutableListOf<LiveMessage>()
        client.listen(2) { line -> messages += parser.feed(line) }
        assertEquals("Bearer mantel_secret", auth)
        assertEquals("2", last)
        assertEquals(setOf("events"), (messages.single() as LiveMessage.Change).topics)
        client.close()
    }

    @Test
    fun replaySendsTheOriginalRequestIdAndStopsWhenTheNetworkDrops() = runBlocking {
        val outbox = WriteOutbox(MemorySnapshotStore())
        outbox.add(
            PendingWrite(
                "check-1",
                "POST",
                "/chores/7/complete",
                """{"user_id":1,"done":true,"request_id":"check-1"}""",
                "check-1",
            ),
        )
        outbox.add(
            PendingWrite(
                "redeem-1",
                "POST",
                "/rewards/3/redeem",
                """{"user_id":1,"request_id":"redeem-1"}""",
                "redeem-1",
            ),
        )
        outbox.add(
            PendingWrite(
                "later",
                "POST",
                "/lists/1/items/2",
                """{"checked":true}""",
                null,
            ),
        )
        val seen = mutableListOf<String>()
        val left = outbox.replay { write ->
            seen += write.body
            if (write.requestId == "redeem-1") ReplayOutcome.Retry else ReplayOutcome.Done
        }
        assertEquals(
            listOf(
                """{"user_id":1,"done":true,"request_id":"check-1"}""",
                """{"user_id":1,"request_id":"redeem-1"}""",
            ),
            seen,
        )
        assertEquals(listOf("redeem-1", null), left.map { it.requestId })
        val again = mutableListOf<String>()
        outbox.replay { write ->
            again += write.requestId ?: ""
            ReplayOutcome.Done
        }
        assertEquals(listOf("redeem-1", ""), again)
        assertTrue(outbox.load().isEmpty())
    }

    @Test
    fun aChoreCheckDrawnOfflineAddsTheStarsOnce() {
        val board = ChoreBoard(
            on = "2026-11-15",
            people = listOf(
                PersonBoard(
                    userId = 1,
                    name = "Sam",
                    stars = 4,
                    chores = listOf(BoardChore(choreId = 7, title = "Make bed", points = 2)),
                ),
            ),
        )
        val once = applyChoreCheck(board, 1, 7, true)
        val twice = applyChoreCheck(once, 1, 7, true)
        assertEquals(6, twice.people.single().stars)
        assertEquals("done", twice.people.single().chores.single().completion?.status)
    }

    @Test
    fun theCacheRoundTripsTheBoardAndTheTime() {
        val dir = Files.createTempDirectory("mantel-cache").toFile()
        val store = ScreenCacheStore(FileSnapshotStore(dir))
        val savedAt = "2026-11-15T19:02:00Z"
        store.save(
            ScreenCache(
                savedAt = savedAt,
                events = listOf(
                    CalEvent(
                        id = 1,
                        calendarId = 1,
                        title = "Soccer",
                        startAt = "2026-11-15T19:00:00Z",
                        endAt = "2026-11-15T20:00:00Z",
                    ),
                ),
                board = ChoreBoard(on = "2026-11-15"),
            ),
        )
        val loaded = store.load()
        assertEquals("Soccer", loaded?.events?.single()?.title)
        assertEquals(savedAt, loaded?.savedAt)
        val label = offlineLabel(savedAt, ZoneOffset.UTC, Instant.parse("2026-11-15T20:00:00Z"))
        assertTrue(label.startsWith("Offline, last synced "))
        assertTrue(label.contains("7:02"))
    }
}

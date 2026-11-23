package dev.mantel.calendar.core

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MessagesTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    @Test
    fun conversationsListingHidesUnknownNumbersAndKeepsFamilyWithoutPhones() {
        val listing = mantelJson.decodeFromString<ConversationsListing>(LISTING)
        assertTrue(listing.configured)
        assertEquals("+18777708804", listing.fromNumber)
        assertEquals(listOf("Dinner's ready", "Call me"), listing.quickReplies)
        assertEquals(listOf("Dad", "Sam"), listing.conversations.map { it.name })
        assertFalse(listing.conversations.any { it.unknown })
        val dad = listing.conversations[0]
        assertEquals("user-1", dad.id)
        assertEquals(1, dad.userId)
        assertTrue(dad.canSend)
        assertEquals("On my way", dad.lastMessage?.body)
        val sam = listing.conversations[1]
        assertNull(sam.phone)
        assertFalse(sam.canSend)
        assertEquals("Ask a grown-up to add a phone number", conversationPreview(sam))
        assertEquals("On my way", conversationPreview(dad))
    }

    @Test
    fun friendlyErrorsAskAGrownUpInsteadOfRepeatingProviderNames() {
        assertEquals(
            "Ask a grown-up to finish Messages settings, then try again.",
            friendlySendError("Add your Twilio or Signal details in Settings"),
        )
        assertEquals(
            "Ask a grown-up to add a phone number first.",
            friendlySendError("Sam does not have a phone number yet."),
        )
        assertEquals(
            "Couldn't send that. Try again in a moment.",
            friendlySendError("502 Bad Gateway"),
        )
        assertEquals(
            "Mom can't get Signal messages from Mantel yet. Ask a grown-up for help.",
            friendlySendError("UNREGISTERED_FAILURE: +15555550123", "Mom"),
        )
    }

    @Test
    fun clientSendsANoteAndReadsTheThread() = runBlocking {
        var sent = ""
        val client = MantelClient(
            MockEngine { request ->
                val path = request.url.encodedPath
                when {
                    path.endsWith("/api/messages/conversations") -> respond(LISTING, HttpStatusCode.OK, json)
                    path.endsWith("/api/messages/conversations/user-1") -> respond(THREAD, HttpStatusCode.OK, json)
                    path.endsWith("/api/messages") -> {
                        sent = (request.body as TextContent).text
                        respond(SENT, HttpStatusCode.Created, json)
                    }
                    path.endsWith("/api/messages/9/media") -> respond(
                        byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47),
                        HttpStatusCode.OK,
                        headersOf(HttpHeaders.ContentType, "image/png"),
                    )
                    else -> respond("""{"error":{"message":"missing"}}""", HttpStatusCode.NotFound, json)
                }
            },
            { "http://familycal.local:8080" },
            { "mantel_secret" },
        )
        val listing = client.conversations()
        assertTrue(listing.configured)
        assertEquals("+18777708804", listing.fromNumber)
        val thread = client.conversation("user-1")
        assertTrue(thread.canSend)
        assertEquals("Dad", thread.name)
        val message = client.sendMessage(1, "Hello", "data:image/png;base64,doodle")
        assertEquals("queued", message.status)
        assertTrue(sent.contains("\"user_id\":1"))
        assertTrue(sent.contains("Hello"))
        assertTrue(sent.contains("data:image/png;base64,doodle"))
        val media = client.messageMedia(9)
        assertEquals(4, media.size)
        client.close()
    }

    @Test
    fun messageMediaIdReadsTheApiPath() {
        assertEquals(8, messageMediaId("/api/messages/8/media"))
        assertNull(messageMediaId(null))
        assertEquals("Sent", messageStatusLabel("sent"))
        assertEquals("Sending", messageStatusLabel("queued"))
    }
}

private const val LISTING = """
{
  "configured": true,
  "from_number": "+18777708804",
  "quick_replies": ["Dinner's ready", "Call me"],
  "conversations": [
    {
      "id": "user-1",
      "user_id": 1,
      "name": "Dad",
      "phone": "+15555550123",
      "color": "#3b82f6",
      "avatar_emoji": null,
      "unknown": false,
      "can_send": true,
      "last_message": {
        "id": 1,
        "user_id": 1,
        "phone": "+15555550123",
        "direction": "in",
        "body": "On my way",
        "media_url": null,
        "media_content_type": null,
        "status": "received",
        "error_message": null,
        "created_at": "2026-11-22T22:00:00Z"
      }
    },
    {
      "id": "user-2",
      "user_id": 2,
      "name": "Sam",
      "phone": null,
      "color": "#f97316",
      "avatar_emoji": null,
      "unknown": false,
      "can_send": false,
      "last_message": null
    }
  ]
}
"""

private const val THREAD = """
{
  "id": "user-1",
  "user_id": 1,
  "name": "Dad",
  "phone": "+15555550123",
  "color": "#3b82f6",
  "avatar_emoji": null,
  "unknown": false,
  "can_send": true,
  "messages": []
}
"""

private const val SENT = """
{
  "id": 9,
  "user_id": 1,
  "phone": "+15555550123",
  "direction": "out",
  "body": "Hello",
  "media_url": "/api/messages/9/media",
  "media_content_type": "image/png",
  "status": "queued",
  "error_message": null,
  "created_at": "2026-11-22T22:05:00Z"
}
"""

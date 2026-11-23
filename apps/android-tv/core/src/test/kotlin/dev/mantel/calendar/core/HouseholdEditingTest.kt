package dev.mantel.calendar.core

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.*
import io.ktor.http.content.TextContent
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class HouseholdEditingTest {
    private val headers = headersOf(HttpHeaders.ContentType, "application/json")

    @Test
    fun editingAnItemOnlyPatchesItsTextAndKeepsItsCheckState() = runBlocking {
        val client = MantelClient(MockEngine { request ->
            assertEquals(HttpMethod.Patch, request.method)
            assertEquals("/api/lists/3/items/8", request.url.encodedPath)
            val body = Json.parseToJsonElement((request.body as TextContent).text).jsonObject
            assertEquals(setOf("text"), body.keys)
            assertEquals("Milk and eggs", body["text"]?.jsonPrimitive?.content)
            respond("""{"id":8,"list_id":3,"text":"Milk and eggs","checked":true}""", HttpStatusCode.OK, headers)
        }, { "http://localhost" }, { null })
        assertTrue(client.renameItem(3, 8, "Milk and eggs").checked)
        client.close()
    }

    @Test
    fun choreDefinitionPreservesAllAssigneesAndZeroPointWeeklySchedule() = runBlocking {
        val payload = """{"id":5,"title":"Dishes","notes":"Load dishwasher","points":0,"schedule":"weekly","weekdays":[0,3],"due_on":null,"requires_approval":false,"icon":null,"assignee_ids":[1,2]}"""
        val client = MantelClient(MockEngine { request ->
            assertEquals("/api/chores", request.url.encodedPath)
            respond("[$payload]", HttpStatusCode.OK, headers)
        }, { "http://localhost" }, { null })
        val chore = client.chores().single()
        assertEquals(listOf(1, 2), chore.assigneeIds)
        assertEquals(listOf(0, 3), chore.weekdays)
        assertEquals(0, chore.points)
        assertFalse(chore.requiresApproval)
        assertEquals("Load dishwasher", chore.notes)
        client.close()
    }

    @Test
    fun listDeletionAcceptsAnEmpty204Response() = runBlocking {
        val client = MantelClient(MockEngine { request ->
            assertEquals(HttpMethod.Delete, request.method)
            assertEquals("/api/lists/3", request.url.encodedPath)
            respond("", HttpStatusCode.NoContent)
        }, { "http://localhost" }, { null })
        client.deleteList(3)
        client.close()
    }
}

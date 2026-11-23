package dev.mantel.calendar.core

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class HomeAndTvPairingTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")
    private fun client(engine: MockEngine) =
        MantelClient(engine, { "http://10.0.15.178:8080" }, { "mantel_secret" })

    @Test
    fun aPhoneMintsACodeForTheTvWithItsOwnTokenAndItsOwnAddress() = runBlocking {
        var method: HttpMethod? = null
        var url = ""
        var auth: String? = null
        val c = client(
            MockEngine { request ->
                method = request.method
                url = request.url.toString()
                auth = request.headers[HttpHeaders.Authorization]
                respond(
                    """{"code":"K7NQ-4RMP","expires_at":"2026-11-21T23:40:00Z","qr_payload":"mantel://pair?v=1&base=x&code=K7NQ-4RMP","qr_svg":"<svg/>"}""",
                    HttpStatusCode.OK,
                    json,
                )
            },
        )
        val minted = c.createPairingCode("http://10.0.15.178:8080")
        assertEquals(HttpMethod.Post, method)
        assertTrue(url, url.startsWith("http://10.0.15.178:8080/api/auth/pairing-codes?base_url="))
        assertTrue(url, url.contains("http%3A%2F%2F10.0.15.178%3A8080"))
        assertEquals("Bearer mantel_secret", auth)
        assertEquals("K7NQ-4RMP", minted.code)
        assertTrue("what the TV types must be accepted by the pairing check", pairCodeComplete(minted.code))
        c.close()
    }

    @Test
    fun savingTheTokenSendsItOnceAndTheAddressAloneLeavesTheTokenAlone() = runBlocking {
        val bodies = mutableListOf<String>()
        val c = client(
            MockEngine { request ->
                assertEquals(HttpMethod.Patch, request.method)
                bodies += String(request.body.toByteArray())
                respond("""{"ha_base_url":"http://ha:8123","ha_token":"","server":{"ha_token_set":true}}""", HttpStatusCode.OK, json)
            },
        )
        c.saveHomeConnection(baseUrl = " http://ha:8123 ", token = "  abc.def ")
        c.saveHomeConnection(baseUrl = "http://ha:8123")
        c.saveHomeConnection(token = "")
        c.saveHomeConnection(clearToken = true)
        assertEquals("""{"ha_base_url":"http://ha:8123","ha_token":"abc.def"}""", bodies[0])
        assertEquals("""{"ha_base_url":"http://ha:8123"}""", bodies[1])
        assertEquals("a blank token must not wipe the saved one", "{}", bodies[2])
        assertEquals("""{"ha_token":null}""", bodies[3])
        c.close()
    }

    @Test
    fun theSetupReadBackNeverCarriesATokenOnlyWhetherOneIsSaved() = runBlocking {
        val c = client(
            MockEngine {
                respond("""{"theme":"airy","ha_base_url":"http://ha:8123","ha_token":"","server":{"ha_token_set":true,"version":"1"}}""", HttpStatusCode.OK, json)
            },
        )
        val setup = c.homeSetup()
        assertEquals("http://ha:8123", setup.haBaseUrl)
        assertTrue(setup.server.haTokenSet)
        assertFalse(HomeSetup::class.java.declaredFields.any { it.name.contains("token", true) && it.name != "server" })
        c.close()
    }

    @Test
    fun testConnectionSaysWhatHappened() = runBlocking {
        val c = client(
            MockEngine {
                respond("""{"ok":false,"status":"invalid_token","message":"Home Assistant rejected the access token."}""", HttpStatusCode.OK, json)
            },
        )
        val result = c.testHome()
        assertFalse(result.ok)
        assertEquals("invalid_token", result.status)
        assertTrue(result.message.contains("rejected"))
        c.close()
    }

    @Test
    fun homeReadsRoomsAndScenes() = runBlocking {
        val c = client(
            MockEngine {
                respond(
                    """{"status":"ok","message":"","rooms":[{"area_id":"den","name":"Den","entities":[
                        {"entity_id":"light.lamp","domain":"light","name":"Lamp","state":"on","available":true,"on":true,"level":50,"adjustable":true,"attrs":{}},
                        {"entity_id":"lock.front","domain":"lock","name":"Front Door","state":"locked","available":true,"on":false,"level":null,"adjustable":false,"attrs":{}}
                    ]}],"actions":[{"entity_id":"scene.movie","domain":"scene","name":"Movie Night","state":"scening","available":true,"on":null,"level":null,"adjustable":false,"attrs":{}}]}""",
                    HttpStatusCode.OK,
                    json,
                )
            },
        )
        val home = c.home()
        assertEquals("Den", home.rooms.single().name)
        val lamp = home.rooms.single().entities.first()
        assertEquals(50, lamp.level)
        assertTrue(lamp.adjustable)
        assertNull(home.rooms.single().entities.last().level)
        assertEquals("scene.movie", home.actions.single().entityId)
        c.close()
    }

    @Test
    fun anActionIsSentWithItsLevelAndLocksAreSentConfirmedOnlyWhenAsked() = runBlocking {
        val seen = mutableListOf<Pair<String, String>>()
        val c = client(
            MockEngine { request ->
                seen += request.url.encodedPath to String(request.body.toByteArray())
                respond("""{"ok":true}""", HttpStatusCode.OK, json)
            },
        )
        c.homeAction("light.lamp", "set_level", 40)
        c.homeAction("lock.front", "unlock", confirm = true)
        assertEquals("/api/home/entities/light.lamp/action" to """{"action":"set_level","value":40,"confirm":false}""", seen[0])
        assertEquals("/api/home/entities/lock.front/action" to """{"action":"unlock","confirm":true}""", seen[1])
        c.close()
    }

    @Test
    fun aRefusalComesBackAsAMantelException() = runBlocking {
        val c = client(
            MockEngine {
                respond("""{"error":{"code":"confirmation_required","message":"Confirm before you unlock this."}}""", HttpStatusCode.BadRequest, json)
            },
        )
        try {
            c.homeAction("lock.front", "unlock")
            fail("expected the refusal")
        } catch (e: MantelException) {
            assertEquals("confirmation_required", e.code)
            assertEquals(400, e.status)
        }
        c.close()
    }
}

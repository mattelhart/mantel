package dev.mantel.calendar.core

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

/** The address a screen should call. A bare IP gets port 8080, the server's default. */
fun normalizeServer(raw: String): String? {
    var text = raw.trim()
    if (text.isEmpty()) return null
    if (!text.contains("://")) text = "http://$text"
    val uri = try {
        URI(text)
    } catch (_: Exception) {
        return null
    }
    val scheme = uri.scheme?.lowercase() ?: return null
    if (scheme != "http" && scheme != "https") return null
    if (!uri.userInfo.isNullOrEmpty()) return null
    val host = uri.host ?: return null
    if (host.isBlank()) return null
    val port = when {
        uri.port != -1 -> uri.port
        scheme == "http" -> 8080
        else -> -1
    }
    val portPart = if (port == -1) "" else ":$port"
    val shown = if (host.contains(":")) "[$host]" else host
    return "$scheme://$shown$portPart"
}

const val FAMILYCAL_ORIGIN = "http://familycal.local:8080"

/** How long a missing familycal.local may stall launch before the address box. */
const val DISCOVERY_TIMEOUT_MS = 2_000L

/** A saved address is worth waiting for. Wi-Fi on a TV is often late to the first packet. */
const val SAVED_PROBE_TIMEOUT_MS = 3_000L

const val SAVED_PROBE_ATTEMPTS = 2

/** Gap between the two tries of the same saved address. */
const val PROBE_BACKOFF_MS = 500L

/** Connect, after someone typed an address, can wait a little longer than discovery. */
const val CONNECT_TIMEOUT_MS = 4_000L

data class ProbeStep(
    val origin: String,
    val timeoutMs: Long,
    val saved: Boolean,
)

/**
 * Launch order. The last address that worked is tried first, twice. familycal.local
 * is one short guess after that, and it is not added again when it is already the
 * saved address. A missing name should open the address box, not sit on a spinner.
 */
fun probeSchedule(saved: String?): List<ProbeStep> {
    val normalized = saved?.let(::normalizeServer)
    val steps = mutableListOf<ProbeStep>()
    if (normalized != null) {
        repeat(SAVED_PROBE_ATTEMPTS) {
            steps += ProbeStep(normalized, SAVED_PROBE_TIMEOUT_MS, saved = true)
        }
    }
    if (normalized != FAMILYCAL_ORIGIN) {
        steps += ProbeStep(FAMILYCAL_ORIGIN, DISCOVERY_TIMEOUT_MS, saved = false)
    }
    return steps
}

/** What the first launch tries, before anyone types an address. */
fun discoveryCandidates(saved: String?): List<String> =
    probeSchedule(saved).map { it.origin }.distinct()

/**
 * Walk [steps] until a probe succeeds. The pause runs only between two tries of
 * the same address, so a dead familycal.local is not asked to wait out the saved
 * address's backoff.
 */
suspend fun firstReachable(
    steps: List<ProbeStep>,
    probe: suspend (origin: String, timeoutMs: Long) -> Boolean,
    pause: suspend (millis: Long) -> Unit = {},
    allow: (String) -> Boolean = { true },
): String? {
    var previous: String? = null
    for (step in steps) {
        if (!allow(step.origin)) continue
        if (previous == step.origin) pause(PROBE_BACKOFF_MS)
        previous = step.origin
        if (probe(step.origin, step.timeoutMs)) return step.origin
    }
    return null
}

/** The address box after discovery misses. Empty when nothing usable was saved. */
fun savedAddressPrefill(saved: String?): String = saved?.let(::normalizeServer).orEmpty()

fun discoveryMissMessage(saved: String?): String =
    if (savedAddressPrefill(saved).isEmpty()) {
        "Couldn't find familycal.local. Enter the calendar server's address."
    } else {
        "Couldn't reach the saved calendar server. The last address is filled in below."
    }

fun unreachableMessage(origin: String): String =
    "Can't reach $origin. Check that the calendar server is running, and that this device is on the same network or a VPN."

/**
 * An empty box or an IP is easier from a TV remote's number keys. A hostname
 * needs letters, so the address screen can offer a full keyboard instead.
 */
fun prefersNumericKeypad(raw: String): Boolean {
    val text = raw.trim()
        .removePrefix("https://")
        .removePrefix("http://")
        .substringBefore('/')
        .substringBefore('?')
    if (text.isEmpty()) return true
    return text.all { it.isDigit() || it == '.' || it == ':' || it == '[' || it == ']' }
}

fun pairingFailureMessage(status: Int, serverMessage: String?): String {
    val text = serverMessage?.trim().orEmpty()
    return when (status) {
        401 -> when {
            text.contains("expired", ignoreCase = true) || text.contains("wrong", ignoreCase = true) -> text
            else -> "That pairing code has expired or was already used. On the wall, open Settings → Devices and show a new code."
        }
        429 -> text.ifEmpty { "Too many pairing attempts. Wait a few minutes and try again." }
        0 -> text.ifEmpty { unreachableMessage("the calendar server") }
        else -> text.ifEmpty { "Could not pair with the calendar server." }
    }
}

fun revokedDeviceMessage(): String =
    "This device is no longer paired. On the wall, open Settings → Devices and pair it again."

sealed class ServerProbe {
    data object Up : ServerProbe()
    data object Down : ServerProbe()
    data class Unhealthy(val status: Int) : ServerProbe()

    fun failureMessage(origin: String): String? = when (this) {
        Up -> null
        Down -> unreachableMessage(origin)
        is Unhealthy -> "The calendar server at $origin answered, but it is not ready (HTTP $status)."
    }
}

/**
 * Mantel is a LAN server. Cleartext is fine on a private address, on
 * Tailscale's 100.64.0.0/10 range, and on a name such as familycal.local or a
 * MagicDNS hostname. A public IP over HTTP is the port-forward case, and we
 * refuse it. HTTPS is allowed anywhere.
 */
fun cleartextPermitted(origin: String): Boolean {
    val normalized = normalizeServer(origin) ?: return false
    val uri = URI(normalized)
    if (uri.scheme.equals("https", ignoreCase = true)) return true
    val host = uri.host ?: return false
    return cleartextHost(host)
}

fun cleartextHost(host: String): Boolean {
    val bare = host.trim().trim('[', ']').lowercase()
    if (bare.isEmpty()) return false
    if (bare == "localhost" || bare.endsWith(".local") || bare.endsWith(".local.")) return true
    if (bare.contains(':')) return ipv6Cleartext(bare)
    val parts = bare.split('.')
    if (parts.size != 4) return true
    val nums = parts.map { it.toIntOrNull() ?: return true }
    if (nums.any { it !in 0..255 }) return true
    val a = nums[0]
    val b = nums[1]
    if (a == 10 || a == 127 || a == 0) return true
    if (a == 169 && b == 254) return true
    if (a == 192 && b == 168) return true
    if (a == 172 && b in 16..31) return true
    // Tailscale and other CGNAT: 100.64.0.0/10.
    if (a == 100 && b in 64..127) return true
    return false
}

private fun ipv6Cleartext(host: String): Boolean {
    if (host == "::1" || host == "0:0:0:0:0:0:0:1") return true
    if (host.startsWith("fc") || host.startsWith("fd")) return true
    return host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")
}

/** The alphabet on the wall. 0/O and 1/I are left out so a code can be read across the room. */
const val PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

data class PairingLink(val base: String, val code: String)

fun normalizePairCode(raw: String): String = raw.uppercase().filter { it.isLetterOrDigit() }

fun pairCodeComplete(raw: String): Boolean {
    val code = normalizePairCode(raw)
    return code.length == 8 && code.all { it in PAIR_ALPHABET }
}

/** `mantel://pair?v=1&base=…&code=K7NQ-4RMP` from the wall's pairing QR. */
fun parsePairingLink(raw: String): PairingLink? {
    val text = raw.trim()
    if (!text.startsWith("mantel:", ignoreCase = true)) return null
    val uri = try {
        URI(text)
    } catch (_: Exception) {
        return null
    }
    if (!uri.scheme.equals("mantel", ignoreCase = true)) return null
    if (!uri.host.equals("pair", ignoreCase = true)) return null
    val params = queryParams(uri.rawQuery ?: return null)
    val base = normalizeServer(params["base"] ?: return null) ?: return null
    val code = normalizePairCode(params["code"] ?: return null)
    if (!pairCodeComplete(code)) return null
    return PairingLink(base, code)
}

private fun queryParams(raw: String): Map<String, String> =
    raw.split('&').mapNotNull { part ->
        val split = part.indexOf('=')
        if (split <= 0) null
        else {
            val key = URLDecoder.decode(part.substring(0, split), StandardCharsets.UTF_8)
            val value = URLDecoder.decode(part.substring(split + 1), StandardCharsets.UTF_8)
            key to value
        }
    }.toMap()

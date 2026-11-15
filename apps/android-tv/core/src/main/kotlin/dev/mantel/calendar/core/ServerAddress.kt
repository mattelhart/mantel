package dev.mantel.calendar.core

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

/** The address the TV should call. A bare IP gets the port the Pi uses. */
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

/** What the first launch tries, before anyone types an address. */
fun discoveryCandidates(saved: String?): List<String> {
    val out = LinkedHashSet<String>()
    saved?.let { normalizeServer(it)?.let(out::add) }
    out.add(FAMILYCAL_ORIGIN)
    return out.toList()
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

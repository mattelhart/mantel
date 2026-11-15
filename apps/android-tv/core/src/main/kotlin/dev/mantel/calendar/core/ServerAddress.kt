package dev.mantel.calendar.core

import java.net.URI

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

package dev.mantel.calendar.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

sealed class LiveMessage {
    data class Hello(val id: Long?) : LiveMessage()
    data class Change(val id: Long?, val topics: Set<String>) : LiveMessage()
    data class Resync(val id: Long?) : LiveMessage()
}

/** Frames arrive a line at a time. A blank line ends one. */
class SseParser {
    private val lines = mutableListOf<String>()

    fun reset() {
        lines.clear()
    }

    fun feed(line: String): List<LiveMessage> {
        if (line.isNotEmpty()) {
            lines += line
            return emptyList()
        }
        if (lines.isEmpty()) return emptyList()
        val message = parse(lines.toList())
        lines.clear()
        return listOfNotNull(message)
    }

    private fun parse(frame: List<String>): LiveMessage? {
        var id: Long? = null
        var event = "message"
        val data = StringBuilder()
        for (raw in frame) {
            if (raw.startsWith(":")) continue
            val split = raw.indexOf(':')
            val field = if (split == -1) raw else raw.substring(0, split)
            val value = if (split == -1) "" else raw.substring(split + 1).removePrefix(" ")
            when (field) {
                "id" -> id = value.toLongOrNull()
                "event" -> event = value
                "data" -> {
                    if (data.isNotEmpty()) data.append('\n')
                    data.append(value)
                }
            }
        }
        return when (event) {
            "hello" -> LiveMessage.Hello(id)
            "resync" -> LiveMessage.Resync(id)
            "change" -> LiveMessage.Change(id, topics(data.toString()))
            else -> null
        }
    }

    private fun topics(data: String): Set<String> = try {
        val array = Json.parseToJsonElement(data).jsonObject["topics"]?.jsonArray ?: return emptySet()
        array.map { it.jsonPrimitive.content }.toSet()
    } catch (_: Exception) {
        emptySet()
    }
}

/** 1s, 2s, 4s… capped, plus a short jitter so every screen does not reconnect together. */
fun reconnectDelayMs(attempt: Int, jitterMs: Long = 0): Long {
    val step = (attempt - 1).coerceAtLeast(0)
    val exp = (1000L shl step.coerceAtMost(15)).coerceAtMost(30_000L)
    return exp + jitterMs.coerceIn(0, 400)
}

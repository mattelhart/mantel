package dev.mantel.calendar.core

fun friendlySendError(raw: String?): String {
    val text = raw.orEmpty()
    return when {
        text.contains("phone number", ignoreCase = true) ->
            "Ask a grown-up to add a phone number first."
        text.contains("Twilio or Signal", ignoreCase = true) ||
            text.contains("not configured", ignoreCase = true) ||
            text.contains("Settings", ignoreCase = true) ->
            "Ask a grown-up to finish Messages settings, then try again."
        else -> "Couldn't send that. Try again in a moment."
    }
}

fun conversationPreview(item: Conversation): String {
    val last = item.lastMessage
    if (last != null) {
        val body = last.body?.trim().orEmpty()
        if (body.isNotEmpty()) return body
        if (!last.mediaUrl.isNullOrBlank()) {
            return if (last.direction == "out") "You sent a drawing" else "Sent a picture"
        }
    }
    if (item.phone.isNullOrBlank()) return "Ask a grown-up to add a phone number"
    return "No messages yet"
}

fun messageStatusLabel(status: String): String = when (status) {
    "queued", "accepted", "scheduled", "sending" -> "Sending"
    "sent" -> "Sent"
    "delivered" -> "Delivered"
    "read" -> "Read"
    "undelivered", "failed", "canceled" -> "Failed"
    else -> status
}

fun messageMediaId(url: String?): Int? {
    val match = Regex("""/messages/(\d+)/media""").find(url ?: return null) ?: return null
    return match.groupValues[1].toIntOrNull()
}

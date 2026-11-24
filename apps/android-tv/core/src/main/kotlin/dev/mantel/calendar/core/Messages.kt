package dev.mantel.calendar.core

fun friendlyFailureText(raw: String?, name: String? = null): String {
    val text = raw.orEmpty().trim()
    if (text.isEmpty()) return ""
    val lowered = text.lowercase()
    return when {
        lowered.contains("couldn't be sent as a picture") -> text
        lowered.contains("can't get signal messages from") -> text
        lowered.contains("unregistered") ||
            lowered.contains("isn't registered") ||
            lowered.contains("not registered") -> {
            val who = name?.trim().orEmpty().ifEmpty { "They" }
            "$who can't get Signal messages from Homie yet. Ask a grown-up for help."
        }
        lowered.contains("phone number") ->
            "Ask a grown-up to add a phone number first."
        lowered.contains("ask a grown-up to finish messages settings") -> text
        lowered.contains("twilio or signal") ||
            lowered.contains("not configured") ||
            lowered.contains("settings") ->
            "Ask a grown-up to finish Messages settings, then try again."
        else -> "Couldn't send that. Try again in a moment."
    }
}

fun friendlySendError(raw: String?, name: String? = null): String {
    val mapped = friendlyFailureText(raw, name)
    return mapped.ifEmpty { "Couldn't send that. Try again in a moment." }
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
    "unconfirmed" -> "Delivery unconfirmed"
    "undelivered", "failed", "canceled" -> "Failed"
    else -> status
}

fun messageMediaId(url: String?): Int? {
    val match = Regex("""/messages/(\d+)/media""").find(url ?: return null) ?: return null
    return match.groupValues[1].toIntOrNull()
}

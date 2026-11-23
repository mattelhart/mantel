package dev.mantel.calendar.phone.ui

import java.time.Instant

/** Whole minutes left on a pairing code, never below zero, or null when the timestamp can't be read. */
internal fun minutesLeft(expiresAt: String, now: Instant = Instant.now()): Long? {
    val end = runCatching { Instant.parse(expiresAt) }.getOrNull() ?: return null
    val seconds = end.epochSecond - now.epochSecond
    return if (seconds <= 0) 0 else (seconds + 59) / 60
}

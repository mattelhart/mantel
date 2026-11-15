package dev.mantel.calendar.core

import java.time.LocalDate

enum class RepeatFreq { NONE, DAILY, WEEKLY, MONTHLY, YEARLY }

data class RepeatChoice(
    val freq: RepeatFreq = RepeatFreq.NONE,
    val byday: List<String> = emptyList(),
    val until: String = "",
)

/** Sunday first, matching the wall's recurrence picker. */
val WEEKDAY_CODES = listOf("SU", "MO", "TU", "WE", "TH", "FR", "SA")

fun weekdayCode(day: LocalDate): String = WEEKDAY_CODES[day.dayOfWeek.value % 7]

fun parseRepeat(rule: String?): RepeatChoice {
    if (rule.isNullOrBlank()) return RepeatChoice()
    val parts = rule.split(';').mapNotNull { piece ->
        val split = piece.indexOf('=')
        if (split <= 0) null else piece.substring(0, split).uppercase() to piece.substring(split + 1)
    }.toMap()
    val freq = when (parts["FREQ"]?.uppercase()) {
        "DAILY" -> RepeatFreq.DAILY
        "WEEKLY" -> RepeatFreq.WEEKLY
        "MONTHLY" -> RepeatFreq.MONTHLY
        "YEARLY" -> RepeatFreq.YEARLY
        else -> RepeatFreq.NONE
    }
    val rawUntil = parts["UNTIL"].orEmpty()
    val until = if (rawUntil.length >= 8 && rawUntil[0].isDigit()) {
        "${rawUntil.substring(0, 4)}-${rawUntil.substring(4, 6)}-${rawUntil.substring(6, 8)}"
    } else {
        ""
    }
    val byday = parts["BYDAY"].orEmpty().split(',').map { it.trim().uppercase() }.filter { it in WEEKDAY_CODES }
    return RepeatChoice(freq, byday, until)
}

/** Null means the event does not repeat. The wall stores the same shape. */
fun buildRepeat(choice: RepeatChoice): String? {
    if (choice.freq == RepeatFreq.NONE) return null
    val parts = mutableListOf("FREQ=${choice.freq.name}")
    if (choice.freq == RepeatFreq.WEEKLY && choice.byday.isNotEmpty()) {
        val ordered = WEEKDAY_CODES.filter { it in choice.byday }
        parts += "BYDAY=${ordered.joinToString(",")}"
    }
    val until = choice.until.trim()
    if (until.length >= 10 && until[4] == '-' && until[7] == '-') {
        parts += "UNTIL=${until.substring(0, 10).replace("-", "")}T235959"
    }
    return parts.joinToString(";")
}

/**
 * How an edit is allowed to land.
 *
 * A series this server expands carries its RRULE on every drawn occurrence, and
 * saving changes the whole series. Google expands the series itself, so one
 * occurrence arrives with `recurring` and no rule, and a save touches only that
 * row. Moving that row to another calendar is refused by the server.
 */
enum class EventEditKind { Create, Single, Series, Occurrence, ReadOnly }

fun eventEditKind(event: CalEvent?): EventEditKind {
    if (event == null) return EventEditKind.Create
    if (!event.editable) return EventEditKind.ReadOnly
    if (!event.recurrenceRule.isNullOrBlank()) return EventEditKind.Series
    if (event.recurring) return EventEditKind.Occurrence
    return EventEditKind.Single
}

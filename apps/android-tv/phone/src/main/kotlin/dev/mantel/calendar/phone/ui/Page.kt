package dev.mantel.calendar.phone.ui

import dev.mantel.calendar.core.CalEvent
import java.time.LocalDate

sealed interface Page {
    data class Event(val event: CalEvent) : Page
    data class Edit(val event: CalEvent?, val day: LocalDate) : Page
    data class ListDetail(val id: Int) : Page
    data object Rewards : Page
    data object Settings : Page
}

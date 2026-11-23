package dev.mantel.calendar.tv.dream

import android.content.res.Configuration
import android.graphics.Color
import android.service.dreams.DreamService
import android.widget.LinearLayout
import android.widget.TextView
import dev.mantel.calendar.core.FAMILYCAL_ORIGIN
import dev.mantel.calendar.core.MantelClient
import dev.mantel.calendar.core.dayLabel
import dev.mantel.calendar.core.eventsOn
import dev.mantel.calendar.core.formatWhen
import dev.mantel.calendar.core.todayIn
import dev.mantel.calendar.core.zoneOrUtc
import dev.mantel.calendar.device.SecureTokenStore
import io.ktor.client.engine.cio.CIO
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** Today's agenda on the TV's screensaver. Turn it on in the device's screensaver settings. */
class AgendaDreamService : DreamService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var ink: Int = Color.parseColor("#1C2430")

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        isInteractive = false
        isFullscreen = true
        isScreenBright = false
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val night = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK ==
                Configuration.UI_MODE_NIGHT_YES
            setBackgroundColor(if (night) Color.parseColor("#1A1613") else Color.parseColor("#FFFFFF"))
            ink = if (night) Color.parseColor("#F6EFE6") else Color.parseColor("#1C2430")
            setPadding(80, 64, 80, 64)
        }
        val title = text("Today", 42f)
        root.addView(title)
        setContentView(root)
        scope.launch {
            val saved = SecureTokenStore(this@AgendaDreamService).read()
            val origin = saved.origin ?: FAMILYCAL_ORIGIN
            val client = MantelClient(CIO.create(), { origin }, { saved.token })
            try {
                if (!client.reachable(origin)) {
                    root.addView(text("Can't reach the calendar server", 24f))
                    return@launch
                }
                val settings = client.settings()
                val zone = zoneOrUtc(settings.homeTimezone)
                val today = todayIn(zone)
                title.text = dayLabel(today)
                val (start, end) = dev.mantel.calendar.core.fetchInstants(today, today.plusDays(1), zone)
                val events = eventsOn(client.events(start.toString(), end.toString()), today, zone)
                if (events.isEmpty()) root.addView(text("Nothing on today", 28f))
                events.take(8).forEach { event ->
                    root.addView(text("${event.title}   ${formatWhen(event, zone, settings.timeFormat24h)}", 28f))
                }
            } catch (_: Exception) {
                root.addView(text("Can't reach the calendar server", 24f))
            } finally {
                client.close()
            }
        }
    }

    override fun onDetachedFromWindow() {
        scope.cancel()
        super.onDetachedFromWindow()
    }

    private fun text(value: String, size: Float) = TextView(this).apply {
        text = value
        textSize = size
        setTextColor(ink)
        setPadding(0, 12, 0, 12)
    }
}

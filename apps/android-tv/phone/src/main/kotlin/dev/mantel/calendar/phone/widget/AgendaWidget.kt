package dev.mantel.calendar.phone.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import dev.mantel.calendar.core.FileSnapshotStore
import dev.mantel.calendar.core.ScreenCacheStore
import dev.mantel.calendar.core.dayLabel
import dev.mantel.calendar.core.syncedLabel
import dev.mantel.calendar.core.todayIn
import dev.mantel.calendar.core.zoneOrUtc
import dev.mantel.calendar.phone.AgendaLine
import dev.mantel.calendar.phone.CACHE_DIR
import dev.mantel.calendar.phone.MainActivity
import dev.mantel.calendar.phone.R
import dev.mantel.calendar.phone.agendaLines
import java.io.File

class AgendaWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        val views = render(context)
        appWidgetIds.forEach { appWidgetManager.updateAppWidget(it, views) }
    }

    companion object {
        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, AgendaWidget::class.java))
            if (ids.isEmpty()) return
            manager.updateAppWidget(ids, render(context))
        }

        private fun render(context: Context): RemoteViews {
            val cache = ScreenCacheStore(FileSnapshotStore(File(context.filesDir, CACHE_DIR))).load()
            val views = RemoteViews(context.packageName, R.layout.widget_agenda)
            if (cache == null) {
                views.setTextViewText(R.id.widget_title, "Today")
                views.setTextViewText(R.id.widget_status, "Not synced yet")
                views.setTextViewText(R.id.widget_body, "Open Homie to sync")
            } else {
                val zone = zoneOrUtc(cache.settings.homeTimezone)
                val day = todayIn(zone)
                val lines = agendaLines(cache.events, day, zone, cache.settings.timeFormat24h, limit = 6)
                views.setTextViewText(R.id.widget_title, dayLabel(day))
                views.setTextViewText(R.id.widget_status, syncedLabel(cache.savedAt, zone))
                views.setTextViewText(R.id.widget_body, body(lines))
            }
            val intent = Intent(context, MainActivity::class.java)
            val pending = PendingIntent.getActivity(
                context,
                0,
                intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            views.setOnClickPendingIntent(R.id.widget_root, pending)
            return views
        }

        private fun body(lines: List<AgendaLine>): String =
            if (lines.isEmpty()) "Nothing on today."
            else lines.joinToString("\n") { line -> "${line.whenText}  ${line.title}" }
    }
}

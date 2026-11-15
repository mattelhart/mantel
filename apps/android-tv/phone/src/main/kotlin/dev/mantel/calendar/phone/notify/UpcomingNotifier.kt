package dev.mantel.calendar.phone.notify

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import dev.mantel.calendar.core.CalEvent
import dev.mantel.calendar.core.formatWhen
import dev.mantel.calendar.phone.MainActivity
import dev.mantel.calendar.phone.R
import dev.mantel.calendar.phone.dueForReminder
import dev.mantel.calendar.phone.reminderKey
import java.time.Instant
import java.time.ZoneId

object UpcomingNotifier {
    private const val CHANNEL = "upcoming"
    private const val PREFS = "mantel_phone_notified"

    fun consider(
        context: Context,
        events: List<CalEvent>,
        zone: ZoneId,
        use24h: Boolean,
        now: Instant = Instant.now(),
    ) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val manager = NotificationManagerCompat.from(context)
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = android.app.NotificationChannel(
                CHANNEL,
                "Upcoming events",
                android.app.NotificationManager.IMPORTANCE_DEFAULT,
            )
            channel.description = "A reminder when something on the calendar is about to start."
            manager.createNotificationChannel(channel)
        }
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        for (event in events) {
            if (!dueForReminder(event, now)) continue
            val key = reminderKey(event)
            if (prefs.getBoolean(key, false)) continue
            val open = PendingIntent.getActivity(
                context,
                key.hashCode(),
                Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val notification = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_calendar)
                .setContentTitle(event.title)
                .setContentText(formatWhen(event, zone, use24h))
                .setAutoCancel(true)
                .setContentIntent(open)
                .build()
            runCatching { manager.notify(key.hashCode(), notification) }
            prefs.edit().putBoolean(key, true).apply()
        }
    }
}

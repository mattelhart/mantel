package dev.mantel.calendar.phone.notify

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import dev.mantel.calendar.core.FAMILYCAL_ORIGIN
import dev.mantel.calendar.core.FileSnapshotStore
import dev.mantel.calendar.core.MantelClient
import dev.mantel.calendar.core.ScreenCacheStore
import dev.mantel.calendar.core.fetchInstants
import dev.mantel.calendar.core.todayIn
import dev.mantel.calendar.core.zoneOrUtc
import dev.mantel.calendar.device.SecureTokenStore
import dev.mantel.calendar.phone.CACHE_DIR
import dev.mantel.calendar.phone.STORE_ALIAS
import dev.mantel.calendar.phone.STORE_NAME
import io.ktor.client.engine.cio.CIO
import java.io.File

/** Looks ahead while the app is closed. The stream is faster when the app is open. */
class UpcomingWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val saved = SecureTokenStore(applicationContext, STORE_NAME, STORE_ALIAS).read()
        val origin = saved.origin
        if (origin.isNullOrBlank()) {
            notifyFromCache()
            return Result.success()
        }
        val client = MantelClient(CIO.create(), { origin.ifBlank { FAMILYCAL_ORIGIN } }, { saved.token })
        try {
            val settings = client.settings()
            val zone = zoneOrUtc(settings.homeTimezone)
            val today = todayIn(zone)
            val (start, end) = fetchInstants(today, today.plusDays(2), zone)
            val events = client.events(start.toString(), end.toString())
            UpcomingNotifier.consider(applicationContext, events, zone, settings.timeFormat24h)
        } catch (_: Exception) {
            notifyFromCache()
        } finally {
            client.close()
        }
        return Result.success()
    }

    private fun notifyFromCache() {
        val cache = ScreenCacheStore(FileSnapshotStore(File(applicationContext.filesDir, CACHE_DIR))).load() ?: return
        val zone = zoneOrUtc(cache.settings.homeTimezone)
        UpcomingNotifier.consider(applicationContext, cache.events, zone, cache.settings.timeFormat24h)
    }
}

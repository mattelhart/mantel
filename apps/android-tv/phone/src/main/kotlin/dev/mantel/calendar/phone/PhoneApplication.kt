package dev.mantel.calendar.phone

import android.app.Application
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import dev.mantel.calendar.phone.notify.UpcomingWorker
import java.util.concurrent.TimeUnit

class PhoneApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        val request = PeriodicWorkRequestBuilder<UpcomingWorker>(30, TimeUnit.MINUTES).build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "mantel-upcoming",
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }
}

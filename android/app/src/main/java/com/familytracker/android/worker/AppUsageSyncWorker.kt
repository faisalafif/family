package com.familytracker.android.worker

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.familytracker.android.data.AppUsageCollector
import com.familytracker.android.data.AppUsageRecord
import com.familytracker.android.data.DevicePreferences
import com.familytracker.android.data.FunctionsRepository
import com.familytracker.android.data.LocalDatabase
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

object AppUsageSync {
    private const val PERIODIC_WORK = "collect-app-usage-daily"
    private const val IMMEDIATE_WORK = "sync-app-usage-now"

    fun schedule(context: Context) {
        val manager = WorkManager.getInstance(context.applicationContext)
        manager.enqueueUniquePeriodicWork(
            PERIODIC_WORK,
            ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<AppUsageSyncWorker>(6, TimeUnit.HOURS).build()
        )
        requestNow(context)
    }

    fun requestNow(context: Context) {
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            IMMEDIATE_WORK,
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<AppUsageSyncWorker>().build()
        )
    }
}

class AppUsageSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext
        val preferences = DevicePreferences(app)
        val token = preferences.trackingToken ?: return Result.success()
        val memberId = preferences.memberId ?: return Result.success()
        val deviceId = preferences.deviceId
        val enabled = preferences.appUsageEnabled
        val accessGranted = AppUsageCollector.hasUsageAccess(app)
        val snapshot = if (enabled && accessGranted) AppUsageCollector.collect(app, memberId, deviceId) else null
        val dao = LocalDatabase.get(app).appUsageDao()

        if (snapshot != null) {
            snapshot.records.forEach { fresh ->
                val old = dao.find(deviceId, fresh.usageDate, fresh.packageName)
                val unchanged = old != null && old.usageMs == fresh.usageMs && old.appName == fresh.appName && old.lastUsedAt == fresh.lastUsedAt
                dao.upsert(fresh.copy(syncedAt = if (unchanged) old?.syncedAt else null))
            }
        }
        dao.deleteBefore(localDate(daysAgo = 30))

        val pending = if (enabled && accessGranted) dao.pending(deviceId) else emptyList()
        val statusTime = snapshot?.collectedAt ?: isoTimestamp(System.currentTimeMillis())
        return try {
            FunctionsRepository().syncAppUsage(
                trackingToken = token,
                memberId = memberId,
                deviceId = deviceId,
                collectionEnabled = enabled,
                usageAccessGranted = accessGranted,
                collectionIncomplete = snapshot?.incomplete == true,
                collectedAt = statusTime,
                records = pending
            )
            val syncedAt = isoTimestamp(System.currentTimeMillis())
            pending.forEach { dao.markSynced(it.eventId, syncedAt) }
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    private fun localDate(daysAgo: Int): String = Calendar.getInstance().apply {
        add(Calendar.DAY_OF_YEAR, -daysAgo)
    }.let { SimpleDateFormat("yyyy-MM-dd", Locale.US).format(it.time) }

    private fun isoTimestamp(timeMillis: Long): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }.format(Date(timeMillis))
}

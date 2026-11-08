package com.familytracker.android.worker

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.familytracker.android.data.AppUsageCollector
import com.familytracker.android.data.DevicePreferences
import com.familytracker.android.data.FunctionsRepository
import com.familytracker.android.data.LocalDatabase
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

object AppUsageSync {
    private const val MAX_ROWS_PER_BATCH = 500
    private const val PERIODIC_WORK = "collect-app-usage-daily"
    private const val IMMEDIATE_WORK = "sync-app-usage-now"
    private val syncMutex = Mutex()

    fun schedule(context: Context) {
        val manager = WorkManager.getInstance(context.applicationContext)
        manager.enqueueUniquePeriodicWork(
            PERIODIC_WORK,
            ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<AppUsageSyncWorker>(15, TimeUnit.MINUTES).build()
        )
        requestNow(context)
    }

    fun requestNow(context: Context) {
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            IMMEDIATE_WORK,
            ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<AppUsageSyncWorker>().build()
        )
    }

    /** Direct sync for the running foreground service; avoids waiting for JobScheduler. */
    suspend fun syncNow(context: Context): ListenableWorker.Result = syncMutex.withLock {
        syncAppUsage(context.applicationContext)
    }

    private suspend fun syncAppUsage(app: Context): ListenableWorker.Result {
        val preferences = DevicePreferences(app)
        val token = preferences.trackingToken ?: run {
            preferences.appUsageSyncError = "Perangkat belum ditautkan ke anggota keluarga."
            return ListenableWorker.Result.failure()
        }
        val memberId = preferences.memberId ?: run {
            preferences.appUsageSyncError = "ID anggota belum tersimpan. Tautkan ulang perangkat."
            return ListenableWorker.Result.failure()
        }
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
            snapshot.sessions.forEach { fresh ->
                val old = dao.findSession(fresh.sessionId)
                val unchanged = old != null && old.durationMs == fresh.durationMs && old.endedAt == fresh.endedAt && old.isActive == fresh.isActive && old.appName == fresh.appName
                dao.upsertSession(fresh.copy(syncedAt = if (unchanged) old?.syncedAt else null))
            }
        }
        dao.deleteBefore(localDate(daysAgo = 30))
        dao.deleteSessionsBefore(localDate(daysAgo = 30))

        val pending = if (enabled && accessGranted) dao.pending(deviceId) else emptyList()
        val pendingSessions = if (enabled && accessGranted) dao.pendingSessions(deviceId) else emptyList()
        val statusTime = snapshot?.collectedAt ?: isoTimestamp(System.currentTimeMillis())
        return try {
            val syncedAt = isoTimestamp(System.currentTimeMillis())
            val recordBatches = pending.chunked(MAX_ROWS_PER_BATCH)
            val sessionBatches = pendingSessions.chunked(MAX_ROWS_PER_BATCH)
            val batchCount = maxOf(recordBatches.size, sessionBatches.size, 1)
            var acceptedRecords = 0
            var acceptedSessions = 0
            var finalStatus = "TERKIRIM"
            val repository = FunctionsRepository()

            repeat(batchCount) { batchIndex ->
                val recordBatch = recordBatches.getOrElse(batchIndex) { emptyList() }
                val sessionBatch = sessionBatches.getOrElse(batchIndex) { emptyList() }
                val response = repository.syncAppUsage(
                    trackingToken = token,
                    memberId = memberId,
                    deviceId = deviceId,
                    collectionEnabled = enabled,
                    usageAccessGranted = accessGranted,
                    collectionIncomplete = snapshot?.incomplete == true,
                    collectedAt = statusTime,
                    records = recordBatch,
                    sessions = sessionBatch,
                    activeAppPackage = snapshot?.activeAppPackage,
                    activeAppName = snapshot?.activeAppName,
                    activeAppSince = snapshot?.activeAppSince
                )
                recordBatch.forEach { dao.markSynced(it.eventId, syncedAt) }
                sessionBatch.forEach { dao.markSessionSynced(it.sessionId, syncedAt) }
                acceptedRecords += response.optInt("accepted", recordBatch.size)
                acceptedSessions += response.optInt("acceptedSessions", sessionBatch.size)
                finalStatus = response.optString("status", finalStatus)
            }
            preferences.appUsageSyncAt = syncedAt
            preferences.appUsageSyncResult = "$finalStatus · $acceptedRecords aplikasi · $acceptedSessions sesi"
            preferences.appUsageSyncError = ""
            ListenableWorker.Result.success()
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            preferences.appUsageSyncError = error.message ?: "Sinkronisasi gagal."
            ListenableWorker.Result.retry()
        }
    }

    private fun localDate(daysAgo: Int): String = Calendar.getInstance().apply {
        add(Calendar.DAY_OF_YEAR, -daysAgo)
    }.let { SimpleDateFormat("yyyy-MM-dd", Locale.US).format(it.time) }

    private fun isoTimestamp(timeMillis: Long): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }.format(Date(timeMillis))
}

class AppUsageSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = AppUsageSync.syncNow(applicationContext)
}

package com.familytracker.android.worker

import android.content.Context
import android.net.VpnService
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.familytracker.android.data.DevicePreferences
import com.familytracker.android.data.FunctionsRepository
import com.familytracker.android.data.LocalDatabase
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

object DomainMonitorSync {
    private const val PERIODIC_WORK = "sync-domain-monitor"
    private const val IMMEDIATE_WORK = "sync-domain-monitor-now"
    private val networkConstraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun schedule(context: Context) {
        WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
            PERIODIC_WORK,
            ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<DomainMonitorSyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(networkConstraints)
                .build()
        )
    }

    fun requestNow(context: Context) {
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            IMMEDIATE_WORK,
            ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<DomainMonitorSyncWorker>().setConstraints(networkConstraints).build()
        )
    }
}

class DomainMonitorSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val prefs = DevicePreferences(applicationContext)
        val token = prefs.trackingToken ?: return Result.success()
        val memberId = prefs.memberId ?: return Result.success()
        val deviceId = prefs.deviceId
        val dao = LocalDatabase.get(applicationContext).domainObservationDao()
        val records = dao.pending(deviceId)
        return try {
            FunctionsRepository().syncDomains(
                trackingToken = token,
                memberId = memberId,
                deviceId = deviceId,
                monitoringEnabled = prefs.domainMonitorEnabled,
                vpnPermissionGranted = VpnService.prepare(applicationContext) == null,
                observedAt = isoTimestamp(System.currentTimeMillis()),
                records = records
            )
            val syncedAt = isoTimestamp(System.currentTimeMillis())
            records.forEach { dao.markSynced(it.deviceId, it.observationDate, it.domain, syncedAt) }
            dao.deleteBefore(localDate(30))
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    private fun localDate(daysAgo: Int) = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -daysAgo) }
        .let { SimpleDateFormat("yyyy-MM-dd", Locale.US).format(it.time) }

    private fun isoTimestamp(millis: Long) = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        .apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(millis))
}

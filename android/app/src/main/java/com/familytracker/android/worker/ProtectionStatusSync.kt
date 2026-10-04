package com.familytracker.android.worker

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.familytracker.android.data.AndroidDiagnostics
import com.familytracker.android.data.DevicePreferences
import com.familytracker.android.data.FunctionsRepository
import com.familytracker.android.data.LocalDatabase
import java.util.concurrent.TimeUnit

object ProtectionStatusSync {
    private const val UNIQUE_WORK_NAME = "sync-protection-pause"

    fun enqueue(context: Context) {
        val request = OneTimeWorkRequestBuilder<ProtectionStatusSyncWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniqueWork(UNIQUE_WORK_NAME, ExistingWorkPolicy.REPLACE, request)
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context.applicationContext).cancelUniqueWork(UNIQUE_WORK_NAME)
    }
}

class ProtectionStatusSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext
        val preferences = DevicePreferences(app)
        if (!preferences.protectionPauseSyncPending) return Result.success()
        if (preferences.protectionEnabled) {
            preferences.protectionPauseSyncPending = false
            return Result.success()
        }

        val token = preferences.trackingToken ?: return Result.retry()
        val memberId = preferences.memberId ?: return Result.retry()
        val queued = LocalDatabase.get(app).locationDao().count()
        return try {
            FunctionsRepository().confirmProtectionPause(
                token,
                memberId,
                preferences.deviceId,
                AndroidDiagnostics.snapshot(app, queued)
            )
            preferences.protectionPauseSyncPending = false
            preferences.lastStatus = "Perlindungan lokasi dijeda · status web tersinkron"
            Result.success()
        } catch (_: Exception) {
            preferences.lastStatus = "Perlindungan dijeda · status web menunggu jaringan"
            Result.retry()
        }
    }
}

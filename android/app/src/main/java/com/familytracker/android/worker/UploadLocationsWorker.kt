package com.familytracker.android.worker

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.familytracker.android.data.DevicePreferences
import com.familytracker.android.data.AndroidDiagnostics
import com.familytracker.android.data.FunctionsRepository
import com.familytracker.android.data.LocalDatabase

class UploadLocationsWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val preferences = DevicePreferences(applicationContext)
        val token = preferences.trackingToken ?: return Result.failure()
        val memberId = preferences.memberId ?: return Result.failure()
        val dao = LocalDatabase.get(applicationContext).locationDao()
        val repository = FunctionsRepository()
        return try {
            for (record in dao.oldest()) {
                if (record.memberId != memberId) throw IllegalStateException("Perangkat ditautkan ulang sebelum antrean lama terkirim.")
                val response = repository.upload(record, token, AndroidDiagnostics.snapshot(applicationContext, (dao.count() - 1).coerceAtLeast(0)))
                preferences.adminMessage = response.optString("adminMessage", "")
                preferences.adminMessageUpdatedAt = response.optString("adminMessageUpdatedAt").takeIf { it.isNotBlank() && it != "null" }
                preferences.adminMessageSyncError = ""
                dao.delete(record.id)
                preferences.lastUpdate = record.timestamp
                preferences.lastAccuracy = record.accuracy
                preferences.lastStatus = "Lokasi terkirim"
            }
            Result.success()
        } catch (_: Exception) {
            preferences.lastStatus = "Belum terkirim · akan dicoba lagi saat online"
            Result.retry()
        }
    }
}

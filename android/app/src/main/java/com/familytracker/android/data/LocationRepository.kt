package com.familytracker.android.data

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.familytracker.android.worker.UploadLocationsWorker
import com.google.android.gms.location.LocationResult
import java.time.Instant
import java.util.UUID

class LocationRepository(context: Context) {
    private val app = context.applicationContext
    private val dao = LocalDatabase.get(app).locationDao()

    suspend fun store(result: LocationResult, deviceId: String, memberId: String) {
        result.locations.forEach { loc ->
            dao.insert(PendingLocation(
                eventId = UUID.randomUUID().toString(), latitude = loc.latitude, longitude = loc.longitude, accuracy = loc.accuracy,
                altitude = if (loc.hasAltitude()) loc.altitude else null,
                speed = if (loc.hasSpeed()) loc.speed else null,
                bearing = if (loc.hasBearing()) loc.bearing else null,
                timestamp = Instant.ofEpochMilli(loc.time).toString(), deviceId = deviceId, memberId = memberId
            ))
        }
        val extra = dao.count() - 500
        if (extra > 0) dao.deleteOldest(extra)
        dao.latest()?.let { latest -> DevicePreferences(app).apply {
            lastUpdate = latest.timestamp; lastAccuracy = latest.accuracy; lastStatus = "Lokasi tersimpan · menunggu sinkronisasi"
        } }
        scheduleUpload()
    }

    fun scheduleUpload() {
        val work = OneTimeWorkRequestBuilder<UploadLocationsWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
        WorkManager.getInstance(app).enqueueUniqueWork("upload-pending-locations", ExistingWorkPolicy.KEEP, work)
    }
}

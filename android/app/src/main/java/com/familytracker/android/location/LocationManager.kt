package com.familytracker.android.location

import android.content.Context
import android.os.Looper
import com.google.android.gms.location.*

class LocationManager(context: Context) {
    private val client = LocationServices.getFusedLocationProviderClient(context)
    private val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, UPDATE_INTERVAL_MS)
        .setMinUpdateIntervalMillis(FASTEST_INTERVAL_MS)
        .setWaitForAccurateLocation(false)
        .build()

    fun start(callback: LocationCallback) {
        client.removeLocationUpdates(callback)
        client.requestLocationUpdates(request, callback, Looper.getMainLooper())
    }

    fun stop(callback: LocationCallback) { client.removeLocationUpdates(callback) }

    companion object {
        // Tunable policy point: future stationary/moving modes can adjust these values.
        const val UPDATE_INTERVAL_MS = 30_000L
        const val FASTEST_INTERVAL_MS = 15_000L
    }
}

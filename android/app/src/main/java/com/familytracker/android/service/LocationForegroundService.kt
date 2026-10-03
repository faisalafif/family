package com.familytracker.android.service

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager as SystemLocationManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.familytracker.android.MainActivity
import com.familytracker.android.data.DevicePreferences
import com.familytracker.android.data.LocationRepository
import com.familytracker.android.location.LocationManager
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class LocationForegroundService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var locationManager: LocationManager
    private lateinit var callback: LocationCallback
    private lateinit var preferences: DevicePreferences

    override fun onCreate() {
        super.onCreate()
        preferences = DevicePreferences(this)
        locationManager = LocationManager(this)
        callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                scope.launch {
                    val memberId = preferences.memberId ?: return@launch
                    LocationRepository(this@LocationForegroundService).store(result, preferences.deviceId, memberId)
                    preferences.lastStatus = "Perlindungan lokasi aktif · ${result.lastLocation?.accuracy?.toInt() ?: "?"} m"
                    updateNotification(preferences.lastStatus)
                }
            }
        }
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            preferences.protectionEnabled = false
            locationManager.stop(callback)
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        val memberId = preferences.memberId
        val permission = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val systemLocation = getSystemService(LOCATION_SERVICE) as SystemLocationManager
        val locationEnabled = if (Build.VERSION.SDK_INT >= 28) systemLocation.isLocationEnabled else
            systemLocation.isProviderEnabled(SystemLocationManager.GPS_PROVIDER) || systemLocation.isProviderEnabled(SystemLocationManager.NETWORK_PROVIDER)
        if (memberId == null || !permission || !locationEnabled) {
            preferences.lastStatus = if (!permission) "Izin lokasi belum diberikan" else if (!locationEnabled) "Layanan lokasi nonaktif" else "Perangkat belum ditautkan"
            preferences.protectionEnabled = false
            stopSelf()
            return START_NOT_STICKY
        }

        preferences.protectionEnabled = true
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification("Perlindungan lokasi aktif"),
            if (Build.VERSION.SDK_INT >= 29) android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0)
        try {
            locationManager.start(callback)
            preferences.lastStatus = "Menunggu pembaruan lokasi…"
        } catch (_: SecurityException) {
            preferences.lastStatus = "Izin lokasi dicabut · aktifkan lagi di aplikasi"
            preferences.protectionEnabled = false
            stopSelf()
        }
        return START_STICKY
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(CHANNEL_ID, "Perlindungan lokasi", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun notification(text: String): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val pause = PendingIntent.getService(this, 1, Intent(this, LocationForegroundService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Family Tracker")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(0, "Pause", pause)
            .build()
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(text))
    }

    override fun onDestroy() {
        if (::locationManager.isInitialized && ::callback.isInitialized) locationManager.stop(callback)
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_START = "com.familytracker.android.START_LOCATION"
        const val ACTION_STOP = "com.familytracker.android.STOP_LOCATION"
        private const val CHANNEL_ID = "location_protection"
        private const val NOTIFICATION_ID = 17
    }
}

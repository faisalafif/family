package com.familytracker.android.service

import android.app.ActivityManager
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import androidx.core.content.ContextCompat
import com.familytracker.android.data.DevicePreferences

class LocationRestartReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != ACTION_RESTART_LOCATION) return
        val preferences = DevicePreferences(context)
        if (!preferences.protectionEnabled || preferences.memberId == null || isLocationServiceRunning(context)) return
        ContextCompat.startForegroundService(
            context,
            Intent(context, LocationForegroundService::class.java).setAction(LocationForegroundService.ACTION_START)
        )
    }

    @Suppress("DEPRECATION")
    private fun isLocationServiceRunning(context: Context): Boolean =
        (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager)
            .getRunningServices(Int.MAX_VALUE)
            .any { it.service.className == LocationForegroundService::class.java.name }

    companion object {
        private const val ACTION_RESTART_LOCATION = "com.familytracker.android.RESTART_LOCATION_AFTER_TASK_REMOVED"

        fun schedule(context: Context) {
            val intent = Intent(context, LocationRestartReceiver::class.java).setAction(ACTION_RESTART_LOCATION)
            val pending = PendingIntent.getBroadcast(
                context,
                32,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            alarm.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + 3_000L, pending)
        }
    }
}

package com.familytracker.android.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.familytracker.android.data.DevicePreferences

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED || Build.VERSION.SDK_INT >= 34) return
        val prefs = DevicePreferences(context)
        if (!prefs.protectionEnabled || prefs.memberId == null) return
        if (Build.VERSION.SDK_INT >= 29 && ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) return
        runCatching {
            ContextCompat.startForegroundService(context, Intent(context, LocationForegroundService::class.java).setAction(LocationForegroundService.ACTION_START))
        }
    }
}

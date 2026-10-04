package com.familytracker.android.data

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.PowerManager
import androidx.core.content.ContextCompat
import org.json.JSONObject

object AndroidDiagnostics {
    fun snapshot(context: Context, queued: Int): JSONObject {
        val fineLocation = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarseLocation = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        @Suppress("DEPRECATION")
        val locationEnabled = if (Build.VERSION.SDK_INT >= 28) locationManager.isLocationEnabled
        else locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) || locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        @Suppress("DEPRECATION")
        val serviceRunning = (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager)
            .getRunningServices(Int.MAX_VALUE).any { it.service.className == "com.familytracker.android.service.LocationForegroundService" }
        val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = connectivity.activeNetwork?.let(connectivity::getNetworkCapabilities)
        val online = network?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true &&
            network.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val ignoresBatteryOptimization = Build.VERSION.SDK_INT < 23 || power.isIgnoringBatteryOptimizations(context.packageName)
        val batteryIntent: Intent? = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val batteryLevel = batteryIntent?.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val batteryScale = batteryIntent?.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1) ?: -1
        val batteryPercent = if (batteryLevel >= 0 && batteryScale > 0) batteryLevel * 100 / batteryScale else null

        return JSONObject()
            .put("location_permission", fineLocation || coarseLocation)
            .put("background_permission", Build.VERSION.SDK_INT < 29 || ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED)
            .put("foreground_service", serviceRunning)
            .put("protection_enabled", DevicePreferences(context).protectionEnabled)
            .put("location_services", locationEnabled)
            .put("network_online", online)
            .put("battery_optimization_exempt", ignoresBatteryOptimization)
            .put("battery_percent", batteryPercent ?: JSONObject.NULL)
            .put("queued_uploads", queued.coerceIn(0, 500))
    }
}

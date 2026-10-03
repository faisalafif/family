package com.familytracker.android.data

import android.content.Context
import android.content.SharedPreferences
import java.util.UUID

class DevicePreferences(context: Context) {
    private val prefs = context.getSharedPreferences("device_setup", Context.MODE_PRIVATE)
    fun addListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) = prefs.registerOnSharedPreferenceChangeListener(listener)
    fun removeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) = prefs.unregisterOnSharedPreferenceChangeListener(listener)
    val deviceId: String
        get() = prefs.getString("device_id", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("device_id", it).apply() }
    var memberId: String?
        get() = prefs.getString("member_id", null)
        set(value) { prefs.edit().putString("member_id", value).apply() }
    var name: String?
        get() = prefs.getString("name", null)
        set(value) { prefs.edit().putString("name", value).apply() }
    var phone: String?
        get() = prefs.getString("phone", null)
        set(value) { prefs.edit().putString("phone", value).apply() }
    var trackingToken: String?
        get() = prefs.getString("tracking_token", null)
        set(value) { prefs.edit().putString("tracking_token", value).apply() }
    var protectionEnabled: Boolean
        get() = prefs.getBoolean("protection_enabled", false)
        set(value) { prefs.edit().putBoolean("protection_enabled", value).apply() }
    var locationPermissionAsked: Boolean
        get() = prefs.getBoolean("location_permission_asked", false)
        set(value) { prefs.edit().putBoolean("location_permission_asked", value).apply() }
    var notificationPermissionAsked: Boolean
        get() = prefs.getBoolean("notification_permission_asked", false)
        set(value) { prefs.edit().putBoolean("notification_permission_asked", value).apply() }
    var lastUpdate: String?
        get() = prefs.getString("last_update", null)
        set(value) { prefs.edit().putString("last_update", value).apply() }
    var lastAccuracy: Float
        get() = prefs.getFloat("last_accuracy", 0f)
        set(value) { prefs.edit().putFloat("last_accuracy", value).apply() }
    var lastStatus: String
        get() = prefs.getString("last_status", "Menunggu lokasi pertama") ?: "Menunggu lokasi pertama"
        set(value) { prefs.edit().putString("last_status", value).apply() }
    var adminMessage: String
        get() = prefs.getString("admin_message", "").orEmpty()
        set(value) { prefs.edit().putString("admin_message", value).apply() }
    var adminMessageUpdatedAt: String?
        get() = prefs.getString("admin_message_updated_at", null)
        set(value) { prefs.edit().putString("admin_message_updated_at", value).apply() }
}

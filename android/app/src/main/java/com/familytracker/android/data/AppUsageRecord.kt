package com.familytracker.android.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "pending_app_usage",
    indices = [Index(value = ["deviceId", "usageDate", "packageName"], unique = true)]
)
data class AppUsageRecord(
    @PrimaryKey val eventId: String,
    val memberId: String,
    val deviceId: String,
    val usageDate: String,
    val packageName: String,
    val appName: String,
    val usageMs: Long,
    val lastUsedAt: String?,
    val syncedAt: String? = null
)

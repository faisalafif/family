package com.familytracker.android.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "pending_locations")
data class PendingLocation(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val eventId: String,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float,
    val altitude: Double?,
    val speed: Float?,
    val bearing: Float?,
    val timestamp: String,
    val deviceId: String,
    val memberId: String
)

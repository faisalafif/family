package com.familytracker.android.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface AppUsageDao {
    @Query("SELECT * FROM pending_app_usage WHERE deviceId = :deviceId AND usageDate = :usageDate AND packageName = :packageName LIMIT 1")
    suspend fun find(deviceId: String, usageDate: String, packageName: String): AppUsageRecord?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(record: AppUsageRecord)

    @Query("SELECT * FROM pending_app_usage WHERE deviceId = :deviceId AND syncedAt IS NULL ORDER BY usageDate ASC, appName ASC")
    suspend fun pending(deviceId: String): List<AppUsageRecord>

    @Query("UPDATE pending_app_usage SET syncedAt = :syncedAt WHERE eventId = :eventId")
    suspend fun markSynced(eventId: String, syncedAt: String)

    @Query("DELETE FROM pending_app_usage WHERE usageDate < :cutoffDate")
    suspend fun deleteBefore(cutoffDate: String)
}

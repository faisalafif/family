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

    @Query("SELECT * FROM pending_app_usage_sessions WHERE deviceId = :deviceId AND syncedAt IS NULL ORDER BY startedAt ASC")
    suspend fun pendingSessions(deviceId: String): List<AppUsageSession>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertSession(session: AppUsageSession)

    @Query("SELECT * FROM pending_app_usage_sessions WHERE sessionId = :sessionId LIMIT 1")
    suspend fun findSession(sessionId: String): AppUsageSession?

    @Query("UPDATE pending_app_usage_sessions SET syncedAt = :syncedAt WHERE sessionId = :sessionId")
    suspend fun markSessionSynced(sessionId: String, syncedAt: String)

    @Query("DELETE FROM pending_app_usage_sessions WHERE usageDate < :cutoffDate")
    suspend fun deleteSessionsBefore(cutoffDate: String)
}

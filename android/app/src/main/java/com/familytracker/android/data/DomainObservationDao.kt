package com.familytracker.android.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
interface DomainObservationDao {
    @Query("SELECT * FROM pending_domain_observations WHERE deviceId = :deviceId AND observationDate = :date AND domain = :domain LIMIT 1")
    suspend fun find(deviceId: String, date: String, domain: String): DomainObservation?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: DomainObservation)

    @Transaction
    suspend fun record(deviceId: String, memberId: String, date: String, domain: String, timestamp: String) {
        val old = find(deviceId, date, domain)
        upsert(DomainObservation(
            deviceId = deviceId,
            memberId = memberId,
            observationDate = date,
            domain = domain,
            queryCount = (old?.queryCount ?: 0) + 1,
            firstSeenAt = old?.firstSeenAt ?: timestamp,
            lastSeenAt = timestamp,
            syncedAt = null
        ))
    }

    @Query("SELECT * FROM pending_domain_observations WHERE deviceId = :deviceId AND syncedAt IS NULL ORDER BY observationDate, domain LIMIT 2000")
    suspend fun pending(deviceId: String): List<DomainObservation>

    @Query("UPDATE pending_domain_observations SET syncedAt = :timestamp WHERE deviceId = :deviceId AND observationDate = :date AND domain = :domain")
    suspend fun markSynced(deviceId: String, date: String, domain: String, timestamp: String)

    @Query("DELETE FROM pending_domain_observations WHERE observationDate < :cutoffDate")
    suspend fun deleteBefore(cutoffDate: String)
}

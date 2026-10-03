package com.familytracker.android.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query

@Dao
interface LocationDao {
    @Insert suspend fun insert(location: PendingLocation)
    @Query("SELECT * FROM pending_locations ORDER BY id ASC LIMIT :limit") suspend fun oldest(limit: Int = 500): List<PendingLocation>
    @Query("DELETE FROM pending_locations WHERE id = :id") suspend fun delete(id: Long)
    @Query("SELECT COUNT(*) FROM pending_locations") suspend fun count(): Int
    @Query("DELETE FROM pending_locations WHERE id IN (SELECT id FROM pending_locations ORDER BY id ASC LIMIT :count)") suspend fun deleteOldest(count: Int)
    @Query("SELECT * FROM pending_locations ORDER BY id DESC LIMIT 1") suspend fun latest(): PendingLocation?
}

package com.familytracker.android.data

import androidx.room.Entity

@Entity(tableName = "pending_domain_observations", primaryKeys = ["deviceId", "observationDate", "domain"])
data class DomainObservation(
    val deviceId: String,
    val memberId: String,
    val observationDate: String,
    val domain: String,
    val queryCount: Int,
    val firstSeenAt: String,
    val lastSeenAt: String,
    val syncedAt: String? = null
) {
    val eventId: String get() = "$deviceId:$observationDate:$domain"
}

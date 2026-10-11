package com.familytracker.android.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(entities = [PendingLocation::class, AppUsageRecord::class, DomainObservation::class], version = 3, exportSchema = false)
abstract class LocalDatabase : RoomDatabase() {
    abstract fun locationDao(): LocationDao
    abstract fun appUsageDao(): AppUsageDao
    abstract fun domainObservationDao(): DomainObservationDao

    companion object {
        @Volatile private var instance: LocalDatabase? = null
        fun get(context: Context): LocalDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(context.applicationContext, LocalDatabase::class.java, "family_tracker.db")
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3).build().also { instance = it }
        }

        private val MIGRATION_1_2 = object : androidx.room.migration.Migration(1, 2) {
            override fun migrate(database: androidx.sqlite.db.SupportSQLiteDatabase) {
                database.execSQL("CREATE TABLE IF NOT EXISTS `pending_app_usage` (`eventId` TEXT NOT NULL, `memberId` TEXT NOT NULL, `deviceId` TEXT NOT NULL, `usageDate` TEXT NOT NULL, `packageName` TEXT NOT NULL, `appName` TEXT NOT NULL, `usageMs` INTEGER NOT NULL, `lastUsedAt` TEXT, `syncedAt` TEXT, PRIMARY KEY(`eventId`))")
                database.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_pending_app_usage_deviceId_usageDate_packageName` ON `pending_app_usage` (`deviceId`, `usageDate`, `packageName`)")
            }
        }

        private val MIGRATION_2_3 = object : androidx.room.migration.Migration(2, 3) {
            override fun migrate(database: androidx.sqlite.db.SupportSQLiteDatabase) {
                database.execSQL("CREATE TABLE IF NOT EXISTS `pending_domain_observations` (`deviceId` TEXT NOT NULL, `memberId` TEXT NOT NULL, `observationDate` TEXT NOT NULL, `domain` TEXT NOT NULL, `queryCount` INTEGER NOT NULL, `firstSeenAt` TEXT NOT NULL, `lastSeenAt` TEXT NOT NULL, `syncedAt` TEXT, PRIMARY KEY(`deviceId`, `observationDate`, `domain`))")
            }
        }
    }
}

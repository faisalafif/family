package com.familytracker.android.data

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Process
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class AppUsageSnapshot(
    val usageAccessGranted: Boolean,
    val records: List<AppUsageRecord>,
    val collectedAt: String,
    val incomplete: Boolean = false
)

object AppUsageCollector {
    fun hasUsageAccess(context: Context): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        @Suppress("DEPRECATION")
        return appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName) == AppOpsManager.MODE_ALLOWED
    }

    fun collect(context: Context, memberId: String, deviceId: String): AppUsageSnapshot {
        val now = System.currentTimeMillis()
        val nowIso = isoTimestamp(now)
        if (!hasUsageAccess(context)) return AppUsageSnapshot(false, emptyList(), nowIso)

        val start = Calendar.getInstance().apply {
            add(Calendar.DAY_OF_YEAR, -6)
            set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val apps = launcherAppNames(context)
        val queried = try {
            manager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start, now)
        } catch (_: Exception) {
            return AppUsageSnapshot(true, emptyList(), nowIso, incomplete = true)
        }
        if (queried == null) return AppUsageSnapshot(true, emptyList(), nowIso, incomplete = true)
        val rows = queried
            .asSequence()
            .filter { it.packageName != context.packageName && it.totalTimeInForeground > 0 }
            .map { stats ->
                val date = localDate(stats.firstTimeStamp.coerceAtLeast(start))
                val lastUsed = stats.lastTimeUsed.takeIf { it > 0 }?.let(::isoTimestamp)
                val packageName = stats.packageName
                AppUsageRecord(
                    eventId = "$deviceId:$date:$packageName",
                    memberId = memberId,
                    deviceId = deviceId,
                    usageDate = date,
                    packageName = packageName,
                    appName = apps[packageName] ?: packageName,
                    usageMs = stats.totalTimeInForeground.coerceAtLeast(0),
                    lastUsedAt = lastUsed
                )
            }
            .toList()
        return AppUsageSnapshot(true, rows, nowIso)
    }

    private fun launcherAppNames(context: Context): Map<String, String> {
        val intent = android.content.Intent(android.content.Intent.ACTION_MAIN).addCategory(android.content.Intent.CATEGORY_LAUNCHER)
        @Suppress("DEPRECATION")
        return context.packageManager.queryIntentActivities(intent, 0).associate { result ->
            result.activityInfo.packageName to result.loadLabel(context.packageManager).toString()
        }
    }

    private fun localDate(timeMillis: Long): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(timeMillis))

    private fun isoTimestamp(timeMillis: Long): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }.format(Date(timeMillis))
}

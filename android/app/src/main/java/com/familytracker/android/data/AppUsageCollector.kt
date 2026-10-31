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
    val sessions: List<AppUsageSession>,
    val activeAppPackage: String?,
    val activeAppName: String?,
    val activeAppSince: String?,
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
        if (!hasUsageAccess(context)) return AppUsageSnapshot(false, emptyList(), emptyList(), null, null, null, nowIso)

        val start = Calendar.getInstance().apply {
            add(Calendar.DAY_OF_YEAR, -6)
            set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val apps = launcherAppNames(context)
        val queried = try {
            manager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start, now)
        } catch (_: Exception) {
            return AppUsageSnapshot(true, emptyList(), emptyList(), null, null, null, nowIso, incomplete = true)
        }
        if (queried == null) return AppUsageSnapshot(true, emptyList(), emptyList(), null, null, null, nowIso, incomplete = true)
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
                    appName = apps[packageName] ?: installedAppName(context, packageName) ?: packageName,
                    usageMs = stats.totalTimeInForeground.coerceAtLeast(0),
                    lastUsedAt = lastUsed
                )
            }
            .toList()
        val timeline = collectSessions(manager, context, deviceId, memberId, apps, start, now)
        val today = localDate(now)
        val currentDaySessions = timeline.sessions.filter { it.usageDate == today }.groupBy { it.packageName }
        val refreshedRows = (rows.associateBy { it.packageName }.toMutableMap()).apply {
            currentDaySessions.forEach { (packageName, appSessions) ->
                val sessionDuration = appSessions.sumOf { it.durationMs }.coerceAtMost(86_400_000L)
                val lastEventTime = appSessions.maxOfOrNull { it.endedAt ?: it.startedAt }
                val old = this[packageName]
                this[packageName] = AppUsageRecord(
                    eventId = "$deviceId:$today:$packageName", memberId = memberId, deviceId = deviceId,
                    usageDate = today, packageName = packageName,
                    appName = appSessions.first().appName,
                    usageMs = maxOf(old?.usageMs ?: 0L, sessionDuration),
                    lastUsedAt = listOfNotNull(old?.lastUsedAt, lastEventTime).maxOrNull()
                )
            }
        }.values.toList()
        return AppUsageSnapshot(true, refreshedRows, timeline.sessions, timeline.activePackage,
            timeline.activePackage?.let { apps[it] ?: installedAppName(context, it) ?: it },
            timeline.activeSince?.let(::isoTimestamp), nowIso, incomplete = timeline.incomplete)
    }

    private data class SessionTimeline(val sessions: List<AppUsageSession>, val activePackage: String?, val activeSince: Long?, val incomplete: Boolean = false)

    private fun collectSessions(manager: UsageStatsManager, context: Context, deviceId: String, memberId: String,
        labels: Map<String, String>, start: Long, now: Long): SessionTimeline {
        val events = try { manager.queryEvents(start, now) } catch (_: Exception) { null }
            ?: return SessionTimeline(emptyList(), null, null, incomplete = true)
        val event = android.app.usage.UsageEvents.Event()
        val open = linkedMapOf<String, Long>()
        val sessions = mutableListOf<AppUsageSession>()
        fun close(packageName: String, end: Long) {
            val began = open.remove(packageName) ?: return
            if (end <= began) return
            val date = localDate(began)
            sessions += AppUsageSession("$deviceId:$packageName:$began", memberId, deviceId, date, packageName,
                labels[packageName] ?: installedAppName(context, packageName) ?: packageName,
                isoTimestamp(began), isoTimestamp(end), (end - began).coerceAtMost(86_400_000L), false)
        }
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            val packageName = event.packageName ?: continue
            if (packageName == context.packageName) continue
            val resumed = event.eventType == android.app.usage.UsageEvents.Event.ACTIVITY_RESUMED ||
                event.eventType == android.app.usage.UsageEvents.Event.MOVE_TO_FOREGROUND
            val paused = event.eventType == android.app.usage.UsageEvents.Event.ACTIVITY_PAUSED ||
                event.eventType == android.app.usage.UsageEvents.Event.ACTIVITY_STOPPED ||
                event.eventType == android.app.usage.UsageEvents.Event.MOVE_TO_BACKGROUND
            if (resumed) {
                open.keys.toList().filter { it != packageName }.forEach { close(it, event.timeStamp) }
                if (packageName !in open) open[packageName] = event.timeStamp
            } else if (paused) close(packageName, event.timeStamp)
        }
        val active = open.entries.maxByOrNull { it.value }
        open.forEach { (pkg, began) ->
            val date = localDate(began)
            sessions += AppUsageSession("$deviceId:$pkg:$began", memberId, deviceId, date, pkg,
                labels[pkg] ?: installedAppName(context, pkg) ?: pkg, isoTimestamp(began), null,
                (now - began).coerceAtLeast(0).coerceAtMost(86_400_000L), true)
        }
        return SessionTimeline(sessions, active?.key, active?.value)
    }

    private fun launcherAppNames(context: Context): Map<String, String> {
        val intent = android.content.Intent(android.content.Intent.ACTION_MAIN).addCategory(android.content.Intent.CATEGORY_LAUNCHER)
        @Suppress("DEPRECATION")
        return context.packageManager.queryIntentActivities(intent, 0).associate { result ->
            result.activityInfo.packageName to result.loadLabel(context.packageManager).toString()
        }
    }

    private fun installedAppName(context: Context, packageName: String): String? = try {
        val info = context.packageManager.getApplicationInfo(packageName, 0)
        context.packageManager.getApplicationLabel(info).toString().takeIf { it.isNotBlank() }
    } catch (_: Exception) { null }

    private fun localDate(timeMillis: Long): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(timeMillis))

    private fun isoTimestamp(timeMillis: Long): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }.format(Date(timeMillis))
}

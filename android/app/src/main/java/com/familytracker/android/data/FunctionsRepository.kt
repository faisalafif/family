package com.familytracker.android.data

import com.familytracker.android.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.json.JSONArray
import java.util.concurrent.TimeUnit

class FunctionsRepository {
    private val client = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private fun call(function: String, payload: JSONObject): JSONObject {
        require(BuildConfig.SUPABASE_URL.startsWith("https://") && BuildConfig.SUPABASE_PUBLISHABLE_KEY.isNotBlank()) {
            "Supabase belum dikonfigurasi di android/local.properties"
        }
        val base = BuildConfig.SUPABASE_URL.trimEnd('/')
        val request = Request.Builder()
            .url("$base/functions/v1/$function")
            .header("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
            .post(payload.toString().toRequestBody(jsonType))
            .build()
        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            val result = runCatching { JSONObject(text) }.getOrElse { JSONObject() }
            if (!response.isSuccessful) throw IllegalStateException(result.optString("message", "Upload gagal (${response.code})."))
            return result
        }
    }

    suspend fun register(token: String, deviceId: String): Pair<String, String> = withContext(Dispatchers.IO) {
        val result = call("device-register", JSONObject().put("trackingToken", token).put("deviceId", deviceId))
        result.getString("memberId") to result.getString("name")
    }

    suspend fun fetchAdminMessage(token: String, memberId: String, deviceId: String): JSONObject = withContext(Dispatchers.IO) {
        call("android-message-fetch", JSONObject()
            .put("trackingToken", token).put("memberId", memberId).put("deviceId", deviceId))
    }

    suspend fun confirmProtectionPause(token: String, memberId: String, deviceId: String, diagnostics: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        call("android-protection-control", JSONObject()
            .put("trackingToken", token).put("memberId", memberId).put("deviceId", deviceId)
            .put("diagnostics", diagnostics))
    }

    suspend fun upload(location: PendingLocation, trackingToken: String, diagnostics: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        call("android-location-ingest", JSONObject()
            .put("trackingToken", trackingToken).put("memberId", location.memberId).put("deviceId", location.deviceId).put("eventId", location.eventId)
            .put("latitude", location.latitude).put("longitude", location.longitude).put("accuracy", location.accuracy.toDouble())
            .put("altitude", location.altitude ?: JSONObject.NULL).put("speed", location.speed?.toDouble() ?: JSONObject.NULL)
            .put("bearing", location.bearing?.toDouble() ?: JSONObject.NULL).put("timestamp", location.timestamp)
            .put("diagnostics", diagnostics))
    }

    suspend fun syncAppUsage(
        trackingToken: String,
        memberId: String,
        deviceId: String,
        collectionEnabled: Boolean,
        usageAccessGranted: Boolean,
        collectionIncomplete: Boolean,
        collectedAt: String,
        records: List<AppUsageRecord>
    ): JSONObject = withContext(Dispatchers.IO) {
        val payloadRecords = JSONArray()
        records.forEach { record ->
            payloadRecords.put(JSONObject()
                .put("eventId", record.eventId)
                .put("usageDate", record.usageDate)
                .put("packageName", record.packageName)
                .put("appName", record.appName)
                .put("usageMs", record.usageMs)
                .put("lastUsedAt", record.lastUsedAt ?: JSONObject.NULL))
        }
        call("android-app-usage-ingest", JSONObject()
            .put("trackingToken", trackingToken)
            .put("memberId", memberId)
            .put("deviceId", deviceId)
            .put("collectionEnabled", collectionEnabled)
            .put("usageAccessGranted", usageAccessGranted)
            .put("collectionIncomplete", collectionIncomplete)
            .put("collectedAt", collectedAt)
            .put("records", payloadRecords))
    }

    suspend fun syncDomains(
        trackingToken: String,
        memberId: String,
        deviceId: String,
        monitoringEnabled: Boolean,
        vpnPermissionGranted: Boolean,
        observedAt: String,
        records: List<DomainObservation>
    ): JSONObject = withContext(Dispatchers.IO) {
        val payloadRecords = JSONArray()
        records.forEach { record ->
            payloadRecords.put(JSONObject()
                .put("eventId", record.eventId)
                .put("observationDate", record.observationDate)
                .put("domain", record.domain)
                .put("queryCount", record.queryCount)
                .put("firstSeenAt", record.firstSeenAt)
                .put("lastSeenAt", record.lastSeenAt))
        }
        call("android-domain-ingest", JSONObject()
            .put("trackingToken", trackingToken)
            .put("memberId", memberId)
            .put("deviceId", deviceId)
            .put("monitoringEnabled", monitoringEnabled)
            .put("vpnPermissionGranted", vpnPermissionGranted)
            .put("observedAt", observedAt)
            .put("records", payloadRecords))
    }
}

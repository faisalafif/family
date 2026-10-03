package com.familytracker.android.data

import com.familytracker.android.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
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

    suspend fun register(name: String, phone: String, token: String, deviceId: String): String = withContext(Dispatchers.IO) {
        call("device-register", JSONObject().put("name", name).put("phone", phone).put("trackingToken", token).put("deviceId", deviceId))
            .getString("memberId")
    }

    suspend fun upload(location: PendingLocation, trackingToken: String) = withContext(Dispatchers.IO) {
        call("android-location-ingest", JSONObject()
            .put("trackingToken", trackingToken).put("memberId", location.memberId).put("deviceId", location.deviceId).put("eventId", location.eventId)
            .put("latitude", location.latitude).put("longitude", location.longitude).put("accuracy", location.accuracy.toDouble())
            .put("altitude", location.altitude ?: JSONObject.NULL).put("speed", location.speed?.toDouble() ?: JSONObject.NULL)
            .put("bearing", location.bearing?.toDouble() ?: JSONObject.NULL).put("timestamp", location.timestamp))
    }
}

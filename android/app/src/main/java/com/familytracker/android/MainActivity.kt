package com.familytracker.android

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.SharedPreferences
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.familytracker.android.data.DevicePreferences
import com.familytracker.android.data.FunctionsRepository
import com.familytracker.android.data.LocalDatabase
import com.familytracker.android.service.LocationForegroundService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

private val Ink = Color(0xFF1F2A37)
private val Blue = Color(0xFF3977D5)
private val Soft = Color(0xFFF3F6FA)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme(colorScheme = lightColorScheme(primary = Blue, background = Soft)) { FamilyTrackerApp() } }
    }
}

@Composable
private fun FamilyTrackerApp() {
    val context = LocalContext.current
    val prefs = remember { DevicePreferences(context) }
    val scope = rememberCoroutineScope()
    val lifecycleOwner = LocalLifecycleOwner.current
    var screenRefresh by remember { mutableIntStateOf(0) }
    var showDiagnostics by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf(prefs.name.orEmpty()) }
    var tokenInput by remember { mutableStateOf(prefs.trackingToken.orEmpty()) }
    var busy by remember { mutableStateOf(false) }
    var autoStartAfterLink by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var hasFine by remember { mutableStateOf(hasLocationPermission(context)) }
    var hasBackground by remember { mutableStateOf(hasBackgroundPermission(context)) }
    var locationEnabled by remember { mutableStateOf(isLocationEnabled(context)) }
    var hasNotification by remember { mutableStateOf(Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) }
    var queued by remember { mutableIntStateOf(0) }
    var serviceRunning by remember { mutableStateOf(isLocationServiceRunning(context)) }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) {
            hasFine = hasLocationPermission(context); hasBackground = hasBackgroundPermission(context)
            locationEnabled = isLocationEnabled(context)
            hasNotification = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            serviceRunning = isLocationServiceRunning(context)
            screenRefresh++
        } }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    LaunchedEffect(screenRefresh) { queued = withContext(Dispatchers.IO) { LocalDatabase.get(context).locationDao().count() } }

    val foregroundPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        hasFine = result[Manifest.permission.ACCESS_FINE_LOCATION] == true || result[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (!hasFine) {
            message = "Izin lokasi ditolak. Izinkan lokasi agar perangkat ini bisa membagikan lokasinya."
            autoStartAfterLink = false
        }
        screenRefresh++
    }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        hasNotification = it
        if (!it) {
            message = "Izin notifikasi diperlukan agar status layanan lokasi terlihat."
            autoStartAfterLink = false
        }
        screenRefresh++
    }

    val requestForegroundPermission: () -> Unit = {
        if (prefs.locationPermissionAsked) {
            autoStartAfterLink = false
            message = "Izin lokasi sebelumnya ditolak. Ubah izin aplikasi secara manual di Pengaturan Android."
            context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
        } else {
            prefs.locationPermissionAsked = true
            foregroundPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
        }
    }
    val requestNotificationPermission: () -> Unit = {
        if (prefs.notificationPermissionAsked) {
            autoStartAfterLink = false
            message = "Aktifkan notifikasi note di Pengaturan Android agar status layanan tetap terlihat."
            context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
        } else {
            prefs.notificationPermissionAsked = true
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    DisposableEffect(prefs) {
        val mainHandler = Handler(Looper.getMainLooper())
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key in setOf("protection_enabled", "last_update", "last_accuracy", "last_status")) mainHandler.post { screenRefresh++; serviceRunning = isLocationServiceRunning(context) }
        }
        prefs.addListener(listener)
        onDispose { prefs.removeListener(listener) }
    }

    val registerAndContinue: () -> Unit = {
        val token = parseTrackingToken(tokenInput)
        if (token == null) message = "Tempel tracking link anggota yang sudah dibuat di dashboard."
        else {
            busy = true; message = "Menghubungkan perangkat ke anggota keluarga…"
            scope.launch {
                runCatching { FunctionsRepository().register(token, prefs.deviceId) }
                    .onSuccess { registration ->
                        name = registration.second
                        prefs.name = registration.second; prefs.phone = null; prefs.trackingToken = token; prefs.memberId = registration.first
                        message = "Perangkat berhasil ditautkan. Izinkan akses yang diminta; perlindungan akan aktif otomatis."
                        autoStartAfterLink = true
                    }
                    .onFailure { message = it.message ?: "Pendaftaran perangkat gagal." }
                busy = false; screenRefresh++
            }
        }
    }

    val startProtection: () -> Unit = {
        if (prefs.memberId == null) message = "Tautkan perangkat ke anggota keluarga lebih dulu."
        else autoStartAfterLink = true
    }

    LaunchedEffect(autoStartAfterLink, hasFine, hasBackground, hasNotification, locationEnabled, prefs.memberId) {
        if (autoStartAfterLink && prefs.memberId != null) {
            when {
                !hasFine -> requestForegroundPermission()
                Build.VERSION.SDK_INT >= 29 && !hasBackground -> message = "Pilih 'Izinkan sepanjang waktu' di izin lokasi. Setelah kembali ke note, perlindungan akan aktif otomatis."
                !locationEnabled -> message = "Aktifkan Location / Lokasi di pengaturan Android. Setelah kembali ke note, perlindungan akan aktif otomatis."
                Build.VERSION.SDK_INT >= 33 && !hasNotification -> requestNotificationPermission()
                else -> {
                    autoStartAfterLink = false
                    ContextCompat.startForegroundService(context, Intent(context, LocationForegroundService::class.java).setAction(LocationForegroundService.ACTION_START))
                    prefs.protectionEnabled = true; prefs.lastStatus = "Mengaktifkan perlindungan lokasi…"; screenRefresh++
                }
            }
        }
    }

    if (showDiagnostics) AlertDialog(
        onDismissRequest = { showDiagnostics = false },
        title = { Text("Diagnostik perangkat") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            DiagnosticLine("Izin lokasi", if (hasFine) "Diizinkan" else "Belum diizinkan", hasFine)
            DiagnosticLine("Izin latar belakang", if (Build.VERSION.SDK_INT < 29 || hasBackground) "Diizinkan" else "Belum diizinkan", Build.VERSION.SDK_INT < 29 || hasBackground)
            DiagnosticLine("Foreground service", if (serviceRunning) "Aktif" else "Tidak aktif", serviceRunning)
            DiagnosticLine("Location services", if (isLocationEnabled(context)) "Aktif" else "Nonaktif", isLocationEnabled(context))
            DiagnosticLine("Network", if (isOnline(context)) "Online" else "Offline", isOnline(context))
            DiagnosticLine("Battery optimization", if (ignoresBatteryOptimization(context)) "Pembatasan dikecualikan" else "Pembatasan aktif", ignoresBatteryOptimization(context))
            DiagnosticLine("Baterai", batteryLevel(context)?.let { "$it%" } ?: "Tidak diketahui", true)
            Text("Antrean upload lokal: $queued dari 500", color = Ink)
            Text("Jika pembaruan berhenti pada Xiaomi/OPPO/Vivo/Realme, periksa izin autostart dan pembatasan baterai melalui pengaturan sistem. Aplikasi tidak mengubah pengaturan itu otomatis.", color = Color(0xFF68778C), style = MaterialTheme.typography.bodySmall)
        } }, confirmButton = { TextButton(onClick = { showDiagnostics = false }) { Text("Selesai") } }
    )

    Surface(Modifier.fillMaxSize(), color = Soft) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(24.dp))
            Text("note", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = Ink)
            Spacer(Modifier.height(16.dp))
            MovingPinIllustration()

            if (prefs.memberId == null) {
                Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(22.dp)) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Hubungkan perangkat", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = Ink)
                        Text("Tempel tracking link anggota yang sudah dibuat di dashboard. Anggota akan dikenali otomatis. Link ini bersifat rahasia; bagikan hanya kepada pemilik perangkat.", color = Color(0xFF68778C))
                        OutlinedTextField(tokenInput, { tokenInput = it }, label = { Text("Tracking link / token dari dashboard") }, minLines = 2, modifier = Modifier.fillMaxWidth())
                        Button(onClick = registerAndContinue, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "Menghubungkan…" else "Tautkan perangkat") }
                    }
                }
            } else {
                Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(22.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(prefs.name ?: "Keluarga", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = Ink)
                        Spacer(Modifier.height(10.dp))
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Box(Modifier.size(10.dp).background(if (serviceRunning) Color(0xFF19A765) else Color(0xFF9AA4B2), CircleShape))
                            Text(if (serviceRunning) "Perlindungan lokasi aktif" else "Perlindungan lokasi nonaktif", fontWeight = FontWeight.SemiBold, color = Ink)
                        }
                        Text(prefs.lastStatus, color = Color(0xFF68778C), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
                        Spacer(Modifier.height(18.dp))
                        SummaryLine("Pembaruan lokasi terakhir", prefs.lastUpdate?.let(::formatTime) ?: "Belum ada lokasi")
                        SummaryLine("Akurasi", if (prefs.lastAccuracy > 0) "±${prefs.lastAccuracy.toInt()} m" else "—")
                        SummaryLine("Baterai", batteryLevel(context)?.let { "$it%" } ?: "Tidak diketahui")
                        SummaryLine("Jaringan", if (isOnline(context)) "Online" else "Offline · antrean lokal $queued")
                        if (!isOnline(context) && queued > 0) Text("Lokasi disimpan di perangkat dan akan dicoba kirim lagi saat jaringan kembali.", color = Color(0xFF68778C), modifier = Modifier.padding(top = 10.dp))
                        Spacer(Modifier.height(14.dp))
                        Button(onClick = { if (serviceRunning) {
                            context.startService(Intent(context, LocationForegroundService::class.java).setAction(LocationForegroundService.ACTION_STOP))
                            prefs.protectionEnabled = false; prefs.lastStatus = "Perlindungan lokasi dijeda"; screenRefresh++
                        } else startProtection() }, modifier = Modifier.fillMaxWidth()) {
                            Text(if (serviceRunning) "Jeda perlindungan" else "Aktifkan perlindungan lokasi")
                        }
                        if (Build.VERSION.SDK_INT >= 29 && !hasBackground) {
                            OutlinedButton(onClick = {
                                message = "Di halaman info aplikasi, buka Izin > Lokasi > izinkan ‘Sepanjang waktu’. Pengaturan ini diperlukan untuk berbagi lokasi berkelanjutan."
                                context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
                            }, modifier = Modifier.fillMaxWidth()) { Text("Izinkan lokasi latar belakang") }
                        }
                        if (Build.VERSION.SDK_INT >= 33 && !hasNotification) {
                            OutlinedButton(onClick = requestNotificationPermission, modifier = Modifier.fillMaxWidth()) { Text("Izinkan notifikasi layanan") }
                        }
                        TextButton(onClick = { showDiagnostics = true }) { Text("Diagnostik perangkat") }
                    }
                }
            }

            if (message.isNotBlank()) Text(message, color = if (message.contains("gagal", true) || message.contains("ditolak", true)) Color(0xFFB42318) else Color(0xFF475467), modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun MovingPinIllustration() {
    val transition = rememberInfiniteTransition(label = "protection-motion")
    val move by transition.animateFloat(0f, 1f, infiniteRepeatable(tween(1800), RepeatMode.Reverse), label = "walker")
    val pulse by transition.animateFloat(0.45f, 1f, infiniteRepeatable(tween(1100), RepeatMode.Reverse), label = "pin-pulse")
    Canvas(Modifier.size(width = 190.dp, height = 142.dp)) {
        val y = size.height * .70f
        val path = Path().apply { moveTo(size.width * .17f, y); cubicTo(size.width * .35f, y + 22, size.width * .55f, y - 20, size.width * .82f, y) }
        drawPath(path, Color(0xFFB9D3FA), style = Stroke(width = 5.dp.toPx(), cap = StrokeCap.Round))
        drawCircle(Color(0x333977D5), radius = 22.dp.toPx() * pulse, center = Offset(size.width * .82f, size.height * .34f))
        drawCircle(Blue, radius = 12.dp.toPx(), center = Offset(size.width * .82f, size.height * .34f))
        drawCircle(Color.White, radius = 4.dp.toPx(), center = Offset(size.width * .82f, size.height * .34f))
        val person = Offset(size.width * (.17f + .48f * move), y - 19.dp.toPx())
        drawCircle(Color(0xFFFFB85C), 7.dp.toPx(), person)
        drawLine(Ink, Offset(person.x, person.y + 7), Offset(person.x, person.y + 25), 4.dp.toPx(), cap = StrokeCap.Round)
        drawLine(Ink, Offset(person.x, person.y + 12), Offset(person.x - 9.dp.toPx(), person.y + 19), 3.dp.toPx(), cap = StrokeCap.Round)
        drawLine(Ink, Offset(person.x, person.y + 12), Offset(person.x + 9.dp.toPx(), person.y + 18), 3.dp.toPx(), cap = StrokeCap.Round)
        drawLine(Ink, Offset(person.x, person.y + 24), Offset(person.x - 8.dp.toPx(), person.y + 34), 3.dp.toPx(), cap = StrokeCap.Round)
        drawLine(Ink, Offset(person.x, person.y + 24), Offset(person.x + 8.dp.toPx(), person.y + 34), 3.dp.toPx(), cap = StrokeCap.Round)
    }
}

@Composable private fun SummaryLine(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = Color(0xFF68778C)); Text(value, color = Ink, fontWeight = FontWeight.SemiBold)
    }
}

@Composable private fun DiagnosticLine(label: String, value: String, okay: Boolean) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = Ink); Text("${if (okay) "✓" else "!"}  $value", color = if (okay) Color(0xFF16834A) else Color(0xFFB54708))
    }
}

private fun hasLocationPermission(context: Context) = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED || ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
@Suppress("DEPRECATION")
private fun isLocationServiceRunning(context: Context): Boolean = (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager)
    .getRunningServices(Int.MAX_VALUE).any { it.service.className == "com.familytracker.android.service.LocationForegroundService" }
private fun hasBackgroundPermission(context: Context) = Build.VERSION.SDK_INT < 29 || ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
private fun isLocationEnabled(context: Context): Boolean {
    val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    return if (Build.VERSION.SDK_INT >= 28) locationManager.isLocationEnabled
    else locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) || locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
}
private fun isOnline(context: Context): Boolean {
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val network = manager.activeNetwork ?: return false
    val capabilities = manager.getNetworkCapabilities(network) ?: return false
    return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
}
private fun batteryLevel(context: Context): Int? {
    val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return null
    val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1); val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
    return if (level >= 0 && scale > 0) level * 100 / scale else null
}
private fun ignoresBatteryOptimization(context: Context) = (context.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(context.packageName)
private fun parseTrackingToken(value: String): String? = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}").find(value)?.value
private fun formatTime(value: String): String = runCatching { Instant.parse(value).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("HH:mm:ss")) }.getOrDefault(value)

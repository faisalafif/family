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
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.text.input.KeyboardType
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
    var phone by remember { mutableStateOf(prefs.phone.orEmpty()) }
    var tokenInput by remember { mutableStateOf(prefs.trackingToken.orEmpty()) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var hasFine by remember { mutableStateOf(hasLocationPermission(context)) }
    var hasBackground by remember { mutableStateOf(hasBackgroundPermission(context)) }
    var hasNotification by remember { mutableStateOf(Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) }
    var queued by remember { mutableIntStateOf(0) }
    var serviceRunning by remember { mutableStateOf(isLocationServiceRunning(context)) }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) {
            hasFine = hasLocationPermission(context); hasBackground = hasBackgroundPermission(context)
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
        if (!hasFine) message = "Izin lokasi ditolak. Izinkan lokasi agar perangkat ini bisa membagikan lokasinya."
        screenRefresh++
    }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { hasNotification = it }

    val requestForegroundPermission: () -> Unit = {
        if (prefs.locationPermissionAsked) {
            message = "Izin lokasi sebelumnya ditolak. Ubah izin aplikasi secara manual di Pengaturan Android."
            context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
        } else {
            prefs.locationPermissionAsked = true
            foregroundPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
        }
    }
    val requestNotificationPermission: () -> Unit = {
        if (prefs.notificationPermissionAsked) {
            message = "Aktifkan notifikasi Family Tracker di Pengaturan Android agar status layanan tetap terlihat."
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
        if (name.isBlank() || !validIndonesianPhone(phone)) message = "Isi nama dan nomor Indonesia yang valid terlebih dahulu."
        else if (token == null) message = "Tempel token dari tracking link anggota yang sudah dibuat di dashboard."
        else {
            busy = true; message = "Menghubungkan perangkat ke anggota keluarga…"
            scope.launch {
                runCatching { FunctionsRepository().register(name.trim(), normalizePhone(phone), token, prefs.deviceId) }
                    .onSuccess { memberId ->
                        prefs.name = name.trim(); prefs.phone = normalizePhone(phone); prefs.trackingToken = token; prefs.memberId = memberId
                        message = "Perangkat berhasil ditautkan. Berikutnya izinkan lokasi dan aktifkan perlindungan."
                        if (!hasFine) requestForegroundPermission()
                    }
                    .onFailure { message = it.message ?: "Pendaftaran perangkat gagal." }
                busy = false; screenRefresh++
            }
        }
    }

    val startProtection: () -> Unit = {
        if (prefs.memberId == null) message = "Tautkan perangkat ke anggota keluarga lebih dulu."
        else if (!hasFine) requestForegroundPermission()
        else if (!hasBackground && Build.VERSION.SDK_INT >= 29) message = "Untuk berbagi lokasi berkelanjutan, izinkan akses lokasi 'Sepanjang waktu' melalui tombol izin latar belakang."
        else if (!isLocationEnabled(context)) message = "Aktifkan Location / Lokasi di pengaturan Android."
        else if (Build.VERSION.SDK_INT >= 33 && !hasNotification) {
            requestNotificationPermission()
            message = "Izinkan notifikasi agar status foreground service lokasi selalu terlihat."
        }
        else {
            ContextCompat.startForegroundService(context, Intent(context, LocationForegroundService::class.java).setAction(LocationForegroundService.ACTION_START))
            prefs.protectionEnabled = true; prefs.lastStatus = "Mengaktifkan perlindungan lokasi…"; screenRefresh++
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
            DiagnosticLine("Battery optimization", if (ignoresBatteryOptimization(context)) "Dikecualikan" else "Aktif", ignoresBatteryOptimization(context))
            Text("Antrean upload lokal: $queued dari 500", color = Ink)
            Text("Jika pembaruan berhenti pada Xiaomi/OPPO/Vivo/Realme, periksa izin autostart dan pembatasan baterai melalui pengaturan sistem. Aplikasi tidak mengubah pengaturan itu otomatis.", color = Color(0xFF68778C), style = MaterialTheme.typography.bodySmall)
        } }, confirmButton = { TextButton(onClick = { showDiagnostics = false }) { Text("Selesai") } }
    )

    Surface(Modifier.fillMaxSize(), color = Soft) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(24.dp))
            Text("Family Tracker", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = Ink)
            Text("Berbagi lokasi dengan keluarga", color = Color(0xFF68778C))
            Spacer(Modifier.height(16.dp))
            MovingPinIllustration()

            if (prefs.memberId == null) {
                Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(22.dp)) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Siapkan perangkat ini", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = Ink)
                        Text("Buat anggota keluarga dulu di dashboard, lalu tempel token tracking link miliknya untuk menautkan perangkat ini.", color = Color(0xFF68778C))
                        OutlinedTextField(name, { name = it }, label = { Text("Nama") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(phone, { phone = it }, label = { Text("Nomor telepon") }, placeholder = { Text("+62812xxxxxxxx") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), singleLine = true, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(tokenInput, { tokenInput = it }, label = { Text("Tracking link / token dari dashboard") }, minLines = 2, modifier = Modifier.fillMaxWidth())
                        Button(onClick = registerAndContinue, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "Menghubungkan…" else "Lanjutkan") }
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
                        TextButton(onClick = {
                            if (queued > 0) message = "Masih ada $queued lokasi yang belum tersinkron. Sambungkan internet sampai antrean kosong sebelum mengganti anggota."
                            else {
                                if (serviceRunning) context.startService(Intent(context, LocationForegroundService::class.java).setAction(LocationForegroundService.ACTION_STOP))
                                name = ""; phone = ""; tokenInput = ""; prefs.memberId = null; prefs.name = null; prefs.phone = null; prefs.trackingToken = null; screenRefresh++
                            }
                        }) { Text("Ganti anggota tertaut") }
                    }
                }
            }

            if (message.isNotBlank()) Text(message, color = if (message.contains("gagal", true) || message.contains("ditolak", true)) Color(0xFFB42318) else Color(0xFF475467), modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
            Spacer(Modifier.height(8.dp))
            Text("Lokasi hanya dibagikan saat perlindungan aktif. Notifikasi persisten Android akan selalu terlihat.", color = Color(0xFF68778C), style = MaterialTheme.typography.bodySmall)
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
private fun isLocationEnabled(context: Context) = (context.getSystemService(Context.LOCATION_SERVICE) as LocationManager).isLocationEnabled
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
private fun validIndonesianPhone(value: String) = Regex("^(?:\\+?62|0)8[0-9]{8,11}$").matches(value.replace(Regex("[\\s().-]"), ""))
private fun normalizePhone(value: String): String {
    val digits = value.replace(Regex("[\\s().-]"), "")
    return when { digits.startsWith("+62") -> digits; digits.startsWith("62") -> "+$digits"; digits.startsWith("0") -> "+62${digits.drop(1)}"; else -> digits }
}
private fun parseTrackingToken(value: String): String? = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}").find(value)?.value
private fun formatTime(value: String): String = runCatching { Instant.parse(value).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("HH:mm:ss")) }.getOrDefault(value)

package com.familytracker.android.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.content.pm.ServiceInfo
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.familytracker.android.MainActivity
import com.familytracker.android.R
import com.familytracker.android.data.DevicePreferences
import com.familytracker.android.data.DomainObservationDao
import com.familytracker.android.data.LocalDatabase
import com.familytracker.android.worker.DomainMonitorSync
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Captures DNS names only. All non-DNS traffic continues over the normal network. */
class DomainMonitorVpnService : VpnService() {
    private val preferences by lazy { DevicePreferences(this) }
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var running = false
    private var tunnel: ParcelFileDescriptor? = null
    private var readerThread: Thread? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopMonitor()
                return START_NOT_STICKY
            }
            ACTION_START, null -> startMonitor()
        }
        return START_STICKY
    }

    private fun startMonitor() {
        if (running) return
        if (VpnService.prepare(this) != null) {
            preferences.domainMonitorEnabled = false
            preferences.domainMonitorRunning = false
            stopSelf()
            return
        }
        try {
            val notification = buildNotification()
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }

            val connectivity = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
            val underlying: Network? = connectivity.activeNetwork
            val upstreamDns = underlying?.let { network ->
                connectivity.getLinkProperties(network)?.dnsServers?.firstOrNull { it is Inet4Address }
            } ?: throw IllegalStateException("Jaringan belum menyediakan DNS IPv4.")

            val builder = Builder()
                .setSession("Web Safety Monitor")
                .setMtu(4096)
                .addAddress(TUNNEL_DEVICE_ADDRESS, 32)
                .addDnsServer(TUNNEL_DNS_ADDRESS)
                .addRoute(TUNNEL_DNS_ADDRESS, 32)
            if (underlying != null) builder.setUnderlyingNetworks(arrayOf(underlying))
            tunnel = builder.establish() ?: throw IllegalStateException("Android tidak dapat membuat tunnel DNS.")
            running = true
            preferences.domainMonitorEnabled = true
            preferences.domainMonitorRunning = true
            preferences.domainMonitorError = ""
            DomainMonitorSync.schedule(this)
            DomainMonitorSync.requestNow(this)
            readerThread = Thread({ readDnsPackets(tunnel!!, upstreamDns) }, "domain-dns-monitor").apply { start() }
        } catch (error: Exception) {
            preferences.domainMonitorRunning = false
            preferences.domainMonitorEnabled = false
            preferences.domainMonitorError = error.message ?: "Monitor domain tidak dapat dijalankan."
            running = false
            tunnel?.close()
            tunnel = null
            stopForeground(true)
            stopSelf()
        }
    }

    private fun readDnsPackets(descriptor: ParcelFileDescriptor, upstreamDns: InetAddress) {
        val input = FileInputStream(descriptor.fileDescriptor)
        val output = FileOutputStream(descriptor.fileDescriptor)
        val packetBuffer = ByteArray(32767)
        val dao: DomainObservationDao = LocalDatabase.get(this).domainObservationDao()
        while (running) {
            try {
                val length = input.read(packetBuffer)
                if (length <= 0) continue
                val query = DnsPacketCodec.parseUdpQuery(packetBuffer, length) ?: continue
                val dnsResponse = forwardDnsQuery(query.dnsPayload, upstreamDns)
                    ?: DnsPacketCodec.servfail(query.dnsPayload)
                val responsePacket = DnsPacketCodec.buildIpv4UdpResponse(query, dnsResponse)
                output.write(responsePacket)
                query.domain?.let { domain ->
                    serviceScope.launch {
                        val memberId = preferences.memberId ?: return@launch
                        val date = isoDate(System.currentTimeMillis())
                        dao.record(preferences.deviceId, memberId, date, domain, isoTimestamp(System.currentTimeMillis()))
                    }
                }
            } catch (_: Exception) {
                if (running) continue
            }
        }
    }

    private fun forwardDnsQuery(query: ByteArray, server: InetAddress): ByteArray? {
        return runCatching {
            DatagramSocket().use { socket ->
                if (!protect(socket)) return null
                socket.soTimeout = DNS_TIMEOUT_MS
                val request = DatagramPacket(query, query.size, server, DNS_PORT)
                socket.send(request)
                val responseBytes = ByteArray(MAX_DNS_PACKET_SIZE)
                val response = DatagramPacket(responseBytes, responseBytes.size)
                socket.receive(response)
                responseBytes.copyOf(response.length)
            }
        }.getOrNull()
    }

    private fun stopMonitor() {
        running = false
        preferences.domainMonitorEnabled = false
        preferences.domainMonitorRunning = false
        readerThread?.interrupt()
        readerThread = null
        runCatching { tunnel?.close() }
        tunnel = null
        DomainMonitorSync.requestNow(this)
        stopForeground(true)
        stopSelf()
    }

    override fun onRevoke() {
        preferences.domainMonitorEnabled = false
        stopMonitor()
        super.onRevoke()
    }

    override fun onDestroy() {
        running = false
        preferences.domainMonitorRunning = false
        runCatching { tunnel?.close() }
        tunnel = null
        serviceScope.cancel()
        super.onDestroy()
    }

    private fun buildNotification(): Notification {
        val openApp = android.app.PendingIntent.getActivity(
            this, 41, Intent(this, MainActivity::class.java),
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or pendingIntentImmutableFlag()
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_search)
            .setContentTitle("Pemantauan domain aktif")
            .setContentText("Nama domain DNS teramati; ketuk untuk mengelola pemantauan.")
            .setContentIntent(openApp)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(CHANNEL_ID, "Pemantauan domain", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Terlihat saat monitor domain DNS aktif."
                setShowBadge(false)
            }
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
    }

    private fun pendingIntentImmutableFlag(): Int = if (Build.VERSION.SDK_INT >= 23) android.app.PendingIntent.FLAG_IMMUTABLE else 0

    private fun isoDate(millis: Long) = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(millis))
    private fun isoTimestamp(millis: Long) = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        .apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(millis))

    companion object {
        const val ACTION_START = "com.familytracker.android.domain.START"
        const val ACTION_STOP = "com.familytracker.android.domain.STOP"
        private const val CHANNEL_ID = "domain_monitor"
        private const val NOTIFICATION_ID = 7302
        private const val TUNNEL_DEVICE_ADDRESS = "10.73.0.2"
        private const val TUNNEL_DNS_ADDRESS = "10.73.0.1"
        private const val DNS_PORT = 53
        private const val DNS_TIMEOUT_MS = 3500
        private const val MAX_DNS_PACKET_SIZE = 4096
    }
}

private data class CapturedDnsQuery(
    val sourceAddress: ByteArray,
    val dnsAddress: ByteArray,
    val sourcePort: Int,
    val dnsPayload: ByteArray,
    val domain: String?
)

private object DnsPacketCodec {
    private val expectedDnsAddress = byteArrayOf(10, 73, 0, 1)

    fun parseUdpQuery(packet: ByteArray, length: Int): CapturedDnsQuery? {
        if (length < 28 || ((packet[0].toInt() ushr 4) and 0xF) != 4) return null
        val ipHeaderLength = (packet[0].toInt() and 0xF) * 4
        if (ipHeaderLength < 20 || length < ipHeaderLength + 8 || (packet[9].toInt() and 0xFF) != 17) return null
        val destination = packet.copyOfRange(16, 20)
        if (!destination.contentEquals(expectedDnsAddress)) return null
        val sourcePort = unsignedShort(packet, ipHeaderLength)
        val destinationPort = unsignedShort(packet, ipHeaderLength + 2)
        val udpLength = unsignedShort(packet, ipHeaderLength + 4)
        if (destinationPort != 53 || udpLength < 20 || ipHeaderLength + udpLength > length) return null
        val dnsStart = ipHeaderLength + 8
        val dnsPayload = packet.copyOfRange(dnsStart, ipHeaderLength + udpLength)
        if (dnsPayload.size < 17 || (dnsPayload[2].toInt() and 0x80) != 0) return null
        val domain = parseQuestionName(dnsPayload)
        return CapturedDnsQuery(packet.copyOfRange(12, 16), destination, sourcePort, dnsPayload, domain)
    }

    fun buildIpv4UdpResponse(query: CapturedDnsQuery, dnsPayload: ByteArray): ByteArray {
        val udpLength = 8 + dnsPayload.size
        val packet = ByteArray(20 + udpLength)
        packet[0] = 0x45
        putShort(packet, 2, packet.size)
        packet[4] = 0x51
        packet[5] = 0x7A
        packet[8] = 64
        packet[9] = 17
        query.dnsAddress.copyInto(packet, 12)
        query.sourceAddress.copyInto(packet, 16)
        putShort(packet, 10, ipv4Checksum(packet, 20))
        putShort(packet, 20, 53)
        putShort(packet, 22, query.sourcePort)
        putShort(packet, 24, udpLength)
        // A zero UDP checksum is valid for IPv4 and avoids changing DNS payload bytes.
        dnsPayload.copyInto(packet, 28)
        return packet
    }

    fun servfail(query: ByteArray): ByteArray {
        if (query.size < 12) return query
        val response = query.copyOf()
        val flags = unsignedShort(response, 2) or 0x8002
        putShort(response, 2, flags)
        putShort(response, 6, 0)
        putShort(response, 8, 0)
        putShort(response, 10, 0)
        return response
    }

    private fun parseQuestionName(dns: ByteArray): String? {
        val questionCount = unsignedShort(dns, 4)
        if (questionCount < 1) return null
        val labels = mutableListOf<String>()
        var position = 12
        var totalLength = 0
        while (position < dns.size) {
            val labelLength = dns[position++].toInt() and 0xFF
            if (labelLength == 0) break
            if (labelLength > 63 || position + labelLength > dns.size) return null
            val labelBytes = dns.copyOfRange(position, position + labelLength)
            val label = labelBytes.toString(Charsets.US_ASCII).lowercase(Locale.ROOT)
            if (!label.matches(Regex("[a-z0-9_-]+"))) return null
            labels += label
            totalLength += labelLength + 1
            if (totalLength > 253) return null
            position += labelLength
        }
        if (labels.isEmpty()) return null
        val domain = labels.joinToString(".")
        if (domain == "localhost" || domain.endsWith(".local") || domain.endsWith(".lan") ||
            domain.endsWith(".home") || domain.endsWith(".internal") ||
            domain.endsWith(".in-addr.arpa") || domain.endsWith(".ip6.arpa")) return null
        return domain
    }

    private fun unsignedShort(data: ByteArray, offset: Int): Int =
        ((data[offset].toInt() and 0xFF) shl 8) or (data[offset + 1].toInt() and 0xFF)

    private fun putShort(data: ByteArray, offset: Int, value: Int) {
        data[offset] = (value ushr 8).toByte()
        data[offset + 1] = value.toByte()
    }

    private fun ipv4Checksum(header: ByteArray, headerLength: Int): Int {
        var sum = 0L
        var offset = 0
        while (offset < headerLength) {
            if (offset != 10) sum += unsignedShort(header, offset).toLong()
            offset += 2
        }
        while ((sum ushr 16) != 0L) sum = (sum and 0xFFFF) + (sum ushr 16)
        return sum.inv().toInt() and 0xFFFF
    }
}

import { withSupabase } from "npm:@supabase/server";
import { corsHeaders, json, parseBody } from "../_shared/http.ts";

const isUuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const isPackageName = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.length <= 255 && !/[\u0000-\u001f\u007f]/.test(value);
const invalidRecordField = (row: unknown, deviceId: string): string | null => {
  if (!row || typeof row !== "object") return "BENTUK_DATA";
  const record = row as Record<string, unknown>;
  if (!isDate(record.usageDate)) return "TANGGAL";
  if (!isPackageName(record.packageName)) return "PACKAGE_NAME";
  if (typeof record.appName !== "string" || !record.appName.trim() || record.appName.length > 200) return "APP_NAME";
  if (!Number.isInteger(Number(record.usageMs)) || Number(record.usageMs) < 0 || Number(record.usageMs) > 86_400_000) return "DURASI";
  if (record.lastUsedAt != null && (!Number.isFinite(Date.parse(String(record.lastUsedAt))) || Date.parse(String(record.lastUsedAt)) > Date.now() + 300_000)) return "WAKTU_TERAKHIR";
  if (record.eventId !== `${deviceId}:${record.usageDate}:${record.packageName}`) return "EVENT_ID";
  return null;
};

Deno.serve(withSupabase({ auth: "none" }, async (request, { supabaseAdmin: admin }) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const body = await parseBody(request);
  const { trackingToken, memberId, deviceId } = body ?? {};
  const records = body?.records;
  const sessions = body?.sessions;
  const activePackage = body?.activeAppPackage;
  const activeName = body?.activeAppName;
  const activeSince = body?.activeAppSince;
  const collectedAt = String(body?.collectedAt ?? "");
  const collectedAtMs = Date.parse(collectedAt);
  const invalid = (reason: string) => {
    console.warn("android-app-usage-ingest rejected payload", {
      reason,
      recordCount: Array.isArray(records) ? records.length : null,
      sessionCount: Array.isArray(sessions) ? sessions.length : null,
    });
    return json({ message: `Laporan penggunaan aplikasi tidak valid: ${reason}.`, code: reason }, 400);
  };
  if (![trackingToken, memberId, deviceId].every(isUuid)) return invalid("ID_PERANGKAT_ATAU_ANGGOTA_TIDAK_VALID");
  if (typeof body?.collectionEnabled !== "boolean" || typeof body?.usageAccessGranted !== "boolean" || typeof body?.collectionIncomplete !== "boolean") {
    return invalid("STATUS_PENGUMPULAN_TIDAK_VALID");
  }
  if (!Number.isFinite(collectedAtMs) || collectedAtMs > Date.now() + 300_000) return invalid("WAKTU_PENGUMPULAN_TIDAK_VALID");
  if (!Array.isArray(records) || records.length > 2000) return invalid("JUMLAH_RIWAYAT_APLIKASI_TIDAK_VALID");
  if (!Array.isArray(sessions) || sessions.length > 2000) return invalid("JUMLAH_SESI_APLIKASI_TIDAK_VALID");
  const recordIndex = records.findIndex((row: unknown) => invalidRecordField(row, String(deviceId)) != null);
  if (recordIndex >= 0) {
    const field = invalidRecordField(records[recordIndex], String(deviceId));
    return invalid(`RIWAYAT_APLIKASI_KE_${recordIndex + 1}_${field}_TIDAK_VALID`);
  }
  if ((!body.collectionEnabled || !body.usageAccessGranted) && records.length > 0) return invalid("RIWAYAT_TERKIRIM_SAAT_PENGUMPULAN_NONAKTIF");
  const sessionIndex = sessions.findIndex((row: Record<string, unknown>) => !row || typeof row !== "object" ||
    typeof row.sessionId !== "string" || row.sessionId.length > 300 ||
    !isDate(row.usageDate) || !isPackageName(row.packageName) ||
    typeof row.appName !== "string" || !row.appName.trim() || row.appName.length > 200 ||
    !Number.isFinite(Date.parse(String(row.startedAt))) || Date.parse(String(row.startedAt)) > Date.now() + 300_000 ||
    (row.endedAt != null && (!Number.isFinite(Date.parse(String(row.endedAt))) || Date.parse(String(row.endedAt)) < Date.parse(String(row.startedAt)))) ||
    !Number.isInteger(Number(row.durationMs)) || Number(row.durationMs) < 0 || Number(row.durationMs) > 86_400_000 || typeof row.isActive !== "boolean" ||
    (row.isActive && row.endedAt != null));
  if (sessionIndex >= 0) return invalid(`SESI_APLIKASI_KE_${sessionIndex + 1}_TIDAK_VALID`);
  if (activePackage != null && (typeof activePackage !== "string" || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(activePackage) || typeof activeName !== "string" || !activeName.trim())) {
    return invalid("APLIKASI_AKTIF_TIDAK_VALID");
  }
  if (activeSince != null && (!Number.isFinite(Date.parse(String(activeSince))) || Date.parse(String(activeSince)) > Date.now() + 300_000)) return invalid("WAKTU_APLIKASI_AKTIF_TIDAK_VALID");
  if ((!body.collectionEnabled || !body.usageAccessGranted) && (sessions.length > 0 || activePackage != null)) return invalid("SESI_TERKIRIM_SAAT_PENGUMPULAN_NONAKTIF");
  if (body.collectionIncomplete && (!body.collectionEnabled || !body.usageAccessGranted)) return invalid("STATUS_DATA_TIDAK_KONSISTEN");

  const { data: member } = await admin.from("family_members").select("id")
    .eq("id", memberId).eq("tracking_token", trackingToken).maybeSingle();
  if (!member) return json({ message: "Perangkat tidak terautentikasi untuk anggota ini." }, 403);
  const { data: device } = await admin.from("android_devices").select("device_id")
    .eq("device_id", deviceId).eq("member_id", memberId).maybeSingle();
  if (!device) return json({ message: "Perangkat belum terdaftar untuk anggota ini." }, 403);

  const retentionCutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const latestAllowedDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (records.some((row: Record<string, unknown>) => String(row.usageDate) < retentionCutoff || String(row.usageDate) > latestAllowedDate)) {
    return json({ message: "Rentang tanggal penggunaan aplikasi tidak valid." }, 400);
  }

  if (records.length > 0) {
    const rows = records.map((record: Record<string, unknown>) => ({
      event_id: record.eventId,
      device_id: deviceId,
      member_id: memberId,
      usage_date: record.usageDate,
      package_name: record.packageName,
      app_name: record.appName,
      usage_ms: Number(record.usageMs),
      last_used_at: record.lastUsedAt == null ? null : new Date(String(record.lastUsedAt)).toISOString(),
      synced_at: new Date().toISOString(),
    }));
    const { error } = await admin.from("android_app_usage_daily").upsert(rows, { onConflict: "device_id,usage_date,package_name" });
    if (error) return json({ message: "Riwayat penggunaan aplikasi gagal disimpan." }, 500);
  }

  if (sessions.some((row: Record<string, unknown>) => String(row.usageDate) < retentionCutoff || String(row.usageDate) > latestAllowedDate)) {
    return json({ message: "Rentang tanggal sesi aplikasi tidak valid." }, 400);
  }
  if (sessions.length > 0) {
    const rows = sessions.map((session: Record<string, unknown>) => ({
      session_id: session.sessionId,
      device_id: deviceId,
      member_id: memberId,
      usage_date: session.usageDate,
      package_name: session.packageName,
      app_name: session.appName,
      started_at: new Date(String(session.startedAt)).toISOString(),
      ended_at: session.endedAt == null ? null : new Date(String(session.endedAt)).toISOString(),
      duration_ms: Number(session.durationMs),
      is_active: session.isActive,
      synced_at: new Date().toISOString(),
    }));
    const { error } = await admin.from("android_app_usage_sessions").upsert(rows, { onConflict: "session_id" });
    if (error) return json({ message: "Riwayat sesi aplikasi gagal disimpan." }, 500);
  }

  const status = !body.collectionEnabled ? "DISABLED" : !body.usageAccessGranted ? "PERMISSION_REQUIRED" : body.collectionIncomplete ? "INCOMPLETE" : "READY";
  const { error: statusError } = await admin.from("android_app_usage_status").upsert({
    device_id: deviceId,
    member_id: memberId,
    collection_enabled: body.collectionEnabled,
    usage_access_granted: body.usageAccessGranted,
    collection_status: status,
    active_app_package: body.collectionEnabled && body.usageAccessGranted ? activePackage : null,
    active_app_name: body.collectionEnabled && body.usageAccessGranted ? activeName : null,
    active_app_since: body.collectionEnabled && body.usageAccessGranted && activeSince ? new Date(String(activeSince)).toISOString() : null,
    collected_at: new Date(collectedAtMs).toISOString(),
    reported_at: new Date().toISOString(),
  }, { onConflict: "device_id" });
  if (statusError) return json({ message: "Status penggunaan aplikasi gagal diperbarui." }, 500);

  const { error: retentionError } = await admin.from("android_app_usage_daily").delete().eq("device_id", deviceId).lt("usage_date", retentionCutoff);
  if (retentionError) return json({ message: "Riwayat lama belum dapat dibersihkan." }, 500);
  const { error: sessionRetentionError } = await admin.from("android_app_usage_sessions").delete().eq("device_id", deviceId).lt("usage_date", retentionCutoff);
  if (sessionRetentionError) return json({ message: "Sesi lama belum dapat dibersihkan." }, 500);
  return json({ ok: true, accepted: records.length, acceptedSessions: sessions.length, status });
}));

import { withSupabase } from "npm:@supabase/server";
import { corsHeaders, json, parseBody } from "../_shared/http.ts";

const isUuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

Deno.serve(withSupabase({ auth: "none" }, async (request, { supabaseAdmin: admin }) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const body = await parseBody(request);
  const { trackingToken, memberId, deviceId } = body ?? {};
  const records = body?.records;
  const collectedAt = String(body?.collectedAt ?? "");
  const collectedAtMs = Date.parse(collectedAt);
  if (![trackingToken, memberId, deviceId].every(isUuid) ||
      typeof body?.collectionEnabled !== "boolean" || typeof body?.usageAccessGranted !== "boolean" ||
      typeof body?.collectionIncomplete !== "boolean" ||
      !Number.isFinite(collectedAtMs) || collectedAtMs > Date.now() + 300_000 ||
      !Array.isArray(records) || records.length > 2000 ||
      records.some((row: Record<string, unknown>) => {
        if (!row || typeof row !== "object" || !isDate(row.usageDate) ||
            typeof row.packageName !== "string" || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(row.packageName) ||
            typeof row.appName !== "string" || !row.appName.trim() || row.appName.length > 200 ||
            !Number.isInteger(Number(row.usageMs)) || Number(row.usageMs) < 0 || Number(row.usageMs) > 86_400_000 ||
            (row.lastUsedAt != null && (!Number.isFinite(Date.parse(String(row.lastUsedAt))) || Date.parse(String(row.lastUsedAt)) > Date.now() + 300_000))) return true;
        return row.eventId !== `${deviceId}:${row.usageDate}:${row.packageName}`;
      }) ||
      ((!body.collectionEnabled || !body.usageAccessGranted) && records.length > 0) ||
      (body.collectionIncomplete && (!body.collectionEnabled || !body.usageAccessGranted))) {
    return json({ message: "Laporan penggunaan aplikasi tidak valid." }, 400);
  }

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

  const status = !body.collectionEnabled ? "DISABLED" : !body.usageAccessGranted ? "PERMISSION_REQUIRED" : body.collectionIncomplete ? "INCOMPLETE" : "READY";
  const { error: statusError } = await admin.from("android_app_usage_status").upsert({
    device_id: deviceId,
    member_id: memberId,
    collection_enabled: body.collectionEnabled,
    usage_access_granted: body.usageAccessGranted,
    collection_status: status,
    collected_at: new Date(collectedAtMs).toISOString(),
    reported_at: new Date().toISOString(),
  }, { onConflict: "device_id" });
  if (statusError) return json({ message: "Status penggunaan aplikasi gagal diperbarui." }, 500);

  const { error: retentionError } = await admin.from("android_app_usage_daily").delete().eq("device_id", deviceId).lt("usage_date", retentionCutoff);
  if (retentionError) return json({ message: "Riwayat lama belum dapat dibersihkan." }, 500);
  return json({ ok: true, accepted: records.length, status });
}));

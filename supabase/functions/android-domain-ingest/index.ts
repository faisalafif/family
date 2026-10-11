import { withSupabase } from "npm:@supabase/server";
import { corsHeaders, json, parseBody } from "../_shared/http.ts";

const isUuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const isDomain = (value: unknown) => typeof value === "string" && value.length <= 253 &&
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/i.test(value);

Deno.serve(withSupabase({ auth: "none" }, async (request, { supabaseAdmin: admin }) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const body = await parseBody(request);
  const { trackingToken, memberId, deviceId } = body ?? {};
  const records = body?.records;
  const observedAt = String(body?.observedAt ?? "");
  const observedAtMs = Date.parse(observedAt);
  if (![trackingToken, memberId, deviceId].every(isUuid) ||
      typeof body?.monitoringEnabled !== "boolean" || typeof body?.vpnPermissionGranted !== "boolean" ||
      !Number.isFinite(observedAtMs) || observedAtMs > Date.now() + 300_000 ||
      !Array.isArray(records) || records.length > 2000 ||
      records.some((row: Record<string, unknown>) => {
        if (!row || typeof row !== "object" || !isDate(row.observationDate) || !isDomain(row.domain) ||
            !Number.isInteger(Number(row.queryCount)) || Number(row.queryCount) < 1 || Number(row.queryCount) > 1_000_000 ||
            !Number.isFinite(Date.parse(String(row.firstSeenAt))) || !Number.isFinite(Date.parse(String(row.lastSeenAt))) ||
            Date.parse(String(row.firstSeenAt)) > Date.parse(String(row.lastSeenAt)) ||
            Date.parse(String(row.lastSeenAt)) > Date.now() + 300_000) return true;
        return row.eventId !== `${deviceId}:${row.observationDate}:${String(row.domain).toLowerCase()}`;
      })) {
    return json({ message: "Laporan domain tidak valid." }, 400);
  }

  const { data: member } = await admin.from("family_members").select("id")
    .eq("id", memberId).eq("tracking_token", trackingToken).maybeSingle();
  if (!member) return json({ message: "Perangkat tidak terautentikasi untuk anggota ini." }, 403);
  const { data: device } = await admin.from("android_devices").select("device_id")
    .eq("device_id", deviceId).eq("member_id", memberId).maybeSingle();
  if (!device) return json({ message: "Perangkat belum terdaftar untuk anggota ini." }, 403);

  const retentionCutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const latestAllowedDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (records.some((row: Record<string, unknown>) => String(row.observationDate) < retentionCutoff || String(row.observationDate) > latestAllowedDate)) {
    return json({ message: "Rentang tanggal domain tidak valid." }, 400);
  }

  if (records.length > 0) {
    const rows = records.map((record: Record<string, unknown>) => ({
      event_id: record.eventId,
      device_id: deviceId,
      member_id: memberId,
      observation_date: record.observationDate,
      domain: String(record.domain).toLowerCase(),
      query_count: Number(record.queryCount),
      first_seen_at: new Date(String(record.firstSeenAt)).toISOString(),
      last_seen_at: new Date(String(record.lastSeenAt)).toISOString(),
      synced_at: new Date().toISOString(),
    }));
    const { error } = await admin.from("android_domain_observations").upsert(rows, { onConflict: "device_id,observation_date,domain" });
    if (error) return json({ message: "Riwayat domain gagal disimpan." }, 500);
  }

  const { error: statusError } = await admin.from("android_domain_monitor_status").upsert({
    device_id: deviceId,
    member_id: memberId,
    monitoring_enabled: body.monitoringEnabled,
    vpn_permission_granted: body.vpnPermissionGranted,
    reported_at: new Date(observedAtMs).toISOString(),
  }, { onConflict: "device_id" });
  if (statusError) return json({ message: "Status monitor domain gagal diperbarui." }, 500);

  const { error: retentionError } = await admin.from("android_domain_observations").delete().eq("device_id", deviceId).lt("observation_date", retentionCutoff);
  if (retentionError) return json({ message: "Riwayat domain lama belum dapat dibersihkan." }, 500);
  return json({ ok: true, accepted: records.length });
}));

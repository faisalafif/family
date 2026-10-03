import { withSupabase } from "npm:@supabase/server";
import { corsHeaders, json, parseBody } from "../_shared/http.ts";
const isUuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

Deno.serve(withSupabase({ auth: "none" }, async (request, { supabaseAdmin: admin }) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const body = await parseBody(request);
  const { trackingToken, deviceId, memberId, eventId } = body ?? {};
  const latitude = Number(body?.latitude), longitude = Number(body?.longitude), accuracy = Number(body?.accuracy);
  const timestamp = String(body?.timestamp ?? "");
  const epoch = Date.parse(timestamp);
  const optionalNumbers = [body?.altitude, body?.speed, body?.bearing].filter((value) => value != null).map(Number);
  if (![trackingToken, deviceId, memberId, eventId].every(isUuid) || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(accuracy) || accuracy <= 0 || accuracy > 100_000 || !Number.isFinite(epoch) || epoch > Date.now() + 300_000) {
    return json({ message: "Data lokasi tidak valid." }, 400);
  }
  if (optionalNumbers.some((number) => !Number.isFinite(number))) return json({ message: "Data sensor lokasi tidak valid." }, 400);
  if ((body?.altitude != null && (Number(body.altitude) < -1000 || Number(body.altitude) > 100000)) ||
      (body?.speed != null && (Number(body.speed) < 0 || Number(body.speed) > 200)) ||
      (body?.bearing != null && (Number(body.bearing) < 0 || Number(body.bearing) > 360))) {
    return json({ message: "Nilai sensor berada di luar rentang yang diizinkan." }, 400);
  }
  const { data: member } = await admin.from("family_members").select("id").eq("id", memberId).eq("tracking_token", trackingToken).maybeSingle();
  if (!member) return json({ message: "Perangkat tidak terautentikasi untuk anggota ini." }, 403);
  const { data: device } = await admin.from("android_devices").select("device_id").eq("device_id", deviceId).eq("member_id", memberId).maybeSingle();
  if (!device) return json({ message: "Perangkat belum terdaftar untuk anggota ini." }, 403);

  const row = {
    event_id: eventId, member_id: memberId, device_id: deviceId,
    latitude, longitude, accuracy,
    altitude: body?.altitude == null ? null : Number(body.altitude),
    speed: body?.speed == null ? null : Number(body.speed),
    bearing: body?.bearing == null ? null : Number(body.bearing),
    source: "ANDROID", platform: "ANDROID", recorded_at: new Date(epoch).toISOString(),
  };
  const { error: locationError } = await admin.from("locations").upsert(row, { onConflict: "event_id", ignoreDuplicates: true });
  if (locationError) return json({ message: "Lokasi gagal disimpan." }, 500);
  const { error: memberError } = await admin.from("family_members")
    .update({ latitude, longitude, accuracy, last_seen: row.recorded_at, last_source: "ANDROID", last_provider: "android", device_seen_at: new Date().toISOString() })
    .eq("id", memberId);
  if (memberError) return json({ message: "Lokasi tersimpan tetapi posisi terakhir gagal diperbarui." }, 500);
  const { error: deviceError } = await admin.from("android_devices").update({ last_seen: new Date().toISOString() }).eq("device_id", deviceId);
  if (deviceError) return json({ message: "Lokasi tersimpan tetapi status perangkat gagal diperbarui." }, 500);
  return json({ ok: true });
}));

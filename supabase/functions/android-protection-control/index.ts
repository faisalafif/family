import { withSupabase } from "npm:@supabase/server";
import { corsHeaders, json, parseBody } from "../_shared/http.ts";

const isUuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

Deno.serve(withSupabase({ auth: "none" }, async (request, { supabaseAdmin: admin }) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);

  const body = await parseBody(request);
  const { trackingToken, memberId, deviceId } = body ?? {};
  const diagnostics = body?.diagnostics as Record<string, unknown> | undefined;
  if (![trackingToken, memberId, deviceId].every(isUuid) || !diagnostics || typeof diagnostics !== "object" ||
      !["location_permission", "background_permission", "location_services", "network_online", "battery_optimization_exempt"].every(key => typeof diagnostics[key] === "boolean") ||
      !Number.isInteger(Number(diagnostics.queued_uploads)) || Number(diagnostics.queued_uploads) < 0 || Number(diagnostics.queued_uploads) > 500 ||
      (diagnostics.battery_percent != null && (!Number.isInteger(Number(diagnostics.battery_percent)) || Number(diagnostics.battery_percent) < 0 || Number(diagnostics.battery_percent) > 100))) {
    return json({ message: "Permintaan jeda tidak valid." }, 400);
  }

  const { data: member } = await admin.from("family_members").select("id")
    .eq("id", memberId).eq("tracking_token", trackingToken).maybeSingle();
  if (!member) return json({ message: "Perangkat tidak terautentikasi untuk anggota ini." }, 403);

  const { data: device } = await admin.from("android_devices").select("device_id")
    .eq("device_id", deviceId).eq("member_id", memberId).maybeSingle();
  if (!device) return json({ message: "Perangkat belum terdaftar untuk anggota ini." }, 403);

  const { error } = await admin.from("android_device_status").upsert({
    device_id: deviceId,
    member_id: memberId,
    location_permission: diagnostics.location_permission,
    background_permission: diagnostics.background_permission,
    foreground_service: false,
    location_services: diagnostics.location_services,
    network_online: diagnostics.network_online,
    battery_optimization_exempt: diagnostics.battery_optimization_exempt,
    battery_percent: diagnostics.battery_percent == null ? null : Number(diagnostics.battery_percent),
    protection_enabled: false,
    queued_uploads: Number(diagnostics.queued_uploads),
    reported_at: new Date().toISOString(),
  }, { onConflict: "device_id" });
  if (error) return json({ message: "Web gagal mencatat permintaan jeda." }, 500);

  return json({ ok: true, protectionEnabled: false, message: "Permintaan jeda dikonfirmasi dan tercatat." });
}));

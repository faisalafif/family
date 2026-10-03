import { withSupabase } from "npm:@supabase/server";
import { corsHeaders, json, parseBody } from "../_shared/http.ts";

const isUuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

Deno.serve(withSupabase({ auth: "none" }, async (request, { supabaseAdmin: admin }) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const body = await parseBody(request);
  const { trackingToken, memberId, deviceId } = body ?? {};
  if (![trackingToken, memberId, deviceId].every(isUuid)) return json({ message: "Data perangkat tidak valid." }, 400);

  const { data: member, error: memberError } = await admin.from("family_members")
    .select("id,admin_message,admin_message_updated_at")
    .eq("id", memberId).eq("tracking_token", trackingToken).maybeSingle();
  if (memberError || !member) return json({ message: "Perangkat tidak terautentikasi untuk anggota ini." }, 403);
  const { data: device, error: deviceError } = await admin.from("android_devices")
    .select("device_id").eq("device_id", deviceId).eq("member_id", memberId).maybeSingle();
  if (deviceError || !device) return json({ message: "Perangkat belum terdaftar untuk anggota ini." }, 403);

  return json({ message: member.admin_message ?? "", updatedAt: member.admin_message_updated_at });
}));

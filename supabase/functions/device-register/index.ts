import { withSupabase } from "npm:@supabase/server";
import { corsHeaders, json, parseBody } from "../_shared/http.ts";
const normalizedPhone = (value: string) => {
  const digits = value.replace(/[\s().-]/g, "");
  if (/^08\d{8,11}$/.test(digits)) return `+62${digits.slice(1)}`;
  if (/^628\d{8,11}$/.test(digits)) return `+${digits}`;
  if (/^\+628\d{8,11}$/.test(digits)) return digits;
  return null;
};

Deno.serve(withSupabase({ auth: "none" }, async (request, { supabaseAdmin: admin }) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const body = await parseBody(request);
  const name = String(body?.name ?? "").trim();
  const phone = normalizedPhone(String(body?.phone ?? ""));
  const token = String(body?.trackingToken ?? "");
  const deviceId = String(body?.deviceId ?? "");
  const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  if (!name || !phone || !isUuid(token) || !isUuid(deviceId)) {
    return json({ message: "Nama, nomor Indonesia, tracking token, atau device ID tidak valid." }, 400);
  }
  const { data: member, error } = await admin.from("family_members").select("id,name,phone").eq("tracking_token", token).maybeSingle();
  if (error || !member || member.name.trim().toLowerCase() !== name.toLowerCase() || normalizedPhone(member.phone) !== phone) {
    return json({ message: "Anggota tidak ditemukan. Cek kembali nama, nomor, dan tracking link dashboard." }, 403);
  }
  const { error: saveError } = await admin.from("android_devices").upsert({ device_id: deviceId, member_id: member.id, platform: "ANDROID", last_seen: new Date().toISOString() }, { onConflict: "device_id" });
  if (saveError) return json({ message: "Perangkat gagal didaftarkan." }, 500);
  return json({ memberId: member.id });
}));

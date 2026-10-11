import { withSupabase } from "npm:@supabase/server";
import { corsHeaders, json, parseBody } from "../_shared/http.ts";

const isUuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

Deno.serve(withSupabase({ auth: "none" }, async (request, { supabaseAdmin: admin }) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const expectedDashboardKey = Deno.env.get("ANDROID_USAGE_DASHBOARD_KEY");
  if (!expectedDashboardKey) return json({ message: "App Usage History belum dikonfigurasi: set secret ANDROID_USAGE_DASHBOARD_KEY." }, 503);
  if (request.headers.get("x-app-usage-dashboard-key") !== expectedDashboardKey) return json({ message: "Kunci dashboard App Usage History tidak valid." }, 401);
  const body = await parseBody(request);
  const { trackingToken, memberId, usageDate } = body ?? {};
  if (!isUuid(trackingToken) || !isUuid(memberId) || !isDate(usageDate)) return json({ message: "Permintaan riwayat aplikasi tidak valid." }, 400);
  const { data: member } = await admin.from("family_members").select("id")
    .eq("id", memberId).eq("tracking_token", trackingToken).maybeSingle();
  if (!member) return json({ message: "Akses ke perangkat ini tidak valid." }, 403);

  const { data: status, error: statusError } = await admin.from("android_app_usage_status")
    .select("device_id,collection_enabled,usage_access_granted,collection_status,collected_at,reported_at")
    .eq("member_id", memberId).order("reported_at", { ascending: false }).limit(1).maybeSingle();
  if (statusError) return json({ message: "Status penggunaan aplikasi belum tersedia." }, 500);
  if (!status) return json({ status: null, records: [] });

  const { data: records, error } = await admin.from("android_app_usage_daily")
    .select("event_id,device_id,usage_date,package_name,app_name,usage_ms,last_used_at,synced_at")
    .eq("member_id", memberId).eq("device_id", status.device_id).eq("usage_date", usageDate)
    .order("usage_ms", { ascending: false }).limit(500);
  if (error) return json({ message: "Riwayat penggunaan aplikasi gagal dimuat." }, 500);
  return json({ status, records: records ?? [] });
}));

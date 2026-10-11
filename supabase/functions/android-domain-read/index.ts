import { withSupabase } from "npm:@supabase/server";
import { corsHeaders, json, parseBody } from "../_shared/http.ts";

const isUuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

Deno.serve(withSupabase({ auth: "none" }, async (request, { supabaseAdmin: admin }) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const expectedDashboardKey = Deno.env.get("ANDROID_USAGE_DASHBOARD_KEY");
  if (!expectedDashboardKey) return json({ message: "Web Safety Monitor belum dikonfigurasi: dashboard key Supabase tidak ditemukan." }, 503);
  if (request.headers.get("x-app-usage-dashboard-key") !== expectedDashboardKey) return json({ message: "Kunci dashboard tidak valid." }, 401);

  const body = await parseBody(request);
  const { trackingToken, memberId, observationDate } = body ?? {};
  if (!isUuid(trackingToken) || !isUuid(memberId) || !isDate(observationDate)) return json({ message: "Permintaan riwayat domain tidak valid." }, 400);
  const { data: member } = await admin.from("family_members").select("id")
    .eq("id", memberId).eq("tracking_token", trackingToken).maybeSingle();
  if (!member) return json({ message: "Akses ke perangkat ini tidak valid." }, 403);

  const { data: status, error: statusError } = await admin.from("android_domain_monitor_status")
    .select("device_id,monitoring_enabled,vpn_permission_granted,reported_at")
    .eq("member_id", memberId).order("reported_at", { ascending: false }).limit(1).maybeSingle();
  if (statusError) return json({ message: "Status monitor domain belum tersedia." }, 500);
  if (!status) return json({ status: null, records: [] });

  const { data: records, error } = await admin.from("android_domain_observations")
    .select("event_id,device_id,observation_date,domain,query_count,first_seen_at,last_seen_at,synced_at")
    .eq("member_id", memberId).eq("device_id", status.device_id).eq("observation_date", observationDate)
    .order("query_count", { ascending: false }).limit(1000);
  if (error) return json({ message: "Riwayat domain gagal dimuat." }, 500);
  return json({ status, records: records ?? [] });
}));

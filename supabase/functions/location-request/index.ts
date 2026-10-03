const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ code: "METHOD_NOT_ALLOWED", message: "Method not allowed." }, 405);

  const authorization = Deno.env.get("ORANGE_PLAYGROUND_AUTHORIZATION");
  if (!authorization) return response({ code: "PROVIDER_NOT_CONFIGURED", message: "Orange Playground belum dikonfigurasi di server." }, 503);

  let body: { phoneNumber?: string };
  try { body = await request.json(); } catch { return response({ code: "INVALID_ARGUMENT", message: "Request tidak valid." }, 400); }
  const phoneNumber = String(body.phoneNumber ?? "").replace(/[\s().-]/g, "");
  if (!/^\+990\d{6,12}$/.test(phoneNumber)) {
    return response({ code: "SANDBOX_NUMBER_REQUIRED", message: "Orange Playground hanya menerima nomor tes +990 yang terdaftar." }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const tokenResponse = await fetch("https://api.orange.com/openidconnect/playground/v1.0/token", {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
      signal: controller.signal,
    });
    if (!tokenResponse.ok) {
      return response({ code: tokenResponse.status === 401 ? "UNAUTHENTICATED" : tokenResponse.status === 403 ? "PERMISSION_DENIED" : "AUTH_FAILED", message: "Autentikasi Orange Playground gagal." }, tokenResponse.status);
    }
    const token = await tokenResponse.json();
    const locationResponse = await fetch("https://api.orange.com/camara/playground/api/location-retrieval/v0.3/retrieve", {
      method: "POST",
      headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json", accept: "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify({ device: { phoneNumber }, maxAge: 60 }),
      signal: controller.signal,
    });
    const result = await locationResponse.json().catch(() => ({}));
    if (!locationResponse.ok) {
      const status = locationResponse.status;
      const code = status === 404 ? "LOCATION_UNAVAILABLE" : status === 429 ? "RATE_LIMITED" : status === 503 ? "PROVIDER_UNAVAILABLE" : status === 422 ? "MAX_AGE_UNAVAILABLE" : "PROVIDER_ERROR";
      return response({ code, message: status === 404 ? "Sandbox tidak menemukan lokasi nomor uji." : status === 429 ? "Batas permintaan sandbox tercapai." : "Orange Playground tidak dapat memenuhi permintaan lokasi." }, status);
    }
    const center = result?.area?.center;
    if (!center || !Number.isFinite(center.latitude) || !Number.isFinite(center.longitude)) {
      return response({ code: "LOCATION_UNAVAILABLE", message: "Respons sandbox tidak memuat koordinat." }, 404);
    }
    return response({ location: {
      latitude: center.latitude,
      longitude: center.longitude,
      accuracy: Number.isFinite(result.area.radius) ? result.area.radius : null,
      timestamp: result.lastLocationTime || new Date().toISOString(),
      source: "NETWORK",
      confidence: null,
      rawProviderData: { simulated: true, areaType: result.area.areaType || "CIRCLE" },
    } });
  } catch (error) {
    const timeoutError = error instanceof Error && error.name === "AbortError";
    return response({ code: timeoutError ? "TIMEOUT" : "PROVIDER_UNAVAILABLE", message: timeoutError ? "Permintaan lokasi melewati batas waktu." : "Orange Playground tidak dapat dijangkau." }, timeoutError ? 504 : 503);
  } finally {
    clearTimeout(timeout);
  }
});

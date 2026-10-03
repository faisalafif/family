import { normalizeIndonesianPhone } from "./phone.js";

export class LocationProviderError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "LocationProviderError";
    this.code = code;
    this.status = status;
  }
}

export class MockLocationProvider {
  async getLatestLocation({ phoneNumber }) {
    const normalized = normalizeIndonesianPhone(phoneNumber);
    // Deterministic test fixture near Jakarta; never represents a real device.
    const hash = [...normalized].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
    return {
      provider: "mock",
      latitude: -6.2 + (hash % 4000) / 1_000_000,
      longitude: 106.8 + ((hash >>> 4) % 4000) / 1_000_000,
      accuracy: null,
      timestamp: new Date().toISOString(),
      source: "UNKNOWN",
      confidence: null,
      rawProviderData: { simulated: true }
    };
  }
}

export function createLocationProvider(name, options = {}) {
  if (name === "mock") return new MockLocationProvider();
  if (name === "orange-playground") return new OrangePlaygroundLocationProvider(options.invoke);
  if (name === "browser") {
    throw new LocationProviderError("BROWSER_TARGET_REQUIRED", "Browser GPS hanya tersedia dari halaman tracking pada perangkat target.");
  }
  throw new LocationProviderError("PROVIDER_UNAVAILABLE", "Provider lokasi belum dikonfigurasi.");
}

export class OrangePlaygroundLocationProvider {
  constructor(invoke) { this.invoke = invoke; }
  async getLatestLocation({ phoneNumber, memberId }) {
    if (!this.invoke) throw new LocationProviderError("PROVIDER_UNAVAILABLE", "Edge Function sandbox belum dikonfigurasi.");
    const phone = String(phoneNumber ?? "").trim().replace(/[\s().-]/g, "");
    if (!/^\+990\d{6,12}$/.test(phone)) {
      throw new LocationProviderError("SANDBOX_NUMBER_REQUIRED", "Orange Playground memakai nomor uji +990, bukan nomor Indonesia nyata.");
    }
    const { data, error } = await this.invoke("location-request", { body: { memberId, phoneNumber: phone } });
    if (error) throw new LocationProviderError(error.code || "PROVIDER_ERROR", error.message || "Sandbox lokasi gagal.");
    if (!data?.location) throw new LocationProviderError(data?.code || "LOCATION_UNAVAILABLE", data?.message || "Lokasi tidak tersedia.");
    return { ...data.location, provider: "orange-playground" };
  }
}

export function getProviderStatus(provider) {
  return {
    mock: "SIMULASI — koordinat palsu untuk uji UI",
    "orange-playground": "Sandbox Orange CAMARA — hanya nomor uji, data simulasi",
    browser: "Browser GPS tersedia di halaman target /track/:token",
    unavailable: "Provider jaringan Indonesia belum tersedia secara publik"
  }[provider] || "Provider tidak dikenal";
}

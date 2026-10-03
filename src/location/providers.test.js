import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIndonesianPhone } from "./phone.js";
import { createLocationProvider, MockLocationProvider, OrangePlaygroundLocationProvider, LocationProviderError } from "./providers.js";
import { isStaleLocation } from "./quality.js";
import { persistLocationResult } from "./persistence.js";

test("normalizes common Indonesian number forms", () => {
  assert.equal(normalizeIndonesianPhone("0812-3456-7890"), "+6281234567890");
  assert.equal(normalizeIndonesianPhone("6281234567890"), "+6281234567890");
  assert.equal(normalizeIndonesianPhone("+62 812 3456 7890"), "+6281234567890");
});

test("rejects invalid phone numbers", () => {
  assert.throws(() => normalizeIndonesianPhone("12345"), /tidak valid/);
});

test("provider selection and deterministic mock are explicit", async () => {
  assert.ok(createLocationProvider("mock") instanceof MockLocationProvider);
  assert.throws(() => createLocationProvider("unknown"), LocationProviderError);
  const provider = createLocationProvider("mock");
  const a = await provider.getLatestLocation({ phoneNumber: "08123456789" });
  const b = await provider.getLatestLocation({ phoneNumber: "08123456789" });
  assert.equal(a.latitude, b.latitude);
  assert.equal(a.source, "UNKNOWN");
  assert.equal(a.rawProviderData.simulated, true);
});

test("normalizes successful Orange sandbox response", async () => {
  const provider = new OrangePlaygroundLocationProvider(async () => ({
    data: { location: { latitude: -6.2, longitude: 106.8, accuracy: 500, timestamp: "2026-01-01T00:00:00Z", source: "NETWORK" } }
  }));
  const result = await provider.getLatestLocation({ phoneNumber: "+990100000001", memberId: "member" });
  assert.equal(result.provider, "orange-playground");
  assert.equal(result.accuracy, 500);
});

test("requires sandbox number and maps unauthorized response", async () => {
  const provider = new OrangePlaygroundLocationProvider(async () => ({ error: { code: "UNAUTHENTICATED", message: "Unauthorized" } }));
  await assert.rejects(() => provider.getLatestLocation({ phoneNumber: "+6281234567890" }), /nomor uji/);
  await assert.rejects(() => provider.getLatestLocation({ phoneNumber: "+990100000001" }), /Unauthorized/);
});

test("maps timeout and location-unavailable provider errors", async () => {
  const timeoutProvider = new OrangePlaygroundLocationProvider(async () => ({ error: { code: "TIMEOUT", message: "Timed out" } }));
  const missingProvider = new OrangePlaygroundLocationProvider(async () => ({ error: { code: "LOCATION_UNAVAILABLE", message: "Not found" } }));
  await assert.rejects(() => timeoutProvider.getLatestLocation({ phoneNumber: "+990100000001" }), /Timed out/);
  await assert.rejects(() => missingProvider.getLatestLocation({ phoneNumber: "+990100000001" }), /Not found/);
  await assert.rejects(() => missingProvider.getLatestLocation({ phoneNumber: "+12025550123" }), /nomor uji/);
});

test("persists normalized location and updates the member's latest point", async () => {
  const calls = [];
  const client = { from(table) {
    return {
      insert: async (row) => { calls.push({ table, operation: "insert", row }); return { error: null }; },
      update: (row) => ({ eq: async (column, value) => { calls.push({ table, operation: "update", row, column, value }); return { error: null }; } })
    };
  } };
  const result = { latitude: -6.2, longitude: 106.8, accuracy: 400, timestamp: "2026-01-01T00:00:00Z", source: "NETWORK", provider: "orange-playground", confidence: null, rawProviderData: { simulated: true } };
  await persistLocationResult(client, "member-1", result);
  assert.equal(calls[0].table, "locations");
  assert.equal(calls[0].row.latitude, -6.2);
  assert.equal(calls[1].table, "family_members");
  assert.equal(calls[1].row.last_provider, "orange-playground");
  assert.equal(calls[1].value, "member-1");
});

test("marks stale and fresh stored locations", () => {
  const now = Date.now();
  assert.equal(isStaleLocation(new Date(now - 6 * 60_000).toISOString(), 5 * 60_000, now), true);
  assert.equal(isStaleLocation(new Date(now - 60_000).toISOString(), 5 * 60_000, now), false);
});

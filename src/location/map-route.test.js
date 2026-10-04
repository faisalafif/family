import test from "node:test";
import assert from "node:assert/strict";
import { buildRouteSegments } from "./map-route.js";

const point = (id, minute, latitude = -6.2, longitude = 106.8) => ({
  id,
  recorded_at: new Date(Date.UTC(2026, 9, 4, 0, minute)).toISOString(),
  latitude,
  longitude
});

test("builds route segments in capture-time order and removes duplicate IDs", () => {
  const { chronological, segments } = buildRouteSegments([
    point("b", 1), point("a", 0), point("b", 1), point("c", 2)
  ]);
  assert.deepEqual(chronological.map(item => item.id), ["a", "b", "c"]);
  assert.deepEqual(segments.map(segment => segment.map(item => item.id)), [["a", "b", "c"]]);
});

test("splits route where capture-time gap is greater than configured minutes", () => {
  const { segments } = buildRouteSegments([point("a", 0), point("b", 5), point("c", 16)], 10);
  assert.deepEqual(segments.map(segment => segment.map(item => item.id)), [["a", "b"], ["c"]]);
});

test("ignores rows with invalid timestamps or coordinates", () => {
  const { chronological, segments } = buildRouteSegments([
    point("ok", 0), { ...point("bad-time", 1), recorded_at: "invalid" }, point("bad-lat", 2, 100, 106.8)
  ]);
  assert.deepEqual(chronological.map(item => item.id), ["ok"]);
  assert.deepEqual(segments.map(segment => segment.map(item => item.id)), [["ok"]]);
});

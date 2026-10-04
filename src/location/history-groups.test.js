import test from "node:test";
import assert from "node:assert/strict";
import { groupHistoryRecords, isWithinRelativeWindow } from "./history-groups.js";

const baseTime = Date.parse("2026-10-04T10:00:00.000Z");
const record = (id, secondsAgo, accuracy) => ({
  id,
  member_id: "member-1",
  source: "ANDROID",
  recorded_at: new Date(baseTime - secondsAgo * 1000).toISOString(),
  latitude: -6.2,
  longitude: 106.8,
  accuracy
});

test("keeps a stable group identity when a new representative has better accuracy", () => {
  const before = groupHistoryRecords([record("old", 30, 40)], 60_000)[0];
  const after = groupHistoryRecords([record("old", 30, 40), record("new", 10, 8)], 60_000)[0];
  assert.equal(after.groupId, before.groupId);
  assert.equal(before.id, "old");
  assert.equal(after.id, "new");
});

test("keeps capture-time groups newest first and one group per stable record when ungrouped", () => {
  const groups = groupHistoryRecords([record("older", 120, 8), record("newer", 30, 30)]);
  assert.deepEqual(groups.map(group => group.id), ["newer", "older"]);
  assert.equal(new Set(groups.map(group => group.groupId)).size, 2);
});

test("relative window includes its lower and current-time bounds only", () => {
  const now = baseTime;
  assert.equal(isWithinRelativeWindow(new Date(now - 30 * 60_000), now, 30), true);
  assert.equal(isWithinRelativeWindow(new Date(now), now, 30), true);
  assert.equal(isWithinRelativeWindow(new Date(now - 30 * 60_000 - 1), now, 30), false);
  assert.equal(isWithinRelativeWindow(new Date(now + 1), now, 30), false);
});

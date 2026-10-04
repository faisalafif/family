import test from "node:test";
import assert from "node:assert/strict";
import {
  isInJakartaDateTimeRange,
  isInJakartaHourRange,
  jakartaDateInputValue,
  jakartaHour,
  jakartaMidnightUtc,
  nextDateInputValue
} from "./history-time.js";

test("Jakarta date boundaries use UTC+7 and end dates are exclusive", () => {
  assert.equal(jakartaMidnightUtc("2026-10-03"), "2026-10-02T17:00:00.000Z");
  assert.equal(jakartaMidnightUtc(nextDateInputValue("2026-10-03")), "2026-10-03T17:00:00.000Z");
  assert.equal(nextDateInputValue("2026-12-31"), "2027-01-01");
});

test("Jakarta hour range includes start and excludes end on the selected date", () => {
  assert.equal(jakartaHour("2026-10-03T15:00:00.000Z"), 22);
  assert.equal(isInJakartaHourRange("2026-10-03T15:00:00.000Z", "22", "23"), true);
  assert.equal(isInJakartaHourRange("2026-10-03T15:59:59.999Z", "22", "23"), true);
  assert.equal(isInJakartaHourRange("2026-10-03T16:00:00.000Z", "22", "23"), false);
});

test("Jakarta time ranges crossing midnight include late and early hours", () => {
  assert.equal(isInJakartaHourRange("2026-10-03T15:00:00Z", "22", "2"), true);
  assert.equal(isInJakartaHourRange("2026-10-03T18:00:00Z", "22", "2"), true);
  assert.equal(isInJakartaHourRange("2026-10-03T19:00:00Z", "22", "2"), false);
  assert.equal(isInJakartaHourRange("invalid", "ALL", "ALL"), false);
});

test("date picker default is formatted in Jakarta time", () => {
  assert.equal(jakartaDateInputValue(new Date("2026-10-03T18:00:00Z")), "2026-10-04");
});


test("incoming records stay within the selected Jakarta date and time", () => {
  assert.equal(isInJakartaDateTimeRange("2026-10-03T15:30:00Z", "2026-10-03", "2026-10-03", "22", "23"), true);
  assert.equal(isInJakartaDateTimeRange("2026-10-03T16:30:00Z", "2026-10-03", "2026-10-03", "22", "23"), false);
  assert.equal(isInJakartaDateTimeRange("2026-10-04T15:30:00Z", "2026-10-03", "2026-10-03", "22", "23"), false);
});

test("date-only range includes its final Jakarta day and excludes the next day", () => {
  assert.equal(isInJakartaDateTimeRange("2026-10-03T16:59:59.999Z", "2026-10-03", "2026-10-03"), true);
  assert.equal(isInJakartaDateTimeRange("2026-10-03T17:00:00Z", "2026-10-03", "2026-10-03"), false);
  assert.equal(isInJakartaDateTimeRange("2026-10-02T16:59:59.999Z", "2026-10-03", "2026-10-03"), false);
});

test("cross-midnight time range continues into the next Jakarta date", () => {
  assert.equal(isInJakartaDateTimeRange("2026-10-03T15:00:00Z", "2026-10-03", "2026-10-03", "22", "2"), true);
  assert.equal(isInJakartaDateTimeRange("2026-10-03T18:00:00Z", "2026-10-03", "2026-10-03", "22", "2"), true);
  assert.equal(isInJakartaDateTimeRange("2026-10-03T19:00:00Z", "2026-10-03", "2026-10-03", "22", "2"), false);
  assert.equal(isInJakartaDateTimeRange("2026-10-03T14:00:00Z", "2026-10-03", "2026-10-03", "22", "2"), false);
});

test("historical matching uses capture timestamp even if upload occurs later", () => {
  const capturedAt = "2026-10-03T15:30:00Z";
  const uploadedAt = "2026-10-04T08:00:00Z";
  assert.equal(isInJakartaDateTimeRange(capturedAt, "2026-10-03", "2026-10-03", "22", "23"), true);
  assert.equal(isInJakartaDateTimeRange(uploadedAt, "2026-10-03", "2026-10-03", "22", "23"), false);
});


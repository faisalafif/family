export function locationAgeMs(recordedAt, now = Date.now()) {
  const timestamp = new Date(recordedAt).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : null;
}

export function isStaleLocation(recordedAt, maxAgeMs = 5 * 60_000, now = Date.now()) {
  const age = locationAgeMs(recordedAt, now);
  return age === null || age > maxAgeMs;
}

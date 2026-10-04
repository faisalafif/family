export function buildRouteSegments(records, gapMinutes = 10) {
  const unique = new Map();
  for (const record of records) {
    if (record?.latitude == null || record?.longitude == null || record.latitude === "" || record.longitude === "") continue;
    const timestamp = new Date(record?.recorded_at).getTime();
    const latitude = Number(record?.latitude);
    const longitude = Number(record?.longitude);
    if (!record?.id || !Number.isFinite(timestamp) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) continue;
    unique.set(record.id, record);
  }

  const chronological = [...unique.values()].sort((a, b) =>
    new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime() || String(a.id).localeCompare(String(b.id))
  );
  const gapMs = Math.max(1, Number(gapMinutes) || 10) * 60_000;
  const segments = [];
  for (const record of chronological) {
    const current = segments[segments.length - 1];
    const previous = current?.[current.length - 1];
    if (!current || new Date(record.recorded_at).getTime() - new Date(previous.recorded_at).getTime() > gapMs) {
      segments.push([record]);
    } else {
      current.push(record);
    }
  }
  return { chronological, segments };
}

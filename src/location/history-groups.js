export function groupHistoryRecords(records, intervalMs = null) {
  const groups = new Map();
  for (const record of records) {
    const timestamp = new Date(record?.recorded_at).getTime();
    if (!record?.id || !Number.isFinite(timestamp)) continue;
    const sessionAxis = [record.member_id, record.source || "", record.provider || "", record.platform || ""].join("|");
    const groupId = intervalMs ? `${sessionAxis}|${Math.floor(timestamp / intervalMs)}` : `${sessionAxis}|${record.id}`;
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId).push(record);
  }

  return [...groups.entries()].map(([groupId, rawRecords]) => {
    const validAccuracy = rawRecords.filter(record => Number.isFinite(Number(record.accuracy)) && Number(record.accuracy) > 0);
    const candidates = validAccuracy.length ? validAccuracy : rawRecords;
    const representative = [...candidates].sort((a, b) => {
      if (validAccuracy.length && Number(a.accuracy) !== Number(b.accuracy)) return Number(a.accuracy) - Number(b.accuracy);
      const timeDiff = new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime();
      return timeDiff || String(a.id).localeCompare(String(b.id));
    })[0];
    return representative ? { ...representative, id: representative.id, groupId, rawRecords } : null;
  }).filter(Boolean).sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
}

export function isWithinRelativeWindow(timestamp, now, durationMinutes) {
  const capturedAt = new Date(timestamp).getTime();
  const upperBound = new Date(now).getTime();
  const durationMs = Number(durationMinutes) * 60_000;
  return Number.isFinite(capturedAt) && Number.isFinite(upperBound) && Number.isFinite(durationMs) && durationMs > 0
    && capturedAt >= upperBound - durationMs && capturedAt <= upperBound;
}

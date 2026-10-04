export const JAKARTA_TIME_ZONE = "Asia/Jakarta";

export function jakartaDateInputValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: JAKARTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function nextDateInputValue(dateValue) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue || "");
  if (!match) return null;
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function jakartaMidnightUtc(dateValue) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue || "");
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  date.setUTCHours(-7, 0, 0, 0);
  return date.toISOString();
}

export function jakartaHour(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: JAKARTA_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).find(part => part.type === "hour")?.value;
  return hour == null ? null : Number(hour);
}

export function isInJakartaHourRange(timestamp, startHour = "ALL", endHour = "ALL") {
  const hour = jakartaHour(timestamp);
  if (hour == null) return false;
  const start = startHour === "ALL" ? null : Number(startHour);
  const end = endHour === "ALL" ? null : Number(endHour);
  if (start == null && end == null) return true;
  if (start == null) return hour < end;
  if (end == null) return hour >= start;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}


export function isInJakartaDateTimeRange(timestamp, startDate = "", endDate = "", startHour = "ALL", endHour = "ALL") {
  const parsedTimestamp = new Date(timestamp);
  if (!Number.isFinite(parsedTimestamp.getTime())) return false;
  const date = jakartaDateInputValue(parsedTimestamp);
  const isWithinDateRange = value => (!startDate || value >= startDate) && (!endDate || value <= endDate);
  const start = startHour === "ALL" ? null : Number(startHour);
  const end = endHour === "ALL" ? null : Number(endHour);
  if (start != null && end != null && start > end) {
    const hour = jakartaHour(timestamp);
    if (hour >= start) return isWithinDateRange(date);
    if (hour < end) {
      const previousDate = new Date(0);
      const [year, month, day] = date.split("-").map(Number);
      previousDate.setUTCFullYear(year, month - 1, day - 1);
      const previousDateKey = `${previousDate.getUTCFullYear()}-${String(previousDate.getUTCMonth() + 1).padStart(2, "0")}-${String(previousDate.getUTCDate()).padStart(2, "0")}`;
      return isWithinDateRange(previousDateKey);
    }
    return false;
  }
  return isWithinDateRange(date) && isInJakartaHourRange(timestamp, startHour, endHour);
}

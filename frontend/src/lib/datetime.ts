/**
 * Helpers for <input type="datetime-local"> and close-at display.
 * API timestamps are UTC; datetime-local uses the viewer's local wall clock.
 */

/** Fill a datetime-local input from an ISO / API string (local YYYY-MM-DDTHH:mm). */
export function formatForDatetimeLocal(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Send datetime-local value to the API as ISO UTC. */
export function datetimeLocalToIso(value: string): string {
  return new Date(value).toISOString();
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Under a day to close, labels count down in hours and minutes. */
export function closesWithinADay(closeAt: string, now = Date.now()): boolean {
  const ms = new Date(closeAt).getTime() - now;
  return ms > 0 && ms < DAY_MS;
}

/**
 * A market's close label: hours and minutes under a day ("Closes in 5h 12m"),
 * whole days under 30 days ("Closes in 3 days"), otherwise the date.
 */
export function formatTimeUntilClose(closeAt: string, now = Date.now()) {
  const close = new Date(closeAt);
  const ms = close.getTime() - now;
  if (Number.isNaN(ms)) return "—";
  if (ms <= 0) return "Closed";
  if (ms < HOUR_MS) {
    return `Closes in ${Math.max(1, Math.floor(ms / MINUTE_MS))}m`;
  }
  if (ms < DAY_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
    return `Closes in ${hours}h ${minutes}m`;
  }
  if (ms < 30 * DAY_MS) {
    const days = Math.max(1, Math.round(ms / DAY_MS));
    return `Closes in ${days} ${days === 1 ? "day" : "days"}`;
  }
  const sameYear = close.getFullYear() === new Date(now).getFullYear();
  return `Closes ${close.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })}`;
}

export function parseDateTimeLocal(value: string) {
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) return null;

  const [yearStr, monthStr, dayStr] = datePart.split("-");
  const [hourStr, minuteStr] = timePart.split(":");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  if ([year, month, day, hour, minute].some(Number.isNaN)) return null;
  return { year, month, day, hour, minute };
}

function getOffsetMinutesAt(utcDate: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "shortOffset",
  });
  const offsetPart = formatter
    .formatToParts(utcDate)
    .find((part) => part.type === "timeZoneName")?.value;

  if (!offsetPart || offsetPart === "GMT") return 0;

  const match = offsetPart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) return 0;

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || "0");
  return sign * (hours * 60 + minutes);
}

/** Interpret a datetime-local wall-clock value in `timeZone` and return the UTC instant. */
export function zonedLocalDateTimeToUtcDate(
  value: string,
  timeZone: string,
): Date | null {
  const parsed = parseDateTimeLocal(value);
  if (!parsed) return null;

  let utcMillis = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    parsed.hour,
    parsed.minute,
    0,
    0,
  );

  for (let i = 0; i < 3; i += 1) {
    const offsetMinutes = getOffsetMinutesAt(new Date(utcMillis), timeZone);
    const corrected =
      Date.UTC(
        parsed.year,
        parsed.month - 1,
        parsed.day,
        parsed.hour,
        parsed.minute,
        0,
        0,
      ) -
      offsetMinutes * 60_000;
    if (corrected === utcMillis) break;
    utcMillis = corrected;
  }

  return new Date(utcMillis);
}

/** Inverse of zonedLocalDateTimeToUtcDate: a UTC instant as YYYY-MM-DDTHH:mm wall clock in `timeZone`. */
export function formatInstantInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

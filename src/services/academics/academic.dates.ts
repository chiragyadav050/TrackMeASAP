import {
  instantFromLocalTime,
  localDateKey,
  parseMinutesFromTime,
} from "@/lib/time";

/**
 * Converting user-picked dates into what the database stores.
 *
 * Two destinations, two rules — see the header of `schema.prisma`:
 *
 *   DATE-ONLY columns (`@db.Date`) take a calendar date with no zone. They
 *   are anchored at UTC midnight so the value round-trips unchanged; applying
 *   a zone offset here would push "1 January" into December for anyone west
 *   of Greenwich.
 *
 *   ABSOLUTE columns take a real instant, converted FROM the profile's zone.
 *   A class at 10:00 means 10:00 where the student is.
 *
 * Every academic service goes through these two functions rather than
 * constructing dates inline, so the distinction cannot quietly erode.
 */

/** `YYYY-MM-DD` → a date-only value (UTC midnight). Zone-independent. */
export function toDateOnly(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** A date-only value back to `YYYY-MM-DD`, read as UTC. */
export function fromDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * `YYYY-MM-DD` + optional `HH:mm` → an absolute instant in the profile's zone.
 * With no time, anchors at local midnight; callers decide what that means
 * (see `isAllDay` on Assignment).
 */
export function toInstant(
  dateKey: string,
  time: string | undefined,
  timeZone: string,
): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const minutes = time ? (parseMinutesFromTime(time) ?? 0) : 0;

  return instantFromLocalTime(year, month, day, minutes, timeZone);
}

/** The profile's current local day as `YYYY-MM-DD`. */
export function todayKey(now: Date, timeZone: string): string {
  return localDateKey(now, timeZone);
}

/**
 * Walks the local calendar days in `[fromKey, toKey]` inclusive.
 *
 * Iterates over date-only values rather than adding 24 hours repeatedly, so a
 * daylight-saving transition inside the range cannot skip or repeat a day.
 */
export function eachLocalDate(fromKey: string, toKey: string): string[] {
  const days: string[] = [];

  const cursor = toDateOnly(fromKey);
  const end = toDateOnly(toKey);

  while (cursor.getTime() <= end.getTime()) {
    days.push(fromDateOnly(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

/** ISO weekday (1 = Monday … 7 = Sunday) for a `YYYY-MM-DD` key. */
export function isoWeekdayOf(dateKey: string): number {
  const weekday = toDateOnly(dateKey).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/**
 * Time-zone and time-of-day helpers.
 *
 * Deliberately generic: Life OS must work correctly for a user in
 * Asia/Kolkata (a :30 offset, which breaks naive hour-based maths) without
 * India being special-cased anywhere in the architecture.
 */

export const MINUTES_PER_DAY = 24 * 60;
export const DEFAULT_TIME_ZONE = "UTC";

/**
 * Validates an IANA time zone identifier.
 *
 * Two checks, because neither alone is sufficient:
 *
 *  1. The runtime's own ICU database must accept it. Validating against a
 *     hard-coded list would reject zones added in later tzdata releases.
 *  2. It must look like an IANA identifier — `UTC`, or `Region/City`.
 *     ICU also accepts bare legacy abbreviations such as `IST` and `EST`,
 *     which are genuinely ambiguous (IST is Indian, Irish *and* Israel
 *     Standard Time) and must never end up stored on a profile.
 *
 * Note that `Asia/Kolkata` and its older alias `Asia/Calcutta` are both
 * accepted and both behave identically; which one a given runtime considers
 * canonical varies by ICU version, and the product must not care.
 */
export function isValidTimeZone(timeZone: string): boolean {
  const candidate = timeZone.trim();

  if (candidate === "") {
    return false;
  }

  if (candidate !== DEFAULT_TIME_ZONE && !candidate.includes("/")) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return true;
  } catch {
    // RangeError is the documented failure mode for an unknown identifier.
    return false;
  }
}

/**
 * The browser's current time zone, or `UTC` when the environment cannot
 * report one. Used to pre-fill onboarding — never to silently overwrite a
 * choice the user has already made.
 */
export function detectTimeZone(): string {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return resolved && isValidTimeZone(resolved) ? resolved : DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/**
 * Every IANA zone the runtime knows about, for the settings picker.
 *
 * `supportedValuesOf` omits `UTC` on every engine, so it is prepended — it is
 * the application's default and has to be selectable.
 */
export function listTimeZones(): readonly string[] {
  const supported = Intl.supportedValuesOf?.("timeZone") ?? [];

  return [
    DEFAULT_TIME_ZONE,
    ...supported.filter((zone) => zone !== DEFAULT_TIME_ZONE),
  ];
}

/**
 * Converts `"HH:mm"` into minutes since local midnight, which is how daily
 * windows are stored (see `Profile.workingHoursStart`).
 *
 * Returns `null` for anything that is not a valid 24-hour clock time, so
 * callers are forced to handle bad input rather than silently getting `NaN`.
 */
export function parseMinutesFromTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

/** Inverse of {@link parseMinutesFromTime}. Always zero-padded `"HH:mm"`. */
export function formatMinutesAsTime(totalMinutes: number): string {
  const clamped = Math.min(
    Math.max(Math.trunc(totalMinutes), 0),
    MINUTES_PER_DAY - 1,
  );

  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Formats an instant in a specific zone. Centralised so no surface ever
 * renders a date using the server's zone by accident.
 */
export function formatInTimeZone(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "full",
  },
  locale = "en",
): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: zone }).format(
    date,
  );
}

/**
 * The user's local date as `YYYY-MM-DD`. This is the key a future "Today"
 * view will group by, and it must be computed in the user's zone — not the
 * server's — or the day rolls over at the wrong moment.
 */
export function localDateKey(date: Date, timeZone: string): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;

  // `en-CA` yields ISO-8601 (YYYY-MM-DD) ordering across every runtime.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** "Good morning" / "Good afternoon" / "Good evening" in the user's zone. */
export function greetingFor(date: Date, timeZone: string): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;

  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      hour12: false,
    }).format(date),
  );

  if (hour < 12) {
    return "Good morning";
  }

  if (hour < 17) {
    return "Good afternoon";
  }

  return "Good evening";
}

// ===========================================================================
// ZONED DAY BOUNDARIES
// ---------------------------------------------------------------------------
// Everything "today", "overdue" and "upcoming" rests on one question: what
// UTC instant is midnight for THIS user? Get it wrong and a task due at 11pm
// in Kolkata is filed under tomorrow, or an Auckland user sees their day roll
// over at lunchtime.
//
// No date library is used. The two functions below are the whole mechanism,
// and they are heavily unit-tested against a half-hour offset (Asia/Kolkata)
// and both DST transitions (America/New_York).
// ===========================================================================

type WallClockParts = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
};

/** Reads the wall-clock an instant shows in a given zone. */
function wallClockIn(date: Date, timeZone: string): WallClockParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value;
    return value === undefined ? 0 : Number(value);
  };

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // Some ICU builds render midnight as "24" under hour12:false.
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

/**
 * The zone's offset from UTC, in milliseconds, at a specific instant.
 *
 * Derived by formatting the instant in the zone and re-reading those parts as
 * if they were UTC; the difference is the offset. This is offset-agnostic, so
 * :30 and :45 zones work with no special cases.
 */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = wallClockIn(date, timeZone);

  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  // Drop sub-second precision on both sides so the difference is exact.
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The instant at which a given local wall-clock time occurs in a zone.
 *
 * Two passes, because the offset needed to answer the question depends on the
 * answer: the first guess assumes the target's own offset, then the offset is
 * re-read at the resulting instant and applied again if a DST boundary moved
 * it. Without the second pass, times near a transition land an hour out.
 *
 * On a spring-forward gap (02:30 on a US DST morning simply does not exist)
 * this yields the instant the clock jumps to, which is the sane reading of
 * "as early as that time can happen".
 */
export function instantFromLocalTime(
  year: number,
  month: number,
  day: number,
  minutesFromMidnight: number,
  timeZone: string,
): Date {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;

  const hours = Math.floor(minutesFromMidnight / 60);
  const minutes = minutesFromMidnight % 60;
  const naive = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);

  const firstPass = naive - zoneOffsetMs(new Date(naive), zone);
  const correctedOffset = zoneOffsetMs(new Date(firstPass), zone);

  return new Date(naive - correctedOffset);
}

/** Parses the `YYYY-MM-DD` key produced by {@link localDateKey}. */
function parseDateKey(dateKey: string): {
  year: number;
  month: number;
  day: number;
} {
  const [year, month, day] = dateKey.split("-").map(Number);
  return { year: year ?? 1970, month: month ?? 1, day: day ?? 1 };
}

/** The instant at which the user's current local day began. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const { year, month, day } = parseDateKey(localDateKey(date, timeZone));
  return instantFromLocalTime(year, month, day, 0, timeZone);
}

/**
 * The instant at which the user's current local day ends — i.e. the start of
 * the next one. Treat the range as half-open: `[start, end)`.
 */
export function endOfLocalDay(date: Date, timeZone: string): Date {
  return startOfLocalDay(addLocalDays(date, timeZone, 1), timeZone);
}

/**
 * Moves `amount` calendar days in the user's zone.
 *
 * Calendar days, not 24-hour blocks: on a DST transition a local day is 23 or
 * 25 hours long, and adding 86,400,000ms would drift the wall clock.
 */
export function addLocalDays(
  date: Date,
  timeZone: string,
  amount: number,
): Date {
  const { year, month, day } = parseDateKey(localDateKey(date, timeZone));
  const parts = wallClockIn(date, timeZone);

  // Let Date.UTC normalise month/year rollover, then re-anchor in the zone.
  const shifted = new Date(Date.UTC(year, month - 1, day + amount));

  return instantFromLocalTime(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    parts.hour * 60 + parts.minute,
    timeZone,
  );
}

/** The start of the local day `amount` days from now. */
export function startOfLocalDayOffset(
  date: Date,
  timeZone: string,
  amount: number,
): Date {
  return startOfLocalDay(addLocalDays(date, timeZone, amount), timeZone);
}

/** Whether two instants fall on the same calendar day in the user's zone. */
export function isSameLocalDay(a: Date, b: Date, timeZone: string): boolean {
  return localDateKey(a, timeZone) === localDateKey(b, timeZone);
}

/**
 * Whole calendar days from `from` to `to` in the user's zone.
 *
 * Counted between local midnights rather than by dividing elapsed
 * milliseconds, so a DST-shortened day still counts as exactly one day.
 */
export function localDayDifference(
  from: Date,
  to: Date,
  timeZone: string,
): number {
  const fromStart = startOfLocalDay(from, timeZone);
  const toStart = startOfLocalDay(to, timeZone);

  return Math.round(
    (toStart.getTime() - fromStart.getTime()) / (24 * 60 * 60 * 1000),
  );
}

/**
 * Human phrasing for how late something is: "2 days overdue", "3 hours
 * overdue", "just now".
 *
 * Days are counted as calendar days in the user's zone — "1 day overdue" has
 * to mean "yesterday", not "at least 24 hours ago".
 */
export function formatOverdueBy(
  dueAt: Date,
  now: Date,
  timeZone: string,
): string {
  const elapsedMs = now.getTime() - dueAt.getTime();

  if (elapsedMs <= 0) {
    return "";
  }

  const days = localDayDifference(dueAt, now, timeZone);

  if (days >= 1) {
    return days === 1 ? "1 day overdue" : `${days} days overdue`;
  }

  const hours = Math.floor(elapsedMs / (60 * 60 * 1000));

  if (hours >= 1) {
    return hours === 1 ? "1 hour overdue" : `${hours} hours overdue`;
  }

  const minutes = Math.floor(elapsedMs / (60 * 1000));

  return minutes >= 1 ? `${minutes} min overdue` : "Just overdue";
}

/** Compact duration for task rows: "45m", "1h 30m", "2h". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

/**
 * Relative day label for a due date: "Today", "Tomorrow", "Yesterday", or a
 * formatted date. Always resolved in the user's zone.
 */
export function formatDueDateLabel(
  dueAt: Date,
  now: Date,
  timeZone: string,
  locale = "en",
): string {
  const days = localDayDifference(now, dueAt, timeZone);

  if (days === 0) {
    return "Today";
  }

  if (days === 1) {
    return "Tomorrow";
  }

  if (days === -1) {
    return "Yesterday";
  }

  // Within the coming week a weekday name reads faster than a date.
  if (days > 1 && days <= 6) {
    return formatInTimeZone(dueAt, timeZone, { weekday: "long" }, locale);
  }

  const sameYear =
    formatInTimeZone(dueAt, timeZone, { year: "numeric" }, locale) ===
    formatInTimeZone(now, timeZone, { year: "numeric" }, locale);

  return formatInTimeZone(
    dueAt,
    timeZone,
    sameYear
      ? { day: "numeric", month: "short" }
      : { day: "numeric", month: "short", year: "numeric" },
    locale,
  );
}

/** Clock time in the user's zone, e.g. "9:30 pm". */
export function formatTimeOfDay(
  date: Date,
  timeZone: string,
  locale = "en",
): string {
  return formatInTimeZone(
    date,
    timeZone,
    { hour: "numeric", minute: "2-digit" },
    locale,
  );
}

/**
 * `HH:mm` on a 24-hour clock in the given zone.
 *
 * Distinct from {@link formatTimeOfDay}, which is locale-formatted for
 * display. This is the machine-readable form that `<input type="time">`
 * requires, and it must be produced in the PROFILE's zone — reading
 * `date.getHours()` on the client would use the browser's zone instead, which
 * is wrong the moment the two differ.
 */
export function localTimeKey(date: Date, timeZone: string): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);

  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "00";

  // Some ICU builds render midnight as "24" under hour12:false.
  const hour = String(Number(read("hour")) % 24).padStart(2, "0");

  return `${hour}:${read("minute")}`;
}

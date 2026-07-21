/**
 * IANA-timezone math on top of Intl (no dependency, DST-correct).
 * Availability rules live in the business's local time; everything stored
 * and served is UTC instants.
 */

/** Milliseconds the zone is ahead of UTC at the given instant. */
function tzOffsetMs(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(at).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - at.getTime();
}

/** "2026-07-25" + "09:00" in `timeZone` → the UTC instant. */
export function zonedTimeToUtc(
  dateStr: string,
  timeStr: string,
  timeZone: string,
): Date {
  const naive = new Date(`${dateStr}T${timeStr}:00Z`);
  const guess = new Date(naive.getTime() - tzOffsetMs(naive, timeZone));
  // Second pass corrects instants that land across a DST transition.
  const corrected = new Date(naive.getTime() - tzOffsetMs(guess, timeZone));
  return corrected;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type WeekdayKey = (typeof WEEKDAYS)[number];

export function weekdayInTz(at: Date, timeZone: string): WeekdayKey {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  })
    .format(at)
    .toLowerCase()
    .slice(0, 3);
  return short as WeekdayKey;
}

export function dateStrInTz(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Format a UTC instant as local wall-clock time for display. */
export function formatInTz(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

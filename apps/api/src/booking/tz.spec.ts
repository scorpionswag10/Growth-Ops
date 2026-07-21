import { dateStrInTz, formatInTz, weekdayInTz, zonedTimeToUtc } from "./tz";

/**
 * This file is deliberately the most thorough spec in the repo: tz.ts is
 * hand-rolled Intl-based date math with no library backing it, and a wrong
 * UTC offset fails silently — a booking looks correct until the one week a
 * DST transition lands in the wrong place. 2026 US DST: spring-forward March
 * 8 (2am -> 3am, CST/-6 -> CDT/-5), fall-back November 1 (2am -> 1am,
 * CDT/-5 -> CST/-6).
 */
describe("zonedTimeToUtc", () => {
  it("converts correctly in standard time (CST, UTC-6)", () => {
    const at = zonedTimeToUtc("2026-03-01", "09:00", "America/Chicago");
    expect(at.toISOString()).toBe("2026-03-01T15:00:00.000Z");
  });

  it("converts correctly in daylight time (CDT, UTC-5)", () => {
    const at = zonedTimeToUtc("2026-03-15", "09:00", "America/Chicago");
    expect(at.toISOString()).toBe("2026-03-15T14:00:00.000Z");
  });

  it("picks the correct offset the week before spring-forward", () => {
    const at = zonedTimeToUtc("2026-03-06", "09:00", "America/Chicago");
    expect(at.toISOString()).toBe("2026-03-06T15:00:00.000Z"); // CST
  });

  it("picks the correct offset the week after spring-forward", () => {
    const at = zonedTimeToUtc("2026-03-09", "09:00", "America/Chicago");
    expect(at.toISOString()).toBe("2026-03-09T14:00:00.000Z"); // CDT
  });

  it("picks the correct offset the week before fall-back", () => {
    const at = zonedTimeToUtc("2026-10-30", "09:00", "America/Chicago");
    expect(at.toISOString()).toBe("2026-10-30T14:00:00.000Z"); // CDT
  });

  it("picks the correct offset the week after fall-back", () => {
    const at = zonedTimeToUtc("2026-11-02", "09:00", "America/Chicago");
    expect(at.toISOString()).toBe("2026-11-02T15:00:00.000Z"); // CST
  });

  it("is consistent across different US timezones on the same date", () => {
    const chicago = zonedTimeToUtc("2026-07-23", "09:00", "America/Chicago");
    const newYork = zonedTimeToUtc("2026-07-23", "09:00", "America/New_York");
    const losAngeles = zonedTimeToUtc("2026-07-23", "09:00", "America/Los_Angeles");
    // Same wall-clock hour, later zones (further east) are earlier in UTC.
    expect(newYork.getTime()).toBeLessThan(chicago.getTime());
    expect(chicago.getTime()).toBeLessThan(losAngeles.getTime());
    expect(chicago.getTime() - newYork.getTime()).toBe(3_600_000);
    expect(losAngeles.getTime() - chicago.getTime()).toBe(7_200_000);
  });
});

describe("weekdayInTz", () => {
  it("returns the correct weekday key", () => {
    // 2026-07-23T14:00:00Z is 9am CDT on a Thursday (used throughout the
    // real booking flow this session — ground truth, not invented).
    expect(weekdayInTz(new Date("2026-07-23T14:00:00Z"), "America/Chicago")).toBe("thu");
  });

  it("crosses a UTC midnight into the previous local day correctly", () => {
    // 2am UTC on a Thursday is still Wednesday night in Chicago (UTC-5 in July).
    expect(weekdayInTz(new Date("2026-07-23T02:00:00Z"), "America/Chicago")).toBe("wed");
  });
});

describe("dateStrInTz", () => {
  it("returns the local calendar date, not the UTC date", () => {
    // 2am UTC on the 23rd is 9pm local on the 22nd in Chicago (summer, UTC-5).
    expect(dateStrInTz(new Date("2026-07-23T02:00:00Z"), "America/Chicago")).toBe(
      "2026-07-22",
    );
  });

  it("agrees with the UTC date when well clear of midnight", () => {
    expect(dateStrInTz(new Date("2026-07-23T18:00:00Z"), "America/Chicago")).toBe(
      "2026-07-23",
    );
  });
});

describe("formatInTz", () => {
  it("formats a known instant as expected", () => {
    expect(formatInTz(new Date("2026-07-23T14:00:00Z"), "America/Chicago")).toBe(
      "Thu, Jul 23, 9:00 AM",
    );
  });
});

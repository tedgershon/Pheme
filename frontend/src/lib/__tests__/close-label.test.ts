import { describe, expect, it } from "vitest";
import { closesWithinADay, formatTimeUntilClose } from "../datetime";

const now = new Date("2026-11-27T12:00:00Z").getTime();
const at = (ms: number) => new Date(now + ms).toISOString();
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

describe("formatTimeUntilClose", () => {
  it("counts down in minutes under an hour", () => {
    expect(formatTimeUntilClose(at(42 * minute), now)).toBe("Closes in 42m");
    expect(formatTimeUntilClose(at(20_000), now)).toBe("Closes in 1m");
  });

  it("shows hours and minutes under a day", () => {
    expect(formatTimeUntilClose(at(5 * hour + 12 * minute), now)).toBe(
      "Closes in 5h 12m",
    );
    expect(formatTimeUntilClose(at(day - minute), now)).toBe(
      "Closes in 23h 59m",
    );
  });

  it("shows whole days under 30 days", () => {
    expect(formatTimeUntilClose(at(day), now)).toBe("Closes in 1 day");
    expect(formatTimeUntilClose(at(3 * day + 2 * hour), now)).toBe(
      "Closes in 3 days",
    );
    expect(formatTimeUntilClose(at(29 * day + 23 * hour), now)).toBe(
      "Closes in 30 days",
    );
  });

  it("shows the date from 30 days out, with the year when it differs", () => {
    expect(formatTimeUntilClose("2026-12-29T17:00:00Z", now)).toBe(
      "Closes Dec 29",
    );
    expect(formatTimeUntilClose("2027-03-01T17:00:00Z", now)).toBe(
      "Closes Mar 1, 2027",
    );
  });

  it("handles closed and invalid dates", () => {
    expect(formatTimeUntilClose(at(-minute), now)).toBe("Closed");
    expect(formatTimeUntilClose("not a date", now)).toBe("—");
  });
});

describe("closesWithinADay", () => {
  it("is true only while the countdown is in hours and minutes", () => {
    expect(closesWithinADay(at(3 * hour), now)).toBe(true);
    expect(closesWithinADay(at(day), now)).toBe(false);
    expect(closesWithinADay(at(-hour), now)).toBe(false);
  });
});

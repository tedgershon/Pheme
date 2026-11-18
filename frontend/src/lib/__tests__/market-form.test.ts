import { describe, expect, it } from "vitest";
import {
  MAX_MARKET_OPTION_LENGTH,
  MAX_MARKET_TITLE_LENGTH,
} from "../constants";
import { formatInstantInZone, zonedLocalDateTimeToUtcDate } from "../datetime";
import {
  closeAtPickerBounds,
  type MarketFormValues,
  mapFieldErrors,
  normalizeFieldPath,
  validateMarketForm,
} from "../market-form";

const NOW = new Date("2026-06-01T12:00:00Z");

function values(overrides: Partial<MarketFormValues> = {}): MarketFormValues {
  return {
    title: "Will CMU win?",
    description: "A description",
    closeAt: "2026-07-01T12:00",
    closeTimezone: "UTC",
    resolutionCriteria: "Official result",
    officialSource: "cmu.edu",
    yesCriteria: "Yes",
    noCriteria: "No",
    ambiguityCriteria: "Unclear",
    link: "",
    marketType: "binary",
    options: ["", ""],
    ...overrides,
  };
}

describe("normalizeFieldPath", () => {
  it("strips the body prefix and option label suffix", () => {
    expect(normalizeFieldPath("body.title")).toBe("title");
    expect(normalizeFieldPath("body.options")).toBe("options");
    expect(normalizeFieldPath("body.options.2.label")).toBe("options.2");
    expect(normalizeFieldPath("body.close_at")).toBe("close_at");
  });
});

describe("mapFieldErrors", () => {
  it("maps backend errors to inputs and strips the Pydantic prefix", () => {
    const { byField, unmapped } = mapFieldErrors([
      {
        field: "body.title",
        message: "Value error, Title must be 120 characters or fewer",
      },
      { field: "body.options.1.label", message: "Bad option" },
      { field: "body.close_at", message: "close_at must be soon" },
    ]);
    expect(byField).toEqual({
      title: "Title must be 120 characters or fewer",
      "options.1": "Bad option",
      close_at: "close_at must be soon",
    });
    expect(unmapped).toEqual([]);
  });

  it("keeps the first message per field and surfaces unknown fields", () => {
    const { byField, unmapped } = mapFieldErrors([
      { field: "body.title", message: "first" },
      { field: "body.title", message: "second" },
      { field: "body.market_type", message: "Input should be binary" },
    ]);
    expect(byField).toEqual({ title: "first" });
    expect(unmapped).toEqual(["Input should be binary"]);
  });
});

describe("closeAtPickerBounds", () => {
  it("is now + 1h and now + 180d in the selected zone", () => {
    expect(closeAtPickerBounds(NOW, "UTC")).toEqual({
      min: "2026-06-01T13:00",
      max: "2026-11-28T12:00",
    });
    // EDT is UTC-4 in June; 180 days later it is EST (UTC-5).
    expect(closeAtPickerBounds(NOW, "America/New_York")).toEqual({
      min: "2026-06-01T09:00",
      max: "2026-11-28T07:00",
    });
  });

  it("round-trips through the zoned conversion across a DST change", () => {
    const now = new Date("2026-03-07T12:00:00Z");
    const { min, max } = closeAtPickerBounds(now, "America/New_York");
    expect(zonedLocalDateTimeToUtcDate(min, "America/New_York")).toEqual(
      new Date(now.getTime() + 3_600_000),
    );
    expect(zonedLocalDateTimeToUtcDate(max, "America/New_York")).toEqual(
      new Date(now.getTime() + 180 * 86_400_000),
    );
  });
});

describe("formatInstantInZone", () => {
  it("renders midnight as 00 rather than 24", () => {
    expect(formatInstantInZone(new Date("2026-06-01T00:00:00Z"), "UTC")).toBe(
      "2026-06-01T00:00",
    );
  });
});

describe("validateMarketForm", () => {
  it("accepts a valid binary market", () => {
    expect(validateMarketForm(values(), NOW)).toEqual({});
  });

  it("reports every invalid field at once", () => {
    const errors = validateMarketForm(
      values({
        title: "T".repeat(MAX_MARKET_TITLE_LENGTH + 1),
        description: " ",
        link: "ftp://nope",
      }),
      NOW,
    );
    expect(Object.keys(errors).sort()).toEqual([
      "description",
      "link",
      "title",
    ]);
    expect(errors.title).toBe("Title must be 120 characters or fewer.");
  });

  it("enforces the close date window", () => {
    expect(
      validateMarketForm(values({ closeAt: "2026-06-01T12:30" }), NOW).close_at,
    ).toMatch(/at least 1 hour/);
    expect(
      validateMarketForm(values({ closeAt: "2027-01-01T12:00" }), NOW).close_at,
    ).toMatch(/within 180 days/);
    expect(
      validateMarketForm(values({ closeAt: "2026-06-01T14:00" }), NOW).close_at,
    ).toBeUndefined();
    expect(validateMarketForm(values({ closeAt: "" }), NOW).close_at).toBe(
      "Close date is required.",
    );
  });

  it("applies the window in the selected timezone", () => {
    // 09:30 New York (EDT) is 13:30 UTC, 1.5h after NOW: valid.
    const ok = values({
      closeAt: "2026-06-01T09:30",
      closeTimezone: "America/New_York",
    });
    expect(validateMarketForm(ok, NOW).close_at).toBeUndefined();
    // The same wall clock in UTC is already in the past.
    expect(
      validateMarketForm({ ...ok, closeTimezone: "UTC" }, NOW).close_at,
    ).toBeDefined();
  });

  it("validates multichoice options per index and as a list", () => {
    const base = values({ marketType: "multichoice" });
    expect(
      validateMarketForm({ ...base, options: ["A", ""] }, NOW).options,
    ).toBe("At least 2 options are required.");
    expect(
      validateMarketForm({ ...base, options: ["Yes", "yes"] }, NOW).options,
    ).toBe("Option labels must be unique.");
    const errors = validateMarketForm(
      { ...base, options: ["A", "B".repeat(MAX_MARKET_OPTION_LENGTH + 1)] },
      NOW,
    );
    expect(errors["options.1"]).toBe("Option must be 80 characters or fewer.");
    expect(errors["options.0"]).toBeUndefined();
  });

  it("does not require binary criteria for multichoice markets", () => {
    const errors = validateMarketForm(
      values({
        marketType: "multichoice",
        options: ["A", "B"],
        yesCriteria: "",
        noCriteria: "",
        ambiguityCriteria: "",
      }),
      NOW,
    );
    expect(errors).toEqual({});
  });
});

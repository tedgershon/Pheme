import {
  MAX_CLOSE_AT_DAYS,
  MAX_MARKET_CRITERIA_LENGTH,
  MAX_MARKET_DESCRIPTION_LENGTH,
  MAX_MARKET_LINK_LENGTH,
  MAX_MARKET_OFFICIAL_SOURCE_LENGTH,
  MAX_MARKET_OPTION_LENGTH,
  MAX_MARKET_RESOLUTION_LENGTH,
  MAX_MARKET_TITLE_LENGTH,
  MIN_CLOSE_AT_HOURS,
} from "./constants";
import { formatInstantInZone, zonedLocalDateTimeToUtcDate } from "./datetime";

export const MAX_OPTIONS = 10;
export const MIN_OPTIONS = 2;

const URL_REGEX = /^https?:\/\/[^\s/$.?#].[^\s]*$/;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Form fields that have an inline error slot on the create-market page. */
const FORM_FIELDS = new Set([
  "title",
  "description",
  "close_at",
  "close_timezone",
  "resolution_criteria",
  "category",
  "official_source",
  "yes_criteria",
  "no_criteria",
  "ambiguity_criteria",
  "link",
  "options",
]);

const OPTION_FIELD = /^options\.\d+$/;

export type FieldErrors = Record<string, string>;

/**
 * The picker bounds for close_at, as wall-clock strings in `timeZone`.
 * The backend window is absolute (now + 1h .. now + 180d), so it is computed
 * on the instant and only then rendered in the selected zone; this stays
 * correct across DST changes.
 */
export function closeAtPickerBounds(now: Date, timeZone: string) {
  return {
    min: formatInstantInZone(
      new Date(now.getTime() + MIN_CLOSE_AT_HOURS * HOUR_MS),
      timeZone,
    ),
    max: formatInstantInZone(
      new Date(now.getTime() + MAX_CLOSE_AT_DAYS * DAY_MS),
      timeZone,
    ),
  };
}

/**
 * Map a backend field path to a form key: "body.title" -> "title",
 * "body.options.2.label" -> "options.2".
 */
export function normalizeFieldPath(field: string): string {
  return field.replace(/^body\./, "").replace(/^(options\.\d+)\.label$/, "$1");
}

/** Pydantic prefixes validator messages with "Value error, "; users should not see it. */
function cleanMessage(message: string): string {
  return message.replace(/^Value error,\s*/, "");
}

/**
 * Split backend field errors into per-input messages and messages for fields
 * the form has no input for (shown at form level so none are silently lost).
 * When one field has several errors, the first is shown.
 */
export function mapFieldErrors(
  fieldErrors: { field: string; message: string }[],
): { byField: FieldErrors; unmapped: string[] } {
  const byField: FieldErrors = {};
  const unmapped: string[] = [];
  for (const { field, message } of fieldErrors) {
    const key = normalizeFieldPath(field);
    const text = cleanMessage(message);
    if (FORM_FIELDS.has(key) || OPTION_FIELD.test(key)) {
      byField[key] ??= text;
    } else {
      unmapped.push(text);
    }
  }
  return { byField, unmapped };
}

export interface MarketFormValues {
  title: string;
  description: string;
  closeAt: string;
  closeTimezone: string;
  resolutionCriteria: string;
  officialSource: string;
  yesCriteria: string;
  noCriteria: string;
  ambiguityCriteria: string;
  link: string;
  marketType: "binary" | "multichoice";
  options: string[];
}

function requiredText(
  errors: FieldErrors,
  key: string,
  label: string,
  value: string,
  max: number,
) {
  const trimmed = value.trim();
  if (!trimmed) errors[key] = `${label} is required.`;
  else if (trimmed.length > max) {
    errors[key] = `${label} must be ${max} characters or fewer.`;
  }
}

/** Client-side pre-check mirroring the backend validators; reports every invalid field. */
export function validateMarketForm(
  values: MarketFormValues,
  now: Date,
): FieldErrors {
  const errors: FieldErrors = {};

  requiredText(errors, "title", "Title", values.title, MAX_MARKET_TITLE_LENGTH);
  requiredText(
    errors,
    "description",
    "Description",
    values.description,
    MAX_MARKET_DESCRIPTION_LENGTH,
  );
  requiredText(
    errors,
    "resolution_criteria",
    "Resolution criteria",
    values.resolutionCriteria,
    MAX_MARKET_RESOLUTION_LENGTH,
  );
  requiredText(
    errors,
    "official_source",
    "Official source",
    values.officialSource,
    MAX_MARKET_OFFICIAL_SOURCE_LENGTH,
  );

  if (!values.closeAt) {
    errors.close_at = "Close date is required.";
  } else {
    const closeDate = zonedLocalDateTimeToUtcDate(
      values.closeAt,
      values.closeTimezone,
    );
    if (!closeDate || Number.isNaN(closeDate.getTime())) {
      errors.close_at = "Close date and timezone are invalid.";
    } else if (
      closeDate.getTime() <
      now.getTime() + MIN_CLOSE_AT_HOURS * HOUR_MS
    ) {
      errors.close_at = `Close date must be at least ${MIN_CLOSE_AT_HOURS} hour from now.`;
    } else if (
      closeDate.getTime() >
      now.getTime() + MAX_CLOSE_AT_DAYS * DAY_MS
    ) {
      errors.close_at = `Close date must be within ${MAX_CLOSE_AT_DAYS} days from now.`;
    }
  }

  const link = values.link.trim();
  if (link.length > MAX_MARKET_LINK_LENGTH) {
    errors.link = `Link must be ${MAX_MARKET_LINK_LENGTH} characters or fewer.`;
  } else if (link && !URL_REGEX.test(link)) {
    errors.link = "Invalid URL. Must start with http:// or https://";
  }

  if (values.marketType === "binary") {
    requiredText(
      errors,
      "yes_criteria",
      "Yes criteria",
      values.yesCriteria,
      MAX_MARKET_CRITERIA_LENGTH,
    );
    requiredText(
      errors,
      "no_criteria",
      "No criteria",
      values.noCriteria,
      MAX_MARKET_CRITERIA_LENGTH,
    );
    requiredText(
      errors,
      "ambiguity_criteria",
      "Ambiguity criteria",
      values.ambiguityCriteria,
      MAX_MARKET_CRITERIA_LENGTH,
    );
  } else {
    const filled = values.options
      .map((label, index) => ({ label: label.trim(), index }))
      .filter((option) => option.label);
    if (filled.length < MIN_OPTIONS) {
      errors.options = `At least ${MIN_OPTIONS} options are required.`;
    } else if (
      new Set(filled.map((option) => option.label.toLowerCase())).size !==
      filled.length
    ) {
      errors.options = "Option labels must be unique.";
    }
    for (const { label, index } of filled) {
      if (label.length > MAX_MARKET_OPTION_LENGTH) {
        errors[`options.${index}`] =
          `Option must be ${MAX_MARKET_OPTION_LENGTH} characters or fewer.`;
      }
    }
  }

  return errors;
}

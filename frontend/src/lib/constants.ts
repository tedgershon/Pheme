/** Short admin-facing labels for market statuses, shared by every admin badge. */
export const MARKET_STATUS_BADGES: Record<
  string,
  { label: string; className: string }
> = {
  pending_review: {
    label: "Pending Approval",
    className: "bg-warning-foreground text-warning",
  },
  denied: { label: "Denied", className: "bg-muted text-muted-foreground" },
  open: { label: "Open", className: "bg-success-foreground text-success" },
  closed: { label: "Closed", className: "bg-muted text-muted-foreground" },
  pending_resolution: {
    label: "Pending Resolution",
    className: "bg-warning-foreground text-warning",
  },
  disputed: {
    label: "Disputed",
    className: "bg-danger-foreground text-danger",
  },
  admin_review: {
    label: "Pending Admin",
    className: "bg-warning-foreground text-warning",
  },
  resolved: { label: "Resolved", className: "bg-primary/10 text-primary" },
};

export const CATEGORIES = [
  "General",
  "Academics",
  "Campus Life",
  "Sports & Clubs",
  "Tech",
  "Politics",
];

export const TIME_ZONE_OPTIONS = [
  { value: "America/New_York", label: "Eastern (EST/EDT)" },
  { value: "America/Chicago", label: "Central (CST/CDT)" },
  { value: "America/Denver", label: "Mountain (MST/MDT)" },
  { value: "America/Los_Angeles", label: "Pacific (PST/PDT)" },
  { value: "America/Phoenix", label: "Arizona (MST)" },
  { value: "Pacific/Honolulu", label: "Hawaii (HST)" },
  { value: "UTC", label: "UTC" },
];

// Keep in sync with backend/schemas/market.py.
export const MAX_MARKET_TITLE_LENGTH = 120;
export const MAX_MARKET_DESCRIPTION_LENGTH = 800;
export const MAX_MARKET_RESOLUTION_LENGTH = 800;
export const MAX_MARKET_OFFICIAL_SOURCE_LENGTH = 200;
export const MAX_MARKET_CRITERIA_LENGTH = 400;
export const MAX_MARKET_LINK_LENGTH = 500;
export const MAX_MARKET_OPTION_LENGTH = 80;
export const MIN_CLOSE_AT_HOURS = 1;
export const MAX_CLOSE_AT_DAYS = 180;
export const MAX_MARKET_REVIEW_NOTES_LENGTH = 1000;

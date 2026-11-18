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

export const MAX_MARKET_TITLE_LENGTH = 160;
export const MAX_MARKET_DESCRIPTION_LENGTH = 2000;
export const MAX_MARKET_RESOLUTION_LENGTH = 2000;
export const MAX_MARKET_OFFICIAL_SOURCE_LENGTH = 300;
export const MAX_MARKET_CRITERIA_LENGTH = 1000;
export const MAX_MARKET_LINK_LENGTH = 2048;
export const MAX_MARKET_OPTION_LENGTH = 80;
export const MAX_MARKET_REVIEW_NOTES_LENGTH = 1000;

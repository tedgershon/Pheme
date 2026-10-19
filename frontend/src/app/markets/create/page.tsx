"use client";

import { ArrowLeft, Info, Plus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  CATEGORIES,
  MAX_MARKET_CRITERIA_LENGTH,
  MAX_MARKET_DESCRIPTION_LENGTH,
  MAX_MARKET_LINK_LENGTH,
  MAX_MARKET_OFFICIAL_SOURCE_LENGTH,
  MAX_MARKET_OPTION_LENGTH,
  MAX_MARKET_RESOLUTION_LENGTH,
  MAX_MARKET_TITLE_LENGTH,
  TIME_ZONE_OPTIONS,
} from "@/lib/constants";
import { useCreateMarket } from "@/lib/query/mutations/markets";

const URL_REGEX = /^https?:\/\/[^\s/$.?#].[^\s]*$/;
const MAX_OPTIONS = 10;
const MIN_OPTIONS = 2;

function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
}

function parseDateTimeLocal(value: string) {
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

function zonedLocalDateTimeToUtcDate(
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

export default function CreateMarketPage() {
  const createMarket = useCreateMarket();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [closeAt, setCloseAt] = useState("");
  const [closeTimezone, setCloseTimezone] = useState(getBrowserTimeZone);
  const [resolutionCriteria, setResolutionCriteria] = useState("");
  const [officialSource, setOfficialSource] = useState("");
  const [yesCriteria, setYesCriteria] = useState("");
  const [noCriteria, setNoCriteria] = useState("");
  const [ambiguityCriteria, setAmbiguityCriteria] = useState("");
  const [category, setCategory] = useState("General");
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [marketType, setMarketType] = useState<"binary" | "multichoice">(
    "binary",
  );
  const [multichoiceType, setMultichoiceType] = useState<
    "exclusive" | "non_exclusive"
  >("exclusive");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function addOption() {
    if (options.length < MAX_OPTIONS) {
      setOptions([...options, ""]);
    }
  }

  function removeOption(index: number) {
    if (options.length > MIN_OPTIONS) {
      setOptions(options.filter((_, i) => i !== index));
    }
  }

  function updateOption(index: number, value: string) {
    const next = [...options];
    next[index] = value;
    setOptions(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLinkError(null);

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (title.trim().length > MAX_MARKET_TITLE_LENGTH) {
      setError(`Title must be ${MAX_MARKET_TITLE_LENGTH} characters or fewer.`);
      return;
    }
    if (!description.trim()) {
      setError("Description is required.");
      return;
    }
    if (description.trim().length > MAX_MARKET_DESCRIPTION_LENGTH) {
      setError(
        `Description must be ${MAX_MARKET_DESCRIPTION_LENGTH} characters or fewer.`,
      );
      return;
    }
    if (!closeAt) {
      setError("Close date is required.");
      return;
    }
    const convertedCloseAt = zonedLocalDateTimeToUtcDate(
      closeAt,
      closeTimezone,
    );
    if (!convertedCloseAt) {
      setError("Close date and timezone are invalid.");
      return;
    }
    if (convertedCloseAt <= new Date()) {
      setError("Close date must be in the future.");
      return;
    }
    if (!resolutionCriteria.trim()) {
      setError("Resolution criteria is required.");
      return;
    }
    if (resolutionCriteria.trim().length > MAX_MARKET_RESOLUTION_LENGTH) {
      setError(
        `Resolution criteria must be ${MAX_MARKET_RESOLUTION_LENGTH} characters or fewer.`,
      );
      return;
    }
    if (link.trim().length > MAX_MARKET_LINK_LENGTH) {
      setLinkError(
        `Link must be ${MAX_MARKET_LINK_LENGTH} characters or fewer.`,
      );
      return;
    }
    if (link && !URL_REGEX.test(link)) {
      setLinkError("Invalid URL. Must start with http:// or https://");
      return;
    }
    if (!officialSource.trim()) {
      setError("Official source is required.");
      return;
    }
    if (officialSource.trim().length > MAX_MARKET_OFFICIAL_SOURCE_LENGTH) {
      setError(
        `Official source must be ${MAX_MARKET_OFFICIAL_SOURCE_LENGTH} characters or fewer.`,
      );
      return;
    }

    if (marketType === "binary") {
      if (!yesCriteria.trim()) {
        setError("Yes criteria is required.");
        return;
      }
      if (yesCriteria.trim().length > MAX_MARKET_CRITERIA_LENGTH) {
        setError(
          `Yes criteria must be ${MAX_MARKET_CRITERIA_LENGTH} characters or fewer.`,
        );
        return;
      }
      if (!noCriteria.trim()) {
        setError("No criteria is required.");
        return;
      }
      if (noCriteria.trim().length > MAX_MARKET_CRITERIA_LENGTH) {
        setError(
          `No criteria must be ${MAX_MARKET_CRITERIA_LENGTH} characters or fewer.`,
        );
        return;
      }
      if (!ambiguityCriteria.trim()) {
        setError("Ambiguity criteria is required.");
        return;
      }
      if (ambiguityCriteria.trim().length > MAX_MARKET_CRITERIA_LENGTH) {
        setError(
          `Ambiguity criteria must be ${MAX_MARKET_CRITERIA_LENGTH} characters or fewer.`,
        );
        return;
      }
    }

    if (marketType === "multichoice") {
      const filledOptions = options.filter((o) => o.trim());
      if (filledOptions.length < MIN_OPTIONS) {
        setError(`At least ${MIN_OPTIONS} options are required.`);
        return;
      }
      if (
        filledOptions.some((o) => o.trim().length > MAX_MARKET_OPTION_LENGTH)
      ) {
        setError(
          `Each option must be ${MAX_MARKET_OPTION_LENGTH} characters or fewer.`,
        );
        return;
      }
      if (new Set(filledOptions).size !== filledOptions.length) {
        setError("Option labels must be unique.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const base = {
        title: title.trim(),
        description: description.trim(),
        close_at: convertedCloseAt.toISOString(),
        close_timezone: closeTimezone,
        resolution_criteria: resolutionCriteria.trim(),
        category,
        official_source: officialSource.trim(),
        link: link.trim() || undefined,
        market_type: marketType,
      };

      if (marketType === "binary") {
        await createMarket.mutateAsync({
          ...base,
          yes_criteria: yesCriteria.trim(),
          no_criteria: noCriteria.trim(),
          ambiguity_criteria: ambiguityCriteria.trim(),
        });
      } else {
        await createMarket.mutateAsync({
          ...base,
          multichoice_type: multichoiceType,
          options: options.filter((o) => o.trim()).map((o) => o.trim()),
        });
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create market.");
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

  if (submitted) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
          <div className="text-4xl">🎉</div>
          <h1 className="text-2xl font-bold tracking-tight">
            Market Submitted!
          </h1>
          <p className="text-sm text-muted-foreground max-w-md">
            Your market has been submitted for review! You&apos;ll be notified
            when an admin approves it.
          </p>
          <Link href="/">
            <Button variant="outline">Back to Home</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to markets
      </Link>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Create a Market</h1>
        <p className="text-sm text-muted-foreground">
          Define your prediction market for the CMU community
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="grid gap-4 lg:grid-cols-[2fr_1fr]"
      >
        <div className="space-y-4">
          {/* Market type selector */}
          <Card size="sm">
            <CardHeader className="pb-0">
              <span className="text-sm font-medium">Market Type</span>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="marketType"
                    value="binary"
                    checked={marketType === "binary"}
                    onChange={() => setMarketType("binary")}
                    className="accent-primary"
                  />
                  <span className="text-sm font-medium">Binary (Yes / No)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="marketType"
                    value="multichoice"
                    checked={marketType === "multichoice"}
                    onChange={() => setMarketType("multichoice")}
                    className="accent-primary"
                  />
                  <span className="text-sm font-medium">Multiple Choice</span>
                </label>
              </div>
            </CardContent>
          </Card>

          {/* Public-facing fields */}
          <Card size="sm">
            <CardHeader className="pb-0">
              <span className="text-sm font-medium">
                Market Details (Public)
              </span>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="title"
                  className="text-sm font-medium text-foreground"
                >
                  Title
                </label>
                <input
                  id="title"
                  type="text"
                  placeholder="Will CMU...?"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={MAX_MARKET_TITLE_LENGTH}
                  className={inputClass}
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="description"
                  className="text-sm font-medium text-foreground"
                >
                  Description
                </label>
                <textarea
                  id="description"
                  placeholder="Describe what this market is about..."
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={MAX_MARKET_DESCRIPTION_LENGTH}
                  className={`${inputClass} resize-none`}
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="link"
                  className="text-sm font-medium text-foreground"
                >
                  Link (optional)
                </label>
                <input
                  id="link"
                  type="url"
                  placeholder="https://example.com/relevant-article"
                  value={link}
                  onChange={(e) => {
                    setLink(e.target.value);
                    setLinkError(null);
                  }}
                  maxLength={MAX_MARKET_LINK_LENGTH}
                  className={`${inputClass} ${linkError ? "border-danger" : ""}`}
                />
                {linkError && (
                  <p className="text-xs text-danger">{linkError}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="resolutionCriteria"
                  className="text-sm font-medium text-foreground"
                >
                  Resolution Criteria
                </label>
                <textarea
                  id="resolutionCriteria"
                  placeholder="How will this market be resolved?"
                  rows={2}
                  value={resolutionCriteria}
                  onChange={(e) => setResolutionCriteria(e.target.value)}
                  maxLength={MAX_MARKET_RESOLUTION_LENGTH}
                  className={`${inputClass} resize-none`}
                />
              </div>
            </CardContent>
          </Card>

          {/* Multichoice options */}
          {marketType === "multichoice" && (
            <Card size="sm">
              <CardHeader className="pb-0">
                <span className="text-sm font-medium">
                  Multiple Choice Settings
                </span>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <span className="text-sm font-medium text-foreground">
                    Outcome Type
                  </span>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="multichoiceType"
                        value="exclusive"
                        checked={multichoiceType === "exclusive"}
                        onChange={() => setMultichoiceType("exclusive")}
                        className="accent-primary"
                      />
                      <span className="text-sm">Mutually Exclusive</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="multichoiceType"
                        value="non_exclusive"
                        checked={multichoiceType === "non_exclusive"}
                        onChange={() => setMultichoiceType("non_exclusive")}
                        className="accent-primary"
                      />
                      <span className="text-sm">Multiple Can Win</span>
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {multichoiceType === "exclusive"
                      ? "Exactly one option wins (e.g., election, competition)"
                      : "Any number of options can be true (e.g., threshold events)"}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">
                      Options
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {options.length} of {MAX_OPTIONS} options
                    </span>
                  </div>
                  {options.map((opt, idx) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: options list is reordered by user
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder={`Option ${idx + 1}`}
                        value={opt}
                        onChange={(e) => updateOption(idx, e.target.value)}
                        maxLength={MAX_MARKET_OPTION_LENGTH}
                        className={inputClass}
                      />
                      {options.length > MIN_OPTIONS && (
                        <button
                          type="button"
                          onClick={() => removeOption(idx)}
                          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        >
                          <X className="size-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={addOption}
                    disabled={options.length >= MAX_OPTIONS}
                  >
                    <Plus className="mr-1 size-4" />
                    Add Option
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Admin-only fields */}
          <Card size="sm" className="border-dashed bg-muted/50">
            <CardHeader className="pb-0">
              <span className="text-sm font-medium">
                Review Information (Admin Only)
              </span>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs text-primary">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                These fields will be reviewed by admins and are not publicly
                displayed.
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="officialSource"
                  className="text-sm font-medium text-foreground"
                >
                  Official Source
                </label>
                <input
                  id="officialSource"
                  type="text"
                  placeholder="e.g. CMU news, official website, verified report"
                  value={officialSource}
                  onChange={(e) => setOfficialSource(e.target.value)}
                  maxLength={MAX_MARKET_OFFICIAL_SOURCE_LENGTH}
                  className={inputClass}
                />
              </div>

              {marketType === "binary" && (
                <>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="yesCriteria"
                      className="text-sm font-medium text-foreground"
                    >
                      Yes Criteria
                    </label>
                    <textarea
                      id="yesCriteria"
                      placeholder="What counts as YES?"
                      rows={2}
                      value={yesCriteria}
                      onChange={(e) => setYesCriteria(e.target.value)}
                      maxLength={MAX_MARKET_CRITERIA_LENGTH}
                      className={`${inputClass} resize-none`}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="noCriteria"
                      className="text-sm font-medium text-foreground"
                    >
                      No Criteria
                    </label>
                    <textarea
                      id="noCriteria"
                      placeholder="What counts as NO?"
                      rows={2}
                      value={noCriteria}
                      onChange={(e) => setNoCriteria(e.target.value)}
                      maxLength={MAX_MARKET_CRITERIA_LENGTH}
                      className={`${inputClass} resize-none`}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="ambiguityCriteria"
                      className="text-sm font-medium text-foreground"
                    >
                      Ambiguity Criteria
                    </label>
                    <textarea
                      id="ambiguityCriteria"
                      placeholder="How should ambiguous or partial outcomes be handled?"
                      rows={2}
                      value={ambiguityCriteria}
                      onChange={(e) => setAmbiguityCriteria(e.target.value)}
                      maxLength={MAX_MARKET_CRITERIA_LENGTH}
                      className={`${inputClass} resize-none`}
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card size="sm">
            <CardHeader className="pb-0">
              <span className="text-sm font-medium">Settings</span>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="closeAt"
                  className="text-sm font-medium text-foreground"
                >
                  Close date &amp; time
                </label>
                <input
                  id="closeAt"
                  type="datetime-local"
                  value={closeAt}
                  onChange={(e) => setCloseAt(e.target.value)}
                  className={inputClass}
                />
                <p className="text-xs text-muted-foreground">
                  Selected timezone: {closeTimezone}
                </p>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="closeTimezone"
                  className="text-sm font-medium text-foreground"
                >
                  Close Date Timezone
                </label>
                <select
                  id="closeTimezone"
                  value={closeTimezone}
                  onChange={(e) => setCloseTimezone(e.target.value)}
                  className={inputClass}
                >
                  {!TIME_ZONE_OPTIONS.some(
                    (tz) => tz.value === closeTimezone,
                  ) && (
                    <option value={closeTimezone}>
                      {closeTimezone} (Browser Default)
                    </option>
                  )}
                  {TIME_ZONE_OPTIONS.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="category"
                  className="text-sm font-medium text-foreground"
                >
                  Category
                </label>
                <select
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className={inputClass}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>

          {error && <p className="text-sm font-medium text-danger">{error}</p>}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={submitting}
          >
            {submitting ? <Spinner /> : "Submit for Review"}
          </Button>
        </div>
      </form>
    </div>
  );
}

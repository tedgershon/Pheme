"use client";

import { ArrowLeft, Info, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CharacterCounter } from "@/components/character-counter";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { parseApiError } from "@/lib/api";
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
import { zonedLocalDateTimeToUtcDate } from "@/lib/datetime";
import {
  closeAtPickerBounds,
  type FieldErrors,
  MAX_OPTIONS,
  MIN_OPTIONS,
  mapFieldErrors,
  normalizeMarketLink,
  validateMarketForm,
} from "@/lib/market-form";
import { useCreateMarket } from "@/lib/query/mutations/markets";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={`${id}-error`} className="text-xs text-danger">
      {message}
    </p>
  );
}

function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-danger">
      *
    </span>
  );
}

function FormSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <h2 className="text-lg font-semibold tracking-tight">
        {title}
        {note && (
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">
            {note}
          </span>
        )}
      </h2>
      {children}
    </section>
  );
}

function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
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
  const [marketType, setMarketType] = useState<"binary" | "multichoice">(
    "binary",
  );
  const [multichoiceType, setMultichoiceType] = useState<
    "exclusive" | "non_exclusive"
  >("exclusive");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [errorsByField, setErrorsByField] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Picker bounds depend on "now", which differs between server and client
  // render, so they are only set after mount (and not recomputed per render).
  const [mountedAt, setMountedAt] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    setMountedAt(new Date());
  }, []);

  const closeAtBounds = useMemo(
    () => (mountedAt ? closeAtPickerBounds(mountedAt, closeTimezone) : null),
    [mountedAt, closeTimezone],
  );

  // Clear only the errors of the field being edited so other messages stay visible.
  function clearError(...keys: string[]) {
    setSubmitError(null);
    setErrorsByField((prev) => {
      if (!keys.some((key) => key in prev)) return prev;
      const next = { ...prev };
      for (const key of keys) delete next[key];
      return next;
    });
  }

  function invalid(key: string) {
    const hasError = Boolean(errorsByField[key]);
    return {
      "aria-invalid": hasError || undefined,
      "aria-describedby": hasError ? `${key}-error` : undefined,
    };
  }

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
    clearError("options", `options.${index}`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const clientErrors = validateMarketForm(
      {
        title,
        description,
        closeAt,
        closeTimezone,
        resolutionCriteria,
        officialSource,
        yesCriteria,
        noCriteria,
        ambiguityCriteria,
        link,
        marketType,
        options,
      },
      new Date(),
    );
    setErrorsByField(clientErrors);
    if (Object.keys(clientErrors).length > 0) return;

    const convertedCloseAt = zonedLocalDateTimeToUtcDate(
      closeAt,
      closeTimezone,
    );
    if (!convertedCloseAt) return;

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
        link: normalizeMarketLink(link) || undefined,
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
      const { code, message, fieldErrors } = parseApiError(
        err,
        "Failed to create market.",
      );
      if (code === "VALIDATION_FAILED" && fieldErrors.length > 0) {
        const { byField, unmapped } = mapFieldErrors(fieldErrors);
        setErrorsByField(byField);
        setSubmitError(unmapped.length > 0 ? unmapped.join(" ") : null);
      } else {
        setErrorsByField({});
        setSubmitError(message);
      }
      setSubmitting(false);
    }
  }

  const baseInputClass =
    "w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";
  const inputClassFor = (key: string, extra = "") =>
    `${baseInputClass}${extra}${errorsByField[key] ? " border-danger" : ""}`;

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
      </div>

      <form
        onSubmit={handleSubmit}
        className="grid gap-8 lg:grid-cols-[2fr_1fr] lg:gap-12"
      >
        <div className="space-y-6">
          {/* Market type selector */}
          <FormSection title="Market Type">
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
          </FormSection>

          {/* Public-facing fields */}
          <FormSection title="Market Details" note="(Public)">
            <div className="space-y-1.5">
              <label
                htmlFor="title"
                className="text-sm font-medium text-foreground"
              >
                Title
                <RequiredMark />
              </label>
              <input
                id="title"
                type="text"
                placeholder="Will CMU...?"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  clearError("title");
                }}
                maxLength={MAX_MARKET_TITLE_LENGTH}
                className={inputClassFor("title")}
                aria-required="true"
                {...invalid("title")}
              />
              <FieldError id="title" message={errorsByField.title} />
              <CharacterCounter value={title} max={MAX_MARKET_TITLE_LENGTH} />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="description"
                className="text-sm font-medium text-foreground"
              >
                Description
                <RequiredMark />
              </label>
              <textarea
                id="description"
                placeholder="Describe what this market is about..."
                rows={3}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  clearError("description");
                }}
                maxLength={MAX_MARKET_DESCRIPTION_LENGTH}
                className={inputClassFor("description", " resize-none")}
                aria-required="true"
                {...invalid("description")}
              />
              <FieldError
                id="description"
                message={errorsByField.description}
              />
              <CharacterCounter
                value={description}
                max={MAX_MARKET_DESCRIPTION_LENGTH}
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
                type="text"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="example.com/relevant-article"
                value={link}
                onChange={(e) => {
                  setLink(e.target.value);
                  clearError("link");
                }}
                onBlur={() =>
                  setLink((current) => normalizeMarketLink(current))
                }
                maxLength={MAX_MARKET_LINK_LENGTH}
                className={inputClassFor("link")}
                {...invalid("link")}
              />
              <FieldError id="link" message={errorsByField.link} />
              <CharacterCounter value={link} max={MAX_MARKET_LINK_LENGTH} />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="resolutionCriteria"
                className="text-sm font-medium text-foreground"
              >
                Resolution Criteria
                <RequiredMark />
              </label>
              <textarea
                id="resolutionCriteria"
                placeholder="How will this market be resolved?"
                rows={2}
                value={resolutionCriteria}
                onChange={(e) => {
                  setResolutionCriteria(e.target.value);
                  clearError("resolution_criteria");
                }}
                maxLength={MAX_MARKET_RESOLUTION_LENGTH}
                className={inputClassFor("resolution_criteria", " resize-none")}
                aria-required="true"
                {...invalid("resolution_criteria")}
              />
              <FieldError
                id="resolution_criteria"
                message={errorsByField.resolution_criteria}
              />
              <CharacterCounter
                value={resolutionCriteria}
                max={MAX_MARKET_RESOLUTION_LENGTH}
              />
            </div>
          </FormSection>

          {/* Multichoice options */}
          {marketType === "multichoice" && (
            <FormSection title="Multiple Choice Settings">
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
                    <RequiredMark />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {options.length} of {MAX_OPTIONS} options
                  </span>
                </div>
                {options.map((opt, idx) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: options list is reordered by user
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder={`Option ${idx + 1}`}
                        value={opt}
                        onChange={(e) => updateOption(idx, e.target.value)}
                        maxLength={MAX_MARKET_OPTION_LENGTH}
                        className={inputClassFor(`options.${idx}`)}
                        {...invalid(`options.${idx}`)}
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
                    <FieldError
                      id={`options.${idx}`}
                      message={errorsByField[`options.${idx}`]}
                    />
                    <CharacterCounter
                      value={opt}
                      max={MAX_MARKET_OPTION_LENGTH}
                    />
                  </div>
                ))}
                <FieldError id="options" message={errorsByField.options} />
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
            </FormSection>
          )}

          {/* Admin-only fields */}
          <FormSection title="Review Information" note="(Admin Only)">
            <div className="flex items-start gap-2 rounded-md bg-brand-tint px-3 py-2 text-xs text-brand-tint-foreground">
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
                <RequiredMark />
              </label>
              <input
                id="officialSource"
                type="text"
                placeholder="e.g. CMU news, official website, verified report"
                value={officialSource}
                onChange={(e) => {
                  setOfficialSource(e.target.value);
                  clearError("official_source");
                }}
                maxLength={MAX_MARKET_OFFICIAL_SOURCE_LENGTH}
                className={inputClassFor("official_source")}
                aria-required="true"
                {...invalid("official_source")}
              />
              <FieldError
                id="official_source"
                message={errorsByField.official_source}
              />
              <CharacterCounter
                value={officialSource}
                max={MAX_MARKET_OFFICIAL_SOURCE_LENGTH}
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
                    <RequiredMark />
                  </label>
                  <textarea
                    id="yesCriteria"
                    placeholder="What counts as YES?"
                    rows={2}
                    value={yesCriteria}
                    onChange={(e) => {
                      setYesCriteria(e.target.value);
                      clearError("yes_criteria");
                    }}
                    maxLength={MAX_MARKET_CRITERIA_LENGTH}
                    className={inputClassFor("yes_criteria", " resize-none")}
                    aria-required="true"
                    {...invalid("yes_criteria")}
                  />
                  <FieldError
                    id="yes_criteria"
                    message={errorsByField.yes_criteria}
                  />
                  <CharacterCounter
                    value={yesCriteria}
                    max={MAX_MARKET_CRITERIA_LENGTH}
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="noCriteria"
                    className="text-sm font-medium text-foreground"
                  >
                    No Criteria
                    <RequiredMark />
                  </label>
                  <textarea
                    id="noCriteria"
                    placeholder="What counts as NO?"
                    rows={2}
                    value={noCriteria}
                    onChange={(e) => {
                      setNoCriteria(e.target.value);
                      clearError("no_criteria");
                    }}
                    maxLength={MAX_MARKET_CRITERIA_LENGTH}
                    className={inputClassFor("no_criteria", " resize-none")}
                    aria-required="true"
                    {...invalid("no_criteria")}
                  />
                  <FieldError
                    id="no_criteria"
                    message={errorsByField.no_criteria}
                  />
                  <CharacterCounter
                    value={noCriteria}
                    max={MAX_MARKET_CRITERIA_LENGTH}
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="ambiguityCriteria"
                    className="text-sm font-medium text-foreground"
                  >
                    Ambiguity Criteria
                    <RequiredMark />
                  </label>
                  <textarea
                    id="ambiguityCriteria"
                    placeholder="How should ambiguous or partial outcomes be handled?"
                    rows={2}
                    value={ambiguityCriteria}
                    onChange={(e) => {
                      setAmbiguityCriteria(e.target.value);
                      clearError("ambiguity_criteria");
                    }}
                    maxLength={MAX_MARKET_CRITERIA_LENGTH}
                    className={inputClassFor(
                      "ambiguity_criteria",
                      " resize-none",
                    )}
                    aria-required="true"
                    {...invalid("ambiguity_criteria")}
                  />
                  <FieldError
                    id="ambiguity_criteria"
                    message={errorsByField.ambiguity_criteria}
                  />
                  <CharacterCounter
                    value={ambiguityCriteria}
                    max={MAX_MARKET_CRITERIA_LENGTH}
                  />
                </div>
              </>
            )}
          </FormSection>
        </div>

        <div className="space-y-6">
          <FormSection title="Settings">
            <div className="space-y-1.5">
              <label
                htmlFor="closeAt"
                className="text-sm font-medium text-foreground"
              >
                Close date &amp; time
                <RequiredMark />
              </label>
              <input
                id="closeAt"
                type="datetime-local"
                value={closeAt}
                min={closeAtBounds?.min}
                max={closeAtBounds?.max}
                onChange={(e) => {
                  setCloseAt(e.target.value);
                  clearError("close_at");
                }}
                className={inputClassFor("close_at")}
                {...invalid("close_at")}
              />
              <FieldError id="close_at" message={errorsByField.close_at} />
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
                onChange={(e) => {
                  setCloseTimezone(e.target.value);
                  clearError("close_at", "close_timezone");
                }}
                className={inputClassFor("close_timezone")}
                {...invalid("close_timezone")}
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
              <FieldError
                id="close_timezone"
                message={errorsByField.close_timezone}
              />
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
                onChange={(e) => {
                  setCategory(e.target.value);
                  clearError("category");
                }}
                className={inputClassFor("category")}
                {...invalid("category")}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <FieldError id="category" message={errorsByField.category} />
            </div>
          </FormSection>

          {submitError && (
            <p role="alert" className="text-sm font-medium text-danger">
              {submitError}
            </p>
          )}

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

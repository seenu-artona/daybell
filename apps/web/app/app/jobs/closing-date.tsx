"use client";

import { closingDay, endOfLocalDay, localDay, MAX_CLOSING_DAYS } from "@daybell/core";
import { Field } from "@daybell/ui";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

/**
 * A job's closing date (ADR 0021, Q2): the person picks the last day to order; the shop closes at midnight at the end
 * of that day in their own time zone, which the hint names. It is stored as that exact moment, and everyone sees it in
 * their own local time. There is no studio time zone yet (follow-up).
 */

/** The person's time zone in words, e.g. "Pacific Time", from the browser; never hard-coded. */
export function useTimeZoneName(): string {
  const locale = useLocale();
  return useMemo(() => {
    const parts = new Intl.DateTimeFormat(locale, { timeZoneName: "longGeneric" }).formatToParts(
      new Date(),
    );
    return (
      parts.find((p) => p.type === "timeZoneName")?.value ??
      Intl.DateTimeFormat().resolvedOptions().timeZone
    );
  }, [locale]);
}

/** A closing moment in the viewer's own local time, e.g. "Nov 21, 2026, 12:00 AM". */
export function useFormatClosing(): (closesAt: string) => string {
  const format = useFormatter();
  return (closesAt) =>
    format.dateTime(new Date(closesAt), { dateStyle: "medium", timeStyle: "short" });
}

/** The date field's value for a job's closing moment ("" for none). */
export function closingFieldValue(closesAt: string | null): string {
  return closesAt ? closingDay(closesAt) : "";
}

/** What to send for the field's value: the end of that local day, or null to remove it. */
export function closesAtFor(day: string): string | null {
  return day ? endOfLocalDay(day).toISOString() : null;
}

/** The labelled date field, from today to MAX_CLOSING_DAYS − 1 days ahead, with the time zone in its hint. */
export function ClosingDateField({
  value,
  onChange,
  error,
  label,
}: {
  value: string;
  onChange: (day: string) => void;
  error?: string | undefined;
  label?: string;
}) {
  const t = useTranslations("app.job.closing");
  const zone = useTimeZoneName();
  const today = new Date();
  const last = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + MAX_CLOSING_DAYS - 1,
  );
  return (
    <Field
      label={label ?? t("label")}
      type="date"
      value={value}
      min={localDay(today)}
      max={localDay(last)}
      onChange={(e) => onChange(e.target.value)}
      help={t("hint", { zone })}
      error={error}
    />
  );
}

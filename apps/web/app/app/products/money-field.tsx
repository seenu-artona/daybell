"use client";

import type { Currency } from "@daybell/core";
import { useTranslations } from "next-intl";
import { useId } from "react";

/**
 * A price input (ADR 0019): a labelled text field (inputmode decimal, so phones and tablets show numbers) with the
 * dollar sign and the currency code shown as text beside it, and the currency read out with the field. What is typed
 * is read with parseMoneyInput into whole cents by the form; it never goes through a float (D96). The error, or the
 * help, is under the field and linked to it.
 */
export function MoneyField({
  label,
  value,
  onChange,
  currency,
  error,
  help,
  name,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  currency: Currency;
  error?: string | undefined;
  help?: string | undefined;
  name?: string;
}) {
  const t = useTranslations("app.products");
  const id = useId();
  const note = error ?? help;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label text-ink">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-sm font-semibold text-muted">
          {t("symbol")}
        </span>
        <input
          id={id}
          name={name}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-currency${note ? ` ${id}-note` : ""}`}
          className={`min-h-11 w-36 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink tabular-nums hover:border-muted focus:border-primary focus:shadow-[0_0_0_3px_var(--color-primary-soft)] focus:outline-none ${error ? "border-danger bg-danger-soft" : ""}`}
        />
        <span aria-hidden="true" className="text-caption text-muted">
          {currency}
        </span>
        <span id={`${id}-currency`} className="sr-only">
          {t("currency", { currency })}
        </span>
      </div>
      {note ? (
        <span id={`${id}-note`} className={`text-caption ${error ? "text-danger" : "text-muted"}`}>
          {note}
        </span>
      ) : null}
    </div>
  );
}

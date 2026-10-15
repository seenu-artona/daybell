"use client";

import type { Currency } from "@daybell/core";
import { isJobPrice, moneyInputText, parseMoneyInput } from "@daybell/core";
import { cn } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { moneyInputClass } from "../../../products/money-input-class";

/**
 * This job's price for one row (D157; N4, Seenu: like Shopify): a text field (decimal keyboard) holding the price in
 * dollars and cents. Enter or leaving the field saves; Escape puts the saved price back. What is typed is read into
 * whole cents with parseMoneyInput, never through a float (D96). The list's own price typed back is a save too: the
 * server clears the job's price (D157's undo). The label is visually hidden ("Price for this job: Package A"); an error
 * is under the field and linked to it.
 */
export function PriceCell({
  name,
  cents,
  currency,
  onSave,
}: {
  /** The product's name, for the field's label. */
  name: string;
  cents: number;
  currency: Currency;
  /** Saves a new price; answers an error to show, or null once saved. */
  onSave: (cents: number) => Promise<string | null>;
}) {
  const t = useTranslations("app.job.shop");
  const tp = useTranslations("app.products");
  const text = useApiText();
  const id = useId();
  const [value, setValue] = useState(moneyInputText(cents));
  const [error, setError] = useState<string | null>(null);
  // Read and set synchronously, so Enter followed by the blur it causes saves once: a save is running, or the text
  // hasn't changed since the last one was sent (a refused price isn't sent again on blur).
  const saving = useRef(false);
  const sent = useRef<number | null>(null);

  // A new saved price (this save, Undo, or another tab's change after a reload) replaces what the field shows.
  useEffect(() => {
    setValue(moneyInputText(cents));
    setError(null);
    sent.current = null;
  }, [cents]);

  async function commit() {
    if (saving.current) return;
    const typed = parseMoneyInput(value);
    if (typed === null || !isJobPrice(typed)) {
      setError(text.field("validation.price") ?? null);
      return;
    }
    if (typed === sent.current) return;
    if (typed === cents) {
      setValue(moneyInputText(cents));
      setError(null);
      return;
    }
    saving.current = true;
    sent.current = typed;
    const problem = await onSave(typed);
    saving.current = false;
    setError(problem);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setValue(moneyInputText(cents));
      setError(null);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="sr-only">
        {t("priceLabel", { name })}
      </label>
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className="text-sm font-semibold text-muted">
          {tp("symbol")}
        </span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => {
            sent.current = null;
            setValue(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => void commit()}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-currency${error ? ` ${id}-error` : ""}`}
          className={cn(moneyInputClass(Boolean(error)), "w-28")}
        />
        <span id={`${id}-currency`} className="sr-only">
          {tp("currency", { currency })}
        </span>
      </div>
      {error ? (
        <span id={`${id}-error`} className="text-caption text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}

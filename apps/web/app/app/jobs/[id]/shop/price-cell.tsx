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
 * is under the field, linked to it and announced. Text typed while a save runs is saved after it, never replaced by
 * the older answer; Enter retries a refused price, leaving the field doesn't send it again.
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
  const apiText = useApiText();
  const textOf = (key: string) => apiText.field(key);
  const id = useId();
  const [value, setValue] = useState(moneyInputText(cents));
  const [error, setError] = useState<string | null>(null);
  // Read and written synchronously (review fixes M2, tester 2–3):
  // - text: what the field holds now, for a save that finishes after more was typed;
  // - saved: the latest saved price (a save may finish before or after the page re-renders with it);
  // - saving: a save is running; typing meanwhile sets editedWhileSaving, and the newer text is saved after it;
  // - refused: a price the server refused, which leaving the field doesn't send again (Enter does: a retry).
  const text = useRef(value);
  const saved = useRef(cents);
  const saving = useRef(false);
  const editedWhileSaving = useRef(false);
  const refused = useRef<number | null>(null);

  const show = (next: string) => {
    text.current = next;
    setValue(next);
  };

  // A new saved price (this save, another change, or a reload) replaces what the field shows, unless newer text was
  // typed since this save began: that text wins and is saved next.
  useEffect(() => {
    saved.current = cents;
    if (editedWhileSaving.current) return;
    text.current = moneyInputText(cents);
    setValue(text.current);
    setError(null);
    refused.current = null;
  }, [cents]);

  async function commit(retry: boolean) {
    if (saving.current) return;
    const typed = parseMoneyInput(text.current);
    if (typed === null || !isJobPrice(typed)) {
      setError(textOf("validation.price") ?? null);
      return;
    }
    if (!retry && typed === refused.current) return;
    if (typed === saved.current) {
      show(moneyInputText(saved.current));
      setError(null);
      refused.current = null;
      return;
    }
    saving.current = true;
    editedWhileSaving.current = false;
    const problem = await onSave(typed);
    saving.current = false;
    refused.current = problem ? typed : null;
    if (!problem) saved.current = typed;
    setError(problem);
    if (editedWhileSaving.current) {
      editedWhileSaving.current = false;
      await commit(false);
    } else if (!problem) {
      show(moneyInputText(typed));
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      show(moneyInputText(saved.current));
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
            if (saving.current) editedWhileSaving.current = true;
            show(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => void commit(false)}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-currency${error ? ` ${id}-error` : ""}`}
          className={cn(moneyInputClass(Boolean(error)), "w-28")}
        />
        <span id={`${id}-currency`} className="sr-only">
          {tp("currency", { currency })}
        </span>
      </div>
      {error ? (
        // An alert, so a refusal is heard where it happens, also after a save made by leaving the field (code M1).
        <span id={`${id}-error`} role="alert" className="text-caption text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}

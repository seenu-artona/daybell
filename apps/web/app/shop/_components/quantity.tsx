"use client";

import { SHOP_MAX_QUANTITY } from "@daybell/core";
import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { shopIconButton } from "./styles";

/** How many, with one fewer / one more buttons (44 px) and the number announced as it changes. */
export function Quantity({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("shop.pose");
  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-1">
      <button
        type="button"
        aria-label={t("decrease")}
        disabled={disabled || value <= 1}
        onClick={() => onChange(value - 1)}
        className={`${shopIconButton} border border-line-strong disabled:opacity-40`}
      >
        <Minus className="size-4" aria-hidden="true" />
      </button>
      <output aria-live="polite" className="min-w-8 text-center font-bold tabular-nums">
        {value}
      </output>
      <button
        type="button"
        aria-label={t("increase")}
        disabled={disabled || value >= SHOP_MAX_QUANTITY}
        onClick={() => onChange(value + 1)}
        className={`${shopIconButton} border border-line-strong disabled:opacity-40`}
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

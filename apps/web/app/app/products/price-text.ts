"use client";

import type { MoneyAmount, PackageLineOut } from "@daybell/api";
import { formatMoney, localeForCurrency, money, type PrintSize } from "@daybell/core";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

/** The editor's address for a list: only its id goes in the URL. */
export function priceListHref(id: string): string {
  return `/app/products/price-lists/${id}`;
}

/** The conflict keys a price list request can be refused with (PRICE_LIST_CONFLICTS), without the "priceLists." prefix. */
const CONFLICTS = [
  "isDefault",
  "inUse",
  "limit",
  "itemLimit",
  "digitalTaken",
  "jobClosed",
] as const;
type ConflictKey = (typeof CONFLICTS)[number];

export function conflictKey(form: string | undefined): ConflictKey | null {
  const key = form?.startsWith("priceLists.") ? form.slice("priceLists.".length) : null;
  return key && (CONFLICTS as readonly string[]).includes(key) ? (key as ConflictKey) : null;
}

/**
 * How price lists read on screen (ADR 0019): money in its own currency's way ("$25.00" for USD and CAD alike, D96),
 * print sizes and package contents in words from the locale files, joined the locale's way.
 */
export function usePriceText() {
  const t = useTranslations("app.products");
  const locale = useLocale();
  return useMemo(() => {
    const size = (s: PrintSize) => t(`sizes.${s}`);
    const list = new Intl.ListFormat(locale, { style: "short", type: "unit" });
    return {
      money: (m: MoneyAmount) =>
        formatMoney(money(m.cents, m.currency), localeForCurrency(m.currency)),
      size,
      contents: (lines: readonly PackageLineOut[]) =>
        list.format(
          lines.map((l) =>
            l.kind === "print" && l.printSize
              ? t("contents.print", { quantity: l.quantity, size: size(l.printSize) })
              : t("contents.digital"),
          ),
        ),
      conflict: (form: string | undefined) => {
        const key = conflictKey(form);
        return key ? t(`conflicts.${key}`) : null;
      },
    };
  }, [t, locale]);
}

"use client";

import type { MoneyAmount, PackageLineOut, ShopChild } from "@daybell/api";
import { closingDay, formatMoney, localeForCurrency } from "@daybell/core";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback } from "react";
import { lockedWait } from "./wait";

/** Money as parents in its currency read it: "$64.00" (D96: whole cents in, text out). */
export function money(amount: MoneyAmount): string {
  return formatMoney(amount, localeForCurrency(amount.currency));
}

/**
 * A picture day (a calendar date), and the last day to order: the day a closing moment ends, as ADR 0021 shows it to
 * studios (closingDay: the shop closes at the midnight that ends it), not the date of that midnight (code review N6).
 */
export function useShopDates() {
  const format = useFormatter();
  const day = (date: string, month: "short" | "long" = "short") =>
    format.dateTime(new Date(`${date}T00:00:00Z`), { month, day: "numeric", timeZone: "UTC" });
  return {
    day: (date: string) => day(date),
    lastDay: (closesAt: string) => day(closingDay(closesAt), "long"),
  };
}

/** A child as parents see them: "Ava P." while their shop is open; "Your child" otherwise (security review M1). */
export function useChildName() {
  const t = useTranslations("shop");
  return useCallback(
    (child: ShopChild | null | undefined) =>
      child?.state === "open" ? child.displayName : t("yourChild"),
    [t],
  );
}

/** What a package holds, as one line: "8×10, 2 × 5×7, 8 wallets, digital download". */
export function useContents() {
  const t = useTranslations("shop");
  const format = useFormatter();
  return useCallback(
    (contents: PackageLineOut[]) =>
      format.list(
        contents.map((c) =>
          c.kind === "digital"
            ? t("contents.digital")
            : t("contents.print", {
                quantity: c.quantity,
                size: c.printSize ? t(`sizes.${c.printSize}`) : "",
              }),
        ),
        { type: "unit" },
      ),
    [t, format],
  );
}

/** The refusal's words for a failed shop call. */
export function useRefusal() {
  const t = useTranslations("shop.refusals");
  const te = useTranslations("errors");
  return useCallback(
    (r: { status: number; code: string; form: string | null; retryAfter: number | null }) => {
      const key = r.form?.startsWith("shop.") ? r.form.slice("shop.".length) : null;
      if (key === "locked") {
        const wait = lockedWait(r.retryAfter);
        return wait.key === "locked"
          ? t("locked", { minutes: wait.minutes })
          : t("lockedHours", { hours: wait.hours });
      }
      if (key && t.has(key as Parameters<typeof t>[0])) return t(key as Parameters<typeof t>[0]);
      if (r.code === "rate_limited") return t("rateLimited");
      if (r.code === "shop_session_required") return t("sessionGone");
      if (r.code === "network") return te("network");
      return te("internal");
    },
    [t, te],
  );
}

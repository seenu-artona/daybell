"use client";

import type { MoneyAmount, PackageLineOut } from "@daybell/api";
import { formatMoney, localeForCurrency } from "@daybell/core";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback } from "react";

/** Money as parents in its currency read it: "$64.00" (D96: whole cents in, text out). */
export function money(amount: MoneyAmount): string {
  return formatMoney(amount, localeForCurrency(amount.currency));
}

/** A picture day (a calendar date) and an order-by moment, in words. */
export function useShopDates() {
  const format = useFormatter();
  return {
    day: (date: string) =>
      format.dateTime(new Date(`${date}T00:00:00Z`), {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
    moment: (at: string) => format.dateTime(new Date(at), { month: "long", day: "numeric" }),
  };
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
      if (key === "locked")
        return t("locked", { minutes: Math.max(1, Math.ceil((r.retryAfter ?? 900) / 60)) });
      if (key && t.has(key as Parameters<typeof t>[0])) return t(key as Parameters<typeof t>[0]);
      if (r.code === "rate_limited") return t("rateLimited");
      if (r.code === "shop_session_required") return t("sessionGone");
      if (r.code === "network") return te("network");
      return te("internal");
    },
    [t, te],
  );
}

"use client";

import type { JobSalesResponse } from "@daybell/api";
import { formatMoney, money } from "@daybell/core";
import { useFormatter, useLocale, useTranslations } from "next-intl";

type Sales = JobSalesResponse["sales"];

/** Whole percent of everyone on the roster who has ordered (D148, D152); 0 with nobody on it. */
export function orderedPercent(ordered: number, everyone: number): number {
  return everyone > 0 ? Math.round((ordered / everyone) * 100) : 0;
}

/**
 * The job's two number cards (D152; ADR 0029), owners and admins once the shop has opened: Sales (by Home's rule, the
 * lime highlight Home's Sales has) with its orders since the first one, and Subjects ordered as a percent of everyone on
 * the roster, with the counts in words.
 */
export function NumberCards({ sales }: { sales: Sales }) {
  const t = useTranslations("app.jobOverview.numbers");
  const format = useFormatter();
  const locale = useLocale() === "en-CA" ? "en-CA" : "en-US";
  const card = "flex flex-col gap-1 rounded-xl bg-surface px-6 py-5 shadow-card";
  return (
    <div className="grid grid-cols-2 gap-5">
      <section aria-label={t("sales")} className={card}>
        <span className="text-body-lg text-muted">{t("sales")}</span>
        <span className="text-money-xl tabular-nums">
          <span className="bg-[linear-gradient(transparent_68%,var(--color-lime)_68%)] px-0.5">
            {formatMoney(money(sales.salesCents, sales.currency), locale, { whole: true })}
          </span>
        </span>
        <span className="text-body text-muted">
          {sales.firstPaidAt
            ? t("ordersSince", {
                count: sales.orders,
                date: format.dateTime(new Date(sales.firstPaidAt), {
                  month: "short",
                  day: "numeric",
                }),
              })
            : t("noOrders")}
        </span>
      </section>
      <section aria-label={t("subjectsOrdered")} className={card}>
        <span className="text-body-lg text-muted">{t("subjectsOrdered")}</span>
        <span className="text-money-xl tabular-nums">
          {t("percent", { percent: orderedPercent(sales.subjectsOrdered, sales.subjects) })}
        </span>
        <span className="text-body text-muted">
          {t("ofSubjects", { ordered: sales.subjectsOrdered, count: sales.subjects })}
        </span>
      </section>
    </div>
  );
}

"use client";

import type { SalesResponse } from "@daybell/api";
import { canSeeOrders, canSeeSales, formatMoney, localeForCurrency, money } from "@daybell/core";
import { PageHeader } from "@daybell/ui";
import { ChevronDown } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useLocalDateTime, viewerTimeZone } from "@/app/_components/local-time";
import { api } from "@/lib/client-api";
import { greetingFor } from "./greeting";
import { HomeChecklist } from "./home-checklist";
import { JobsSelling } from "./jobs-selling";
import { useStudio } from "./me-context";

const RANGES = ["today", "week", "season"] as const;

/**
 * Studio Home (D127, D143; D146 amends D143, D127 and D145). On the canvas: a greeting by the viewer's local time as the
 * h1, with the date range at the right of the same row. Owners and admins see four white number cards (today, this
 * week from Monday, this season from August 1: sales after refunds, orders, the average order and Daybell's fee, from
 * the ledger in the region's currency; ADR 0024). Then one Up next card mixing the jobs' tasks with the orders waiting
 * (to print, to ship, to take to school; for everyone who sees orders, Q4), or the studio setup checklist (ADR 0017),
 * and at the right the jobs selling now as quiet text (ADR 0021).
 */
export default function HomePage() {
  const th = useTranslations("app.home");
  const format = useFormatter();
  const local = useLocalDateTime();
  const { me, version } = useStudio();
  const studio = me.studio;
  const seesSales = canSeeSales(studio.role);
  const seesOrders = canSeeOrders(studio.role);
  const [range, setRange] = useState<(typeof RANGES)[number]>("today");
  const [numbers, setNumbers] = useState<SalesResponse | null>(null);
  const [failed, setFailed] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version re-reads after changes elsewhere in the app.
  useEffect(() => {
    if (!seesOrders) return;
    let live = true;
    // The browser's own time zone, so "today" is the person's day (D127).
    void api<SalesResponse>(`/studio/sales?tz=${encodeURIComponent(viewerTimeZone())}`).then(
      (res) => {
        if (!live) return;
        if (res.ok) {
          setNumbers(res.data);
          setFailed(false);
        } else setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [seesOrders, version]);

  const currency = studio.region === "ca" ? "CAD" : "USD";
  const amount = (cents: number) =>
    formatMoney(money(cents, currency), localeForCurrency(currency), { whole: false });
  const summary = numbers?.sales?.[range] ?? null;
  // Next payout has no amount in any API yet (GET /studio/payouts has only its day, Canada only), so the fourth card
  // stays Daybell's fee (D146).
  const stats = [
    { key: "sales", value: summary ? amount(summary.sales.cents) : amount(0), money: true },
    { key: "orders", value: summary ? format.number(summary.orders) : "0", money: false },
    {
      key: "averageOrder",
      value: summary?.averageOrder ? amount(summary.averageOrder.cents) : th("dash"),
      money: false,
    },
    {
      key: "daybellFee",
      value: summary ? amount(summary.daybellFee.cents) : amount(0),
      money: false,
    },
  ] as const;

  return (
    <div className="flex w-full flex-col gap-6 px-10 pt-8 pb-12">
      <div className="flex items-center justify-between gap-4">
        {/* The browser's own hour: Home only renders once the person is loaded in the browser. */}
        <PageHeader title={th(`greeting.${greetingFor(new Date().getHours())}`)} />
        {seesSales ? (
          <label className="relative">
            <span className="sr-only">{th("range")}</span>
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as (typeof RANGES)[number])}
              className="min-h-11 appearance-none rounded-full bg-surface py-0 pr-10 pl-5 text-body-lg font-semibold text-ink shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {RANGES.map((r) => (
                <option key={r} value={r}>
                  {th(`ranges.${r}`)}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
          </label>
        ) : null}
      </div>

      {seesSales ? (
        <section aria-label={th(`ranges.${range}`)} className="grid grid-cols-4 gap-4">
          {stats.map((s) => (
            <div key={s.key} className="rounded-list bg-surface px-6 py-5 shadow-card">
              <p className="m-0 text-body-lg text-muted">{th(s.key)}</p>
              <p className="m-0 mt-1 text-[28px] leading-9 font-extrabold tracking-tight tabular-nums">
                <span
                  className={
                    s.money
                      ? "bg-[linear-gradient(transparent_70%,var(--color-lime)_70%)] px-0.5"
                      : ""
                  }
                >
                  {s.value}
                </span>
              </p>
              <p className="m-0 text-body text-muted">
                {failed
                  ? th("salesFailed")
                  : summary
                    ? summary.orders === 0
                      ? th("noData")
                      : th("since", {
                          date: local(summary.start, { dateStyle: "medium" }),
                        })
                    : th("checking")}
              </p>
            </div>
          ))}
        </section>
      ) : null}

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start gap-10">
        <div className="flex flex-col gap-6">
          <HomeChecklist orders={seesOrders ? { todo: numbers?.todo ?? null, failed } : null} />
        </div>
        <JobsSelling refreshKey={version} />
      </div>
    </div>
  );
}

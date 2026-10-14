"use client";

import type { SalesResponse } from "@daybell/api";
import { canSeeOrders, canSeeSales, formatMoney, localeForCurrency, money } from "@daybell/core";
import { ChevronDown } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useLocalDateTime, viewerTimeZone } from "@/app/_components/local-time";
import { api } from "@/lib/client-api";
import { ActivityCard } from "./activity-card";
import { HomeCard, HomeLinkRow, HomeNote, HomeRows } from "./home-card";
import { HomeChecklist } from "./home-checklist";
import { JobsSelling } from "./jobs-selling";
import { ListPage } from "./list-page";
import { useStudio } from "./me-context";

const RANGES = ["today", "week", "season"] as const;

/**
 * Studio Home (D127, D143): numbers like Shopify for owners and admins (today, this week from Monday, this season from
 * August 1: sales after refunds, orders, Daybell's fee and the average order, from the ledger in the region's currency;
 * ADR 0024), To do for everyone who fulfils orders (to print, to ship, to take to school; staff see only this, Q4), then
 * the studio setup checklist or Up next (ADR 0017), the jobs selling now (ADR 0021), and recent activity. In the D144
 * layout (amended Oct 14): the title alone on the canvas, the date range at the right end of the row under it, and
 * each section a white list card whose rows open like a list's.
 */
export default function HomePage() {
  const th = useTranslations("app.home");
  const format = useFormatter();
  const local = useLocalDateTime();
  const { me, version } = useStudio();
  const studio = me.studio;
  const canManage = studio.role === "owner" || studio.role === "admin";
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
  const stats = [
    { key: "sales", value: summary ? amount(summary.sales.cents) : amount(0), money: true },
    { key: "orders", value: summary ? format.number(summary.orders) : "0", money: false },
    {
      key: "daybellFee",
      value: summary ? amount(summary.daybellFee.cents) : amount(0),
      money: false,
    },
    {
      key: "averageOrder",
      value: summary?.averageOrder ? amount(summary.averageOrder.cents) : th("dash"),
      money: false,
    },
  ] as const;
  const todo = numbers?.todo;

  return (
    <ListPage
      title={th("title")}
      actions={
        seesSales ? (
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
        ) : null
      }
    >
      {seesSales ? (
        <section
          aria-label={th(`ranges.${range}`)}
          className="grid grid-cols-2 overflow-hidden rounded-list bg-surface shadow-card lg:grid-cols-4"
        >
          {stats.map((s, i) => (
            <div
              key={s.key}
              className={`px-6 py-5 ${i % 2 === 1 ? "border-l border-line" : ""} ${i >= 2 ? "border-t border-line lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}
            >
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

      {seesOrders ? (
        <HomeCard title={th("todo.title")}>
          {failed ? (
            <HomeNote>{th("todo.failed")}</HomeNote>
          ) : !todo ? (
            <HomeNote>{th("checking")}</HomeNote>
          ) : todo.toPrint + todo.toShip + todo.toDeliver === 0 ? (
            <HomeNote>{th("todo.nothing")}</HomeNote>
          ) : (
            <HomeRows>
              {todo.toPrint > 0 ? (
                <HomeLinkRow
                  href="/app/orders?status=paid"
                  name={th("todo.toPrint", { count: todo.toPrint })}
                />
              ) : null}
              {todo.toShip > 0 ? (
                <HomeLinkRow
                  href="/app/orders?status=printed&delivery=home"
                  name={th("todo.toShip", { count: todo.toShip })}
                />
              ) : null}
              {todo.toDeliver > 0 ? (
                <HomeLinkRow
                  href="/app/orders?status=printed&delivery=school"
                  name={th("todo.toDeliver", { count: todo.toDeliver })}
                />
              ) : null}
            </HomeRows>
          )}
        </HomeCard>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[1.35fr_1fr]">
        <HomeChecklist />

        <div className="flex flex-col gap-6">
          <JobsSelling refreshKey={version} />
          {canManage ? <ActivityCard refreshKey={version} /> : null}
        </div>
      </div>
    </ListPage>
  );
}

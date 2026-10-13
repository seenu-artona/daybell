"use client";

import type { SalesResponse } from "@daybell/api";
import { canSeeOrders, canSeeSales, formatMoney, localeForCurrency, money } from "@daybell/core";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useState } from "react";
import { api } from "@/lib/client-api";
import { ActivityCard } from "./activity-card";
import { HomeChecklist } from "./home-checklist";
import { JobsSelling } from "./jobs-selling";
import { useStudio } from "./me-context";
import { PageFrame } from "./page-frame";

const RANGES = ["today", "week", "season"] as const;

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary";

function Panel({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="overflow-hidden rounded-2xl border border-line bg-surface"
    >
      <h2 id={id} className="m-0 px-5 pt-4 pb-3 text-[15px] leading-5 font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The browser's own time zone, so "today" is the person's day (D127). */
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/**
 * Studio Home (D127, D143): numbers like Shopify for owners and admins (today, this week from Monday, this season from
 * August 1: sales after refunds, orders, Daybell's fee and the average order, from the ledger in the region's currency;
 * ADR 0024), To do for everyone who fulfils orders (to print, to ship, to take to school; staff see only this, Q4), then
 * the studio setup checklist or Up next (ADR 0017), the jobs selling now (ADR 0021), and recent activity.
 */
export default function HomePage() {
  const th = useTranslations("app.home");
  const format = useFormatter();
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
    void api<SalesResponse>(`/studio/sales?tz=${encodeURIComponent(timeZone())}`).then((res) => {
      if (!live) return;
      if (res.ok) {
        setNumbers(res.data);
        setFailed(false);
      } else setFailed(true);
    });
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
    <PageFrame>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-h1">{th("title")}</h1>
        {seesSales ? (
          <label className="relative">
            <span className="sr-only">{th("range")}</span>
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as (typeof RANGES)[number])}
              className="min-h-11 appearance-none rounded-[10px] border border-line bg-surface py-0 pr-10 pl-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary"
            >
              {RANGES.map((r) => (
                <option key={r} value={r}>
                  {th(`ranges.${r}`)}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
          </label>
        ) : null}
      </div>

      {seesSales ? (
        <section
          aria-label={th(`ranges.${range}`)}
          className="grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-surface lg:grid-cols-4"
        >
          {stats.map((s, i) => (
            <div
              key={s.key}
              className={`px-5 py-4 ${i % 2 === 1 ? "border-l border-line" : ""} ${i >= 2 ? "border-t border-line lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}
            >
              <p className="m-0 text-sm text-muted">{th(s.key)}</p>
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
              <p className="m-0 text-caption text-muted">
                {failed
                  ? th("salesFailed")
                  : summary
                    ? summary.orders === 0
                      ? th("noData")
                      : th("since", {
                          date: format.dateTime(new Date(summary.start), { dateStyle: "medium" }),
                        })
                    : th("checking")}
              </p>
            </div>
          ))}
        </section>
      ) : null}

      {seesOrders ? (
        <Panel title={th("todo.title")}>
          <div className="border-t border-line px-5 py-3">
            {failed ? (
              <p className="m-0 text-muted">{th("todo.failed")}</p>
            ) : !todo ? (
              <p className="m-0 text-muted">{th("checking")}</p>
            ) : todo.toPrint + todo.toShip + todo.toDeliver === 0 ? (
              <p className="m-0 text-muted">{th("todo.nothing")}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col p-0">
                {todo.toPrint > 0 ? (
                  <li>
                    <Link href="/app/orders?status=paid" className={LINK}>
                      {th("todo.toPrint", { count: todo.toPrint })}
                    </Link>
                  </li>
                ) : null}
                {todo.toShip > 0 ? (
                  <li>
                    <Link href="/app/orders?status=printed&delivery=home" className={LINK}>
                      {th("todo.toShip", { count: todo.toShip })}
                    </Link>
                  </li>
                ) : null}
                {todo.toDeliver > 0 ? (
                  <li>
                    <Link href="/app/orders?status=printed&delivery=school" className={LINK}>
                      {th("todo.toDeliver", { count: todo.toDeliver })}
                    </Link>
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        </Panel>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <HomeChecklist />

        <div className="flex flex-col gap-6">
          <Panel title={th("jobsSelling")}>
            <JobsSelling refreshKey={version} />
          </Panel>
          {canManage ? <ActivityCard refreshKey={version} /> : null}
        </div>
      </div>
    </PageFrame>
  );
}

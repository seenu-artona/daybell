"use client";

import { formatMoney, money } from "@daybell/core";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useState } from "react";
import { ActivityCard } from "./activity-card";
import { HomeChecklist } from "./home-checklist";
import { JobsSelling } from "./jobs-selling";
import { useStudio } from "./me-context";
import { PageFrame } from "./page-frame";

const RANGES = ["week", "month", "season"] as const;

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

/** A flat trend line until there is data; then the real series. */
function Trend({ points }: { points: number[] }) {
  const max = Math.max(1, ...points);
  const d = points
    .map((p, i) => `${(i / (points.length - 1)) * 100},${34 - (p / max) * 30}`)
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 36"
      preserveAspectRatio="none"
      className="mt-3 block h-9 w-full"
      aria-hidden="true"
    >
      <polyline
        points={d}
        fill="none"
        className="stroke-primary"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Studio Home (D127, D143): numbers like Shopify, then the studio setup checklist or Up next (in place of "Needs you";
 * ADR 0017), the jobs selling now (ADR 0021), and recent activity.
 */
export default function HomePage() {
  const th = useTranslations("app.home");
  const { me, version } = useStudio();
  const studio = me.studio;
  const canManage = studio.role === "owner" || studio.role === "admin";
  const [range, setRange] = useState<(typeof RANGES)[number]>("week");

  const currency = studio.region === "ca" ? "CAD" : "USD";
  const locale = studio.region === "ca" ? "en-CA" : "en-US";
  const zero = formatMoney(money(0, currency), locale, { whole: true });
  const flat = [0, 0, 0, 0, 0, 0, 0];
  // Orders arrive in Phase 1; until then every number is honestly zero.
  const stats = [
    { key: "sales", value: zero, money: true },
    { key: "orders", value: "0", money: false },
    { key: "familiesOrdered", value: th("dash"), money: false },
    { key: "averageOrder", value: th("dash"), money: false },
  ] as const;

  return (
    <PageFrame>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-h1">{th("title")}</h1>
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
      </div>

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
            <p className="m-0 text-caption text-muted">{th("noData")}</p>
            {flat.some((v) => v > 0) ? <Trend points={flat} /> : null}
          </div>
        ))}
      </section>

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

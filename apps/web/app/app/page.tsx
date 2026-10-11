"use client";

import type { JobsResponse, PendingInvite, TeamMember } from "@daybell/api";
import { formatMoney, money } from "@daybell/core";
import { Badge } from "@daybell/ui";
import { Camera, ChevronDown, Megaphone, Package, Palette, Plug, UserPlus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { ActivityCard } from "./activity-card";
import { checklistSteps, type StepKey } from "./checklist-steps";
import { useStudio } from "./me-context";

const STEP_ICON: Record<StepKey, typeof Camera> = {
  studio: Package,
  team: UserPlus,
  brand: Palette,
  products: Package,
  payouts: Plug,
  job: Camera,
};
const RANGES = ["week", "month", "season"] as const;

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <h2 className="m-0 px-5 pt-4 pb-3 text-[15px] leading-5 font-bold">{title}</h2>
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

/** Studio Home (D127): numbers like Shopify, then what needs you, jobs selling now, and recent activity. */
export default function HomePage() {
  const t = useTranslations("app");
  const th = useTranslations("app.home");
  const { me, version } = useStudio();
  const studio = me.studio;
  const canManage = studio.role === "owner" || studio.role === "admin";
  const [range, setRange] = useState<(typeof RANGES)[number]>("week");
  const [hasTeam, setHasTeam] = useState<boolean | null>(null);
  const [hasJob, setHasJob] = useState<boolean | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version re-checks after team changes.
  useEffect(() => {
    Promise.all([
      api<{ team: TeamMember[] }>("/studio/team"),
      canManage ? api<{ invites: PendingInvite[] }>("/studio/invites") : Promise.resolve(null),
      api<JobsResponse>("/jobs?limit=1"),
    ]).then(([team, invites, jobs]) => {
      const members = team.ok ? team.data.team.length : 1;
      setHasTeam(members > 1 || (invites?.ok ? invites.data.invites.length > 0 : false));
      setHasJob(jobs.ok ? jobs.data.jobs.length > 0 : false);
    });
  }, [version, canManage]);

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

  const loading = hasTeam === null || hasJob === null;
  const steps = loading ? [] : checklistSteps({ hasTeam, hasJob }).filter((s) => !s.done);

  return (
    <>
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
        <Panel title={th("needsYou")}>
          {loading ? (
            <p className="m-0 border-t border-line px-5 py-4 text-muted">{th("checking")}</p>
          ) : steps.length === 0 ? (
            <p className="m-0 border-t border-line px-5 py-4 text-muted">{th("nothingNeeded")}</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {steps.map((step) => {
                const Icon = STEP_ICON[step.key];
                return (
                  <li
                    key={step.key}
                    className="flex min-h-16 items-center gap-4 border-t border-line px-5 py-3"
                  >
                    <span
                      className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-subtle"
                      aria-hidden="true"
                    >
                      <Icon className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{t(`checklist.${step.key}`)}</span>
                      <span className="block text-sm text-muted">
                        {t(`checklist.${step.key}Body`)}
                      </span>
                    </span>
                    {step.soon ? (
                      <Badge tone="draft">{t("checklist.soon")}</Badge>
                    ) : step.href && (step.key !== "job" || canManage) ? (
                      <Link
                        href={step.href}
                        className="inline-flex min-h-11 items-center px-2 font-semibold text-primary no-underline hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        {th(`actions.${step.key as "team" | "job"}`)}
                        <span className="sr-only"> — {t(`checklist.${step.key}`)}</span>
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title={th("jobsSelling")}>
            <p className="m-0 flex items-center gap-3 border-t border-line px-5 py-4 text-muted">
              <Megaphone className="size-5 shrink-0" aria-hidden="true" />
              {th("noJobs")}
            </p>
          </Panel>
          {canManage ? <ActivityCard refreshKey={version} /> : null}
        </div>
      </div>
    </>
  );
}

"use client";

import {
  daysUntil,
  groupLabel,
  JOURNEY_STAGES,
  jobStage,
  localDay,
  type NextStep,
  nextStep,
} from "@daybell/core";
import { Badge, Button, Card, Stat } from "@daybell/ui";
import { Check } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { ActivityCard } from "../../activity-card";
import { useStudio } from "../../me-context";
import { useFormatDay } from "../status-badge";
import { HIT_44 } from "./hit-area";
import { useJob } from "./job-context";
import { JobSection } from "./job-section";
import { SellChecklist } from "./sell-checklist";
import { SidePanel } from "./side-panel";
import { tabHref } from "./tabs";

const LINK =
  "font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary";

/**
 * A job's Overview (D137, D138): the journey bar, the one next step and this stage's numbers, with "Before you can
 * sell" and the job's recent activity in the side panel. Only numbers that exist today are shown.
 */
export default function JobOverviewPage() {
  const t = useTranslations("app.job");
  const formatDay = useFormatDay();
  const { version } = useStudio();
  const { job, summary, canManage, canEditRoster } = useJob();
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelFocus, setPanelFocus] = useState<string | null>(null);
  const showChecklistId = useId();
  const today = localDay(new Date());
  const children = summary?.children ?? 0;
  const facts = { status: job.status, pictureDay: job.pictureDay, children, today };
  const stage = jobStage(facts);
  const stageIndex = JOURNEY_STAGES.indexOf(stage);
  const step = summary ? nextStep(facts) : null;
  const word = groupLabel(job.type);
  const days = daysUntil(job.pictureDay, today);

  const journey = (
    <ol aria-label={t("journey.label")} className="m-0 flex list-none items-center gap-1 p-0">
      {JOURNEY_STAGES.map((s, i) => {
        const current = i === stageIndex;
        const done = i < stageIndex;
        return (
          <li
            key={s}
            aria-current={current ? "step" : undefined}
            className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-label ${
              current ? "bg-primary-soft font-bold text-ink" : done ? "text-ink" : "text-muted"
            }`}
          >
            {done ? <Check className="size-4 text-primary" aria-hidden="true" /> : null}
            {current ? (
              <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
            ) : null}
            {done ? (
              <>
                <span aria-hidden="true">{t(`journey.stages.${s}`)}</span>
                <span className="sr-only">
                  {t("journey.stageDone", { stage: t(`journey.stages.${s}`) })}
                </span>
              </>
            ) : (
              t(`journey.stages.${s}`)
            )}
          </li>
        );
      })}
    </ol>
  );

  return (
    <JobSection
      bar={journey}
      barEnd={
        panelOpen ? null : (
          <Button
            id={showChecklistId}
            variant="secondary"
            size="sm"
            className={HIT_44}
            onClick={() => {
              setPanelOpen(true);
              setPanelFocus(String(Date.now()));
            }}
          >
            {t("showChecklist")}
          </Button>
        )
      }
      panel={
        panelOpen ? (
          <SidePanel
            title={t("checklist.title")}
            focusKey={panelFocus}
            onClose={() => {
              setPanelOpen(false);
              // The "Show checklist" button appears where focus can return.
              setTimeout(() => document.getElementById(showChecklistId)?.focus(), 0);
            }}
          >
            <SellChecklist roster={children} />
            {canManage ? (
              <ActivityCard refreshKey={version} jobId={job.id} variant="flat" headingLevel={3} />
            ) : null}
          </SidePanel>
        ) : null
      }
    >
      <div className="flex flex-col gap-6 p-6">
        {step ? <NextStepCard step={step} jobId={job.id} canEditRoster={canEditRoster} /> : null}
        {summary ? (
          <section aria-labelledby="job-numbers" className="flex flex-col gap-3">
            <h2 id="job-numbers" className="sr-only">
              {t("stats.label")}
            </h2>
            <div className="grid grid-cols-4 gap-4">
              <Stat
                label={t("stats.children")}
                value={
                  <>
                    {summary.children}
                    {job.subjectsExpected ? (
                      <span className="block text-sm font-medium text-muted">
                        {t("stats.ofExpected", { count: job.subjectsExpected })}
                      </span>
                    ) : null}
                  </>
                }
              />
              <Stat label={t("stats.groups", { group: word })} value={summary.groups} />
              <Stat
                label={t("stats.duplicates")}
                value={
                  <>
                    {summary.duplicates}
                    {summary.duplicates > 0 ? (
                      <Link
                        href={`${tabHref(job.id, "people")}?show=duplicates`}
                        className={`block text-sm ${LINK}`}
                      >
                        {t("showThem")}
                      </Link>
                    ) : null}
                  </>
                }
              />
              <Stat
                label={t("stats.pictureDay")}
                value={
                  <>
                    {days >= 0
                      ? t("stats.countdown", { days })
                      : t("stats.daysAgo", { days: -days })}
                    <span className="block text-sm font-medium text-muted">
                      {formatDay(job.pictureDay)}
                    </span>
                  </>
                }
              />
            </div>
          </section>
        ) : null}
      </div>
    </JobSection>
  );
}

/** The one next step (D138). Its action is white: "Start selling" is the page's only green button. */
function NextStepCard({
  step,
  jobId,
  canEditRoster,
}: {
  step: NextStep;
  jobId: string;
  canEditRoster: boolean;
}) {
  const t = useTranslations("app.job.nextStep");
  const tr = useTranslations("app.roster");
  const formatDay = useFormatDay();
  return (
    <Card className="flex items-center gap-6">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-caption font-semibold text-muted">{t("label")}</p>
        <h2 className="m-0 flex items-center gap-3 text-h3">
          {t(`${step.key}.title`)}
          {step.key === "uploadPhotos" ? <Badge tone="draft">{t("comingSoon")}</Badge> : null}
        </h2>
        <p className="m-0 text-muted">
          {step.key === "getReady"
            ? t("getReady.body", { date: formatDay(step.pictureDay) })
            : t(`${step.key}.body`)}
        </p>
        {step.key === "addRoster" && !canEditRoster ? (
          <p className="m-0 mt-1 text-caption text-muted">{tr("emptyReadOnly")}</p>
        ) : null}
      </div>
      {step.key === "addRoster" && canEditRoster ? (
        <Button asChild variant="secondary">
          <Link href={tabHref(jobId, "people")}>{t("addRoster.action")}</Link>
        </Button>
      ) : null}
    </Card>
  );
}

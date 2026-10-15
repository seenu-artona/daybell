"use client";

import type { Job, JobProgressView, ProgressStepView } from "@daybell/api";
import { type RuleKey, type RulesPatch, stageDoneOn } from "@daybell/core";
import { Button } from "@daybell/ui";
import { Check, ChevronDown, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Dialog } from "../../../dialog";
import { useStudio } from "../../../me-context";
import { RuleForm } from "../../../templates/rule-form";
import { useFormatDay } from "../../status-badge";
import { ClosingDateForm } from "../closing-date-form";
import { useJob } from "../job-context";
import { type StepView, stepView } from "./progress-view";

const QUIET =
  "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold text-ink no-underline hover:bg-subtle focus-visible:outline-2 focus-visible:outline-primary";
const INLINE =
  "inline-flex min-h-11 items-center font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary";

type Stage = JobProgressView["stages"][number];

/**
 * Progress on a job's Overview (D152; ADR 0029): replaces the checklist, the milestone timeline and the key dates. Six
 * stages; a finished stage folds to one line ("Prepare · Done Sep 20"), which opens to show its steps. Each step says
 * its state in words for screen readers (Done, Now, Next, Automatic, Soon), never by colour alone (D91). Done steps are
 * dimmed with when and who (who for owners and admins); the step to do now has its one action; steps ahead show the
 * day the job's rules plan and, for owners and admins, Change; a rule changed for this job says so, with Undo.
 */
export function ProgressCard({
  progress,
  today,
  onChanged,
}: {
  progress: JobProgressView;
  today: string;
  /** The job changed here (a rule, its undo, the closing date). */
  onChanged: (job: Job, message: string) => void;
}) {
  const t = useTranslations("app.progress");
  const text = useApiText();
  const { me } = useStudio();
  const { job } = useJob();
  const titleId = useId();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<RuleKey | "closingDate" | null>(null);
  const [status, setStatus] = useState("");
  const role = me.studio.role;

  async function saveRules(patch: RulesPatch): Promise<string | null> {
    const res = await api<{ job: Job }>(`/jobs/${job.id}`, { method: "PATCH", body: patch });
    if (!res.ok) {
      const field = Object.values(res.fields)[0];
      return field ? (text.field(field) ?? text.error(res.code)) : text.error(res.code);
    }
    setDialog(null);
    onChanged(res.data.job, t("saved"));
    return null;
  }

  async function undo(rule: RuleKey) {
    setStatus("");
    const res = await api<{ job: Job }>(`/jobs/${job.id}/rules/reset`, {
      method: "POST",
      body: { rule },
    });
    if (res.ok) return onChanged(res.data.job, t("undone"));
    if (res.fields.closesAt) return setStatus(t("undoPassed"));
    setStatus(res.fields.form === "jobs.noTemplate" ? t("noTemplate") : text.error(res.code));
  }

  const views = (stage: Stage) =>
    stage.steps.map((step) => ({ step, view: stepView(step, job, role, today) }));

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col rounded-xl bg-surface px-6.5 pt-5.5 pb-3 shadow-card"
    >
      <div className="flex flex-wrap items-baseline gap-3 pb-3.5">
        <h2 id={titleId} className="m-0 text-h2">
          {t("title")}
        </h2>
        <span className="text-body-lg text-muted">
          {progress.current ? t("now", { stage: t(`stages.${progress.current}`) }) : t("allDone")}
        </span>
      </div>
      <p role="status" className="m-0 text-sm font-semibold text-ink empty:sr-only">
        {status}
      </p>
      {progress.stages.map((stage) => {
        const folded = stage.done && stage.key !== progress.current;
        if (folded && !open[stage.key])
          return (
            <FoldedStage
              key={stage.key}
              stage={stage}
              onOpen={() => setOpen((o) => ({ ...o, [stage.key]: true }))}
            />
          );
        return (
          <StageBlock
            key={stage.key}
            stage={stage}
            onFold={folded ? () => setOpen((o) => ({ ...o, [stage.key]: false })) : null}
            steps={views(stage)}
            onChange={setDialog}
            onUndo={(rule) => void undo(rule)}
            onClosingDate={() => setDialog("closingDate")}
          />
        );
      })}

      {(["qrCards", "shopOpens", "shopCloses"] as const).map((rule) => (
        <Dialog
          key={rule}
          open={dialog === rule}
          onClose={() => setDialog(null)}
          title={t(`ruleTitles.${rule}`)}
        >
          <RuleForm
            rule={rule}
            rules={job.rules}
            note={t("ruleNote")}
            onCancel={() => setDialog(null)}
            onSave={saveRules}
          />
        </Dialog>
      ))}
      <Dialog
        open={dialog === "closingDate"}
        onClose={() => setDialog(null)}
        title={t("closingDateTitle")}
      >
        <ClosingDateForm
          job={job}
          onCancel={() => setDialog(null)}
          onSaved={(next, removed) => {
            setDialog(null);
            onChanged(next, t(removed ? "closingRemoved" : "closingSaved"));
          }}
        />
      </Dialog>
    </section>
  );
}

function FoldedStage({ stage, onOpen }: { stage: Stage; onOpen: () => void }) {
  const t = useTranslations("app.progress");
  const when = useWhen();
  const doneOn = stageDoneOn(stage);
  return (
    <button
      type="button"
      aria-expanded={false}
      onClick={onOpen}
      className="flex min-h-13 w-full items-center gap-3.5 border-t border-line text-left text-ink focus-visible:outline-2 focus-visible:outline-primary"
    >
      <StateIcon state="done" />
      <span className="text-body-lg font-bold text-muted">{t(`stages.${stage.key}`)}</span>
      <span className="text-body text-muted">
        {doneOn ? t("stageDoneOn", { date: when(doneOn) }) : t("stageDone")}
      </span>
      <ChevronDown aria-hidden="true" className="ml-auto size-5 text-line-strong" />
    </button>
  );
}

function StageBlock({
  stage,
  steps,
  onFold,
  onChange,
  onUndo,
  onClosingDate,
}: {
  stage: Stage;
  steps: { step: ProgressStepView; view: StepView }[];
  onFold: (() => void) | null;
  onChange: (rule: RuleKey) => void;
  onUndo: (rule: RuleKey) => void;
  onClosingDate: () => void;
}) {
  const t = useTranslations("app.progress");
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} className="border-t border-line pt-3.5 pb-2">
      <div className="mb-1.5 flex items-center">
        <h3
          id={headingId}
          className="m-0 text-label font-bold tracking-[0.06em] text-muted uppercase"
        >
          {t(`stages.${stage.key}`)}
        </h3>
        {onFold ? (
          <button
            type="button"
            aria-expanded={true}
            onClick={onFold}
            className="ml-auto inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-semibold text-muted hover:bg-subtle focus-visible:outline-2 focus-visible:outline-primary"
          >
            {t("fold")}
            <ChevronDown aria-hidden="true" className="size-4 rotate-180" />
          </button>
        ) : null}
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {steps.map(({ step, view }) => (
          <StepRow
            key={step.key}
            step={step}
            view={view}
            onChange={onChange}
            onUndo={onUndo}
            onClosingDate={onClosingDate}
          />
        ))}
      </ul>
    </div>
  );
}

function StateIcon({ state }: { state: ProgressStepView["state"] }) {
  const base = "flex size-6 shrink-0 items-center justify-center rounded-full";
  if (state === "done")
    return (
      <span aria-hidden="true" className={`${base} bg-primary-soft text-primary`}>
        <Check className="size-3.5" strokeWidth={2.5} />
      </span>
    );
  if (state === "now")
    return (
      <span aria-hidden="true" className={`${base} bg-ink`}>
        <span className="size-2 rounded-full bg-surface" />
      </span>
    );
  if (state === "automatic")
    return (
      <span aria-hidden="true" className={`${base} bg-subtle text-muted`}>
        <RefreshCw className="size-3.5" />
      </span>
    );
  return <span aria-hidden="true" className={`${base} border-[1.5px] border-line-strong`} />;
}

/** A moment or a day, as "Mon, Oct 5". */
function useWhen(): (value: string) => string {
  const format = useFormatter();
  return (value) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? format.dateTime(new Date(`${value}T00:00:00Z`), {
          weekday: "short",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        })
      : format.dateTime(new Date(value), { weekday: "short", month: "short", day: "numeric" });
}

function StepRow({
  step,
  view,
  onChange,
  onUndo,
  onClosingDate,
}: {
  step: ProgressStepView;
  view: StepView;
  onChange: (rule: RuleKey) => void;
  onUndo: (rule: RuleKey) => void;
  onClosingDate: () => void;
}) {
  const t = useTranslations("app.progress");
  const formatDay = useFormatDay();
  const when = useWhen();
  const done = step.state === "done";
  const label = t(`steps.${step.key}.${done ? "done" : "todo"}`);
  const d = view.detail;
  const detail: string | null = !d
    ? null
    : d.type === "done"
      ? [d.day ? when(d.day) : d.at ? when(d.at) : null, d.by].filter(Boolean).join(" · ") || null
      : d.type === "pictureDay"
        ? t("detail.pictureDay", { date: when(d.day), days: d.days })
        : d.type === "planned"
          ? t("detail.planned", { date: formatDay(d.day) })
          : d.type === "closes"
            ? t("detail.closes", { date: when(d.at), days: d.days })
            : d.type === "afterOpening"
              ? t("detail.afterOpening", { days: d.days })
              : t(`detail.${d.type}`);
  const a = view.action;

  return (
    <li
      className={`flex min-h-12 items-center gap-3.5 py-1 ${
        step.state === "now" ? "-mx-3 rounded-lg bg-warning-soft px-3" : ""
      }`}
    >
      <StateIcon state={step.state} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={`text-body-lg ${
            step.state === "now"
              ? "font-bold text-ink"
              : step.state === "next"
                ? "font-semibold text-ink"
                : "text-muted"
          }`}
        >
          <span className="sr-only">{t(`states.${step.state}`)}: </span>
          {label}
          {step.state === "soon" ? (
            <>
              {" "}
              <span className="ml-1 rounded-full border border-line-strong px-2 text-micro text-muted">
                {t("soon")}
              </span>
            </>
          ) : null}
        </span>
        {detail || step.changed ? (
          <span className="flex flex-wrap items-center gap-x-1.5 text-body text-muted">
            {detail ? <span>{detail}</span> : null}
            {step.changed ? (
              <>
                {detail ? <span aria-hidden="true">·</span> : null}
                <span className="text-ink">{t("changed")}</span>
                {view.undo ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => onUndo(view.undo as RuleKey)}
                      className={INLINE}
                    >
                      {t("undo")}
                      <span className="sr-only"> {t("undoWhat", { step: label })}</span>
                    </button>
                  </>
                ) : null}
              </>
            ) : null}
            {view.change ? (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => onChange(view.change as RuleKey)}
                  className={INLINE}
                >
                  {t("change")}
                  <span className="sr-only"> {label}</span>
                </button>
              </>
            ) : null}
          </span>
        ) : view.change ? (
          <span className="text-body">
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => onChange(view.change as RuleKey)}
              className={INLINE}
            >
              {t("change")}
              <span className="sr-only"> {label}</span>
            </button>
          </span>
        ) : null}
      </span>
      {a?.kind === "link" ? (
        <Link href={a.href} className={QUIET}>
          {t(`actions.${a.label}`)}
        </Link>
      ) : a?.kind === "publish" ? (
        <Link href={a.href} scroll={false} className={QUIET}>
          {t("actions.publish")}
        </Link>
      ) : a?.kind === "printAgain" ? (
        <Link href={a.href} className={`${QUIET} text-muted`}>
          {t("actions.printAgain")}
        </Link>
      ) : a?.kind === "changeClosingDate" ? (
        <Button variant="quiet" shape="pill" aria-haspopup="dialog" onClick={onClosingDate}>
          {t("actions.changeDate")}
        </Button>
      ) : null}
    </li>
  );
}

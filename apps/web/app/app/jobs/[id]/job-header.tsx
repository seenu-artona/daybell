"use client";

import { Button } from "@daybell/ui";
import { ArrowLeft, ChevronDown, Pencil } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Dialog } from "../../dialog";
import { useStudio } from "../../me-context";
import { MENU_ROW, Popover } from "../../popover";
import { JobForm } from "../job-form";
import { StatusBadge, useFormatDay } from "../status-badge";
import { useJob } from "./job-context";
import { SellChecklist } from "./sell-checklist";

/**
 * The job header (D137): back to Jobs, the job's name and status (not clickable), its details, "More actions" and
 * the page's one green button, "Start selling", while the job is a draft. Selling itself arrives in step 8; for now
 * the button lists what is still missing and is never disabled.
 */
export function JobHeader() {
  const t = useTranslations("app.job");
  const tj = useTranslations("app.jobs");
  const formatDay = useFormatDay();
  const { changed } = useStudio();
  const { job, setJob, summary, canManage } = useJob();
  const [editing, setEditing] = useState(false);
  const [selling, setSelling] = useState(false);
  const [saved, setSaved] = useState(false);

  const details = [
    tj(`types.${job.type}`),
    job.client?.name ?? null,
    formatDay(job.pictureDay),
    job.internalNumber,
  ].filter(Boolean);

  return (
    <header className="border-b border-line bg-surface px-6 pt-3">
      <div className="flex items-start gap-3">
        <Link
          href="/app/jobs"
          aria-label={tj("detail.back")}
          className="-ml-2 grid size-11 shrink-0 place-items-center rounded-md text-ink hover:bg-subtle focus-visible:outline-2 focus-visible:outline-primary"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="m-0 text-h2 break-words">{job.name}</h1>
            <StatusBadge status={job.status} />
          </div>
          <p className="m-0 text-sm text-muted">{details.join(" · ")}</p>
          {/* Always rendered so screen readers announce the text when it appears (WCAG 4.1.3). */}
          <p role="status" className="m-0 min-h-5 text-caption text-muted">
            {saved ? tj("detail.saved") : ""}
          </p>
        </div>
        {canManage ? (
          <div className="flex shrink-0 items-center gap-2">
            <Popover
              trigger={
                <>
                  {t("moreActions")}
                  <ChevronDown aria-hidden="true" />
                </>
              }
              triggerClassName="border border-line-strong bg-surface px-[18px] text-sm font-semibold [&_svg]:size-4"
              panelClassName="w-56"
            >
              {(close) => (
                <button
                  type="button"
                  className={MENU_ROW}
                  onClick={() => {
                    close();
                    setSaved(false);
                    setEditing(true);
                  }}
                >
                  <Pencil aria-hidden="true" />
                  {tj("detail.edit")}
                </button>
              )}
            </Popover>
            {job.status === "draft" ? (
              <Button onClick={() => setSelling(true)}>{t("startSelling")}</Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <Dialog open={editing} onClose={() => setEditing(false)} title={tj("form.editTitle")}>
        <JobForm
          job={job}
          onCancel={() => setEditing(false)}
          onSaved={(next) => {
            setJob(next);
            setEditing(false);
            setSaved(true);
            changed();
          }}
        />
      </Dialog>

      <Dialog open={selling} onClose={() => setSelling(false)} title={t("checklist.title")}>
        <div className="flex flex-col gap-4">
          <p className="m-0 text-muted">{t("sellIntro")}</p>
          <SellChecklist roster={summary?.children ?? 0} />
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setSelling(false)}>
              {t("close")}
            </Button>
          </div>
        </div>
      </Dialog>
    </header>
  );
}

"use client";

import type { Job, JobProgressResponse, JobProgressView, JobSalesResponse } from "@daybell/api";
import { canSeeSales, localDay } from "@daybell/core";
import { Banner, Button } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { Dialog } from "../../dialog";
import { useStudio } from "../../me-context";
import { JobForm } from "../job-form";
import { useJob } from "./job-context";
import { DetailsAside } from "./overview/details";
import { NumberCards } from "./overview/numbers";
import { ProgressCard } from "./overview/progress-card";

/**
 * A job's Overview in the D151 blueprint (D152; ADR 0029, replacing ADR 0017's checklist card and ADR 0014's hero and
 * Recent activity here): the main column is what the job is, the number cards (owners and admins, once the shop has
 * opened) then Progress; the side is Details. The job's history is in ⋯ More › History. No job number, photographer,
 * hero line, reminders or price list here. Progress comes from GET /jobs/:id/progress (the same checklist facts as
 * Home's Up next) and the numbers from GET /jobs/:id/sales.
 */
export default function JobOverviewPage() {
  const t = useTranslations("app.jobOverview");
  const tj = useTranslations("app.jobs");
  const { me, changed } = useStudio();
  const { job, setJob, summary, canManage, setTaggingReviewed } = useJob();
  const [progress, setProgress] = useState<JobProgressView | null>(null);
  const [failed, setFailed] = useState(false);
  const [sales, setSales] = useState<JobSalesResponse["sales"] | null>(null);
  const [salesFailed, setSalesFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState("");
  const today = localDay(new Date());
  const showNumbers = canSeeSales(me.studio.role) && job.status !== "draft";

  // Loaded while the Overview shows: again after the job changes (a rule, a date, the shop) or its summary refreshes
  // (a roster or print change made from this page).
  // biome-ignore lint/correctness/useExhaustiveDependencies: updatedAt and a new summary only signal that the job changed.
  useEffect(() => {
    let live = true;
    api<JobProgressResponse>(`/jobs/${job.id}/progress?today=${localDay(new Date())}`).then(
      (res) => {
        if (!live) return;
        if (!res.ok) return setFailed(true);
        setFailed(false);
        setProgress(res.data.progress);
        setTaggingReviewed(
          res.data.progress.stages.some((s) =>
            s.steps.some((step) => step.key === "reviewTagging" && step.state === "done"),
          ),
        );
      },
    );
    return () => {
      live = false;
    };
  }, [job.id, job.updatedAt, job.status, summary, retry]);

  useEffect(() => {
    if (!showNumbers) {
      setSales(null);
      return;
    }
    let live = true;
    api<JobSalesResponse>(`/jobs/${job.id}/sales`).then((res) => {
      if (!live) return;
      setSalesFailed(!res.ok);
      if (res.ok) setSales(res.data.sales);
    });
    return () => {
      live = false;
    };
  }, [job.id, showNumbers]);

  function changedHere(next: Job, message: string) {
    setJob(next);
    setStatus(message);
    changed();
  }

  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start gap-x-14 gap-y-5">
      <div className="flex min-w-0 flex-col gap-5">
        {/* Always rendered so screen readers announce the text when it appears (WCAG 4.1.3). */}
        <p role="status" className="m-0 text-sm text-muted empty:-mb-5">
          {status}
        </p>
        {showNumbers && sales ? <NumberCards sales={sales} /> : null}
        {showNumbers && salesFailed ? (
          <p className="m-0 text-sm text-muted">{t("numbersFailed")}</p>
        ) : null}
        {failed ? (
          <Banner
            tone="danger"
            title={
              <span className="flex flex-wrap items-center gap-3">
                <span>{t("progressFailed")}</span>
                <Button variant="secondary" onClick={() => setRetry((r) => r + 1)}>
                  {t("retry")}
                </Button>
              </span>
            }
          />
        ) : null}
        {progress ? (
          <ProgressCard progress={progress} today={today} onChanged={changedHere} />
        ) : failed ? null : (
          <p className="m-0 text-muted">{t("loading")}</p>
        )}
      </div>
      <DetailsAside onEdit={canManage ? () => setEditing(true) : null} />
      <Dialog open={editing} onClose={() => setEditing(false)} title={tj("form.editTitle")}>
        <JobForm
          job={job}
          onCancel={() => setEditing(false)}
          onSaved={(next) => {
            setEditing(false);
            changedHere(next, tj("detail.saved"));
          }}
        />
      </Dialog>
    </div>
  );
}

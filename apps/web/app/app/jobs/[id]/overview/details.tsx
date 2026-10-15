"use client";

import { Pencil } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { useFormatDay } from "../../status-badge";
import { useJob } from "../job-context";

/**
 * The Overview's side (D152; ADR 0029): "Details", no box, a heading with a hairline under it and a pencil that opens
 * the existing Edit job dialog (owners and admins); rows Client, Picture day and Template with "N changes for this job".
 * Only what is unique to the job; every fact once (D151).
 */
export function DetailsAside({ onEdit }: { onEdit: (() => void) | null }) {
  const t = useTranslations("app.jobOverview.details");
  const formatDay = useFormatDay();
  const { job } = useJob();
  const headingId = useId();
  const changes = job.changedRules.length;
  return (
    <aside aria-labelledby={headingId} className="flex flex-col">
      <div className="mb-4.5 flex items-center justify-between border-b border-line-canvas pb-1.5">
        <h2 id={headingId} className="m-0 text-h3 font-bold text-ink">
          {t("title")}
        </h2>
        {onEdit ? (
          <button
            type="button"
            aria-label={t("edit")}
            aria-haspopup="dialog"
            onClick={onEdit}
            className="-mr-2.5 flex size-11 items-center justify-center rounded-full text-ink hover:bg-surface focus-visible:outline-2 focus-visible:outline-primary"
          >
            <Pencil aria-hidden="true" className="size-4.5" />
          </button>
        ) : null}
      </div>
      <dl className="m-0 flex flex-col gap-5">
        <div className="flex flex-col gap-0.5">
          <dt className="text-label font-normal text-muted">{t("client")}</dt>
          <dd className="m-0 text-title-sm font-semibold text-ink">
            {job.client?.name ?? t("none")}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-label font-normal text-muted">{t("pictureDay")}</dt>
          <dd className="m-0 text-title-sm font-semibold text-ink">{formatDay(job.pictureDay)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-label font-normal text-muted">{t("template")}</dt>
          <dd className="m-0 flex flex-col gap-0.5">
            <span className="text-title-sm font-semibold text-ink">
              {job.template ? (
                <Link
                  href={`/app/settings/templates/${job.template.id}`}
                  className="inline-flex min-h-11 items-center text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {job.template.name}
                </Link>
              ) : (
                t("noTemplate")
              )}
            </span>
            {changes > 0 ? (
              <span className="text-label font-normal text-muted">
                {t("changes", { count: changes })}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
    </aside>
  );
}

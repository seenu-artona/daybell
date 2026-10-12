"use client";

import type { JobDetailResponse } from "@daybell/api";
import { type SellChecklistItem, sellChecklist } from "@daybell/core";
import { Circle, CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";

/**
 * "Before you can sell" (D138): Roster added and Tagging reviewed are real (ADR 0018: the checklist's Review tagging
 * task, from the server, the rule the sell transition will enforce); photos, price list and payouts arrive in later
 * steps and show "Coming soon". The state is always written out, never shown by colour alone (D91).
 */
export function SellChecklist({
  jobId,
  roster,
}: {
  jobId: string;
  /** Children on the roster. */
  roster: number;
}) {
  const t = useTranslations("app.job.checklist");
  const [taggingReviewed, setTaggingReviewed] = useState(false);
  useEffect(() => {
    let live = true;
    void api<JobDetailResponse>(`/jobs/${encodeURIComponent(jobId)}`).then((res) => {
      if (live && res.ok)
        setTaggingReviewed(
          res.data.job.checklist.tasks.some((task) => task.key === "reviewTagging" && task.done),
        );
    });
    return () => {
      live = false;
    };
  }, [jobId]);
  const items: SellChecklistItem[] = sellChecklist({ children: roster, taggingReviewed });
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {items.map((item) => (
        <li key={item.key} className="flex min-h-10 items-center gap-3 text-sm">
          {item.done ? (
            <CircleCheck className="size-5 shrink-0 text-primary" aria-hidden="true" />
          ) : (
            <Circle className="size-5 shrink-0 text-line-strong" aria-hidden="true" />
          )}
          <span className={`flex-1 ${item.soon ? "text-muted" : "font-semibold text-ink"}`}>
            {t(`items.${item.key}`)}
          </span>
          <span className="text-caption text-muted">
            {item.done ? t("done") : item.soon ? t("soon") : t("todo")}
          </span>
        </li>
      ))}
    </ul>
  );
}

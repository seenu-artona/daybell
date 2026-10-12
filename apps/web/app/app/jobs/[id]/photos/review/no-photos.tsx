"use client";

import type { NoPhotosResponse } from "@daybell/api";
import { Card } from "@daybell/ui";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { api } from "@/lib/client-api";
import { useReview } from "./review-context";

/**
 * Children with no photos yet (Seenu, answer 6), for a retake day later: collapsed at the bottom of the review, loaded
 * when opened. It doesn't block Mark reviewed or selling.
 */
export function NoPhotos({ count }: { count: number }) {
  const t = useTranslations("app.photos.review.noPhotos");
  const { jobId, version } = useReview();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<NoPhotosResponse["children"] | null>(null);
  const panelId = useId();

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the reload signal.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void api<NoPhotosResponse>(`/jobs/${encodeURIComponent(jobId)}/tagging/no-photos`).then(
      (res) => {
        if (live && res.ok) setList(res.data.children);
      },
    );
    return () => {
      live = false;
    };
  }, [open, jobId, version]);

  return (
    <Card variant="sheet" asChild>
      <section aria-label={t("title")} className="flex flex-col gap-2 px-5 py-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
          className="flex min-h-11 w-full items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <ChevronDown
            className={`size-5 shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
            aria-hidden="true"
          />
          <span className="flex-1 text-title-sm font-bold text-ink">{t("title")}</span>
          <span className="text-sm text-muted">{t("count", { count })}</span>
        </button>
        <div id={panelId} hidden={!open}>
          <p className="m-0 mb-2 text-sm text-muted">{t("intro")}</p>
          {open && !list ? <p className="m-0 text-muted">{t("loading")}</p> : null}
          {list && list.length === 0 ? <p className="m-0 text-muted">{t("none")}</p> : null}
          {list?.length ? (
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4 p-0">
              {list.map((c) => (
                <li
                  key={c.id}
                  className="flex min-h-10 flex-col justify-center border-t border-line text-sm"
                >
                  <span className="font-semibold text-ink">
                    {t("childName", { first: c.firstName, last: c.lastName })}
                  </span>
                  <span className="text-caption text-muted">{c.group?.name ?? t("noClass")}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>
    </Card>
  );
}

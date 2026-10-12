"use client";

import type { MilestoneView } from "@daybell/core";
import { Card } from "@daybell/ui";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";

/**
 * The job timeline (D140): five milestones in order. Every state is written out, never shown by colour alone (D91):
 * "Done", "Now · 2 of 3 done" (and aria-current="step"), the picture day's date, or "Soon" for what isn't built yet.
 */
export function JobTimeline({
  milestones,
  progress,
  pictureDay,
}: {
  milestones: MilestoneView[];
  /** The current milestone's to-dos, done of total. */
  progress: { done: number; total: number } | null;
  /** The picture day, already formatted. */
  pictureDay: string;
}) {
  const t = useTranslations("app.job.timeline");
  const titleId = useId();
  return (
    <Card variant="sheet" asChild>
      <section aria-labelledby={titleId} className="flex flex-col gap-4 px-7 pt-5 pb-5">
        <div className="flex items-baseline gap-3">
          <h2 id={titleId} className="m-0 flex-1 text-h3 font-bold">
            {t("title")}
          </h2>
          <p className="m-0 text-label text-muted">{t("note")}</p>
        </div>
        <ol aria-labelledby={titleId} className="m-0 grid list-none grid-cols-5 p-0">
          {milestones.map((m, i) => {
            const last = i === milestones.length - 1;
            const name = t(`milestones.${m.key}`);
            return (
              <li
                key={m.key}
                aria-current={m.state === "current" ? "step" : undefined}
                className="flex min-w-0 flex-col gap-2"
              >
                <div className="flex items-center" aria-hidden="true">
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-full text-caption font-extrabold ${
                      m.state === "current"
                        ? "bg-primary text-on-primary ring-4 ring-primary-soft"
                        : m.state === "done"
                          ? "bg-primary-soft text-ink"
                          : "border-2 border-line-strong bg-surface text-muted"
                    }`}
                  >
                    {m.state === "done" ? <Check className="size-4" /> : i + 1}
                  </span>
                  {last ? null : (
                    <span
                      className={`mx-2 h-0.75 flex-1 rounded-full ${
                        m.state === "done" ? "bg-primary" : "bg-line"
                      }`}
                    />
                  )}
                </div>
                <span className="text-title-sm">{name}</span>
                <span
                  className={`text-label ${m.state === "current" ? "text-primary" : "text-muted"}`}
                >
                  {m.state === "done"
                    ? t("done")
                    : m.state === "current"
                      ? progress
                        ? t("nowProgress", progress)
                        : t("now")
                      : m.key === "pictureDay"
                        ? pictureDay
                        : m.soon && m.key !== "setUp"
                          ? t(`hints.${m.key}`)
                          : null}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </Card>
  );
}

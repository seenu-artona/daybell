"use client";

import type { ActivityItem } from "@daybell/api";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { unnamedSubject } from "@/lib/activity";
import { api } from "@/lib/client-api";

/**
 * The activity log (owners and admins). Reads the event log (D96). Studio-wide on Home; with `jobId`, one job's own
 * changes and roster imports (D138). "flat" sits inside a side panel without a card box.
 */
export function ActivityCard({
  refreshKey,
  jobId,
  variant = "card",
}: {
  refreshKey: number;
  jobId?: string;
  variant?: "card" | "flat";
}) {
  const t = useTranslations("app.activity");
  const tr = useTranslations("app.roles");
  const format = useFormatter();
  const [items, setItems] = useState<ActivityItem[] | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey re-fetches after team changes.
  useEffect(() => {
    // Only an id goes in the URL.
    const path = jobId ? `/studio/activity?jobId=${encodeURIComponent(jobId)}` : "/studio/activity";
    api<{ activity: ActivityItem[] }>(path).then((res) => {
      if (res.ok) setItems(res.data.activity);
    });
  }, [refreshKey, jobId]);

  if (!items) return null;
  const flat = variant === "flat";
  return (
    <section
      className={
        flat ? "flex flex-col" : "overflow-hidden rounded-2xl border border-line bg-surface"
      }
    >
      <h2
        className={
          flat ? "m-0 pb-1 text-title-sm" : "m-0 px-5 pt-4 pb-3 text-[15px] leading-5 font-bold"
        }
      >
        {jobId ? t("jobTitle") : t("title")}
      </h2>
      {items.length === 0 ? (
        <p
          className={
            flat ? "m-0 text-sm text-muted" : "m-0 border-t border-line px-5 py-4 text-muted"
          }
        >
          {t("empty")}
        </p>
      ) : (
        <ol
          className={
            flat
              ? "m-0 flex list-none flex-col p-0"
              : "m-0 flex list-none flex-col border-t border-line px-5 py-2"
          }
        >
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm"
            >
              <span>
                {t(item.type, {
                  actor: item.actorEmail ?? t("someone"),
                  subject: item.subjectEmail ?? t("aTeammate"),
                  role: item.role ? tr(item.role).toLowerCase() : "",
                  name: item.subjectName ?? t(unnamedSubject(item.type)),
                })}
              </span>
              <time className="text-caption text-muted" dateTime={item.occurredAt}>
                {format.relativeTime(new Date(item.occurredAt))}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

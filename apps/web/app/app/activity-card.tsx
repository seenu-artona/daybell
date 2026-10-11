"use client";

import type { ActivityItem } from "@daybell/api";
import { Card, CardTitle } from "@daybell/ui";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";

/** The studio's activity log (owners and admins). Reads the event log (D96). */
export function ActivityCard({ refreshKey }: { refreshKey: number }) {
  const t = useTranslations("app.activity");
  const tr = useTranslations("app.roles");
  const format = useFormatter();
  const [items, setItems] = useState<ActivityItem[] | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey re-fetches after team changes.
  useEffect(() => {
    api<{ activity: ActivityItem[] }>("/studio/activity").then((res) => {
      if (res.ok) setItems(res.data.activity);
    });
  }, [refreshKey]);

  if (!items) return null;
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{t("title")}</CardTitle>
      {items.length === 0 ? (
        <p className="m-0 text-muted">{t("empty")}</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-line pb-2 last:border-b-0"
            >
              <span>
                {t(item.type, {
                  actor: item.actorEmail ?? t("someone"),
                  subject: item.subjectEmail ?? t("aTeammate"),
                  role: item.role ? tr(item.role).toLowerCase() : "",
                })}
              </span>
              <time className="text-caption text-muted" dateTime={item.occurredAt}>
                {format.relativeTime(new Date(item.occurredAt))}
              </time>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

"use client";

import type { ActivityItem } from "@daybell/api";
import { Card, CardRow, IconChip } from "@daybell/ui";
import { FilePlus2, Lock, Pencil, QrCode, ShoppingBag, Store, Upload, Users } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { type ActivityIcon, activityChip, unnamedSubject } from "@/lib/activity";
import { api } from "@/lib/client-api";

const ICONS: Record<ActivityIcon, typeof Pencil> = {
  created: FilePlus2,
  edited: Pencil,
  imported: Upload,
  printed: QrCode,
  team: Users,
  studio: Store,
  selling: ShoppingBag,
  closed: Lock,
};

/**
 * The activity log (owners and admins). Reads the event log (D96). Studio-wide on Home; with `jobId`, one job's own
 * changes and roster imports (D138). "sheet" is the D140 white card with hairline rows and a pastel chip per event,
 * on the job's Overview. Its heading is an h2 in both places (D91).
 */
export function ActivityCard({
  refreshKey,
  jobId,
  variant = "card",
}: {
  refreshKey: number;
  jobId?: string;
  variant?: "card" | "sheet";
}) {
  const t = useTranslations("app.activity");
  const tr = useTranslations("app.roles");
  const format = useFormatter();
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const headingId = useId();

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey re-fetches after team changes.
  useEffect(() => {
    // Only an id goes in the URL.
    const path = jobId ? `/studio/activity?jobId=${encodeURIComponent(jobId)}` : "/studio/activity";
    api<{ activity: ActivityItem[] }>(path).then((res) => {
      if (res.ok) setItems(res.data.activity);
    });
  }, [refreshKey, jobId]);

  if (!items) return null;
  const sentence = (item: ActivityItem) =>
    t(item.type, {
      actor: item.actorEmail ?? t("someone"),
      subject: item.subjectEmail ?? t("aTeammate"),
      role: item.role ? tr(item.role).toLowerCase() : "",
      name: item.subjectName ?? t(unnamedSubject(item.type)),
      // A shop closed by its closing date has no actor (ADR 0021): the sentence says so instead of "Someone". Someone
      // who has since left the team still did it (code review S3): "Someone closed the shop".
      hasActor: item.hasActor ? "yes" : "no",
    });
  const when = (item: ActivityItem) => (
    <time className="shrink-0 text-caption text-muted" dateTime={item.occurredAt}>
      {format.relativeTime(new Date(item.occurredAt))}
    </time>
  );

  if (variant === "sheet") {
    return (
      <Card variant="sheet" asChild>
        <section aria-labelledby={headingId}>
          <CardRow>
            <h2 id={headingId} className="m-0 flex-1 text-h3 font-bold">
              {jobId ? t("jobTitle") : t("title")}
            </h2>
          </CardRow>
          {items.length === 0 ? (
            <CardRow asChild>
              <p className="m-0 text-muted">{t("empty")}</p>
            </CardRow>
          ) : (
            <ol className="m-0 list-none p-0">
              {items.map((item) => {
                const chip = activityChip(item.type);
                const Icon = ICONS[chip.icon];
                return (
                  <CardRow key={item.id} asChild>
                    <li className="py-2 text-sm">
                      <IconChip tone={chip.tone}>
                        <Icon />
                      </IconChip>
                      <span className="min-w-0 flex-1 font-semibold break-words">
                        {sentence(item)}
                      </span>
                      {when(item)}
                    </li>
                  </CardRow>
                );
              })}
            </ol>
          )}
        </section>
      </Card>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <h2 className="m-0 px-5 pt-4 pb-3 text-[15px] leading-5 font-bold">
        {jobId ? t("jobTitle") : t("title")}
      </h2>
      {items.length === 0 ? (
        <p className="m-0 border-t border-line px-5 py-4 text-muted">{t("empty")}</p>
      ) : (
        <ol className="m-0 flex list-none flex-col border-t border-line px-5 py-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm"
            >
              <span>{sentence(item)}</span>
              {when(item)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

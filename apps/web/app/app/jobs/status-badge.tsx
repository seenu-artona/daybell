"use client";

import type { Job } from "@daybell/api";
import { Badge } from "@daybell/ui";
import { Lock, PencilLine, Store } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

const LOOK = {
  draft: { tone: "draft", Icon: PencilLine },
  selling: { tone: "selling", Icon: Store },
  closed: { tone: "warning", Icon: Lock },
} as const;

/** A job's status as a word and an icon; colour only supports it (D91). */
export function StatusBadge({ status }: { status: Job["status"] }) {
  const t = useTranslations("app.jobs.statuses");
  const { tone, Icon } = LOOK[status];
  return (
    <Badge tone={tone} className="before:hidden">
      <Icon className="size-3.5" aria-hidden="true" />
      {t(status)}
    </Badge>
  );
}

/** "2026-10-14" as a local calendar date, e.g. "Oct 14, 2026". Formatted in UTC so it never shifts a day. */
export function useFormatDay(): (day: string) => string {
  const format = useFormatter();
  return (day) =>
    format.dateTime(new Date(`${day}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
}

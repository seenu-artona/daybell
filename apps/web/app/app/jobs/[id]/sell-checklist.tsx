"use client";

import { type SellChecklistItem, sellChecklist } from "@daybell/core";
import { Circle, CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * "Before you can sell" (D138): Roster added, Tagging reviewed (ADR 0018: the checklist's Review tagging task, from
 * the job page's own checklist data, the rule the sell transition will enforce), Price list chosen (ADR 0019: every
 * job has one) and Payouts connected (ADR 0020: the studio's payout account is Active) are real; photos arrive in a
 * later step and show "Coming soon", as payouts do where they aren't offered yet. The state is always written
 * out, never shown by colour alone (D91).
 */
export function SellChecklist({
  roster,
  taggingReviewed,
  hasPriceList,
  payoutsConnected,
}: {
  /** Children on the roster. */
  roster: number;
  /** The checklist's Review tagging task is done. */
  taggingReviewed: boolean;
  /** The job has a price list. */
  hasPriceList: boolean;
  /** The studio's payout account is Active; null where payouts aren't offered yet. */
  payoutsConnected: boolean | null;
}) {
  const t = useTranslations("app.job.checklist");
  const items: SellChecklistItem[] = sellChecklist({
    children: roster,
    taggingReviewed,
    hasPriceList,
    payoutsConnected,
  });
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

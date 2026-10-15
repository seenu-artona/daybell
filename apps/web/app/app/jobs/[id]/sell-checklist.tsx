"use client";

import type { SellChecklistKey } from "@daybell/core";
import { Circle, CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import type { SellItemState } from "./going-live";

/**
 * "Before you can sell" (D138; ADR 0021): Roster added, Photos uploaded, Tagging reviewed, Something to sell (the job
 * sells at least one item; once "Price list chosen", ADR 0033) and Payouts connected, all real and all checked again by the server when the shop opens. The price
 * list and payouts say "Checking…" until they have been read. The state is always written out, never shown by colour
 * alone (D91).
 */
export function SellChecklist({
  items,
}: {
  items: readonly { key: SellChecklistKey; state: SellItemState }[];
}) {
  const t = useTranslations("app.job.checklist");
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {items.map((item) => (
        <li key={item.key} className="flex min-h-10 items-center gap-3 text-sm">
          {item.state === "done" ? (
            <CircleCheck className="size-5 shrink-0 text-primary" aria-hidden="true" />
          ) : (
            <Circle className="size-5 shrink-0 text-line-strong" aria-hidden="true" />
          )}
          <span className="flex-1 font-semibold text-ink">{t(`items.${item.key}`)}</span>
          <span className="text-caption text-muted">
            {item.state === "checking"
              ? t("checking")
              : item.state === "done"
                ? t("done")
                : t("todo")}
          </span>
        </li>
      ))}
    </ul>
  );
}

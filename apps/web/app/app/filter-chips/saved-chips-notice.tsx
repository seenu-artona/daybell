"use client";

import { Banner } from "@daybell/ui";
import { useTranslations } from "next-intl";
import type { ListFilters } from "./use-list-filters";

/**
 * What went wrong with the person's saved chips (D147): they couldn't be loaded (with Retry; meanwhile the built-in
 * chips work and nothing can be added or removed), or the last change couldn't be saved and was undone.
 */
export function SavedChipsNotice({
  filters,
}: {
  filters: Pick<ListFilters, "loadFailed" | "saveFailed" | "retry">;
}) {
  const t = useTranslations("app.chips");
  if (filters.loadFailed)
    return (
      <Banner
        tone="danger"
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span>{t("loadFailed")}</span>
            <button
              type="button"
              onClick={filters.retry}
              className="min-h-11 font-bold underline focus-visible:outline-2 focus-visible:outline-primary"
            >
              {t("retry")}
            </button>
          </span>
        }
      />
    );
  return filters.saveFailed ? <Banner tone="danger" title={t("saveFailed")} /> : null;
}

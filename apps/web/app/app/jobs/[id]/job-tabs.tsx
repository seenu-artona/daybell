"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useJob } from "./job-context";
import { JOB_TABS, tabForPath, tabHref } from "./tabs";

/**
 * The job's sections (D137). Separate routes, so a navigation of links with aria-current, not an ARIA tablist.
 * People shows how many children are on the roster.
 */
export function JobTabs() {
  const t = useTranslations("app.job.tabs");
  const { job, summary } = useJob();
  const current = tabForPath(usePathname());
  return (
    <nav aria-label={t("label")} className="border-b border-line bg-surface px-4">
      <ul className="m-0 flex list-none gap-1 p-0">
        {JOB_TABS.map((tab) => {
          const active = current === tab.key;
          const count = tab.key === "people" ? summary?.children : undefined;
          return (
            <li key={tab.key}>
              <Link
                href={tabHref(job.id, tab.key)}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-11 items-center gap-2 rounded-t-md px-3 text-sm no-underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${
                  active
                    ? "font-bold text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-t-full after:bg-primary"
                    : "font-medium text-muted hover:text-ink"
                }`}
              >
                {t(tab.key)}
                {count !== undefined && count > 0 ? " " : null}
                {count !== undefined && count > 0 ? (
                  <span className="rounded-full bg-subtle px-2 text-caption font-semibold text-ink">
                    <span aria-hidden="true">{count}</span>
                    <span className="sr-only">{t("peopleCount", { count })}</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

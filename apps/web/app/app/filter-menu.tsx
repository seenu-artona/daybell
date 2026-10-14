"use client";

import { iconButtonVariants } from "@daybell/ui";
import { Funnel } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Popover } from "./popover";

export interface FilterOption {
  value: string;
  label: string;
}

/** One filter in the panel: a named group of radio buttons. */
export interface FilterGroup {
  key: string;
  /** The group's name: "Delivery". */
  legend: string;
  options: readonly FilterOption[];
  value: string;
  /** The choice that filters nothing ("" by default), e.g. Subjects' "Group by: None". */
  initial?: string;
  onChange: (value: string) => void;
}

/** How many of the groups are set to something other than their first, unfiltered choice. */
export function filtersOn(groups: readonly Pick<FilterGroup, "value" | "initial">[]): number {
  return groups.filter((g) => g.value !== (g.initial ?? "")).length;
}

/**
 * Every filter of a list behind one 44px filter icon (D145, amends D144), at the right end of its view bar before
 * the search. Its name is "Filter", or "Filter (2 on)" while filters are set, which a small dot shows too (the words
 * are read, so it is never colour alone, D91). It opens a panel with one named group of radio buttons per filter:
 * choosing applies at once and keeps the panel open, so arrow keys move through the choices; Escape or a click outside
 * closes it. While a filter is set, Clear filters resets them all, closes the panel and puts focus back on the icon.
 */
export function FilterMenu({
  groups,
  onClear,
}: {
  groups: readonly FilterGroup[];
  onClear: () => void;
}) {
  const t = useTranslations("app.filters");
  const id = useId();
  const on = filtersOn(groups);
  return (
    <Popover
      label={on > 0 ? t("labelOn", { count: on }) : t("label")}
      trigger={
        <>
          <Funnel aria-hidden="true" />
          {on > 0 ? (
            <span
              aria-hidden="true"
              data-filter-dot=""
              className="absolute top-2 right-2 size-2.5 rounded-full bg-primary ring-2 ring-canvas"
            />
          ) : null}
        </>
      }
      triggerClassName={`relative ${iconButtonVariants({ tone: "quiet" })}`}
      panelClassName="flex max-h-[70vh] w-72 flex-col gap-3 overflow-y-auto p-3"
    >
      {(_close, closeToButton) => (
        <>
          {groups.map((group) => (
            <fieldset key={group.key} className="m-0 flex flex-col border-0 p-0">
              <legend className="mb-1 p-0 text-label text-ink">{group.legend}</legend>
              {group.options.map((option) => (
                <label
                  key={option.value}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-1 text-sm text-ink hover:bg-subtle"
                >
                  <input
                    type="radio"
                    name={`${id}-${group.key}`}
                    value={option.value}
                    checked={group.value === option.value}
                    onChange={() => group.onChange(option.value)}
                    className="size-5 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  />
                  <span className="min-w-0 break-words">{option.label}</span>
                </label>
              ))}
            </fieldset>
          ))}
          {on > 0 ? (
            <button
              type="button"
              onClick={() => {
                onClear();
                // The button goes away with the panel: focus goes back to the icon, not to the page (WCAG 2.4.3).
                closeToButton();
              }}
              className="flex min-h-11 items-center self-start rounded-full px-3 text-body font-semibold text-ink hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t("clear")}
            </button>
          ) : null}
        </>
      )}
    </Popover>
  );
}

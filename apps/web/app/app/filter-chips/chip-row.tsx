"use client";

import { FilterChip, FilterChips } from "@daybell/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { type AddFilterChoice, AddFilterMenu } from "./add-filter-menu";

/** One chip in a list's row: built in (All, Draft…) or added by the person (with a remove button). */
export interface ChipItem {
  /** Stable React key, e.g. "status:draft" or "client:<id>". */
  id: string;
  label: string;
  selected: boolean;
  /** A chip with its own address (?status=…): a link. Without one, a button (a choice kept in the browser). */
  href?: string;
  /** Called when the chip is chosen (as well as following its link, if it has one). */
  onSelect?: () => void;
  /** Added chips only: removes the chip (and, if it was selected, goes back to All). */
  onRemove?: () => void;
  /** The remove button's name when the label isn't the chip's name yet (still loading): e.g. "Remove filter: Client". */
  removeLabel?: string;
}

const CHIP_TARGET = "[data-chip-target]";

/**
 * A list's chips and its "+ Add filter" menu (D147, ADR 0026), for the toolbar of its list card. Links change the
 * address and are not scrolled to; browser-only chips (a grade) are buttons. When a chip is added or removed and the
 * control that had focus goes away (the menu's pill once nothing is left to add, a remove button), focus moves to the
 * selected chip rather than being lost (WCAG 2.4.3).
 */
export function ChipRow({
  label,
  items,
  choices = [],
}: {
  /** The chips' navigation name, e.g. "Show jobs". */
  label: string;
  items: readonly ChipItem[];
  /** What "+ Add filter" offers: only what the list doesn't have yet. */
  choices?: readonly AddFilterChoice[];
}) {
  const t = useTranslations("app.chips");
  const row = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after the chips change.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const chips = row.current?.querySelectorAll<HTMLElement>(CHIP_TARGET);
    const selected = row.current?.querySelector<HTMLElement>(`${CHIP_TARGET}[aria-current]`);
    (selected ?? chips?.[0])?.focus();
  }, [items, choices]);

  const wrapped = choices.map((choice) => ({
    ...choice,
    onPick: (...args: never[]) => {
      refocus.current = true;
      (choice.onPick as (...a: never[]) => void)(...args);
    },
  })) as AddFilterChoice[];

  return (
    <div ref={row}>
      <FilterChips label={label} addFilter={<AddFilterMenu choices={wrapped} />}>
        {items.map((item) => (
          <FilterChip
            key={item.id}
            asChild
            selected={item.selected}
            {...(item.onRemove
              ? {
                  remove: {
                    label: item.removeLabel ?? t("remove", { name: item.label }),
                    onRemove: () => {
                      refocus.current = true;
                      item.onRemove?.();
                    },
                  },
                }
              : {})}
          >
            {item.href ? (
              <Link
                href={item.href}
                scroll={false}
                data-chip-target=""
                {...(item.onSelect ? { onClick: item.onSelect } : {})}
              >
                {item.label}
              </Link>
            ) : (
              <button
                type="button"
                data-chip-target=""
                {...(item.onSelect ? { onClick: item.onSelect } : {})}
              >
                {item.label}
              </button>
            )}
          </FilterChip>
        ))}
      </FilterChips>
    </div>
  );
}

"use client";

import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { Popover } from "./popover";

export interface QuietMenuOption {
  value: string;
  label: string;
}

/**
 * A quiet menu in a view bar (D144), e.g. "Delivery: Any ▾": a text button whose visible words are its accessible
 * name (WCAG 2.5.3), opening a group of radio buttons. Choosing keeps it open, so arrow keys move through the choices
 * and each one applies as it is reached; Escape or a click outside closes it.
 */
export function QuietMenu({
  label,
  legend,
  options,
  value,
  onChange,
}: {
  /** The trigger's words, with the current choice: "Delivery: Any". */
  label: string;
  /** The group's name inside the menu: "Delivery". */
  legend: string;
  options: readonly QuietMenuOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <Popover
      trigger={
        <>
          <span>{label}</span>
          <ChevronDown aria-hidden="true" className="text-muted" />
        </>
      }
      triggerClassName="gap-1.5 rounded-full px-3 text-body font-semibold text-ink hover:bg-surface [&_svg]:size-4"
      panelClassName="w-64 p-3"
    >
      {() => (
        <fieldset className="m-0 flex flex-col border-0 p-0">
          <legend className="mb-1 p-0 text-label text-ink">{legend}</legend>
          {options.map((option) => (
            <label
              key={option.value}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-1 text-sm text-ink hover:bg-subtle"
            >
              <input
                type="radio"
                name={`${id}-choice`}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      )}
    </Popover>
  );
}

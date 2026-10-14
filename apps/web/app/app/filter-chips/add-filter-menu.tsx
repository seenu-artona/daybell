"use client";

import { AddFilterLabel, addFilterTriggerClass } from "@daybell/ui";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Combobox, type ComboboxOption } from "../combobox";
import { MENU_ROW, Popover } from "../popover";

/** A choice that adds its chip at once, e.g. "Shop closes this week". */
export interface PlainChoice {
  kind: "plain";
  id: string;
  label: string;
  onPick: () => void;
}

/** A choice that asks which record first, e.g. "Client…": a second step with a searchable field and Back. */
export interface SearchChoice {
  kind: "search";
  id: string;
  /** The menu row, ending in "…". */
  label: string;
  /** The field's visible label in the second step, e.g. "Client". */
  fieldLabel: string;
  placeholder: string;
  /** The options list's name, e.g. "Clients". */
  listLabel: string;
  /** Records matching what is typed: the API (clients, jobs) or a list already loaded (grades). */
  search: (query: string) => Promise<ComboboxOption[] | null>;
  onPick: (option: ComboboxOption) => void;
}

export type AddFilterChoice = PlainChoice | SearchChoice;

/**
 * "+ Add filter" after a list's chips (D147, ADR 0026): a dashed pill opening a small panel headed "Show only", one
 * plain row per choice the list doesn't have yet. A plain choice adds its chip and closes the panel; a choice ending in
 * "…" opens a second step in the same panel with Back and a searchable field (the existing combobox), and picking a
 * record adds its chip. Focus goes into the second step, back to its row on Back, and to the pill when the panel
 * closes (a chip added, Escape). Nothing shows when there is nothing left to add.
 */
export function AddFilterMenu({ choices }: { choices: readonly AddFilterChoice[] }) {
  const t = useTranslations("app.chips");
  if (choices.length === 0) return null;
  return (
    <Popover
      trigger={<AddFilterLabel>{t("addFilter")}</AddFilterLabel>}
      triggerClassName={addFilterTriggerClass}
      placement="below-start"
      panelClassName="flex w-80 flex-col gap-1 p-2"
    >
      {(_close, closeToButton) => <MenuPanel choices={choices} done={closeToButton} />}
    </Popover>
  );
}

function MenuPanel({
  choices,
  done,
}: {
  choices: readonly AddFilterChoice[];
  /** Closes the panel and puts focus back on the pill. */
  done: () => void;
}) {
  const t = useTranslations("app.chips");
  const headingId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<SearchChoice | null>(null);
  // Where focus goes after a step change: into the field, or back to the row that opened it.
  const focusNext = useRef<string | null>(null);

  useLayoutEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    panel.current?.querySelector<HTMLElement>(target)?.focus();
  });

  if (step) {
    return (
      <div ref={panel} className="flex flex-col gap-2">
        <button
          type="button"
          className={MENU_ROW}
          onClick={() => {
            focusNext.current = `[data-choice="${step.id}"]`;
            setStep(null);
          }}
        >
          <ArrowLeft aria-hidden="true" />
          {t("back")}
        </button>
        <div className="px-1 pb-1">
          <Combobox
            label={step.fieldLabel}
            placeholder={step.placeholder}
            listLabel={step.listLabel}
            value={null}
            search={step.search}
            onChange={(option) => {
              if (!option) return;
              step.onPick(option);
              done();
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={panel} className="flex flex-col">
      <p id={headingId} className="m-0 px-3 pt-1 pb-1.5 text-label text-muted">
        {t("showOnly")}
      </p>
      {/* A job with many classes: the list scrolls inside the panel rather than running off the window. */}
      <ul
        aria-labelledby={headingId}
        className="m-0 flex max-h-[min(60vh,28rem)] list-none flex-col overflow-y-auto p-0"
      >
        {choices.map((choice) => (
          <li key={choice.id}>
            <button
              type="button"
              data-choice={choice.id}
              className={MENU_ROW}
              onClick={() => {
                if (choice.kind === "plain") {
                  choice.onPick();
                  done();
                  return;
                }
                focusNext.current = '[role="combobox"]';
                setStep(choice);
              }}
            >
              {choice.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

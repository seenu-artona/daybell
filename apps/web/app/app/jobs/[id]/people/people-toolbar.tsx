"use client";

import type { Group } from "@daybell/api";
import {
  addFilter,
  type GroupLabel,
  type PeopleFilter,
  type PeopleFilterKind,
  removeFilter,
} from "@daybell/core";
import { iconButtonVariants } from "@daybell/ui";
import { ListFilter, Rows3, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { CheckboxField, SelectField } from "../../../dialog";
import { Popover } from "../../../popover";

export type GroupBy = "group" | "none";

/** A round tool with a dot when it is in use; the dot is decorative (the chips and the label say so in words). */
const ACTIVE_DOT =
  "relative after:absolute after:top-2 after:right-2 after:size-2 after:rounded-full after:bg-primary after:content-['']";

const FLAG_FILTERS = ["doNotPhotograph", "doNotPublish", "duplicates", "noGroup"] as const;

/**
 * People's tools (D138, D140): a visible search box and two round 44px icon buttons, Filter and Group (named
 * "Group: None" or "Group: Class"). Filters are native controls in popovers. The search text and filters stay in
 * this browser: they are never sent or put in the URL.
 */
export function PeopleToolbar({
  query,
  onQuery,
  filters,
  onFilters,
  groupBy,
  onGroupBy,
  groups,
  grades,
  word,
}: {
  query: string;
  onQuery: (query: string) => void;
  filters: PeopleFilter[];
  onFilters: (filters: PeopleFilter[]) => void;
  groupBy: GroupBy;
  onGroupBy: (groupBy: GroupBy) => void;
  groups: Group[];
  grades: string[];
  word: GroupLabel;
}) {
  const t = useTranslations("app.people");
  const tr = useTranslations("app.roster");
  const id = useId();
  const has = (kind: PeopleFilterKind) => filters.some((f) => f.kind === kind);
  const groupFilter = filters.find((f) => f.kind === "group");
  const gradeFilter = filters.find((f) => f.kind === "grade");
  const toggle = (kind: (typeof FLAG_FILTERS)[number], on: boolean) =>
    onFilters(on ? addFilter(filters, { kind }) : removeFilter(filters, kind));

  return (
    <>
      <label className="flex h-11 w-60 items-center gap-2 rounded-full bg-surface px-4 text-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="sr-only">{t("searchLabel")}</span>
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("searchLabel")}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
        />
      </label>

      <Popover
        label={t("filter")}
        trigger={<ListFilter aria-hidden="true" />}
        triggerClassName={`${iconButtonVariants()} ${filters.length > 0 ? ACTIVE_DOT : ""}`}
        panelClassName="flex w-72 flex-col gap-3 p-4"
      >
        {() => (
          <>
            <SelectField
              label={tr("filter", { group: word })}
              value={groupFilter?.kind === "group" ? groupFilter.id : ""}
              onChange={(value) =>
                onFilters(
                  value
                    ? addFilter(filters, { kind: "group", id: value })
                    : removeFilter(filters, "group"),
                )
              }
              options={[
                { value: "", label: t("anyGroup", { group: word }) },
                ...groups.map((g) => ({ value: g.id, label: g.name })),
              ]}
            />
            <SelectField
              label={t("grade")}
              value={gradeFilter?.kind === "grade" ? gradeFilter.value : ""}
              onChange={(value) =>
                onFilters(
                  value
                    ? addFilter(filters, { kind: "grade", value })
                    : removeFilter(filters, "grade"),
                )
              }
              options={[
                { value: "", label: t("anyGrade") },
                ...grades.map((g) => ({ value: g, label: g })),
              ]}
            />
            <fieldset className="m-0 flex flex-col border-0 p-0">
              <legend className="mb-1 p-0 text-label text-ink">{t("show")}</legend>
              {FLAG_FILTERS.map((kind) => (
                <CheckboxField
                  key={kind}
                  label={kind === "noGroup" ? tr("noGroup", { group: word }) : t(`flags.${kind}`)}
                  checked={has(kind)}
                  onChange={(on) => toggle(kind, on)}
                />
              ))}
            </fieldset>
          </>
        )}
      </Popover>

      <Popover
        label={t("groupBy", {
          by: groupBy === "group" ? tr("filter", { group: word }) : t("groupNone"),
        })}
        trigger={<Rows3 aria-hidden="true" />}
        triggerClassName={`${iconButtonVariants()} ${groupBy === "group" ? ACTIVE_DOT : ""}`}
        panelClassName="w-56 p-3"
      >
        {() => (
          <fieldset className="m-0 flex flex-col border-0 p-0">
            <legend className="mb-1 p-0 text-label text-ink">{t("groupByLegend")}</legend>
            {(["group", "none"] as const).map((value) => (
              <label
                key={value}
                className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink"
              >
                <input
                  type="radio"
                  name={`${id}-group-by`}
                  checked={groupBy === value}
                  // Stays open: arrow keys move between radios and change the choice as they go.
                  onChange={() => onGroupBy(value)}
                  className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                />
                {value === "group" ? tr("filter", { group: word }) : t("groupNone")}
              </label>
            ))}
          </fieldset>
        )}
      </Popover>
    </>
  );
}

/** The active filters as removable chips, under People's heading row. */
export function FilterChips({
  filters,
  onFilters,
  groups,
  word,
}: {
  filters: PeopleFilter[];
  onFilters: (filters: PeopleFilter[]) => void;
  groups: Group[];
  word: GroupLabel;
}) {
  const t = useTranslations("app.people");
  const tr = useTranslations("app.roster");
  if (filters.length === 0) return null;
  const label = (f: PeopleFilter): string => {
    switch (f.kind) {
      case "group":
        return t("chips.group", {
          group: word,
          name: groups.find((g) => g.id === f.id)?.name ?? "",
        });
      case "grade":
        return t("chips.grade", { grade: f.value });
      case "noGroup":
        return tr("noGroup", { group: word });
      default:
        return t(`flags.${f.kind}`);
    }
  };
  return (
    <ul
      aria-label={t("activeFilters")}
      className="m-0 flex list-none flex-wrap items-center gap-2 p-0"
    >
      {filters.map((f) => (
        <li key={f.kind}>
          <button
            type="button"
            aria-label={t("removeFilter", { filter: label(f) })}
            onClick={() => onFilters(removeFilter(filters, f.kind))}
            className="flex h-11 items-center gap-1.5 rounded-full bg-primary-soft px-4 text-label font-semibold text-primary-hover hover:bg-primary-soft/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {label(f)}
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

"use client";

import type { Child } from "@daybell/api";
import type { GroupLabel, PeopleSection } from "@daybell/core";
import { Badge, Table, TableCell, TableHead, TableRow } from "@daybell/ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { HIT_44 } from "../hit-area";

const COLUMNS = 4;

/** The DOM id of a child's name link, so focus can return to it when the side panel closes. */
export const rowLinkId = (childId: string) => `child-link-${childId}`;

/**
 * People's list (D137, D138): one flat table on white, 40px rows, grouped by class with grey heading rows that
 * collapse. Each row opens the child in the side panel: the name is a real link (the keyboard target, ?child=<id>),
 * and a click anywhere on the row does the same.
 */
export function PeopleList({
  sections,
  grouped,
  collapsed,
  onToggle,
  selectedId,
  childHref,
  onOpen,
  onLinkOpen,
  onRename,
  word,
  busy,
}: {
  sections: PeopleSection<Child>[];
  grouped: boolean;
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
  selectedId: string | null;
  childHref: (childId: string) => string;
  /** A row was clicked: open the child (the page updates the URL). */
  onOpen: (childId: string) => void;
  /** The name link was used: it updates the URL itself; the page only notes who opened the panel. */
  onLinkOpen: (childId: string) => void;
  /** Roster editors rename a class from its heading; null for everyone else. */
  onRename: ((group: { id: string; name: string }) => void) | null;
  word: GroupLabel;
  busy: boolean;
}) {
  const t = useTranslations("app.people");
  const tr = useTranslations("app.roster");
  const id = useId();

  return (
    <Table variant="flat" aria-busy={busy}>
      <thead>
        <TableRow>
          <TableHead className="h-10 py-0 pl-6">{tr("columns.name")}</TableHead>
          <TableHead className="h-10 py-0">{tr("columns.studentId")}</TableHead>
          <TableHead className="h-10 py-0">{tr("columns.grade")}</TableHead>
          <TableHead className="h-10 py-0 pr-6">{tr("columns.accessCode")}</TableHead>
        </TableRow>
      </thead>
      {sections.map((section) => {
        const bodyId = `${id}-${section.key}`;
        const open = !collapsed.has(section.key);
        const name = section.group?.name ?? tr("noGroup", { group: word });
        return (
          <tbody key={section.key} id={bodyId}>
            {grouped ? (
              <tr className="border-b border-line bg-canvas">
                <th colSpan={COLUMNS} scope="rowgroup" className="h-10 px-4 py-0 text-left">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={bodyId}
                      onClick={() => onToggle(section.key)}
                      className={`${HIT_44} flex h-8 items-center gap-2 rounded-sm px-2 text-label font-bold text-ink hover:bg-subtle focus-visible:outline-2 focus-visible:outline-primary`}
                    >
                      {open ? (
                        <ChevronDown className="size-4" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="size-4" aria-hidden="true" />
                      )}
                      {name}{" "}
                      <span className="font-medium text-muted">
                        {tr("childCount", { count: section.rows.length })}
                      </span>
                    </button>
                    {onRename && section.group ? (
                      <button
                        type="button"
                        aria-label={t("renameLabel", { group: word, name: section.group.name })}
                        onClick={() => section.group && onRename(section.group)}
                        className={`${HIT_44} flex h-8 items-center rounded-sm px-2 text-label font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary`}
                      >
                        {t("rename")}
                      </button>
                    ) : null}
                  </div>
                </th>
              </tr>
            ) : null}
            {open
              ? section.rows.map((child) => {
                  const selected = child.id === selectedId;
                  return (
                    <TableRow
                      key={child.id}
                      onClick={(e) => {
                        // The name link handles its own clicks.
                        if (!(e.target as HTMLElement).closest("a, button")) onOpen(child.id);
                      }}
                      className={`h-10 cursor-pointer ${selected ? "bg-primary-soft [tbody_&]:hover:bg-primary-soft" : ""}`}
                    >
                      <TableCell className="py-0 pl-6">
                        <span className="flex items-center gap-2">
                          <Link
                            id={rowLinkId(child.id)}
                            href={childHref(child.id)}
                            replace
                            scroll={false}
                            aria-current={selected ? "true" : undefined}
                            onClick={() => onLinkOpen(child.id)}
                            className="font-semibold text-ink no-underline hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                          >
                            {child.firstName} {child.lastName}
                          </Link>
                          {child.doNotPhotograph ? (
                            <Badge tone="danger" className="h-5 px-2 text-micro">
                              {tr("badges.doNotPhotograph")}
                            </Badge>
                          ) : null}
                          {child.duplicate ? (
                            <Badge tone="warning" className="h-5 px-2 text-micro">
                              {t("duplicateBadge")}
                            </Badge>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="py-0">{child.studentId ?? ""}</TableCell>
                      <TableCell className="py-0">{child.grade ?? ""}</TableCell>
                      {child.accessCode ? (
                        <TableCell className="py-0 pr-6 font-mono font-semibold tracking-wider whitespace-nowrap">
                          {child.accessCode}
                        </TableCell>
                      ) : (
                        <TableCell className="py-0 pr-6 text-muted">
                          {tr("codeUnavailable")}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              : null}
          </tbody>
        );
      })}
    </Table>
  );
}

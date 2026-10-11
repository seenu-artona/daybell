"use client";

import type { Child } from "@daybell/api";
import type { GroupLabel, PeopleSection } from "@daybell/core";
import { Badge, IconChip, Table, TableCell, TableHead, TableRow } from "@daybell/ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { avatarTone, childInitials } from "./avatar";

const COLUMNS = 5;

/** The DOM id of a child's name link, so focus can return to it when the panel closes. */
export const rowLinkId = (childId: string) => `child-link-${childId}`;

/**
 * People's list (D140): one table in a white sheet card, 60px hairline rows, each with an initials avatar
 * (decorative) and a Class column. Flat by default; with Group: Class, each class gets a heading row that collapses.
 * Each row opens the child in the floating panel: the name is a real link (the keyboard target, ?child=<id>), and
 * a click anywhere on the row does the same.
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
  const noGroup = tr("noGroup", { group: word });

  return (
    <div className="overflow-hidden rounded-xl bg-surface px-3">
      <Table variant="flat" aria-busy={busy}>
        <thead>
          <TableRow>
            <TableHead className="h-13 py-0 pl-4 text-label font-medium">
              {tr("columns.name")}
            </TableHead>
            <TableHead className="h-13 py-0 text-label font-medium">
              {tr("columns.group", { group: word })}
            </TableHead>
            <TableHead className="h-13 py-0 text-label font-medium">
              {tr("columns.studentId")}
            </TableHead>
            <TableHead className="h-13 py-0 text-label font-medium">
              {tr("columns.grade")}
            </TableHead>
            <TableHead className="h-13 py-0 pr-4 text-right text-label font-medium">
              {tr("columns.accessCode")}
            </TableHead>
          </TableRow>
        </thead>
        {sections.map((section) => {
          const bodyId = `${id}-${section.key}`;
          const open = !collapsed.has(section.key);
          const name = section.group?.name ?? noGroup;
          return (
            <tbody key={section.key} id={bodyId}>
              {grouped ? (
                <tr className="border-b border-line">
                  <th colSpan={COLUMNS} scope="rowgroup" className="h-14 px-2 py-0 text-left">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={bodyId}
                        onClick={() => onToggle(section.key)}
                        className="flex min-h-11 items-center gap-2 rounded-full px-3 text-label font-bold text-ink hover:bg-subtle focus-visible:outline-2 focus-visible:outline-primary"
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
                          className="flex min-h-11 items-center rounded-full px-3 text-label font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
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
                        className={`h-15 cursor-pointer text-body-lg ${selected ? "bg-primary-soft [tbody_&]:hover:bg-primary-soft" : ""}`}
                      >
                        <TableCell className="py-0 pl-4">
                          <span className="flex items-center gap-3">
                            <IconChip shape="round" tone={avatarTone(child.id)}>
                              {childInitials(child.firstName, child.lastName)}
                            </IconChip>
                            <Link
                              id={rowLinkId(child.id)}
                              href={childHref(child.id)}
                              replace
                              scroll={false}
                              aria-current={selected ? "true" : undefined}
                              onClick={() => onLinkOpen(child.id)}
                              className="inline-flex min-h-11 min-w-11 items-center font-bold text-ink no-underline hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                            >
                              {child.firstName} {child.lastName}
                            </Link>
                            {child.doNotPhotograph ? (
                              <Badge tone="danger" className="h-6 rounded-sm px-2 before:hidden">
                                {tr("badges.doNotPhotograph")}
                              </Badge>
                            ) : null}
                            {child.duplicate ? (
                              <Badge tone="warning" className="h-6 rounded-sm px-2 before:hidden">
                                {t("duplicateBadge")}
                              </Badge>
                            ) : null}
                          </span>
                        </TableCell>
                        <TableCell className="py-0">
                          <span className="inline-flex h-7 items-center rounded-sm bg-canvas px-2.5 text-label text-muted">
                            {child.group?.name ?? noGroup}
                          </span>
                        </TableCell>
                        <TableCell className="py-0 text-muted">{child.studentId ?? ""}</TableCell>
                        <TableCell className="py-0">{child.grade ?? ""}</TableCell>
                        {child.accessCode ? (
                          <TableCell className="py-0 pr-4 text-right font-mono font-bold tracking-wider whitespace-nowrap">
                            {child.accessCode}
                          </TableCell>
                        ) : (
                          <TableCell className="py-0 pr-4 text-right text-muted">
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
    </div>
  );
}
